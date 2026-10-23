"""Compute the CN rankings held side by side in the database.

  method 1  'official'  The values published on the site, copied verbatim.
                        Nothing is recomputed: this is the reference.

  method 2  'fair'      "Fit", the usual level: the weighted mean of the best 60 % of
                        the scores in the window (championnat de France 2,
                        national race 1.5, other 1), with NO annual step: the
                        level is held by a daily recalage applied to each
                        race once. Only runners with a CN of their own value
                        a circuit, by the arithmetic mean of CN x time over the
                        fastest share of them (forest 90 %, sprint 2/3, VTT and
                        ski 75 %; since 2026-10-16).

  method 3  'top6w'     the Ozimut method, published (the « Top » until 2026-10-19): the same
                        race scores as 'fair' (derived from it, not recomputed), but the
                        index keeps only the best races filling 6 weight places - it rewards racing.

The geometric pair ('fair3', 'top6w3': a geometric circuit value with a tail dial, a cubic
usual level; published from 2026-10-13 to 2026-10-16, an analysis method until 2026-10-19)
was removed on 2026-10-19 (owner): forest -0.02 point of duels, sprint +0.15 against the
arithmetic method, which anyone can follow by hand. Its code is in git history.

For both computed methods forest, sprint, VTT and ski are independent
rankings in every season — the federation only split forest and sprint in
2026, but applying one rule uniformly is the point of recomputing.

Everything is processed in date order because the layers are mutually
dependent: a circuit's value needs the runners' CNs, which come from their
earlier scores. That is sound rather than circular because the CN a race uses
is the one from 15 days earlier.
"""

from __future__ import annotations

import dataclasses
import math
import logging
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .cn import (
    CnParams,
    Decimal_round,
    RunnerHistory,
    circuit_value,
    classify_status,
    is_nc,
    is_junior,
    group_weight,
    race_weight,
    parse_time,
    sexe_of,
    to_int,
    top_n_weighted,
    trimmed_mean,
)

logger = logging.getLogger("ffco_scraper.cn_engine")

# "coefficient de régulation des 10000 points" (k/1000). RC 2023 noted k=950
# from 1 Jan 2022 and the note vanished afterwards; the archive confirms both
# halves - 2022 reproduces 1584/1584 at k=0.95, and 2020/2021/2023-2026 at 1.0.
K_BY_YEAR: dict[int, float] = {2022: 0.95}
DEFAULT_K = 1.0


def bootstrap(engine: "CnEngine", spec: "MethodSpec", passes: int = 2, level: float = 1000.0, days: int | None = 365,
              prior=None) -> dict:
    """A method computed for a country without official CNs: no runner has a level its first circuits could be valued
    from. First pass: everyone starts at the same `level` for the archive's first `days` in each ranking family (a
    circuit's value is then its runners' common pace); each next pass: everyone starts from their own first computed
    level — the first season valued by the levels it shows, as France's first season is by the CN its runners held then.
    The recalage brings the scale to its usual level afterwards. `days=None`: the seeds never expire — a runner without a
    CN of their own still values a circuit at their first level (a country whose archive has gaps longer than the window:
    without it, nobody holds a CN after one and no circuit is valued again). `prior(category) -> float`: the first pass
    starts each runner at `level` x their first category's usual level against H21 instead of all equal — groups that
    never share a circuit (children, veterans racing among themselves) otherwise come out on one level each (Spain,
    2026-10-22: every category's median near the same value, a 12-year-old above the elites)."""
    firsts = {fam: d for fam, d in (
        (family(t), d) for t, d in engine.conn.execute(
            """SELECT comp.terrain, MIN(comp.date_iso) FROM competitions comp WHERE comp.date_iso IS NOT NULL
               GROUP BY comp.terrain"""))}
    start = min(firsts.values()) if firsts else None
    if not start:
        return {"passes": 0}
    engine.seed_until_override = (date.fromisoformat(start) + timedelta(days=days)).isoformat() if days else "9999-12-31"
    who = engine.conn.execute(
        """SELECT DISTINCT r.licence, comp.terrain FROM results r JOIN circuits c ON c.circuit_id = r.circuit_id
           JOIN competitions comp ON comp.course_id = c.course_id WHERE r.licence IS NOT NULL""").fetchall()
    first_cat: dict = {}
    if prior:
        for lic, t, cat in engine.conn.execute(
                """SELECT r.licence, comp.terrain, r.categorie FROM results r JOIN circuits c ON c.circuit_id = r.circuit_id
                   JOIN competitions comp ON comp.course_id = c.course_id
                   WHERE r.licence IS NOT NULL AND r.categorie IS NOT NULL ORDER BY comp.date_iso"""):
            first_cat.setdefault((lic, family(t)), cat)
    engine.seeds_override = {(lic, family(t)): (level * (prior(first_cat.get((lic, family(t)))) if prior else 1.0), None)
                             for lic, t in who}
    stats = {}
    for i in range(passes):
        for table in ("scores", "cn_history", "circuit_values", "rescale_factors", "normalisation"):
            engine.conn.execute(f"DELETE FROM {table} WHERE method = ?", (spec.name,))
        engine.conn.commit()
        stats = engine.run_method(spec)
        if i + 1 < passes:
            first: dict = {}
            for lic, t, raw in engine.conn.execute(
                    """SELECT licence, terrain, cn_raw FROM cn_history WHERE method = ? AND cn_raw IS NOT NULL
                       ORDER BY date_iso""", (spec.name,)):
                first.setdefault((lic, family(t)), (raw, None))
            mean = sum(v for v, _ in first.values()) / len(first) if first else level
            engine.seeds_override = {k: first.get(k, (mean, None)) for k in engine.seeds_override}
    return {"passes": passes, **stats}


def family(terrain: str | None) -> str:
    """The official ranking a terrain's CN J-15 belongs to: forest and sprint shared
    one pedestrian CN until 2026; VTT and ski always had their own."""
    return terrain if terrain in ("VTT", "Ski") else "Ped"


@dataclass
class RescalePolicy:
    """Start-of-year rescaling.

    Which years actually rescaled was measured, not assumed: comparing every
    runner's last CN of year Y with their first of Y+1 shows a sharp shared
    jump at 2013, 2023, 2024, 2025 and 2026, and a flat 1.000 everywhere else.
    The pre-2026 rule only pulled the CN back *into* the 0-10000 band, so it
    fired only when the top breached 10000; the maximum CN is exactly 10000 in
    both 2024 and 2025. From 2026 the target became the top-20% mean at 5600.
    """

    legacy_top_value: float = 10000.0
    modern_top20_mean: float = 5600.0
    modern_from_year: int = 2026
    years_applied: frozenset[int] = frozenset({2013, 2023, 2024, 2025, 2026})
    apply_every_year: bool = False
    enabled: bool = True

    def factor(self, year: int, cns: list[int]) -> float:
        if not self.enabled or not cns:
            return 1.0
        if not self.apply_every_year and year not in self.years_applied:
            return 1.0
        if year >= self.modern_from_year:
            ordered = sorted(cns, reverse=True)
            n = max(1, round(0.20 * len(ordered)))
            top_mean = sum(ordered[:n]) / n
            return self.modern_top20_mean / top_mean if top_mean else 1.0
        top = max(cns)
        return self.legacy_top_value / top if top else 1.0


def _next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def daily_knots(points: list[tuple[date, float]]) -> list[tuple[date, float]]:
    """The knots of the daily recalage factor from the monthly ones, given as
    (first day of the month fitted for, factor), oldest first.

    Each monthly factor is reached on the first day of the FOLLOWING month and
    the factor moves in a straight line between knots: a race's factor is that
    of its day, with no step at a month boundary. The month-m factor is fitted
    on the level `lag_months` earlier, so a day in month m only uses levels at
    least that old - the same protection against late results as a step
    applied from the 1st, at the cost of half a month of lag on average."""
    if not points:
        return []
    return [points[0]] + [(_next_month(d), f) for d, f in points]


def factor_on(knots: list[tuple[date, float]], d: date) -> float:
    """The recalage factor of day `d` (see daily_knots); 1 without any factor."""
    if not knots:
        return 1.0
    if d <= knots[0][0]:
        return knots[0][1]
    if d >= knots[-1][0]:
        return knots[-1][1]
    lo, hi = 0, len(knots) - 1
    while hi - lo > 1:                  # knots[lo][0] <= d < knots[hi][0]
        mid = (lo + hi) // 2
        if knots[mid][0] <= d:
            lo = mid
        else:
            hi = mid
    (d0, f0), (d1, f1) = knots[lo], knots[hi]
    return f0 + (f1 - f0) * (d - d0).days / (d1 - d0).days


@dataclass
class Normalisation:
    """Smooth level anchor, used instead of a yearly step (method 3).

    The CN is scale-free: multiply every runner's CN by a constant and all
    circuit values, and hence all scores, scale identically. Nothing in the
    formula fixes the absolute level, so a from-scratch run drifts (measured
    at -2 to -3%/year here). A yearly rescale fixes that but puts a visible
    step in every runner's curve each 1 January, which is exactly what makes
    long-run progression hard to read.

    So the level is held by a monthly factor instead: the internal computation
    is left untouched and scale-free, factor(t) is chosen so the reference
    cohort averages `target`, and a race's published score is its raw score x
    the factor of the race's date - computed once, never revised when a later
    factor arrives. The published CN is then the aggregate of those published
    scores (no factor at the CN level), so it only moves when a race enters or
    leaves the window. The factor never feeds back into the internal scores, so
    it cannot amplify drift.
    """

    # FFCO's 2026 rule (RC 2026): the mean of the best 20 % of the CNs is
    # brought to 5600 points by simple proportionality, per discipline. The
    # same anchor here, only refreshed monthly instead of each 1 January.
    # Anchoring a *mean* of a fifth of the ranking rather than the single best
    # runner keeps one exceptional career - or a two-race fluke - from
    # rescaling everyone else, and a cohort that grows with the population
    # makes forest and sprint comparable (a fixed top 30 was 1 % of forest but
    # nearly 5 % of sprint).
    target: float = 5600.0
    anchor_top_fraction: float | None = 0.20
    anchor_top_k: int = 30         # the cohort size when anchor_top_fraction is None
    # How factor(t) is derived from the reference level:
    #   "monthly_lag"      - refreshed every month from the level `lag_months`
    #       earlier. Causal, and the lag lets late-arriving results settle
    #       before they can move the scale.
    #   "trailing_monthly" - refreshed monthly from a trailing 12-month mean.
    #   "annual_jan3"      - one factor per year from the *previous* year,
    #       swapped in on 3 January. Causal, but reintroduces a step: measured
    #       year-on-year factor changes are 3-7%, versus ~0.4%/month monthly.
    #   "centred_monthly"  - smoothest, but peeks up to 6 months ahead, so it
    #       can only ever be used retrospectively.
    #   "monthly_drift"    - (study of 2026-10-13) the "monthly_lag" mean, carried forward by the drift of
    #       ln(level) fitted over the `drift_months` months that end with the window, to `trend_ahead_months`
    #       past the month fitted for. The raw scale climbs steadily (a CN keeps the best races, and the next
    #       circuits are valued with those CNs), and the plain mean trails the scores it scales by 18 to 20
    #       months: the published forest level sat 7 % above the target, 18 % with the geometric circuit value.
    #       A slope over ten years barely moves from one month to the next, so the factors stay as smooth.
    mode: str = "monthly_lag"
    # a discipline's own mode over `mode`: VTT and ski have too few monthly levels for a drift to be fitted
    mode_by_terrain: dict = field(default_factory=dict)
    lag_months: int = 2
    smooth_months: int = 13        # window for the *_monthly smoothing modes
    trend_ahead_months: float = 7.0   # "monthly_drift": the mean is carried this far past the month fitted for
    drift_months: int = 121           # "monthly_drift": the drift is fitted over this many months
    # The cohort anchored at the target is that of the method's Top (owner, 2026-10-13): at each CN point, the CN
    # the Top derived from the same raw scores would publish - this many places (None: the method's own CN).
    anchor_top_n: int | None = None
    # ... and the mean that Top takes of its places, when it is not the method's own (2026-10-14: the Top is a weighted
    # arithmetic mean, 1, while its Fit stays cubic). None: the method's own `cn_power`.
    anchor_cn_power: float | None = None
    # Count the lag, the smoothing and the drift in calendar months (2026-10-14): a month without races keeps the previous
    # month's level. Off: in months that have CN points, as before (ski's « 13 months » then spanned years).
    calendar_months: bool = False
    refresh_month: int = 1
    refresh_day: int = 3
    active_days: int = 365         # a runner counts if they raced this recently
    # Only runners whose CN rests on at least this many races anchor the
    # scale. A CN built from one or two races is high-variance and lands
    # disproportionately at the top; with a top-30 cohort one two-race fluke
    # rescaled the whole ranking (2012 forest: 17014 against a ~9800 norm), so
    # this was 4. A 20 % cohort dilutes them, so, as FFCO does, every runner
    # with a CN counts.
    min_kept_for_anchor: int = 0
    enabled: bool = True


@dataclass
class MethodSpec:
    name: str
    params: CnParams
    rescale: RescalePolicy | None = None
    normalisation: Normalisation | None = None
    # Historical k (0.95 in 2022) belongs to what the federation actually ran.
    # A method that applies one rule uniformly must use one k throughout.
    use_historical_k: bool = False
    # A method that shares another's race scores and circuit values and only
    # aggregates them differently into a CN (see CnEngine.derive).
    derived_from: str | None = None
    description: str = ""


def build_methods(overrides: dict | None = None) -> dict[str, MethodSpec]:
    """The computed methods. `overrides`: a country's own parameters (countries/<cc>, `Country.method_params`), applied to
    the usual level and so to the Ozimut method derived from it; `by_terrain` merged discipline by discipline."""
    # The method published since 2026-10-16 (owner: a method everyone can follow, at a cost of a few hundredths of a point):
    # FFCO's score with the ARITHMETIC mean of CN J-15 x time over the fastest share of the ranked CN holders, the usual
    # level (fair) and the Top (top6w) both plain weighted means. The share of the field per discipline was chosen by one
    # criterion - the best duels called right on 2012-2024 without a significant loss since July 2025 (study of 2026-10-15/16
    # on copies, eval_frac*_n.json): forest 90 % (+0.42 point over the two-thirds, +0.08 [+0.05, +0.10] over the whole
    # field, level with the geometric Top), sprint the two-thirds (FFCO's rule; 50-60 % win since 2025 but lose over the
    # fifteen seasons, 100 % -0.34), VTT 75 % (+0.15; 85 % is best on 2012-2024 but -0.49 since 2025), ski 75 % as VTT
    # (unmeasurable). The usual level's share of best scores was tested too (50-100 %, eval_elig_n.json): 60 % stays
    # (50 % -0.03, 70 % -0.11, 100 % -0.62 in forest; flat in sprint). Its recalage was made for the geometric pair (below).
    fair = CnParams(
        sample_rounding="ceil",
        k_over_1000=1.0,
        aggregation="top6_weighted",
        # The weighted mean of the best 60 % of the window's scores: no cap on
        # the number of races (top_n = "places" far beyond any window), so the
        # CN reflects a runner's usual good level whatever how often they race.
        # A capped best-of (Top) used for circuit values fed its selection back:
        # the more a group raced among itself, the higher its circuits were
        # valued (veterans up, H21 down by ~13 %).
        top_n=10 ** 6,
        weighting="title",       # championnat de France 2, national 1.5, other 1
        # No fallback on a runner's first official CN (stale, and on FFCO's
        # scale) after the archive's first season: only runners with a CN of
        # their own value a circuit. It valued a third of sprint circuits.
        seed_until="2011-01-01",
        # Thin data is where absurd CNs come from: at two races the
        # aggregation degenerates to "best single score", which then
        # feeds back through circuit values. These three thresholds
        # all say the same thing — do not publish a number computed
        # from too little evidence.
        min_ranked=4,            # a circuit needs >3 ranked runners
        # a runner needs 2 races for a CN (owner, 2026-10-23; 3 until then): on the 2026-10-09 database, every result's
        # index read on its day, 2012-2024, the results with an index +7 % in forest, +71 % in sprint (+35 % since July
        # 2025), +13 % in VTT, the newly ranked still called better than by their official CN (Ozimut - official forest
        # +2.47 against +2.31, sprint +2.73 against +2.28), at a small cost on the runners ranked either way (forest
        # +0.05, sprint -0.09 ns, since July 2025 -0.23 [-0.43, -0.07], VTT -0.14). Spain measured +0.67 in sprint.
        min_scores_for_cn=2,
        new_entrant_rescue=False,  # only real CN holders score a circuit
        # VTT (~30 competitions a season) and ski (2-4, on one or two weekends):
        # a longer window and a larger share of the scores, so enough runners
        # hold a CN to value the circuits from one season to the next.
        by_terrain={"Forêt": {"sample_fraction": 0.90},
                    "VTT": {"window_days": 730, "eligible_fraction": 0.70, "sample_fraction": 0.75},
                    "Ski": {"window_days": 1095, "eligible_fraction": 0.70, "sample_fraction": 0.75}},
        # The juniors' races fade over the window (owner, 2026-10-19): a race run in H/D 12-20 weighs
        # 1 - its age / the window in the mean, an adult's race keeps its weight (cn.fade_factors). Study of
        # 2026-10-19 (the 2026-10-09 database, every rule from 2010, CN J-15 read on its day; against production read
        # the same way, 2012-2024): forest +0.18 [0.16, 0.21] point of duels (better in 15 of 15 seasons, +0.14
        # [0.08, 0.20] since July 2025), sprint +0.11 [0.05, 0.17] (since July 2025 +0.04, not significant), VTT +0.15
        # [0.10, 0.19] (+0.28 [0.07, 0.53] since July 2025). Fading every runner's races gained at most +0.08 (forest,
        # halving every 6 months) and nothing once the juniors' fade; a 24-month window lost 0.6; the Top alone, the
        # usual level unchanged, lost 0.08. In both steps, so that the circuits' values follow.
        junior_fade=1.0,
    )
    if overrides:
        o = dict(overrides)
        bt = {t: dict(v) for t, v in fair.by_terrain.items()}
        for t, v in (o.pop("by_terrain", None) or {}).items():
            bt.setdefault(t, {}).update(v)
        fair = dataclasses.replace(fair, by_terrain=bt, **o)
    # The recalage (2026-10-13, made for the geometric pair, shared by the linear one since 2026-10-16): each month a
    # factor brings the mean of the best 20 % of the index - the cohort the published method's 6 places give - to 5600,
    # the drift of the raw scale over ten years corrected, counted in calendar months, carried 10 months (7 left the forest
    # level 2.7 % above 5600, 10 keeps the three measurable disciplines within about 2 %).
    norm = Normalisation(mode="monthly_drift", anchor_top_n=6, anchor_cn_power=1.0, calendar_months=True,
                         trend_ahead_months=10.0)
    return {
        "fair": MethodSpec(
            name="fair",
            params=fair,
            rescale=None,  # no annual step at all
            normalisation=norm,      # since 2026-10-16: anchored on the published index, the drift corrected (+0.08 point in forest)
            description="the usual level: weighted mean of the best 60 %, juniors' races fading over the window; arithmetic circuit value over the fastest share (forest 90 %, sprint 2/3, VTT and ski 75 %)",
        ),
        "top6w": MethodSpec(
            name="top6w",
            # the Ozimut method, published (the « Top » until 2026-10-19): fair's race scores, the index keeps only the
            # best races filling 6 weight places, in a weighted arithmetic mean: racing more can only raise it.
            params=dataclasses.replace(fair, top_n=6),
            derived_from="fair",
            normalisation=norm,
            description="Ozimut: fair's scores, best 6 weighted places, weighted arithmetic mean, juniors' races fading over the window",
        ),
    }

class CnEngine:
    # A country without official CNs (Spain, 2026-10-22): nothing seeds its first circuits. The caller's seeds and their
    # end replace FFCO's (load_seeds, params.seed_until): `bootstrap` starts everyone equal, then from their own level.
    seeds_override: dict | None = None
    seed_until_override: str | None = None

    def __init__(self, db_path: Path) -> None:
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA synchronous=OFF")
        self._drop_pre_method_tables()
        schema = (Path(__file__).parent / "cn_schema.sql").read_text(encoding="utf-8")
        self.conn.executescript(schema)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_results_licence ON results(licence)")
        self.conn.commit()

    def _drop_pre_method_tables(self) -> None:
        """Bring old derived tables up to date.

        A missing `method` means the table predates multi-method support and
        its shape is fundamentally different, so it is dropped and recomputed
        (it is pure derived data — the scraped tables are untouched). A merely
        missing column is added in place so methods already computed survive.
        """
        for table in ("scores", "cn_history", "circuit_values"):
            cols = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}
            if cols and "method" not in cols:
                logger.info("dropping pre-method %s (derived, will be recomputed)", table)
                self.conn.execute(f"DROP TABLE {table}")

        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(scores)")}
        if cols and "score_raw" not in cols:
            logger.info("adding scores.score_raw and backfilling from score")
            self.conn.execute("ALTER TABLE scores ADD COLUMN score_raw INTEGER")
            self.conn.execute("UPDATE scores SET score_raw = score")
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ------------------------------------------------------------------
    def _circuits(self, seasons: list[int] | None, since: str | None = None):
        where = ""
        args: tuple = ()
        if seasons:
            where = f"AND comp.season IN ({','.join('?' * len(seasons))})"
            args = tuple(seasons)
        if since:
            where += " AND comp.date_iso >= ?"
            args += (since,)
        return self.conn.execute(
            f"""
            SELECT c.circuit_id, c.course_id, comp.date_iso, comp.season,
                   comp.terrain, comp.epreuve, comp.groupe, comp.title, c.distance_km
            FROM circuits c
            JOIN competitions comp ON comp.course_id = c.course_id
            WHERE comp.specialite IN ('Pédestre', 'VTT', 'Ski') AND comp.date_iso IS NOT NULL {where}
            ORDER BY comp.date_iso, c.course_id, c.circuit_id
            """,
            args,
        ).fetchall()

    def _rows_of(self, circuit_id: int):
        return self.conn.execute(
            """SELECT licence, nom, place, categorie, club, temps, cn_j15, points, nouveau_cn
               FROM results WHERE circuit_id = ? ORDER BY id""",
            (circuit_id,),
        ).fetchall()

    # ------------------------------------------------------------------
    def populate_official(self, seasons: list[int] | None = None, since: str | None = None) -> dict:
        """Method 1: copy the published values through unchanged. With
        `since`, only rows dated from then on are replaced."""
        self.conn.execute("DELETE FROM scores WHERE method='official' AND date_iso >= ?", (since or "",))
        self.conn.execute("DELETE FROM cn_history WHERE method='official' AND date_iso >= ?", (since or "",))
        srows, hrows = [], []
        n = 0
        for c in self._circuits(seasons, since):
            terrain = c["terrain"] or "Forêt"
            w = group_weight(c["groupe"])
            for r in self._rows_of(c["circuit_id"]):
                cat = (r["categorie"] or "").strip().upper()
                status = classify_status(r["temps"])
                T = parse_time(r["temps"])
                score = to_int(r["points"])
                srows.append(
                    ("official", r["licence"], c["circuit_id"], c["course_id"],
                     c["date_iso"], c["season"], cat or None, sexe_of(cat),
                     r["club"] or None, terrain, c["epreuve"], c["groupe"], w,
                     T, status, to_int(r["cn_j15"]), score, score,   # nothing to normalise: raw = published
                     1 if score is not None else 0)
                )
                ncn = to_int(r["nouveau_cn"])
                if ncn:
                    hrows.append(("official", r["licence"], c["date_iso"], terrain,
                                  ncn, ncn, None, None))
                n += 1
            if len(srows) >= 50000:
                self._flush_scores(srows); self._flush_hist(hrows)
                srows, hrows = [], []
        self._flush_scores(srows); self._flush_hist(hrows)
        self.conn.commit()
        return {"rows": n}

    # ------------------------------------------------------------------
    def load_seeds(self, since: str | None, lag_days: int = 15,
                   bootstrap_days: int = 365) -> dict[tuple[str, str], tuple[int, date | None]]:
        """Each runner's first known official CN in each ranking family (see
        `family`), and the date from which it was known:
        (licence, family) -> (cn, known_from).

        A CN J-15 printed on a race dated D was the runner's CN at D - 15 days,
        so it may bootstrap their computed CN from then on — never before. Using
        it earlier would let a CN first seen in 2026 value a runner's 2023 races:
        a look-ahead that also makes every new result rewrite the past.

        The one exception is the start of the archive: the first season's pages
        (2010) publish no CN J-15 at all, so the CN those runners already held is
        only visible on their races of the following months. Seeds first seen
        within `bootstrap_days` of the first published CN J-15 therefore count
        from the start. New results are always far past that point, so they can
        never move a seed earlier.
        With `since` (a partial run), the latest CN before it applies throughout."""
        before: dict[tuple[str, str], tuple[int, date | None]] = {}
        after: dict[tuple[str, str], tuple[int, date | None]] = {}
        bootstrap_end: dict[str, str] = {}          # per family: its archive starts on its own
        for licence, cn, d, terrain in self.conn.execute(
            """
            SELECT r.licence, r.cn_j15, comp.date_iso, comp.terrain
            FROM results r
            JOIN circuits c ON c.circuit_id = r.circuit_id
            JOIN competitions comp ON comp.course_id = c.course_id
            WHERE r.cn_j15 <> '' AND comp.date_iso IS NOT NULL
            ORDER BY comp.date_iso, c.course_id, c.circuit_id, r.id
            """
        ):
            v = to_int(cn)
            if not v or v <= 0:
                continue
            fam = family(terrain)
            if fam not in bootstrap_end:
                bootstrap_end[fam] = (date.fromisoformat(d) + timedelta(days=bootstrap_days)).isoformat()
            key = (licence, fam)
            if since and d < since:
                before[key] = (v, None)
            elif key not in after:
                after[key] = (v, None if d < bootstrap_end[fam]
                              else date.fromisoformat(d) - timedelta(days=lag_days))
        seeds = {**after, **before}
        logger.info("seeded %d runners", len(seeds))
        return seeds

    # ------------------------------------------------------------------
    def _replay(self, spec: MethodSpec, since: str) -> tuple[dict, int | None]:
        """Rebuild every runner's history as it stood just before `since`,
        from the scores already stored, exactly as the full run built it:
        same raw scores, same order, and each stored 1 January rescale
        re-applied at the point in the sequence where it happened.
        Returns (histories, the year the state has reached)."""
        hist: dict[tuple[str, str], RunnerHistory] = defaultdict(RunnerHistory)
        factors = {y: f for y, f in self.conn.execute(
            "SELECT year, factor FROM rescale_factors WHERE method = ?", (spec.name,))}
        current_year: int | None = None

        def cross_into(year: int) -> None:
            nonlocal current_year
            while current_year is not None and year > current_year:
                current_year += 1
                f = factors.get(current_year)
                if f is not None and date(current_year, 1, 1) <= date.fromisoformat(since):
                    for h in hist.values():
                        h.scores = [Decimal_round(x * f) for x in h.scores]

        for lic, terrain, d, raw, w, cat in self.conn.execute(
            """SELECT licence, terrain, date_iso, score_raw, poids, categorie FROM scores
               WHERE method = ? AND date_iso < ? AND counts_for_cn = 1 AND score_raw IS NOT NULL
               ORDER BY date_iso, course_id, circuit_id""",
            (spec.name, since),
        ):
            dd = date.fromisoformat(d)
            if current_year is None:
                current_year = dd.year
            cross_into(dd.year)
            hist[(lic, terrain)].add(dd, raw, w, is_junior(cat))
        # rescales between the last stored race and `since` were computed from
        # this same unchanged state, so they are replayed too
        if current_year is not None:
            cross_into(date.fromisoformat(since).year)
        return hist, current_year

    def run_method(self, spec: MethodSpec, seasons: list[int] | None = None, since: str | None = None) -> dict:
        """Compute a method. With `since`, everything dated before it is kept
        and the computation resumes from there — exact, because a circuit only
        ever depends on races before it."""
        p = spec.params
        seeds = self.seeds_override if self.seeds_override is not None else             self.load_seeds(f"{min(seasons)}-01-01" if seasons else None, p.lag_days)
        seed_until = self.seed_until_override or p.seed_until

        def seed(licence: str, terrain: str, as_of: date):
            if seed_until and as_of.isoformat() >= seed_until:
                return None
            s = seeds.get((licence, family(terrain)))
            return s[0] if s and (s[1] is None or as_of >= s[1]) else None
        if since:
            hist, current_year = self._replay(spec, since)
            logger.info("%s: resumed %d histories before %s", spec.name, len(hist), since)
        else:
            hist = defaultdict(RunnerHistory)
            current_year = None

        per_t: dict[str, CnParams] = {}

        def pt(terrain: str) -> CnParams:
            """The params in a discipline (VTT and ski have their own window and share)."""
            if terrain not in per_t:
                per_t[terrain] = p.for_terrain(terrain)
            return per_t[terrain]

        def value_for(licence: str, terrain: str, as_of: date):
            """What the runner brings to a circuit's value (p.valuation)."""
            if p.valuation not in ("trimmed", "pool"):
                return cn_for(licence, terrain, as_of)
            q = pt(terrain)
            h = hist.get((licence, terrain))
            if h is not None:
                s, w = h.slice(as_of, q.window_days)
                if s:
                    lvl, kept = (trimmed_mean(s, q) if p.valuation == "trimmed"   # "pool": the whole best fraction counts
                                 else top_n_weighted(s, w, dataclasses.replace(q, top_n=10 ** 6)))
                    if lvl is not None:
                        return lvl, len(s), kept
                    return seed(licence, terrain, as_of), len(s), 0
            return seed(licence, terrain, as_of), 0, 0

        def cn_for(licence: str, terrain: str, as_of: date):
            # forest and sprint are independent rankings in every season
            h = hist.get((licence, terrain))
            if h is not None:
                cn, n_w, n_k = h.cn_as_of(as_of, pt(terrain))
                if cn is not None:
                    return cn, n_w, n_k
                if n_w:
                    return seed(licence, terrain, as_of), n_w, 0
            return seed(licence, terrain, as_of), 0, 0

        if since:
            for table in ("scores", "cn_history", "circuit_values"):
                self.conn.execute(f"DELETE FROM {table} WHERE method=? AND date_iso >= ?", (spec.name, since))
            # a rescale on 1 January Y after `since` depends on the new data
            # (1 January of `since`'s own year is never after it)
            self.conn.execute("DELETE FROM rescale_factors WHERE method=? AND year > ?",
                              (spec.name, date.fromisoformat(since).year))
        else:
            for table in ("scores", "cn_history", "circuit_values", "rescale_factors"):
                self.conn.execute(f"DELETE FROM {table} WHERE method=?", (spec.name,))
        self.conn.commit()

        circuits = self._circuits(seasons, since)
        logger.info("%s: processing %d circuits", spec.name, len(circuits))
        per_km_cache: dict[int, float | None] = {}

        def per_km(course_id: int, terrain: str, as_of: date, k: float) -> float | None:
            """The competition's value per km (p.distance_pooling), or None."""
            if course_id not in per_km_cache:
                per_km_cache.clear()                # one competition at a time
                circs = self.conn.execute("SELECT circuit_id, distance_km FROM circuits WHERE course_id=?",
                                          (course_id,)).fetchall()
                v = None
                if circs and all(x["distance_km"] and x["distance_km"] > 0 for x in circs):
                    paces = []
                    for x in circs:
                        for r in self._rows_of(x["circuit_id"]):
                            if is_nc(r["place"]) or (r["categorie"] or "").strip().upper() in ("D10", "H10"):
                                continue
                            T = parse_time(r["temps"])
                            if classify_status(r["temps"]) != "ok" or not T:
                                continue
                            cn_in = value_for(r["licence"], terrain, as_of)[0]
                            if cn_in and cn_in > 0:
                                paces.append((cn_in, T / x["distance_km"]))
                    v = circuit_value(paces, p, k=k)[0]
                per_km_cache[course_id] = v
            return per_km_cache[course_id]

        stats = {"circuits": 0, "eligible": 0, "scores": 0}
        srows, hrows, cvrows = [], [], []

        for c in circuits:
            d = date.fromisoformat(c["date_iso"])
            if current_year is None:
                current_year = d.year
            while d.year > current_year:
                current_year += 1
                if spec.rescale:
                    self._rescale(hist, spec, current_year, p)

            terrain = c["terrain"] or "Forêt"
            weight = race_weight(c["groupe"], c["title"], p)
            as_of = d - timedelta(days=p.lag_days)
            rows = self._rows_of(c["circuit_id"])

            participants, ranked = [], []
            for r in rows:
                if is_nc(r["place"]):           # non classé: not part of the race for the CN
                    continue
                cat = (r["categorie"] or "").strip().upper()
                status = classify_status(r["temps"])
                T = parse_time(r["temps"])
                cn_in, _, _ = value_for(r["licence"], terrain, as_of)
                excluded = cat in ("D10", "H10")
                participants.append((r, status, T, cn_in, cat, excluded))
                if status == "ok" and T and not excluded and cn_in and cn_in > 0:
                    ranked.append((cn_in, T))

            if p.new_entrant_rescue and len(ranked) < p.min_ranked:
                # new entrants count at 2000 only to rescue a circuit that
                # could not otherwise be valued
                for r, status, T, cn_in, cat, excluded in participants:
                    if len(ranked) >= p.min_ranked:
                        break
                    if status == "ok" and T and not excluded and not (cn_in and cn_in > 0):
                        ranked.append((p.new_entrant_value, T))

            k = K_BY_YEAR.get(d.year, DEFAULT_K) if spec.use_historical_k else p.k_over_1000
            cv, n_sample = circuit_value(ranked, pt(terrain), k=k)     # the circuit's rules in its discipline
            if p.distance_pooling and terrain == "Sprint" and c["distance_km"]:
                v_km = per_km(c["course_id"], terrain, as_of, k)
                if v_km is not None:
                    cv = v_km * c["distance_km"]
            stats["circuits"] += 1
            if cv is not None:
                stats["eligible"] += 1
            cvrows.append((spec.name, c["circuit_id"], c["date_iso"],
                           sum(1 for x in participants if x[1] == "ok"),
                           len(ranked), n_sample, cv, 1 if cv is not None else 0))

            for r, status, T, cn_in, cat, excluded in participants:
                score = None
                counts = 0
                if cv is not None and not excluded:
                    if status == "ok" and T:
                        score = Decimal_round(cv / T)
                        counts = 1
                    elif status in ("pm", "abandon", "disqualifie", "hors_delai"):
                        score = 0
                        counts = 1
                if counts and score is not None:
                    hist[(r["licence"], terrain)].add(d, score, weight, is_junior(cat))
                    stats["scores"] += 1
                    cn_after, n_w, n_k = cn_for(r["licence"], terrain, d)
                    # n_kept == 0 means this is the seed showing through, not a
                    # computed CN. A seed is an official-scale value used only
                    # to bootstrap circuit values; publishing it would both
                    # breach "no CN below N races" and get rescaled by the
                    # normalisation as though it were on the internal scale.
                    published = cn_after if n_k > 0 else None
                    hrows.append((spec.name, r["licence"], c["date_iso"], terrain,
                                  published, published, n_w, n_k))
                srows.append(
                    (spec.name, r["licence"], c["circuit_id"], c["course_id"],
                     c["date_iso"], c["season"], cat or None, sexe_of(cat),
                     r["club"] or None, terrain, c["epreuve"], c["groupe"], weight,
                     T, status, cn_in, score, score, counts)
                )

            if len(srows) >= 50000:
                self._flush_scores(srows); self._flush_hist(hrows); self._flush_cv(cvrows)
                srows, hrows, cvrows = [], [], []

        self._flush_scores(srows); self._flush_hist(hrows); self._flush_cv(cvrows)
        self.conn.commit()

        if spec.normalisation and spec.normalisation.enabled:
            self._normalise(spec, since)
        return stats

    # ------------------------------------------------------------------
    def derive(self, spec: MethodSpec, since: str | None = None) -> dict:
        """A method sharing another's race scores, circuit values and recalage
        factors, with its own CN aggregation: the source's rows are copied (from
        `since`), then each CN point is re-aggregated - raw and published - with
        this method's params. Nothing about the races is recomputed."""
        src, p, frm = spec.derived_from, spec.params, since or ""
        for table in ("scores", "cn_history", "circuit_values"):
            self.conn.execute(f"DELETE FROM {table} WHERE method=? AND date_iso >= ?", (spec.name, frm))
        self.conn.execute(
            """INSERT OR REPLACE INTO scores
               (method, licence, circuit_id, course_id, date_iso, season, categorie, sexe, club,
                terrain, epreuve, groupe, poids, temps_s, status, cn_j15, score, score_raw, counts_for_cn)
               SELECT ?, licence, circuit_id, course_id, date_iso, season, categorie, sexe, club,
                      terrain, epreuve, groupe, poids, temps_s, status, cn_j15, score, score_raw, counts_for_cn
               FROM scores WHERE method=? AND date_iso >= ?""", (spec.name, src, frm))
        self.conn.execute(
            """INSERT OR REPLACE INTO circuit_values
               (method, circuit_id, date_iso, n_finishers, n_ranked, n_sample, valeur, eligible)
               SELECT ?, circuit_id, date_iso, n_finishers, n_ranked, n_sample, valeur, eligible
               FROM circuit_values WHERE method=? AND date_iso >= ?""", (spec.name, src, frm))
        self.conn.execute("DELETE FROM normalisation WHERE method=?", (spec.name,))
        self.conn.execute(
            """INSERT INTO normalisation (method, terrain, date_iso, top_mean_raw, factor)
               SELECT ?, terrain, date_iso, top_mean_raw, factor FROM normalisation WHERE method=?""",
            (spec.name, src))

        start = ""
        if since:                 # the window of the first rewritten point reaches back this far
            start = (date.fromisoformat(since) - timedelta(days=p.max_window_days + 1)).isoformat()
        raw: dict = defaultdict(RunnerHistory)
        pub: dict = defaultdict(RunnerHistory)
        for s in self.conn.execute(
                "SELECT licence, terrain, date_iso, score, score_raw, poids, categorie FROM scores "
                "WHERE method=? AND counts_for_cn=1 AND score_raw IS NOT NULL AND date_iso >= ? "
                "ORDER BY date_iso, course_id, circuit_id", (spec.name, start)):
            d, w, key = date.fromisoformat(s["date_iso"]), s["poids"] or 1.0, (s["licence"], s["terrain"])
            jun = is_junior(s["categorie"])
            raw[key].add(d, s["score_raw"], w, jun)
            pub[key].add(d, s["score"] if s["score"] is not None else s["score_raw"], w, jun)
        rows = []
        for r in self.conn.execute(
                "SELECT licence, terrain, date_iso, cn_raw, n_scores_window FROM cn_history "
                "WHERE method=? AND date_iso >= ?", (src, frm)):
            cn = cn_raw = None
            kept = 0
            key, d = (r["licence"], r["terrain"]), date.fromisoformat(r["date_iso"])
            if r["cn_raw"] is not None and key in raw:     # the source published a CN: so does this method
                q = p.for_terrain(r["terrain"])
                cn_raw, _, kept = raw[key].cn_as_of(d, q)
                cn = pub[key].cn_as_of(d, q)[0] if kept else None
                if not kept:
                    cn_raw = None
            rows.append((spec.name, r["licence"], r["date_iso"], r["terrain"], cn, cn_raw, r["n_scores_window"], kept))
        self._flush_hist(rows)
        self.conn.commit()
        logger.info("%s: derived from %s, %d CN points", spec.name, src, len(rows))
        return {"cn_points": len(rows)}

    def _rescale(self, hist, spec: MethodSpec, year: int, p: CnParams) -> None:
        boundary = date(year, 1, 1)
        cns = []
        for h in hist.values():
            cn, _, _ = h.cn_as_of(boundary, p)
            if cn:
                cns.append(cn)
        factor = spec.rescale.factor(year, cns)
        if abs(factor - 1.0) < 1e-9:
            return
        for h in hist.values():
            h.scores = [Decimal_round(s * factor) for s in h.scores]
        self.conn.execute(
            "INSERT OR REPLACE INTO rescale_factors (method, year, factor, n_runners) "
            "VALUES (?,?,?,?)",
            (spec.name, year, factor, len(cns)),
        )
        logger.info("%s rescale %s: x%.4f over %d runners", spec.name, year, factor, len(cns))

    def _normalise(self, spec: MethodSpec, since: str | None = None) -> None:
        """Fit factor(t) so the reference cohort sits at the target level.

        With `since`, the schedule is refitted as usual but only rows dated
        from the first point where it changed (or from `since`) are rewritten."""
        cfg = spec.normalisation
        rows = self._anchor_rows(spec) if cfg.anchor_top_n else self.conn.execute(
            "SELECT licence, terrain, date_iso, cn_raw, n_scores_kept FROM cn_history "
            "WHERE method=? AND cn_raw IS NOT NULL ORDER BY date_iso, licence",
            (spec.name,),
        ).fetchall()
        old_schedule = {(r[0], r[1]): r[2] for r in self.conn.execute(
            "SELECT terrain, date_iso, factor FROM normalisation WHERE method=?", (spec.name,))}
        if not rows:
            return

        by_terrain: dict[str, list] = defaultdict(list)
        for r in rows:
            by_terrain[r["terrain"]].append(r)

        # (terrain, effective_from) -> (reference level, factor)
        schedule: dict[str, list[tuple[date, float, float]]] = {}
        for terrain, trows in by_terrain.items():
            level = self._reference_levels(trows, cfg)
            if not level:
                continue
            schedule[terrain] = self._factor_schedule(
                level, dataclasses.replace(cfg, mode=cfg.mode_by_terrain.get(terrain, cfg.mode)))

        out_factors = [
            (spec.name, terrain, eff.isoformat(), ref, f)
            for terrain, entries in schedule.items()
            for (eff, ref, f) in entries
        ]
        # first date from which any factor differs from the stored schedule
        rewrite_from = since
        if since:
            new_schedule = {(t, d): f for _, t, d, _, f in out_factors}
            moved = [d for key in set(old_schedule) | set(new_schedule)
                     for d in [key[1]] if old_schedule.get(key) != new_schedule.get(key)]
            if moved:
                rewrite_from = min(rewrite_from, min(moved))
        self.conn.execute("DELETE FROM normalisation WHERE method=?", (spec.name,))
        self.conn.executemany(
            """INSERT OR REPLACE INTO normalisation
               (method, terrain, date_iso, top_mean_raw, factor) VALUES (?,?,?,?,?)""",
            out_factors,
        )

        knots = {t: daily_knots([(eff, f) for eff, _, f in entries]) for t, entries in schedule.items()}

        def factor_at(terrain: str, d: date) -> float:
            return factor_on(knots.get(terrain, []), d)

        # A race's published score: raw x the factor of the race's day. One value
        # per race, never revised by a later factor. Always derived from score_raw
        # so re-normalising is idempotent rather than compounding.
        srows = self.conn.execute(
            "SELECT licence, circuit_id, terrain, date_iso, score_raw FROM scores "
            "WHERE method=? AND score_raw IS NOT NULL AND date_iso >= ?",
            (spec.name, rewrite_from or ""),
        ).fetchall()
        self.conn.executemany(
            "UPDATE scores SET score=? WHERE method=? AND licence=? AND circuit_id=?",
            [
                (Decimal_round(s["score_raw"] * factor_at(s["terrain"],
                                                          date.fromisoformat(s["date_iso"]))),
                 spec.name, s["licence"], s["circuit_id"])
                for s in srows
            ],
        )
        # The published CN: the method's aggregate of those published scores - so the
        # CN is made of exactly the values shown race by race, and moves only when a
        # race enters or leaves the window.
        n_cn = self._publish_cn(spec, rewrite_from)
        self.conn.commit()
        logger.info("%s: mode=%s, normalised %d scores and %d CN points over %d factors",
                    spec.name, cfg.mode, len(srows), n_cn, len(out_factors))

    def _anchor_rows(self, spec: MethodSpec) -> list[dict]:
        """The rows the recalage is fitted on when it anchors on the Top (Normalisation.anchor_top_n): at each
        of the method's CN points, the raw CN its Top would publish from the same raw scores - the best places
        only -, so that the published Top's cohort, not the Fit's, sits at the target."""
        cfg, p = spec.normalisation, spec.params
        hist: dict = defaultdict(RunnerHistory)
        for s in self.conn.execute(
                "SELECT licence, terrain, date_iso, score_raw, poids, categorie FROM scores "
                "WHERE method=? AND counts_for_cn=1 AND score_raw IS NOT NULL "
                "ORDER BY date_iso, course_id, circuit_id", (spec.name,)):
            hist[(s["licence"], s["terrain"])].add(date.fromisoformat(s["date_iso"]), s["score_raw"], s["poids"] or 1.0,
                                                   is_junior(s["categorie"]))
        tops: dict[str, CnParams] = {}
        rows = []
        for r in self.conn.execute(
                "SELECT licence, terrain, date_iso FROM cn_history "
                "WHERE method=? AND cn_raw IS NOT NULL ORDER BY date_iso, licence", (spec.name,)):
            h = hist.get((r["licence"], r["terrain"]))
            if h is None:
                continue
            if r["terrain"] not in tops:
                q = dataclasses.replace(p.for_terrain(r["terrain"]), top_n=cfg.anchor_top_n)
                tops[r["terrain"]] = q if cfg.anchor_cn_power is None else dataclasses.replace(q, cn_power=cfg.anchor_cn_power)
            cn, _, kept = h.cn_as_of(date.fromisoformat(r["date_iso"]), tops[r["terrain"]])
            if cn is not None and kept:
                rows.append({"licence": r["licence"], "terrain": r["terrain"], "date_iso": r["date_iso"],
                             "cn_raw": cn, "n_scores_kept": kept})
        return rows

    def _publish_cn(self, spec: MethodSpec, rewrite_from: str | None) -> int:
        """cn_history.cn = aggregate of the published scores in the window (from `rewrite_from`)."""
        p = spec.params
        start = ""
        if rewrite_from:          # the window of the first rewritten row reaches back this far
            start = (date.fromisoformat(rewrite_from) - timedelta(days=p.max_window_days + 1)).isoformat()
        hist: dict = defaultdict(RunnerHistory)
        for s in self.conn.execute(
                "SELECT licence, terrain, date_iso, score, poids, categorie FROM scores "
                "WHERE method=? AND counts_for_cn=1 AND score IS NOT NULL AND date_iso >= ? "
                "ORDER BY date_iso", (spec.name, start)):
            hist[(s["licence"], s["terrain"])].add(date.fromisoformat(s["date_iso"]), s["score"], s["poids"] or 1.0,
                                                   is_junior(s["categorie"]))
        updates = []
        for r in self.conn.execute(
                "SELECT licence, terrain, date_iso, cn_raw FROM cn_history WHERE method=? AND date_iso >= ?",
                (spec.name, rewrite_from or "")):
            cn = None
            h = hist.get((r["licence"], r["terrain"]))
            if r["cn_raw"] is not None and h is not None:   # no raw CN: the seed showing through, unpublished
                cn, _, kept = h.cn_as_of(date.fromisoformat(r["date_iso"]), p.for_terrain(r["terrain"]))
                if not kept:
                    cn = None
            updates.append((cn, spec.name, r["licence"], r["terrain"], r["date_iso"]))
        self.conn.executemany(
            "UPDATE cn_history SET cn=? WHERE method=? AND licence=? AND terrain=? AND date_iso=?", updates)
        return len(updates)

    @staticmethod
    def _reference_levels(trows, cfg: Normalisation) -> dict[str, float]:
        """Month -> mean CN of the top-k active runners at that month."""
        latest: dict[str, tuple[date, int]] = {}
        monthly: dict[str, float] = {}
        for r in trows:
            d = date.fromisoformat(r["date_iso"])
            if (r["n_scores_kept"] or 0) >= cfg.min_kept_for_anchor:
                latest[r["licence"]] = (d, r["cn_raw"])
            ym = r["date_iso"][:7]
            if ym not in monthly:
                cutoff = d - timedelta(days=cfg.active_days)
                active = [cn for (dd, cn) in latest.values() if dd >= cutoff and cn]
                if active:
                    active.sort(reverse=True)
                    k = (round(cfg.anchor_top_fraction * len(active)) if cfg.anchor_top_fraction
                         else cfg.anchor_top_k)
                    k = max(1, min(k, len(active)))
                    monthly[ym] = sum(active[:k]) / k
        return monthly

    @staticmethod
    def _factor_schedule(monthly: dict[str, float],
                         cfg: Normalisation) -> list[tuple[date, float, float]]:
        """Turn monthly reference levels into (effective_from, level, factor)."""
        months = sorted(monthly)
        if cfg.calendar_months and months:
            # every calendar month from the first to the last, a month without races keeping the previous level
            filled: dict[str, float] = {}
            y, mo = int(months[0][:4]), int(months[0][5:7])
            last = None
            while f"{y:04d}-{mo:02d}" <= months[-1]:
                key = f"{y:04d}-{mo:02d}"
                last = monthly.get(key, last)
                filled[key] = last
                y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
            monthly, months = filled, sorted(filled)
        vals = [monthly[m] for m in months]
        out: list[tuple[date, float, float]] = []

        if cfg.mode == "annual_jan3":
            # One factor per year, taken from the previous year's December
            # level and swapped in on 3 January. The first year has no
            # predecessor, so it uses its own level.
            by_year: dict[int, float] = {}
            for m, v in zip(months, vals):
                by_year[int(m[:4])] = v      # last month seen wins => December
            years = sorted(by_year)
            first = years[0]
            for y in years:
                ref = by_year[y if y == first else y - 1]
                eff = (date(y, cfg.refresh_month, cfg.refresh_day)
                       if y != first else date(y, 1, 1))
                out.append((eff, ref, cfg.target / ref if ref else 1.0))
            return out

        half = cfg.smooth_months // 2
        for i, m in enumerate(months):
            if cfg.mode == "centred_monthly":
                lo, hi = max(0, i - half), min(len(vals), i + half + 1)
            elif cfg.mode in ("monthly_lag", "monthly_drift"):
                # The level from `lag_months` ago, so late results have
                # settled before they can move the scale.
                j = max(0, i - cfg.lag_months)
                lo, hi = max(0, j - cfg.smooth_months + 1), j + 1
            else:  # trailing_monthly
                lo, hi = max(0, i - cfg.smooth_months + 1), i + 1
            sm = sum(vals[lo:hi]) / (hi - lo)
            if cfg.mode == "monthly_drift":
                # the mean sits at the window's middle: carried to trend_ahead_months past month i by the drift
                dlo = max(0, hi - cfg.drift_months)
                if hi - dlo >= 12 and all(v > 0 for v in vals[dlo:hi]):
                    xs = list(range(dlo, hi))
                    ys = [math.log(v) for v in vals[dlo:hi]]
                    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                    slope = (sum((x - mx) * (y - my) for x, y in zip(xs, ys))
                             / sum((x - mx) ** 2 for x in xs))
                    sm *= math.exp(slope * (i + cfg.trend_ahead_months - (lo + hi - 1) / 2))
            y, mo = int(m[:4]), int(m[5:7])
            out.append((date(y, mo, 1), sm, cfg.target / sm if sm else 1.0))
        return out

    # ------------------------------------------------------------------
    def _flush_scores(self, rows) -> None:
        if rows:
            self.conn.executemany(
                """INSERT OR REPLACE INTO scores
                   (method, licence, circuit_id, course_id, date_iso, season,
                    categorie, sexe, club, terrain, epreuve, groupe, poids,
                    temps_s, status, cn_j15, score, score_raw, counts_for_cn)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )

    def _flush_hist(self, rows) -> None:
        if rows:
            self.conn.executemany(
                """INSERT OR REPLACE INTO cn_history
                   (method, licence, date_iso, terrain, cn, cn_raw,
                    n_scores_window, n_scores_kept)
                   VALUES (?,?,?,?,?,?,?,?)""",
                rows,
            )

    def _flush_cv(self, rows) -> None:
        if rows:
            self.conn.executemany(
                """INSERT OR REPLACE INTO circuit_values
                   (method, circuit_id, date_iso, n_finishers, n_ranked, n_sample,
                    valeur, eligible) VALUES (?,?,?,?,?,?,?,?)""",
                rows,
            )

    def write_runners(self) -> None:
        names: dict[str, str] = {}
        for licence, nom in self.conn.execute("SELECT licence, nom FROM results WHERE nom <> ''"):
            names[licence] = nom
        agg: dict[str, dict] = {}
        for licence, d, cat, club, sexe in self.conn.execute(
            "SELECT licence, date_iso, categorie, club, sexe FROM scores "
            "WHERE method='official' ORDER BY licence, date_iso"
        ):
            a = agg.get(licence)
            if a is None:
                agg[licence] = a = {"first": d, "last": d, "n": 0,
                                    "cat": cat, "club": club, "sexe": sexe}
            a["last"] = d
            a["n"] += 1
            for key, val in (("cat", cat), ("club", club), ("sexe", sexe)):
                if val:
                    a[key] = val
        self.conn.execute("DELETE FROM runners")
        self.conn.executemany(
            """INSERT INTO runners (licence, nom, first_date, last_date, n_races,
                                    last_categorie, last_club, sexe)
               VALUES (?,?,?,?,?,?,?,?)""",
            [(lic, names.get(lic), a["first"], a["last"], a["n"], a["cat"], a["club"], a["sexe"])
             for lic, a in agg.items()],
        )
        self.conn.commit()

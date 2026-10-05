"""Compute the three CN rankings held side by side in the database.

  method 1  'official'  The values published on the site, copied verbatim.
                        Nothing is recomputed: this is the reference.

  method 2  'fair'      "Équitable": the weighted mean of the best 60 % of
                        the scores in the window (championnat de France 2,
                        national race 1.5, other 1), with NO annual step: the
                        level is held by a monthly recalage applied to each
                        race once. Only runners with a CN of their own value
                        a circuit.

  method 3  'top6w'     "Top": the same race scores as 'fair' (derived from
                        it, not recomputed), but the CN keeps only the best
                        races filling 6 weight places - it rewards racing.

For both computed methods forest and sprint are independent rankings in every
season — the federation only split them in 2026, but applying one rule
uniformly is the point of recomputing.

Everything is processed in date order because the layers are mutually
dependent: a circuit's value needs the runners' CNs, which come from their
earlier scores. That is sound rather than circular because the CN a race uses
is the one from 15 days earlier.
"""

from __future__ import annotations

import dataclasses
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
    mode: str = "monthly_lag"
    lag_months: int = 2
    smooth_months: int = 13        # window for the *_monthly smoothing modes
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


def build_methods() -> dict[str, MethodSpec]:
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
        min_scores_for_cn=3,     # a runner needs >=3 races for a CN
        new_entrant_rescue=False,  # only real CN holders score a circuit
    )
    return {
        "fair": MethodSpec(
            name="fair",
            params=fair,
            rescale=None,  # no annual step at all
            normalisation=Normalisation(),
            description="weighted mean of the best 60 %, monthly recalage",
        ),
        "top6w": MethodSpec(
            name="top6w",
            # Fair's race scores, but the CN keeps only the best races filling 6
            # weight places: racing more can only raise it. Measured on 2025-26,
            # it predicts head-to-heads as well as Fair (82 % forest, 84 % sprint).
            params=dataclasses.replace(fair, top_n=6),
            derived_from="fair",
            description="Fair's scores, best 6 weighted places",
        ),
    }


class CnEngine:
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
            WHERE comp.specialite = 'Pédestre' AND comp.date_iso IS NOT NULL {where}
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
                   bootstrap_days: int = 365) -> dict[str, tuple[int, date | None]]:
        """Each runner's first known official CN, and the date from which it
        was known: licence -> (cn, known_from).

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
        before: dict[str, tuple[int, date | None]] = {}
        after: dict[str, tuple[int, date | None]] = {}
        bootstrap_end: str | None = None
        for licence, cn, d in self.conn.execute(
            """
            SELECT r.licence, r.cn_j15, comp.date_iso
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
            if bootstrap_end is None:
                bootstrap_end = (date.fromisoformat(d) + timedelta(days=bootstrap_days)).isoformat()
            if since and d < since:
                before[licence] = (v, None)
            elif licence not in after:
                after[licence] = (v, None if d < bootstrap_end
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

        for lic, terrain, d, raw, w in self.conn.execute(
            """SELECT licence, terrain, date_iso, score_raw, poids FROM scores
               WHERE method = ? AND date_iso < ? AND counts_for_cn = 1 AND score_raw IS NOT NULL
               ORDER BY date_iso, course_id, circuit_id""",
            (spec.name, since),
        ):
            dd = date.fromisoformat(d)
            if current_year is None:
                current_year = dd.year
            cross_into(dd.year)
            hist[(lic, terrain)].add(dd, raw, w)
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
        seeds = self.load_seeds(f"{min(seasons)}-01-01" if seasons else None, p.lag_days)

        def seed(licence: str, as_of: date):
            if p.seed_until and as_of.isoformat() >= p.seed_until:
                return None
            s = seeds.get(licence)
            return s[0] if s and (s[1] is None or as_of >= s[1]) else None
        if since:
            hist, current_year = self._replay(spec, since)
            logger.info("%s: resumed %d histories before %s", spec.name, len(hist), since)
        else:
            hist = defaultdict(RunnerHistory)
            current_year = None

        uncapped = dataclasses.replace(p, top_n=10 ** 6)     # "pool": the whole best fraction counts

        def value_for(licence: str, terrain: str, as_of: date):
            """What the runner brings to a circuit's value (p.valuation)."""
            if p.valuation not in ("trimmed", "pool"):
                return cn_for(licence, terrain, as_of)
            h = hist.get((licence, terrain))
            if h is not None:
                s, w = h.slice(as_of, p.window_days)
                if s:
                    lvl, kept = (trimmed_mean(s, p) if p.valuation == "trimmed"
                                 else top_n_weighted(s, w, uncapped))
                    if lvl is not None:
                        return lvl, len(s), kept
                    return seed(licence, as_of), len(s), 0
            return seed(licence, as_of), 0, 0

        def cn_for(licence: str, terrain: str, as_of: date):
            # forest and sprint are independent rankings in every season
            h = hist.get((licence, terrain))
            if h is not None:
                cn, n_w, n_k = h.cn_as_of(as_of, p)
                if cn is not None:
                    return cn, n_w, n_k
                if n_w:
                    return seed(licence, as_of), n_w, 0
            return seed(licence, as_of), 0, 0

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
            cv, n_sample = circuit_value(ranked, p, k=k)
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
                    hist[(r["licence"], terrain)].add(d, score, weight)
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
            start = (date.fromisoformat(since) - timedelta(days=p.window_days + 1)).isoformat()
        raw: dict = defaultdict(RunnerHistory)
        pub: dict = defaultdict(RunnerHistory)
        for s in self.conn.execute(
                "SELECT licence, terrain, date_iso, score, score_raw, poids FROM scores "
                "WHERE method=? AND counts_for_cn=1 AND score_raw IS NOT NULL AND date_iso >= ? "
                "ORDER BY date_iso, course_id, circuit_id", (spec.name, start)):
            d, w, key = date.fromisoformat(s["date_iso"]), s["poids"] or 1.0, (s["licence"], s["terrain"])
            raw[key].add(d, s["score_raw"], w)
            pub[key].add(d, s["score"] if s["score"] is not None else s["score_raw"], w)
        rows = []
        for r in self.conn.execute(
                "SELECT licence, terrain, date_iso, cn_raw, n_scores_window FROM cn_history "
                "WHERE method=? AND date_iso >= ?", (src, frm)):
            cn = cn_raw = None
            kept = 0
            key, d = (r["licence"], r["terrain"]), date.fromisoformat(r["date_iso"])
            if r["cn_raw"] is not None and key in raw:     # the source published a CN: so does this method
                cn_raw, _, kept = raw[key].cn_as_of(d, p)
                cn = pub[key].cn_as_of(d, p)[0] if kept else None
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
        rows = self.conn.execute(
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
            schedule[terrain] = self._factor_schedule(level, cfg)

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

    def _publish_cn(self, spec: MethodSpec, rewrite_from: str | None) -> int:
        """cn_history.cn = aggregate of the published scores in the window (from `rewrite_from`)."""
        p = spec.params
        start = ""
        if rewrite_from:          # the window of the first rewritten row reaches back this far
            start = (date.fromisoformat(rewrite_from) - timedelta(days=p.window_days + 1)).isoformat()
        hist: dict = defaultdict(RunnerHistory)
        for s in self.conn.execute(
                "SELECT licence, terrain, date_iso, score, poids FROM scores "
                "WHERE method=? AND counts_for_cn=1 AND score IS NOT NULL AND date_iso >= ? "
                "ORDER BY date_iso", (spec.name, start)):
            hist[(s["licence"], s["terrain"])].add(date.fromisoformat(s["date_iso"]), s["score"], s["poids"] or 1.0)
        updates = []
        for r in self.conn.execute(
                "SELECT licence, terrain, date_iso, cn_raw FROM cn_history WHERE method=? AND date_iso >= ?",
                (spec.name, rewrite_from or "")):
            cn = None
            h = hist.get((r["licence"], r["terrain"]))
            if r["cn_raw"] is not None and h is not None:   # no raw CN: the seed showing through, unpublished
                cn, _, kept = h.cn_as_of(date.fromisoformat(r["date_iso"]), p)
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
            elif cfg.mode == "monthly_lag":
                # The level from `lag_months` ago, so late results have
                # settled before they can move the scale.
                j = max(0, i - cfg.lag_months)
                lo, hi = max(0, j - cfg.smooth_months + 1), j + 1
            else:  # trailing_monthly
                lo, hi = max(0, i - cfg.smooth_months + 1), i + 1
            sm = sum(vals[lo:hi]) / (hi - lo)
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

"""Compute the Classement National (CN) from scraped results.

Two linked computations, per ffcorientation.fr/aide-cn/calcul/:

1. Per-race score on a circuit
       circuit_value = mean(CN_at_J-15 * time) over the fastest 2/3 of
                       ranked finishers, times k/1000
       score         = circuit_value / runner's time

2. The CN itself: over a rolling 365-day window, the mean of a runner's
   scores after discarding the best 10% and the worst 40%, requiring at
   least 2 scores.

These are mutually dependent — a circuit's value needs the runners' CNs,
which come from their earlier scores — so everything is computed strictly
in date order. That is sound rather than circular because the CN a race
uses is the one from 15 days earlier, and all scores older than that are
already final by the time we reach the race.

The parameters the published description leaves ambiguous (how 2/3 is
rounded, the k coefficient, how the 10%/40% trim rounds) are gathered in
CnParams so they can be swept against real data instead of guessed.
"""

from __future__ import annotations

import math
import re
import sqlite3
import unicodedata
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from pathlib import Path

NON_FINISHER_STATUSES = {
    "pm": "pm",
    "abandon": "abandon",
    "disqualifié": "disqualifie",
    "disqualifie": "disqualifie",
    "hors délai": "hors_delai",
    "hors delai": "hors_delai",
}

EXCLUDED_CATEGORIES = {"D10", "H10"}


# Race-group weighting for the top-6 aggregation: A and B count twice D,
# C one and a half times D.
GROUP_WEIGHTS = {"A": 2.0, "B1": 2.0, "B2": 2.0, "C1": 1.5, "C2": 1.5, "D": 1.0}
DEFAULT_GROUP_WEIGHT = 1.0


def group_weight(groupe: str | None) -> float:
    return GROUP_WEIGHTS.get((groupe or "").strip().upper(), DEFAULT_GROUP_WEIGHT)


def _plain(text: str | None) -> str:
    t = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(ch for ch in t if not unicodedata.combining(ch)).replace("’", "'")


TITLE_WEIGHTS = {"cdf": 2.0, "national": 1.5, "other": 1.0}


def title_weight(title: str | None) -> float:
    """Weight from the competition's name: a championnat de France 2, a national
    race (O'France, Nationale ...) 1.5, anything else 1."""
    t = _plain(title)
    if "championnat de france" in t:
        return TITLE_WEIGHTS["cdf"]
    if "o'france" in t or re.search(r"\bnationale\b", t):
        return TITLE_WEIGHTS["national"]
    return TITLE_WEIGHTS["other"]


def race_weight(groupe: str | None, title: str | None, params: "CnParams") -> float:
    return title_weight(title) if params.weighting == "title" else group_weight(groupe)


@dataclass(frozen=True)
class CnParams:
    # how a race is weighted in top6_weighted: "group" (FFCO's A/B/C/D level)
    # or "title" (championnat de France / national race / other)
    weighting: str = "group"
    sample_fraction: float = 2 / 3
    sample_rounding: str = "floor"       # floor | round | ceil
    min_ranked: int = 3                  # circuit needs this many ranked runners
    k_over_1000: float = 1.0             # "coefficient de régulation"
    new_entrant_value: int = 2000
    # The federation injects a synthetic 2000 to rescue a circuit that would
    # otherwise have too few ranked runners. Turning this off means only
    # runners who genuinely hold a CN ever contribute to a circuit's value.
    new_entrant_rescue: bool = True
    # How a runner's scores become a CN:
    #   "trimmed"      - federation rule: drop best 10% / worst 40%, mean
    #   "top6_weighted"- best N races, weighted by race group
    aggregation: str = "trimmed"
    # top6_weighted: `top_n` is a number of *slots*, not of races. From the best
    # score down, each race fills as many slots as its weight (A/B 2, C 1.5,
    # D 1) until they are full; the last one counts only for what is left. So
    # a stronger event can never lower the CN, which a mean over a fixed six
    # races allowed (a B race as 6th weighed twice a D race at the bottom).
    top_n: int = 6
    # The races are taken from the best `eligible_fraction` of the window
    # rather than from all of it, so a runner with few races cannot have all
    # of them counted.
    eligible_fraction: float = 0.60
    # What values a circuit: "cn" - each ranked runner's CN as published by the
    # method; "pool" - the same weighted mean of the best `eligible_fraction`
    # of their scores, but without the `top_n` cap; "trimmed" - the 2026 rule's
    # mean (without the 10 % best and 40 % worst). The last two keep a method that
    # publishes the best races from feeding that selection back into circuit values.
    valuation: str = "cn"
    # A runner without a CN of their own falls back on their first official CN
    # to value circuits; with seed_until, only for races before that date (the
    # archive's start), never after.
    seed_until: str | None = None
    # Sprint only: when every circuit of a competition has its length, value
    # them together per kilometre (mean of CN x time / length over the fastest
    # two thirds of all the competition's ranked runners, by pace), each
    # circuit then worth that x its length - so a circuit run by one age group
    # is valued by the whole field, not by that group alone.
    distance_pooling: bool = False
    drop_best_frac: float = 0.10
    drop_worst_frac: float = 0.40
    trim_rounding: str = "round"         # how the dropped counts round
    min_scores_for_cn: int = 2
    window_days: int = 365
    lag_days: int = 15                   # CN "à J-15"
    # Power means (2026-10-07): 1 = the plain mean (FFCO's rule); 2 = the quadratic mean, which leans towards
    # the higher values. `cv_power` for the circuit value (mean of CN x time over the sample), `cn_power` for
    # a runner's CN (weighted mean of the kept scores). Measured: both at 2 predict best in every specialité.
    cv_power: float = 1.0
    cn_power: float = 1.0
    # The race's elasticity (study of 2026-10-13): a runner's score is V / time^k with V = mean(CN x time^k) over
    # the sample - k = 1 is FFCO's rule (1 % slower, 1 % fewer points); k = 2, 2 % fewer. "circuit": each
    # circuit's own k, the ratio of the spreads of log CN and log time among its ranked CN holders (reduced major
    # axis), shrunk towards `race_power` with the weight n / (n + race_power_n0). cv_power 0: the geometric mean.
    race_power: float = 1.0
    race_power_mode: str = "fixed"       # fixed | circuit | ols
    race_power_n0: float = 30.0
    # The item-response view (study of 2026-10-13): on a circuit, ln time = delta - beta ln CN + noise. "ols": the
    # race's elasticity is race_power x race_beta_ref / beta, beta the least-squares slope over the ranked CN holders
    # shrunk towards race_beta_ref (the discipline's typical slope) with the weight n / (n + race_power_n0) - a
    # circuit where a given gap in level makes a larger gap in time has its scores compressed accordingly.
    # race_weight_mode "info": a race's weight (title weight x this) follows the information it carries about the
    # runner's level, beta^2 / sigma^2 relative to the discipline's typical (race_sigma_ref: the residual sd of
    # ln time), sigma^2 shrunk with n / (n + race_weight_n0); clamped to [1 / race_weight_max, race_weight_max].
    race_beta_ref: float = 0.93
    race_sigma_ref: float = 0.14
    race_weight_mode: str = "title"      # title | info
    race_weight_n0: float = 10.0
    race_weight_max: float = 3.0
    # A bent race score (study of 2026-10-13): with x = ln(time / t_ref), t_ref the time of a runner of the sample's
    # mean CN, ln score = ln(mean CN) - k x + gamma x^2 - big time losses (often mistakes) count less than
    # proportionally. 0: FFCO's straight rule. Past the curve's lowest point the score stays flat (never rises).
    race_curvature: float = 0.0
    # A robust geometric circuit value (study of 2026-10-13): with cv_power 0, Huber's M-estimate of the location
    # of ln(CN x time^k) instead of its mean - a runner further than cv_huber robust standard deviations
    # (1.4826 x MAD) from it counts as if they were at that distance. 0: the plain mean.
    cv_huber: float = 0.0
    # aggregation "mle" (study of 2026-10-13): the CN is the level that makes the runner's race scores most likely,
    # given the distribution of a race's log score around a runner's level (MLE_TABLES[mle_table], measured on the
    # data); a race's weight multiplies its term. mle_zeros: "ignore" (a PM says nothing about speed) or "low" (it
    # counts as a race at the bottom of the distribution).
    mle_table: str = ""
    mle_zeros: str = "ignore"
    # A discipline's own values over the ones above, e.g. {"VTT": {"window_days": 730}}:
    # VTT and ski have far fewer competitions than forest and sprint.
    by_terrain: dict = field(default_factory=dict, hash=False, compare=False)
    per_terrain: bool = True             # 2026+ ranks Forêt and Sprint apart
    # Diagnostic: feed the site's own CN à J-15 into the circuit value
    # instead of our running one. Isolates the scoring formula from the
    # rolling-CN recursion, which is how the formula was validated.
    use_official_cn_for_circuit_value: bool = False

    def for_terrain(self, terrain: str | None) -> "CnParams":
        """These params as they apply in one discipline (its own values, if any)."""
        own = self.by_terrain.get(terrain or "")
        return replace(self, **own) if own else self

    @property
    def max_window_days(self) -> int:
        """The longest window of any discipline: how far back a partial run must reach."""
        return max([self.window_days, *(o.get("window_days", 0) for o in self.by_terrain.values())])


def parse_time(t: str | None) -> int | None:
    """'1:18:06' -> seconds. Returns None for non-finishers."""
    if not t or ":" not in t:
        return None
    try:
        parts = [int(p) for p in t.split(":")]
    except ValueError:
        return None
    if len(parts) == 3:
        h, m, s = parts
    elif len(parts) == 2:
        h, m, s = 0, parts[0], parts[1]
    else:
        return None
    total = h * 3600 + m * 60 + s
    return total if total > 0 else None


def is_nc(place: str | None) -> bool:
    """"nc" (non classé) in the place column: FFCO gives the runner no points
    and leaves the race out of their CN - unlike a PM or an abandon, which
    are placed nowhere but score 0 and count. Such a row takes no part in
    any calculation: not in the circuit's value, not in the runner's results."""
    return (place or "").strip().lower() == "nc"


def classify_status(temps: str | None) -> str:
    t = (temps or "").strip().lower()
    if t in NON_FINISHER_STATUSES:
        return NON_FINISHER_STATUSES[t]
    return "ok" if parse_time(temps) else "unknown"


def to_int(v: str | None) -> int | None:
    if v is None:
        return None
    v = v.strip().replace("+", "").replace(" ", "").replace(" ", "")
    if not v or not v.lstrip("-").isdigit():
        return None
    return int(v)


def sexe_of(categorie: str | None) -> str | None:
    c = (categorie or "").strip().upper()
    if c.startswith("H"):
        return "H"
    if c.startswith("D"):
        return "D"
    return None


def _apply_rounding(x: float, mode: str) -> int:
    if mode == "floor":
        return math.floor(x)
    if mode == "ceil":
        return math.ceil(x)
    return int(Decimal_round(x))


def Decimal_round(x: float) -> int:
    """Round half away from zero (what a spreadsheet does), not Python's
    banker's rounding, since the federation's figures follow the former."""
    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)


def circuit_fit(ranked: list[tuple[int, int]], params: CnParams) -> tuple[float, float, int] | None:
    """(beta, sigma, n) of ln time = delta - beta ln CN + noise over the ranked CN holders, both shrunk towards the
    discipline's typical values (params.race_beta_ref, race_sigma_ref); None under 6 runners or a flat field."""
    n = len(ranked)
    if n < 6:
        return None
    lc = [math.log(cn) for cn, _ in ranked]
    lt = [math.log(t) for _, t in ranked]
    mc, mt = sum(lc) / n, sum(lt) / n
    sxx = sum((x - mc) ** 2 for x in lc)
    if sxx <= 0:
        return None
    beta = -sum((x - mc) * (y - mt) for x, y in zip(lc, lt)) / sxx
    s2 = sum((y - mt + beta * (x - mc)) ** 2 for x, y in zip(lc, lt)) / (n - 2)
    w = n / (n + params.race_power_n0)
    beta_s = w * beta + (1 - w) * params.race_beta_ref
    wv = n / (n + params.race_weight_n0)
    sigma_s = math.sqrt(wv * s2 + (1 - wv) * params.race_sigma_ref ** 2)
    return beta_s, sigma_s, n


def circuit_info(ranked: list[tuple[int, int]], params: CnParams) -> float:
    """The race's weight factor (params.race_weight_mode "info"): its information about a runner's level, beta^2 /
    sigma^2, relative to the discipline's typical; 1 otherwise."""
    if params.race_weight_mode != "info":
        return 1.0
    fit = circuit_fit(ranked, params)
    if fit is None:
        return 1.0
    beta, sigma, _ = fit
    beta = max(beta, 0.2)
    r = (beta / params.race_beta_ref) ** 2 * (params.race_sigma_ref / sigma) ** 2
    return min(params.race_weight_max, max(1 / params.race_weight_max, r))


def circuit_elasticity(ranked: list[tuple[int, int]], params: CnParams) -> float:
    """The race's elasticity k (params.race_power_mode): the given power, or for "circuit" the circuit's own -
    the ratio of the robust spreads (interquartile ranges) of log CN and log time among the ranked CN holders,
    which makes the scores' spread match the field's CN spread, shrunk towards race_power - or for "ols" the
    power x the discipline's typical slope over the circuit's (circuit_fit)."""
    k0 = params.race_power
    if params.race_power_mode == "ols":
        fit = circuit_fit(ranked, params)
        if fit is None:
            return k0
        return k0 * min(2.0, max(0.5, params.race_beta_ref / max(fit[0], 0.2)))
    if params.race_power_mode != "circuit" or len(ranked) < 6:
        return k0
    lc = sorted(math.log(cn) for cn, _ in ranked)
    lt = sorted(math.log(t) for _, t in ranked)
    n = len(ranked)

    def iqr(v):
        return v[(3 * n) // 4] - v[n // 4]
    # the spreads must go the right way (stronger runners faster): else the circuit says nothing about k
    mc, mt = sum(lc) / n, sum(lt) / n
    cov = sum((math.log(cn) - mc) * (math.log(t) - mt) for cn, t in ranked)
    if cov >= 0 or iqr(lt) <= 0:
        return k0
    kc = min(4.0, max(0.25, iqr(lc) / iqr(lt)))
    w = n / (n + params.race_power_n0)
    return w * kc + (1 - w) * k0


def circuit_value(
    ranked: list[tuple[int, int]],
    params: CnParams,
    k: float | None = None,
    kr: float = 1.0,
) -> tuple[int | None, int]:
    """ranked: (cn_at_j15, time_seconds) for ranked finishers.

    Returns (circuit_value, n_sample). Value is None when the circuit does
    not have enough ranked runners to count. `k` overrides the params'
    coefficient, which changed by year (0.95 for 2022, otherwise 1.0).
    """
    if len(ranked) < params.min_ranked:
        return None, 0
    ordered = sorted(ranked, key=lambda r: r[1])  # fastest first
    n_total = len(ordered)
    if n_total == params.min_ranked:
        # "s'il n'y a que 3 coureurs classés, on n'en prend pas 2 mais les 3"
        n = n_total
    else:
        n = max(1, _apply_rounding(params.sample_fraction * n_total, params.sample_rounding))
    subset = ordered[:n]
    q = params.cv_power
    if kr == 1 and q == 1:
        mean_value = sum(cn * t for cn, t in subset) / len(subset)
    elif q == 0:                         # geometric mean
        xs = [math.log(cn) + kr * math.log(t) for cn, t in subset]
        mu = huber_location(xs, params.cv_huber) if params.cv_huber > 0 and len(xs) >= 4 else sum(xs) / len(xs)
        mean_value = math.exp(mu)
    else:
        mean_value = (sum((cn * t ** kr) ** q for cn, t in subset) / len(subset)) ** (1 / q)
    coeff = params.k_over_1000 if k is None else k
    return Decimal_round(mean_value * coeff), n


def huber_location(xs: list[float], c: float) -> float:
    """Huber's M-estimate of location, tuning constant c in robust standard deviations (1.4826 x MAD)."""
    s = sorted(xs)
    n = len(s)
    med = (s[(n - 1) // 2] + s[n // 2]) / 2
    dev = sorted(abs(x - med) for x in xs)
    h = c * 1.4826 * (dev[(n - 1) // 2] + dev[n // 2]) / 2
    if h <= 0:
        return med
    mu = med
    for _ in range(100):
        w = [1.0 if abs(x - mu) <= h else h / abs(x - mu) for x in xs]
        new = sum(wi * x for wi, x in zip(w, xs)) / sum(w)
        if abs(new - mu) < 1e-10:
            return new
        mu = new
    return mu


def trimmed_mean(scores: list[int], params: CnParams) -> tuple[int | None, int]:
    """Mean after dropping the best 10% and worst 40%. Returns (cn, n_kept)."""
    n = len(scores)
    if n < params.min_scores_for_cn:
        return None, 0
    ordered = sorted(scores, reverse=True)  # best first
    n_best = _apply_rounding(params.drop_best_frac * n, params.trim_rounding)
    n_worst = _apply_rounding(params.drop_worst_frac * n, params.trim_rounding)
    kept = ordered[n_best : n - n_worst] if n - n_worst > n_best else []
    if not kept:
        # Degenerate trim (very few scores): fall back to the middle one.
        kept = [ordered[len(ordered) // 2]]
    return Decimal_round(sum(kept) / len(kept)), len(kept)


def top_n_weighted(
    scores: list[int], weights: list[float], params: CnParams
) -> tuple[int | None, int]:
    """Keep the best N races and average them weighted by race group.

    Unlike the federation's trim this rewards peak performances rather than
    consistency, and lets a championship count for more than a local event.
    """
    n = len(scores)
    if n < params.min_scores_for_cn:
        return None, 0
    pairs = sorted(zip(scores, weights), key=lambda p: p[0], reverse=True)
    # Only the best `eligible_fraction` of the window is even considered,
    # so a runner with few races cannot have all of them counted.
    pool = max(1, Decimal_round(params.eligible_fraction * n))
    slots, kept = float(params.top_n), []
    for s, w in pairs[:pool]:
        if slots <= 0:
            break
        used = min(w, slots)                 # the last race may only partly fit
        kept.append((s, used))
        slots -= used
    total_w = sum(u for _, u in kept)
    if total_w <= 0:
        return None, 0
    q = params.cn_power
    if q != 1:                               # power mean of the kept scores, same weights
        return Decimal_round((sum(s ** q * u for s, u in kept) / total_w) ** (1 / q)), len(kept)
    return Decimal_round(sum(s * u for s, u in kept) / total_w), len(kept)


# name -> (first grid point, step, log density on the grid) of a race's log score around the runner's level
MLE_TABLES: dict[str, tuple] = {}


def mle_level(scores: list[int], weights: list[float], params: CnParams) -> tuple[int | None, int]:
    """The maximum-likelihood level (see CnParams.mle_table): exp(theta) maximising sum w log f(ln s - theta)."""
    import numpy as np
    n = len(scores)
    if n < params.min_scores_for_cn:
        return None, 0
    g0, step, logf = MLE_TABLES[params.mle_table]
    pos = [(math.log(s), w) for s, w in zip(scores, weights) if s > 0]
    if not pos:
        return 0, n
    lv = np.array([x for x, _ in pos])
    wv = np.array([w for _, w in pos])
    med = float(np.median(lv))
    zw = [w for s, w in zip(scores, weights) if s <= 0]
    if params.mle_zeros == "low" and zw:             # a PM: a pseudo-race far below the runner's usual level
        lv = np.concatenate([lv, np.full(len(zw), med - 1.0)])
        wv = np.concatenate([wv, np.array(zw, dtype=float)])
    thetas = med + np.arange(-0.8, 0.80001, 0.005)
    x = lv[:, None] - thetas[None, :]
    idx = np.clip(np.rint((x - g0) / step).astype(int), 0, len(logf) - 1)
    ll = (wv[:, None] * logf[idx]).sum(axis=0)
    j = int(np.argmax(ll))
    th = float(thetas[j])
    if 0 < j < len(thetas) - 1:                       # parabolic refinement between the grid points
        a, b, c = ll[j - 1], ll[j], ll[j + 1]
        den = a - 2 * b + c
        if den < 0:
            th += 0.005 * 0.5 * (a - c) / den
    return Decimal_round(math.exp(th)), n


def aggregate(
    scores: list[int], weights: list[float], params: CnParams
) -> tuple[int | None, int]:
    if params.aggregation == "mle":
        return mle_level(scores, weights, params)
    if params.aggregation == "top6_weighted":
        return top_n_weighted(scores, weights, params)
    return trimmed_mean(scores, params)


class RunnerHistory:
    """A runner's scores in date order, supporting 'CN as of date D'."""

    __slots__ = ("dates", "scores", "weights")

    def __init__(self) -> None:
        self.dates: list[date] = []
        self.scores: list[int] = []
        self.weights: list[float] = []

    def add(self, d: date, score: int, weight: float = 1.0) -> None:
        # races are fed in date order, so append keeps the list sorted
        self.dates.append(d)
        self.scores.append(score)
        self.weights.append(weight)

    def slice(self, as_of: date, window_days: int) -> tuple[list[int], list[float]]:
        lo = bisect_left(self.dates, as_of - timedelta(days=window_days))
        hi = bisect_right(self.dates, as_of)
        return self.scores[lo:hi], self.weights[lo:hi]

    def window(self, as_of: date, window_days: int) -> list[int]:
        return self.slice(as_of, window_days)[0]

    def cn_as_of(self, as_of: date, params: CnParams) -> tuple[int | None, int, int]:
        s, w = self.slice(as_of, params.window_days)
        cn, kept = aggregate(s, w, params)
        return cn, len(s), kept

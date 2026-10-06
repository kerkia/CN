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


def circuit_value(
    ranked: list[tuple[int, int]],
    params: CnParams,
    k: float | None = None,
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
    mean_value = sum(cn * t for cn, t in subset) / len(subset)
    coeff = params.k_over_1000 if k is None else k
    return Decimal_round(mean_value * coeff), n


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
    return Decimal_round(sum(s * u for s, u in kept) / total_w), len(kept)


def aggregate(
    scores: list[int], weights: list[float], params: CnParams
) -> tuple[int | None, int]:
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

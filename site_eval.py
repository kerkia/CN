"""How well each method's CN predicts race results, measured soundly -> site/data/evaluation.json (Méthodes · Les
analyses). Built from the per-competition result files only, like the other second-stage datasets; rebuilt when it is
missing (update.migrate deletes it whenever a method or this measure changes).

The question: on a circuit, does the CN each runner had 15 days before the race (their own published CN, no fallback)
tell who finishes ahead, and by how much? The runners compared are the same for every method: those who finished
("ok", a time) and held a CN in all of them. Three measures, from the coarsest to the finest:

  tau   Kendall's tau-b between the CN and the finishing order, circuit by circuit, then averaged over the circuits —
        each circuit counts once (a duel count lets a 150-runner circuit weigh as much as 500 small ones), and the
        difference between two methods is taken circuit by circuit (paired: same runners, same race).
  r2    the share of the spread of finishing times (log of the time, measured from the circuit's mean) that the CN
        explains: ln t = a_circuit - b * ln CN, the slope b fitted on the previous season, so every season is predicted
        out of sample. Margins count, not just the order.
  pl    the Plackett-Luce likelihood of the whole finishing order (the winner among all, then the second among the
        rest...), each runner's chance proportional to CN^beta, beta fitted on the previous season: the information
        gained per runner over a random order, in nats (a proper score: being right with confidence earns more).
  acc   the share of duels called right, as the page used to show (ties in CN count as wrong), for continuity.

Uncertainty: duels and runners of one race are not independent (same day, same terrain, same weather), so the 95 %
intervals come from a bootstrap that resamples whole competitions (BOOT draws). A difference whose interval holds 0
is not established. Periods: each season from FIRST, the seasons before any tuning (HOLDOUT: the parameters were
chosen on July 2025 - October 2026), and that tuning period itself.

Run on its own:  py -3 site_eval.py   (a few minutes)
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from site_io import dump
from ffco_scraper.cn import title_weight

ROOT = Path(__file__).parent
OUT = ROOT / "site" / "data"

METHODS = ("official", "fair", "top6w", "fair3", "top6w3")
CNJ15 = (7, 9, 11, 13, 15)          # c/ row columns: each method's CN 15 days before the race
TERRAINS = ("For", "Spr")           # VTT and ski: too few races a season for per-season figures
FIRST = 2012                        # the first seasons mostly reflect the seed CNs
HOLDOUT = (2012, 2024)              # before the period the parameters were tuned on
TUNED_FROM = "2025-07-01"           # the tuning period: July 2025 - October 2026
MIN_RUNNERS = 4                     # runners compared on a circuit
BOOT = 2000
BETAS = np.round(np.arange(0.0, 24.01, 0.25), 2)
PAIRS = (("top6w3", "official"), ("fair3", "official"), ("top6w", "official"), ("fair", "official"),
         ("top6w3", "top6w"), ("fair3", "fair"), ("fair3", "top6w3"), ("fair", "top6w"))
NM = len(METHODS)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def circuit_stats(rows: list) -> dict | None:
    """The additive quantities of one circuit (see the module's docstring)."""
    rows = [r for r in rows if r[3] == "ok" and r[2] and all(r[k] for k in CNJ15)]
    n = len(rows)
    if n < MIN_RUNNERS:
        return None
    rows.sort(key=lambda r: r[2])                         # finishing order
    t = np.array([r[2] for r in rows], dtype=float)
    cn = np.array([[r[k] for k in CNJ15] for r in rows], dtype=float)          # n x methods
    x = np.log(cn)
    iu = np.triu_indices(n, 1)
    dt = np.sign(t[iu[0]] - t[iu[1]])                     # +1: the first of the pair finished behind
    n0 = len(dt)
    n2 = int(np.sum(dt == 0))
    tau = np.zeros(NM)
    right = np.zeros(NM)
    for m in range(NM):
        dc = np.sign(cn[iu[0], m] - cn[iu[1], m])        # +1: the first of the pair holds the higher CN
        s = -np.sum(dc * dt)                              # concordant minus discordant
        n1 = int(np.sum(dc == 0))
        den = np.sqrt(float(n0 - n1) * float(n0 - n2))
        tau[m] = s / den if den else 0.0
        right[m] = np.sum((dc * dt)[dt != 0] < 0)
    # log-time against log-CN, both from the circuit's mean
    y = np.log(t) - np.log(t).mean()
    xc = x - x.mean(axis=0)
    # Plackett-Luce log-likelihood of the order for each beta, less a random order's (beta = 0)
    pl = np.zeros((NM, len(BETAS)))
    for m in range(NM):
        v = np.outer(x[:, m] - x[:, m].max(), BETAS)      # n x betas
        suffix = np.logaddexp.accumulate(v[::-1], axis=0)[::-1]
        pl[m] = (v - suffix).sum(axis=0)
    pl0 = -np.sum(np.log(np.arange(n, 0, -1)))
    return {"n": n, "pairs": n0 - n2, "tau": tau, "right": right, "syy": float(y @ y), "sxy": xc.T @ y,
            "sxx": np.einsum("ij,ij->j", xc, xc), "pl": pl - pl0}


def collect(comps: dict) -> dict:
    """Per competition: its season, terrain, scopes, date and summed circuit quantities."""
    out = {}
    for cid, c in comps.items():
        terrain, season = c[6], int(c[7])
        if terrain not in TERRAINS or season < FIRST - 1:
            continue
        path = OUT / "c" / f"{cid}.json"
        if not path.exists():
            continue
        acc = None
        for circ in load(path)["circuits"]:
            s = circuit_stats(circ["rows"])
            if s is None:
                continue
            s["circuits"] = 1
            if acc is None:
                acc = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in s.items()}
                acc["circ_list"] = [s]
            else:
                for k, v in s.items():
                    acc[k] = acc[k] + v
                acc["circ_list"].append(s)
        if acc:
            acc.update(terrain=terrain, season=season, date=c[0], nat=title_weight(c[1]) > 1)
            out[cid] = acc
    return out


def fit(items: list) -> tuple[np.ndarray, np.ndarray]:
    """The log-time slope and the Plackett-Luce beta of each method, from a training set of competitions."""
    sxy = sum(i["sxy"] for i in items)
    sxx = sum(i["sxx"] for i in items)
    b = sxy / sxx                                          # negative: a higher CN, a shorter time
    pl = sum(i["pl"] for i in items)                       # methods x betas
    return b, BETAS[np.argmax(pl, axis=1)]


def features(items: list, b: np.ndarray, beta: np.ndarray) -> np.ndarray:
    """One row per competition of the additive quantities the statistics are ratios of."""
    bi = [int(np.searchsorted(BETAS, x)) for x in beta]
    rows = []
    for i in items:
        sse = i["syy"] - 2 * b * i["sxy"] + b * b * i["sxx"]
        plv = np.array([i["pl"][m, bi[m]] for m in range(NM)])
        rows.append(np.concatenate([[i["circuits"], i["pairs"], i["n"], i["syy"]], i["tau"], i["right"], sse, plv]))
    return np.array(rows)


def stats(F: np.ndarray) -> np.ndarray:
    """From summed features (... x F): per method tau, acc, r2, pl (... x 4 x methods)."""
    nc, npairs, nrun, syy = F[..., 0], F[..., 1], F[..., 2], F[..., 3]
    o = 4
    tau = F[..., o:o + NM] / nc[..., None]
    acc = F[..., o + NM:o + 2 * NM] / npairs[..., None]
    r2 = 1 - F[..., o + 2 * NM:o + 3 * NM] / syy[..., None]
    pl = F[..., o + 3 * NM:o + 4 * NM] / nrun[..., None]
    return np.stack([tau, acc, r2, pl], axis=-2)


def summarise(F: np.ndarray, rng) -> dict | None:
    """The statistics of a set of competitions (rows of F), with bootstrap intervals for the differences."""
    k = len(F)
    if k < 3:
        return None
    total = F.sum(axis=0)
    point = stats(total)
    counts = np.stack([np.bincount(rng.integers(0, k, k), minlength=k) for _ in range(BOOT)])
    boot = stats(counts @ F)                               # BOOT x 4 x methods
    names = ("tau", "acc", "r2", "pl")
    res = {"comps": k, "circuits": int(total[0]), "pairs": int(total[1]), "runners": int(total[2])}
    for j, nm in enumerate(names):
        res[nm] = {m: round(float(point[j, i]), 5) for i, m in enumerate(METHODS)}
    res["d"] = {}
    for a, c in PAIRS:
        ia, ic = METHODS.index(a), METHODS.index(c)
        res["d"][f"{a}-{c}"] = {nm: [round(float(point[j, ia] - point[j, ic]), 5),
                                     *[round(float(q), 5) for q in np.percentile(boot[:, j, ia] - boot[:, j, ic], [2.5, 97.5])]]
                                for j, nm in enumerate(names)}
    return res


def evaluation(comps: dict | None = None, force: bool = False) -> None:
    if (OUT / "evaluation.json").exists() and not force:
        return
    t0 = time.monotonic()
    comps = comps or load(OUT / "competitions.json")["rows"]
    data = collect(comps)
    rng = np.random.default_rng(20261010)
    seasons = sorted({i["season"] for i in data.values() if i["season"] >= FIRST})
    rows, fits = {}, {}
    for terrain in TERRAINS:
        by_season = defaultdict(list)
        for i in data.values():
            if i["terrain"] == terrain:
                by_season[i["season"]].append(i)
        # each season predicted with what the previous one taught (all races)
        fitted = {s: fit(by_season[s - 1]) for s in seasons if by_season.get(s - 1)}
        fits[terrain] = {str(s): {"b": [round(float(x), 4) for x in fitted[s][0]], "beta": [float(x) for x in fitted[s][1]]}
                         for s in fitted}
        rows[terrain] = {}
        for scope in ("all", "nat"):
            keep = lambda i: scope == "all" or i["nat"]
            per = {}
            for s in seasons:
                if s in fitted:
                    sel = [i for i in by_season[s] if keep(i)]
                    per[str(s)] = summarise(features(sel, *fitted[s]), rng) if sel else None
            # pooled periods: each competition keeps the fit of its own season
            def pooled(pred):
                F = [features(sel, *fitted[s]) for s in seasons if s in fitted
                     for sel in [[i for i in by_season[s] if keep(i) and pred(i)]] if sel]
                return summarise(np.vstack(F), rng) if F else None
            per["holdout"] = pooled(lambda i: HOLDOUT[0] <= i["season"] <= HOLDOUT[1])
            per["tuned"] = pooled(lambda i: i["date"] >= TUNED_FROM)
            rows[terrain][scope] = {k: v for k, v in per.items() if v}
    dump(OUT / "evaluation.json", {
        "generated": date.today().isoformat(), "methods": list(METHODS), "lag_days": 15, "first": FIRST,
        "holdout": list(HOLDOUT), "tuned_from": TUNED_FROM, "boot": BOOT, "min_runners": MIN_RUNNERS,
        "pairs": [f"{a}-{c}" for a, c in PAIRS], "fits": fits, "rows": rows,
    })
    n = sum(v["runners"] for t in rows.values() for k, v in t["all"].items() if k.isdigit())
    print(f"  evaluation: {n:,} runner results in {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    evaluation(force=True)

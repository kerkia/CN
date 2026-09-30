"""Second-stage datasets, derived only from what build_site.py already exported.

Everything here reads site/data (snapshots, category/club attributes, the
per-competition result files) rather than the database, so it can be re-run
on its own in a few minutes after a full build:

    py -3 site_extras.py

Outputs (all under site/data/):
    club/{code}.json        club aggregates: "monthly" [n, median, max, sum, top5]
                            per "{method}_{terrain}" and month; "years" and "pts"
                            per season and sex/age group
    elite/{season}.json     points earned in national races (levels A and B1)
    elite_summary.json      the same points summed per club and season
    agecurve.json           CN quantiles per age category and season
    net/{bucket}.json       each runner's most frequent co-runners
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from site_io import dump

ROOT = Path(__file__).parent
OUT = ROOT / "site" / "data"

# Points for the first ten of a category, Formula-1 style: a win is worth a
# lot more than a 10th place, but depth still counts.
ELITE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
ELITE_LEVELS = {"A", "B1"}          # national races: championnats, nationales, sélections
ELITE_CATS = {"H21", "D21"}         # the "élite" ranking; "all" keeps every category
CHAMPIONSHIP_COEFF = 2              # a national championship counts double
QUANTILES = list(range(0, 101, 5))
AGE_POOL_FROM = 2012                # the first seasons mostly reflect the seed CNs
NET_TOP = 30                        # co-runners kept per runner
NET_MIN_SHARED = 2


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))





def club_code(club: str | None) -> str | None:
    m = re.match(r"^(\d{4})[A-Z]*$", (club or "").strip())
    return m.group(1) if m else None


def fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def snapshot_files(year: int):
    """(method, terrain, snapshot) for every CN snapshot of a season."""
    for f in sorted((OUT / "snap").glob(f"*_{year}.json")):
        if f.name.startswith("attr_"):
            continue
        method, terrain, _ = f.stem.split("_")
        yield method, terrain, load(f)


# -- clubs ---------------------------------------------------------------------
SEXES = ("H", "D", "*")
# J: up to 20 (H/D 10-20), A: 21 and over, E: 21 only (the elite category)
AGE_GROUPS = ("J", "A", "E", "*")


def groups_of(cat: str | None) -> list[str]:
    """Every sex/age combination a category belongs to, as 'HJ', '*A', '**'…"""
    m = re.match(r"^([HD])(\d+)$", (cat or "").strip())
    if not m:
        return ["**"]
    sexe, age = m.group(1), int(m.group(2))
    ages = ["J" if age <= 20 else "A", "*"] + (["E"] if age == 21 else [])
    return [s + a for s in (sexe, "*") for a in ages]


def summarise(values: list[float]) -> list:
    """[n, sum, sum of the best five] — enough for total, mean and top-5 mean."""
    values = sorted(values)
    return [len(values), round(sum(values)), round(sum(values[-5:]))]


def club_files(years: list[int], elite_rows: dict) -> None:
    """Per-club aggregates.

    monthly: [n, median, max, sum, top5] per "{method}_{terrain}" and month, over
      every ranked runner. `sum` rewards size and level together; `top5` is the
      mean of the five best CNs, a missing runner counting 0.
    years: at each season's last month-end, [n, sum, top5 sum] per sex/age group.
    pts: national-race points per season, the same summary over each runner's total."""
    series = defaultdict(lambda: defaultdict(dict))
    years_out = defaultdict(lambda: defaultdict(dict))
    for Y in years:
        attr = load(OUT / "snap" / f"attr_{Y}.json")
        for method, terrain, snap in snapshot_files(Y):
            last = len(snap["months"]) - 1
            grouped = defaultdict(lambda: defaultdict(list))
            for row in snap["rows"]:
                cn = row[1 + last]
                a = attr.get(str(row[0]))
                code = club_code(a[1]) if cn and a else None
                if code:
                    for g in groups_of(a[0]):
                        grouped[code][g].append(cn)
            for code, per in grouped.items():
                years_out[code][f"{method}_{terrain}"][str(Y)] = {g: summarise(v) for g, v in per.items()}
            for i, m in enumerate(snap["months"]):
                per_club = defaultdict(list)
                for row in snap["rows"]:
                    cn = row[1 + i]
                    a = attr.get(str(row[0]))
                    code = club_code(a[1]) if cn and a else None
                    if code:
                        per_club[code].append(cn)
                for code, vals in per_club.items():
                    vals.sort()
                    series[code][f"{method}_{terrain}"][m[:7]] = [
                        len(vals), vals[len(vals) // 2], vals[-1], sum(vals),
                        round(sum(vals[-5:]) / 5)]
    # national-race points: each runner's season total within each group
    comps = load(OUT / "competitions.json")["rows"]
    pts_out = defaultdict(lambda: defaultdict(dict))
    for season, rows in elite_rows.items():
        per_runner = defaultdict(float)             # (club, terrain, group, licence) -> points
        for course, lic, cat, _rank, pts, code in rows:
            if not code:
                continue
            terrain = comps[str(course)][6]
            for g in groups_of(cat):
                per_runner[(code, terrain, g, lic)] += pts
        grouped = defaultdict(list)
        for (code, terrain, g, _lic), v in per_runner.items():
            grouped[(code, terrain, g)].append(v)
        for (code, terrain, g), v in grouped.items():
            pts_out[code][terrain].setdefault(str(season), {})[g] = summarise(v)
    codes = set(series) | set(years_out) | set(pts_out)
    for code in codes:
        dump(OUT / "club" / f"{code}.json", {"monthly": series.get(code, {}), "years": years_out.get(code, {}),
                                              "pts": pts_out.get(code, {})})
    print(f"  {len(codes)} club files")


# -- elite results ---------------------------------------------------------------
def elite(comps: dict) -> dict:
    """Top-10 finishes per category in national races, with points.

    A category is ranked on the circuit where most of its runners ran, so an
    open 'H21 court' circuit alongside the elite one does not hand out a second
    set of podiums."""
    by_season = defaultdict(list)
    summary = {mode: {t: defaultdict(lambda: defaultdict(int)) for t in ("For", "Spr")}
               for mode in ("elite", "all")}
    for cid, c in comps.items():
        d, title, _, _, groupe, _, terrain, season, *_ = c
        if groupe not in ELITE_LEVELS:
            continue
        path = OUT / "c" / f"{cid}.json"
        if not path.exists():
            continue
        coeff = CHAMPIONSHIP_COEFF if "championnat de france" in fold(title) else 1
        circuits = load(path)["circuits"]
        count = defaultdict(lambda: defaultdict(int))        # cat -> circuit index -> n
        for k, circ in enumerate(circuits):
            for r in circ["rows"]:
                if r[4]:
                    count[r[4]][k] += 1
        for cat, per in count.items():
            k = max(per, key=per.get)
            ranked = sorted((r for r in circuits[k]["rows"]
                             if r[4] == cat and r[3] == "ok" and r[1]), key=lambda r: r[1])
            for rank, r in enumerate(ranked[: len(ELITE_POINTS)], start=1):
                pts = ELITE_POINTS[rank - 1] * coeff
                code = club_code(r[5])
                by_season[season].append([int(cid), r[0], cat, rank, pts, code])
                if code:
                    summary["all"][terrain][code][season] += pts
                    if cat in ELITE_CATS:
                        summary["elite"][terrain][code][season] += pts
    for season, rows in by_season.items():
        rows.sort(key=lambda x: (comps[str(x[0])][0], x[0], x[2], x[3]))
        dump(OUT / "elite" / f"{season}.json", {"rows": rows})
    dump(OUT / "elite_summary.json", {
        "points": ELITE_POINTS, "levels": sorted(ELITE_LEVELS), "cats": sorted(ELITE_CATS),
        "championship_coeff": CHAMPIONSHIP_COEFF,
        "data": {mode: {t: {code: dict(v) for code, v in per.items()} for t, per in d.items()}
                 for mode, d in summary.items()},
    })
    print(f"  elite: {sum(len(v) for v in by_season.values()):,} top-10 finishes over {len(by_season)} seasons")
    return by_season


# -- age curves ------------------------------------------------------------------
def quantiles(sorted_vals: list[int]) -> list[int]:
    a = np.asarray(sorted_vals, dtype=float)
    return [int(round(x)) for x in np.percentile(a, QUANTILES)]


def age_curves(years: list[int]) -> None:
    """CN distribution of each age category at each season's last month-end,
    so a runner's season can be placed against everyone of their category."""
    data = defaultdict(dict)
    pooled = defaultdict(lambda: defaultdict(list))
    months = {}
    for Y in years:
        attr = load(OUT / "snap" / f"attr_{Y}.json")
        for method, terrain, snap in snapshot_files(Y):
            i = len(snap["months"]) - 1
            months[str(Y)] = snap["months"][i]
            per_cat = defaultdict(list)
            for row in snap["rows"]:
                cn = row[1 + i]
                a = attr.get(str(row[0]))
                if cn and a and a[0]:
                    per_cat[a[0]].append(cn)
            key = f"{method}_{terrain}"
            out = {}
            for cat, vals in per_cat.items():
                if len(vals) >= 5:
                    vals.sort()
                    out[cat] = [len(vals), *quantiles(vals)]
                if Y >= AGE_POOL_FROM:
                    pooled[key][cat].extend(vals)
            data[key][str(Y)] = out
    for key, per_cat in pooled.items():
        data[key]["all"] = {cat: [len(v), *quantiles(sorted(v))] for cat, v in per_cat.items() if len(v) >= 5}
    dump(OUT / "agecurve.json", {"q": QUANTILES, "pool_from": AGE_POOL_FROM, "months": months, "data": data})
    print(f"  age curves: {len(data)} method/terrain series")


# -- who runs with whom ----------------------------------------------------------
def network(comps: dict) -> None:
    """For every runner, the runners met most often on the same circuit, with
    how often each finished ahead. A runner who did not finish is behind
    everyone who did; two non-finishers are level."""
    lic_ix: dict[str, int] = {}
    lics: list[str] = []
    circ_idx, circ_place, circ_day = [], [], []
    for cid, c in comps.items():
        path = OUT / "c" / f"{cid}.json"
        if not path.exists():
            continue
        day = date.fromisoformat(c[0]).toordinal()
        for circ in load(path)["circuits"]:
            ix, pl = [], []
            for r in circ["rows"]:
                lic = r[0]
                if lic not in lic_ix:
                    lic_ix[lic] = len(lics)
                    lics.append(lic)
                ix.append(lic_ix[lic])
                pl.append(r[1] if r[3] == "ok" and r[1] else np.inf)
            if len(ix) > 1:
                circ_idx.append(np.asarray(ix, dtype=np.int32))
                circ_place.append(np.asarray(pl, dtype=float))
                circ_day.append(day)
    n = len(lics)
    member = defaultdict(list)                   # runner -> [(circuit, position)]
    for k, ix in enumerate(circ_idx):
        for p, a in enumerate(ix):
            member[int(a)].append((k, p))
    print(f"  network: {n:,} runners, {len(circ_idx):,} circuits")

    buckets = defaultdict(dict)
    for a, mem in member.items():
        idx = np.concatenate([circ_idx[k] for k, _ in mem])
        ahead = np.concatenate([circ_place[k] > circ_place[k][p] for k, p in mem])
        behind = np.concatenate([circ_place[k] < circ_place[k][p] for k, p in mem])
        days = np.concatenate([np.full(len(circ_idx[k]), circ_day[k]) for k, _ in mem])
        shared = np.bincount(idx, minlength=n)
        shared[a] = 0
        top = np.argsort(-shared, kind="stable")[:NET_TOP]
        top = top[shared[top] >= NET_MIN_SHARED]
        if not len(top):
            continue
        n_ahead = np.bincount(idx, weights=ahead, minlength=n)
        n_behind = np.bincount(idx, weights=behind, minlength=n)
        last = np.zeros(n, dtype=np.int64)
        np.maximum.at(last, idx, days)
        lic = lics[a]
        bucket = int(lic) // 10 if lic.isdigit() else 999999
        buckets[bucket][lic] = [
            [lics[b], int(shared[b]), int(n_ahead[b]), int(n_behind[b]),
             date.fromordinal(int(last[b])).isoformat()]
            for b in top]
    for bucket, rows in buckets.items():
        dump(OUT / "net" / f"{bucket}.json", rows)
    print(f"  network: {sum(len(v) for v in buckets.values()):,} runners in {len(buckets):,} files")


def main(out: Path | None = None) -> None:
    global OUT
    if out is not None:
        OUT = out
    t0 = time.monotonic()
    meta = load(OUT / "meta.json")
    years = meta["seasons"]
    comps = load(OUT / "competitions.json")["rows"]
    print("extras:")
    elite_rows = elite(comps)
    club_files(years, elite_rows)
    age_curves(years)
    network(comps)
    print(f"extras done in {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()

"""The public copy of a country's site data (owner, 2026-10-30): what a visitor without an account — or an account that has
not joined the country — may read of a ranking whose federation keeps its older seasons to its members (France: FFCO shows
the seasons before 2024 to its licensees only, countries/fr/public_period.py). Written to <country folder>/pub/ from the
files build_site has just published, the same names and shapes, keeping only the races from `public_from` on:

- runners.json: the runners with a race in the period, their counts of races recomputed on it;
- competitions.json and c/ (the races' results, grouped as meta `c_group` says): the period's competitions;
- r/ (a runner's races): the period's rows, a hundred runners' numbers to a file (meta `bucket` 100: ~470 files for France
  instead of ~4 700 — Pages takes 20 000 files a deployment);
- snap/ (the month-end rankings and categories): the files of the period's seasons, and official_j15.json;
- meta.json: the period's seasons and months, `public_from`, the counts recomputed; agecurve.json as it is (aggregates).

Nothing else (clubs' pages, networks, statistics over the years): those pages are not offered without the country. The
folder is served as static files, outside the login gate (site/_routes.json, functions/_middleware.js PUBLIC).
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

from site_io import COURSE_GROUP, WRITES, course_file, dump, prune, runner_bucket

PUB_BUCKET = 100                 # r/: a runner's number // 100 (France's full copy: // 10)
R_DATE, R_TERRAIN = 4, 5         # data.js R: a runner's race row


def _read(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def write(out: Path, public_from: int) -> dict:
    """Write out/pub from out's files; -> what it holds."""
    start = f"{public_from}-01-01"
    pub = out / "pub"
    meta = _read(out / "meta.json") or {}
    # the period's competitions
    comps = _read(out / "competitions.json") or {"cols": None, "rows": {}}
    keep_comps = {cid: r for cid, r in comps.get("rows", {}).items() if str(r[0]) >= start}
    dump(pub / "competitions.json", {**comps, "rows": keep_comps})
    # their results
    size = meta.get("c_group") or COURSE_GROUP
    groups: dict[str, dict] = defaultdict(dict)
    src_cache: dict[str, dict | None] = {}
    for cid in keep_comps:
        name = course_file(cid, size)
        if name not in src_cache:
            src_cache[name] = _read(out / "c" / name)
        g = src_cache[name]
        if g is not None and str(cid) in g:
            groups[name][str(cid)] = g[str(cid)]
        else:
            one = _read(out / "c" / f"{cid}.json")             # a folder built before the groups
            if one is not None:
                groups[course_file(cid, size)][str(cid)] = one
    for name, g in groups.items():
        dump(pub / "c" / name, g)
    if (pub / "c").exists():
        prune(pub / "c", set(groups))
    # the runners' races, regrouped by a hundred numbers
    buckets: dict[int, dict] = defaultdict(dict)
    counts: dict[str, dict] = {}
    for f in sorted((out / "r").glob("*.json")):
        for lic, rows in (_read(f) or {}).items():
            mine = [r for r in rows if str(r[R_DATE]) >= start]
            if not mine:
                continue
            buckets[runner_bucket(lic, PUB_BUCKET)][lic] = mine
            by = defaultdict(int)
            for r in mine:
                by[r[R_TERRAIN]] += 1
            dates = sorted(str(r[R_DATE]) for r in mine)
            counts[lic] = {"n": len(mine), "by": by, "first": dates[0], "last": dates[-1]}
    for b, rows in buckets.items():
        dump(pub / "r" / f"{b}.json", rows)
    if (pub / "r").exists():
        prune(pub / "r", {f"{b}.json" for b in buckets})
    # the month-end rankings and categories of the period's seasons (first: a runner they rank, a CN from earlier races
    # still counting, is one of the period's runners)
    snap_keep, ranked = set(), set()
    for f in (out / "snap").glob("*.json"):
        year = f.stem.rsplit("_", 1)[-1]
        if f.stem == "official_j15" or (year.isdigit() and int(year) >= public_from):
            target = pub / "snap" / f.name
            if not target.exists() or target.read_bytes() != f.read_bytes():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, target)
                WRITES["written"] += 1
            snap_keep.add(f.name)
            if f.stem.split("_")[0] != "attr" and f.stem != "official_j15":
                ranked.update(str(r[0]) for r in (_read(f) or {}).get("rows", []))
    if (pub / "snap").exists():
        prune(pub / "snap", snap_keep)
    # the runners of the period
    runners = _read(out / "runners.json") or {"cols": [], "rows": []}
    ix = {c: i for i, c in enumerate(runners["cols"])}
    rows = []
    for r in runners["rows"]:
        lic = str(r[ix["licence"]])
        c = counts.get(lic) or ({"n": 0, "by": {}, "first": None, "last": None} if lic in ranked else None)
        if not c:
            continue
        r = list(r)
        r[ix["n"]] = c["n"]
        for t in ("For", "Spr", "VTT", "Ski"):
            if f"n{t}" in ix:
                r[ix[f"n{t}"]] = c["by"].get(t, 0)
        if "first" in ix:
            r[ix["first"]] = c["first"]
        if "last" in ix:
            r[ix["last"]] = c["last"]
        rows.append(r)
    dump(pub / "runners.json", {**runners, "rows": rows})
    for name in ("agecurve.json",):
        if (out / name).exists():
            dump(pub / name, _read(out / name))
    # the index, for the period
    n_results = sum(len(v) for b in buckets.values() for v in b.values())
    pmeta = {**meta,
             "public_from": public_from,
             "bucket": PUB_BUCKET,
             "min_season": public_from,
             "seasons": [y for y in meta.get("seasons", []) if y >= public_from],
             "months": [m for m in meta.get("months", []) if m >= start],
             "overview": {y: v for y, v in (meta.get("overview") or {}).items() if str(y).isdigit() and int(y) >= public_from},
             "counts": {**(meta.get("counts") or {}), "runners": len(rows), "competitions": len(keep_comps), "results": n_results,
                        "circuits": sum(len((c or {}).get("circuits") or []) for g in groups.values() for c in g.values())}}
    pmeta.pop("club_packs", None)
    dump(pub / "meta.json", pmeta)
    held = {"runners": len(rows), "competitions": len(keep_comps), "r_files": len(buckets), "c_files": len(groups)}
    print(f"public copy from {public_from}: {held}")
    return held

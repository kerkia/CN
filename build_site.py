"""Export the CN database into the static JSON the website reads.

    python build_site.py                      # full archive
    python build_site.py --min-season 2024    # public build: open seasons only
    python build_site.py --since 2026-07-01   # after an update: redo only what
                                              # can have changed from that date

Files are only rewritten when their content changes, so an incremental build
touches few files (and uploads few, once hosted).

The site is static (no server): everything it needs is precomputed here and
laid out so each page loads only what it shows.

    site/data/meta.json            methods, params & the monthly recalage
                                   schedules, reference names, months, stats
    site/data/runners.json         identity & attributes, one row per runner
    site/data/competitions.json    competition metadata
    site/data/snap/attr_{Y}.json   runner category & club as of each year
    site/data/snap/{m}_{t}_{Y}.json  CN at each month-end of year Y
    site/data/r/{bucket}.json      race-by-race detail, 10 runners per file
    site/data/c/{course}.json      full results of one competition
    site/data/club/{code}.json     monthly club aggregates (via site_extras.py)

Month-end CNs for the computed methods are *recomputed* here from the stored
score history with the same functions the engine uses, not read from the
event log: between two races a CN still moves as old races leave the 365-day
window, and a ranking "as of" a date must reflect that.
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import unicodedata
import json
import re
import shutil
import sqlite3
import statistics
import time
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import httpx
from lxml import html as lhtml

from ffco_scraper.cn import TITLE_WEIGHTS, CnParams, Decimal_round, is_nc, top_n_weighted
from ffco_scraper.cn_engine import build_methods
import site_extras
from site_io import WRITES, dump, prune

ROOT = Path(__file__).parent
import paths  # noqa: E402
DB = paths.DB
OUT = ROOT / "site" / "data"
NAMES_CACHE = paths.CACHE / "reference_names.json"
TERRAINS = {"Forêt": "For", "Sprint": "Spr"}
SPLIT_YEAR = 2026


def month_ends(first: date, last: date) -> list[date]:
    out = []
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        out.append(date(y, m, calendar.monthrange(y, m)[1]))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


# ---------------------------------------------------------------------------
# reference names (clubs, leagues, departments)
# ---------------------------------------------------------------------------
def _recent_unnamed_clubs(conn: sqlite3.Connection, names: dict, days: int = 100) -> set[str]:
    """Club numbers seen in recent results that have no name yet — a new club."""
    since = (date.today() - timedelta(days=days)).isoformat()
    codes = set()
    for (club,) in conn.execute(
            """SELECT DISTINCT r.club FROM results r JOIN circuits c USING (circuit_id)
               JOIN competitions k ON k.course_id = c.course_id WHERE k.date_iso >= ?""", (since,)):
        code = club_parts(club)[0]
        if code and code not in names["clubs"]:
            codes.add(code)
    return codes


def reference_names(conn: sqlite3.Connection) -> dict:
    """Club/league/department names from the ranking page's filter lists,
    completed from competition organisers for clubs that no longer exist.

    The lists are cached; they are fetched again when a club number seen in
    recent results has no name (a new club), at most once a day."""
    names = None
    if NAMES_CACHE.exists():
        names = json.loads(NAMES_CACHE.read_text(encoding="utf-8"))
        stale = time.time() - NAMES_CACHE.stat().st_mtime > 86400
        if stale and _recent_unnamed_clubs(conn, names):
            names = None
    if names is None:
        r = httpx.get("https://cn.ffcorientation.fr/classement/?specialite=For", timeout=30)
        r.raise_for_status()
        doc = lhtml.fromstring(r.text)
        names = {"clubs": {}, "ligues": {}, "depts": {}}
        for sel in doc.xpath("//select"):
            opts = [o.text_content().strip() for o in sel.xpath(".//option")]
            for o in opts:
                m = re.match(r"^(\d{4}) - (.+)$", o)
                if m:
                    names["clubs"][m.group(1)] = m.group(2).strip()
                    continue
                m = re.match(r"^([A-Z]{2}) - (.+)$", o)
                if m:
                    names["ligues"][m.group(1)] = m.group(2).strip()
                    continue
                m = re.match(r"^(\d{2}) - (.+)$", o)
                if m:
                    names["depts"][m.group(1)] = m.group(2).strip()
        NAMES_CACHE.write_text(json.dumps(names, ensure_ascii=False), encoding="utf-8")

    for (org,) in conn.execute("SELECT DISTINCT organizer FROM competitions"):
        m = re.match(r"^(\d{4}) - (.+)$", org or "")
        if m and m.group(1) not in names["clubs"]:
            names["clubs"][m.group(1)] = m.group(2).strip()
    return names


def name_key(name: str | None) -> str:
    """Normalised login name — the same rule as functions/_middleware.js and
    assets/js/auth.js: accents, case, punctuation and word order don't matter."""
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return " ".join(sorted(re.sub(r"[^a-z0-9]+", " ", s).split()))


def write_auth_index(runners: list) -> None:
    """Credentials index for the server-side login (never served publicly):
    auth/{licence // 100}.json -> {licence: [sha256(name key), name]}."""
    buckets = defaultdict(dict)
    for lic, nom, *_ in runners:
        lic = str(lic)
        if not nom:
            continue
        b = int(lic) // 100 if lic.isdigit() else 999999
        buckets[b][lic] = [hashlib.sha256(name_key(nom).encode()).hexdigest(), nom]
    folder = OUT.parent / "auth"
    for b, content in buckets.items():
        dump(folder / f"{b}.json", content)
    prune(folder, {f"{b}.json" for b in buckets})


def club_parts(club: str | None) -> tuple[str | None, str | None, str | None]:
    """'7707IF' -> ('7707', '77', 'IF')."""
    if not club:
        return None, None, None
    m = re.match(r"^(\d{4})([A-Z]*)$", club.strip())
    if not m:
        return None, None, None
    code = m.group(1)
    return code, code[:2], (m.group(2) or None)


# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> None:
    global OUT, DB
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-season", type=int, default=None,
                    help="Only export seasons >= this (e.g. 2024 for the open seasons).")
    ap.add_argument("--clean", action="store_true",
                    help="wipe the output folder first (by default files are updated in place and "
                         "obsolete ones pruned, which suits a synced folder far better)")
    ap.add_argument("--since", default=None,
                    help="Incremental: data before this date (YYYY-MM-DD) is unchanged, so "
                         "earlier seasons' snapshots are kept as they are.")
    ap.add_argument("--out", type=Path, default=None, help="output folder (default site/data)")
    ap.add_argument("--db", type=Path, default=None)
    args = ap.parse_args(argv)
    if args.out:
        OUT = args.out
    if args.db:
        DB = args.db
    for k in WRITES:
        WRITES[k] = 0

    t0 = time.monotonic()
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    min_season = args.min_season or 0
    since = date.fromisoformat(args.since) if args.since else None
    old_meta = None
    if since:
        if not (OUT / "meta.json").exists():
            raise SystemExit("--since needs an existing build in the output folder")
        old_meta = json.loads((OUT / "meta.json").read_text(encoding="utf-8"))

    if OUT.exists() and args.clean and not since:
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    methods = build_methods()
    pf: CnParams = methods["fair"].params
    p6: CnParams = methods["top6w"].params
    norm_cfg = methods["fair"].normalisation       # Top shares Fair's scores and recalage

    names = reference_names(conn)
    print(f"names: {len(names['clubs'])} clubs, {len(names['ligues'])} ligues, "
          f"{len(names['depts'])} depts")

    # -- competitions & circuits -------------------------------------------
    comps = {}
    for r in conn.execute(
        """SELECT course_id, date_iso, season, title, location, organizer, groupe,
                  epreuve, terrain FROM competitions
           WHERE specialite='Pédestre' AND date_iso IS NOT NULL AND season >= ?""",
        (min_season,),
    ):
        comps[r["course_id"]] = [r["date_iso"], r["title"], r["location"], r["organizer"],
                                 r["groupe"], r["epreuve"], TERRAINS.get(r["terrain"], "For"),
                                 r["season"]]
    circuits = {}
    for r in conn.execute("SELECT circuit_id, course_id, name, distance_km FROM circuits"):
        if r["course_id"] in comps:
            circuits[r["circuit_id"]] = [r["course_id"], r["name"], r["distance_km"]]
    cvals = defaultdict(dict)
    for r in conn.execute("SELECT method, circuit_id, valeur FROM circuit_values"):
        if r["circuit_id"] in circuits:
            cvals[r["circuit_id"]][r["method"]] = r["valeur"]
    for r in conn.execute("SELECT circuit_id, valeur FROM circuits"):
        if r["circuit_id"] in circuits:
            cvals[r["circuit_id"]]["official"] = r["valeur"]
    print(f"{len(comps)} competitions, {len(circuits)} circuits")

    # -- the monthly recalage schedule (Fair's, shared by Top) ------------------
    norm = defaultdict(list)
    for r in conn.execute(
        "SELECT terrain, date_iso, factor, top_mean_raw FROM normalisation "
        "WHERE method='fair' ORDER BY date_iso"
    ):
        norm[TERRAINS[r["terrain"]]].append((r["date_iso"], r["factor"], r["top_mean_raw"]))
    norm_dates = {t: [date.fromisoformat(d) for d, _, _ in v] for t, v in norm.items()}

    def factor_at(t: str, d: date) -> float:
        ds = norm_dates.get(t)
        if not ds:
            return 1.0
        i = bisect_right(ds, d) - 1
        return norm[t][max(0, i)][1]


    # -- load every result row once ----------------------------------------
    by_method = defaultdict(dict)   # method -> (licence, circuit) -> row
    for r in conn.execute(
        """SELECT method, licence, circuit_id, date_iso, terrain, categorie, club, status,
                  temps_s, cn_j15, score, score_raw, counts_for_cn, poids
           FROM scores WHERE season >= ?""",
        (min_season,),
    ):
        if r["circuit_id"] in circuits:
            by_method[r["method"]][(r["licence"], r["circuit_id"])] = r
    cn_after = defaultdict(dict)    # method -> (licence, date, terrain) -> cn
    cn_hist = defaultdict(lambda: defaultdict(lambda: ([], [])))   # method -> (licence, terrain) -> dates, cns
    for r in conn.execute(
        "SELECT method, licence, date_iso, terrain, cn FROM cn_history "
        "WHERE method IN ('fair','top6w') ORDER BY date_iso"
    ):
        if r["cn"] is not None:
            cn_after[r["method"]][(r["licence"], r["date_iso"], r["terrain"])] = r["cn"]
        h = cn_hist[r["method"]][(r["licence"], r["terrain"])]
        h[0].append(r["date_iso"])
        h[1].append(r["cn"])

    def cn_j15(method, lic, terrain, d):
        """The runner's published CN 15 days before a race (the engine's cn_j15 is on its internal scale)."""
        h = cn_hist[method].get((lic, terrain))
        if not h:
            return None
        asof = date.fromisoformat(d) - timedelta(days=pf.lag_days)
        i = bisect_right(h[0], asof.isoformat()) - 1
        if i < 0 or h[0][i] <= (asof - timedelta(days=pf.window_days)).isoformat():
            return None
        return h[1][i]
    raw_res = {}
    for r in conn.execute(
        "SELECT circuit_id, licence, nom, place, temps, nouveau_cn, points, cn_j15 FROM results"
    ):
        if r["circuit_id"] in circuits:
            raw_res[(r["licence"], r["circuit_id"])] = r
    # "nc" (non classé): no points, not part of the race for the CN. Such a row is
    # dropped from every method, so it is in no runner's results and no statistic;
    # the race's own page still lists it, as FFCO does.
    nc_rows = {}
    for key, r in raw_res.items():
        if is_nc(r["place"]):
            nc_rows[key] = by_method["official"].get(key)
            for m in by_method.values():
                m.pop(key, None)
    for key in nc_rows:
        del raw_res[key]
    n_per_circuit = defaultdict(int)
    for (lic, cid), r in raw_res.items():
        n_per_circuit[cid] += 1
    print(f"loaded {len(raw_res):,} results")

    def to_int(v):
        try:
            return int(str(v).replace("+", "").strip())
        except (TypeError, ValueError):
            return None

    # -- runners ---------------------------------------------------------------
    per_runner = defaultdict(list)   # licence -> list of (date, circuit)
    for (lic, cid), r in by_method["official"].items():
        per_runner[lic].append((r["date_iso"], cid))
    names_by_lic = {lic: r["nom"] for (lic, cid), r in raw_res.items()}

    runners = []
    attrs_timeline = {}              # licence -> [(date, cat, club)]
    for lic, lst in per_runner.items():
        lst.sort()
        tl = []
        nF = nS = 0
        for d, cid in lst:
            o = by_method["official"][(lic, cid)]
            tl.append((d, o["categorie"], o["club"]))
            if comps[circuits[cid][0]][6] == "For":
                nF += 1
            else:
                nS += 1
        attrs_timeline[lic] = tl
        last = tl[-1]
        sexe = (last[1] or "")[:1] if (last[1] or "")[:1] in ("H", "D") else None
        runners.append([lic, names_by_lic.get(lic, ""), sexe, lst[0][0], lst[-1][0],
                        len(lst), nF, nS, last[1], last[2]])
    runners.sort(key=lambda x: x[1])
    write_auth_index(runners)
    dump(OUT / "runners.json", {
        "cols": ["licence", "nom", "sexe", "first", "last", "n", "nFor", "nSpr", "cat", "club"],
        "rows": runners,
    })
    print(f"{len(runners):,} runners")

    # -- runner detail files ------------------------------------------------
    buckets = defaultdict(dict)
    for lic, lst in per_runner.items():
        races = []
        for d, cid in lst:
            course_id, cname, dist = circuits[cid]
            c = comps[course_id]
            o = by_method["official"][(lic, cid)]
            v = by_method["fair"].get((lic, cid))
            t = by_method["top6w"].get((lic, cid))
            raw = raw_res.get((lic, cid))
            terr_full = o["terrain"]
            races.append([
                cid, course_id, cname, dist, d, TERRAINS.get(terr_full, "For"),
                c[5], c[4], o["categorie"], o["club"],
                to_int(raw["place"]) if raw else None, n_per_circuit[cid],
                o["temps_s"], o["status"],
                # official: score, cn j-15, cn after
                o["score"], o["cn_j15"], to_int(raw["nouveau_cn"]) if raw else None,
                # fair: published score, cn j-15, cn after, counts
                v["score"] if v else None, cn_j15("fair", lic, terr_full, d) if v else None,
                cn_after["fair"].get((lic, d, terr_full)), v["counts_for_cn"] if v else 0,
                # top6w: raw score, published score (= Fair's), cn j-15, cn after, counts, weight
                t["score_raw"] if t else None, t["score"] if t else None,
                cn_j15("top6w", lic, terr_full, d) if t else None, cn_after["top6w"].get((lic, d, terr_full)),
                t["counts_for_cn"] if t else 0, t["poids"] if t else None,
            ])
        buckets[int(lic) // 10 if str(lic).isdigit() else 999999][lic] = races
    for b, content in buckets.items():
        dump(OUT / "r" / f"{b}.json", content)
    prune(OUT / "r", {f"{b}.json" for b in buckets})
    print(f"{len(buckets):,} runner bucket files")

    # -- competition files --------------------------------------------------
    by_course = defaultdict(lambda: defaultdict(list))
    for (lic, cid), o in by_method["official"].items():
        v = by_method["fair"].get((lic, cid))
        t = by_method["top6w"].get((lic, cid))
        raw = raw_res.get((lic, cid))
        by_course[circuits[cid][0]][cid].append([
            lic, to_int(raw["place"]) if raw else None, o["temps_s"], o["status"],
            o["categorie"], o["club"],
            o["score"], o["cn_j15"],
            v["score"] if v else None, cn_j15("fair", lic, o["terrain"], o["date_iso"]) if v else None,
            t["score"] if t else None, cn_j15("top6w", lic, o["terrain"], o["date_iso"]) if t else None,
        ])
    for (lic, cid), o in nc_rows.items():
        if o is not None:
            by_course[circuits[cid][0]][cid].append([
                lic, None, o["temps_s"], "nc", o["categorie"], o["club"],
                None, o["cn_j15"], None, None, None, None,
            ])
    for course_id, circ in by_course.items():
        out = []
        for cid, rows in circ.items():
            rows.sort(key=lambda x: (x[1] is None, x[1] or 0, x[2] or 10**9))
            cv = cvals.get(cid, {})
            d = date.fromisoformat(comps[course_id][0])
            fv = cv.get("fair")                     # Top's circuits are Fair's
            fv = Decimal_round(fv * factor_at(comps[course_id][6], d)) if fv else None
            out.append({
                "id": cid, "name": circuits[cid][1], "dist": circuits[cid][2],
                "value": {"official": cv.get("official"), "fair": fv, "top6w": fv},
                "rows": rows,
            })
        out.sort(key=lambda c: c["name"] or "")
        dump(OUT / "c" / f"{course_id}.json", {"course": course_id, "circuits": out})
    prune(OUT / "c", {f"{cid}.json" for cid in by_course})

    # which competitions each club took part in (the "Courses" tab, club mode)
    club_courses = defaultdict(set)
    for course_id, circ in by_course.items():
        for rows in circ.values():
            for row in rows:
                code = club_parts(row[5])[0]
                if code:
                    club_courses[code].add(course_id)
    for code, ids in club_courses.items():
        dump(OUT / "club_courses" / f"{code}.json", sorted(ids))
    prune(OUT / "club_courses", {f"{code}.json" for code in club_courses})
    print(f"{len(by_course):,} competition files")
    # listing columns: + number of results and of circuits
    comps_out = {cid: [*v, sum(len(r) for r in by_course.get(cid, {}).values()), len(by_course.get(cid, {}))]
                 for cid, v in comps.items()}
    dump(OUT / "competitions.json", {
        "cols": ["date", "title", "location", "organizer", "groupe", "epreuve", "terrain", "season", "n", "circuits"],
        "rows": comps_out,
    })

    # -- month-end snapshots ------------------------------------------------
    last_race = max(date.fromisoformat(v[0]) for v in comps.values())
    first_race = min(date.fromisoformat(v[0]) for v in comps.values())
    months = month_ends(first_race, last_race)
    months[-1] = min(months[-1], last_race)
    print(f"{len(months)} month-ends {months[0]} .. {months[-1]}")

    # histories per runner/terrain for each method
    h6 = defaultdict(lambda: ([], [], []))         # dates, published scores, weights (Fair's = Top's)
    hoff = defaultdict(lambda: ([], []))           # (lic, t|Ped) -> dates, cn
    for (lic, cid), v in sorted(by_method["fair"].items(), key=lambda kv: kv[1]["date_iso"]):
        if v["counts_for_cn"] and v["score"] is not None:
            k = (lic, TERRAINS.get(v["terrain"], "For"))
            h6[k][0].append(date.fromisoformat(v["date_iso"]))
            h6[k][1].append(v["score"])
            h6[k][2].append(v["poids"] or 1.0)
    # Before 2026 the official ranking was a single pedestrian ranking, so its
    # history is pooled under "Ped"; from 2026 it is per terrain.
    off_events = []
    for (lic, cid), raw in raw_res.items():
        o = by_method["official"].get((lic, cid))
        ncn = to_int(raw["nouveau_cn"])
        if o and ncn:
            d = date.fromisoformat(o["date_iso"])
            t = TERRAINS.get(o["terrain"], "For") if d.year >= SPLIT_YEAR else "Ped"
            off_events.append((d, lic, t, ncn))
    off_events.sort()
    for d, lic, t, ncn in off_events:
        hoff[(lic, t)][0].append(d)
        hoff[(lic, t)][1].append(ncn)

    def agg_at(dates, scores, weights, X: date, p: CnParams):
        # the aggregate of the published scores (each fixed with its race's factor): no factor here
        lo = bisect_left(dates, X - timedelta(days=p.window_days))
        hi = bisect_right(dates, X)
        cn, kept = top_n_weighted(scores[lo:hi], weights[lo:hi], p)
        return Decimal_round(cn) if cn and kept else None

    def off_at(dates, cns, X: date):
        hi = bisect_right(dates, X)
        if hi == 0 or dates[hi - 1] < X - timedelta(days=365):
            return None
        return cns[hi - 1]

    years = sorted({m.year for m in months if m.year >= min_season})
    snap_stats = {}
    levels = defaultdict(list)   # "method_terrain" -> [[yyyy-mm, n, median, top30mean]]
    if since:
        # seasons before the change are unchanged: keep their snapshots and levels
        for key, rows in old_meta.get("levels", {}).items():
            levels[key] = [r for r in rows if int(r[0][:4]) < since.year]
    snap_keep: set[str] = set()
    for Y in years:
        if since and Y < since.year:
            snap_keep.update(f.name for f in (OUT / "snap").glob(f"*_{Y}.json"))
            continue
        ym = [m for m in months if m.year == Y]
        idx = {m: i for i, m in enumerate(ym)}
        files = defaultdict(dict)   # (method, t) -> lic -> [12]
        for (lic, t), (ds, ss, ws) in h6.items():
            for m in ym:
                if ds and ds[0] <= m and ds[-1] >= m - timedelta(days=366):
                    for mth, p in (("fair", pf), ("top6w", p6)):
                        cn = agg_at(ds, ss, ws, m, p)
                        if cn:
                            files[(mth, t)].setdefault(lic, [0] * 12)[idx[m]] = cn
        for (lic, t), (ds, cs) in hoff.items():
            if (Y < SPLIT_YEAR) != (t == "Ped"):
                continue
            for m in ym:
                cn = off_at(ds, cs, m)
                if cn:
                    files[("official", t)].setdefault(lic, [0] * 12)[idx[m]] = cn
        active = set()
        snap_keep.add(f"attr_{Y}.json")
        snap_keep.update(f"{mth}_{t}_{Y}.json" for (mth, t) in files)
        for (mth, t), rows in files.items():
            dump(OUT / "snap" / f"{mth}_{t}_{Y}.json",
                 {"months": [m.isoformat() for m in ym],
                  "rows": [[lic, *v[: len(ym)]] for lic, v in rows.items()]})
            active.update(rows)
            snap_stats[f"{mth}_{t}_{Y}"] = len(rows)
            for i, m in enumerate(ym):
                vals = sorted((v[i] for v in rows.values() if v[i]), reverse=True)
                if vals:
                    levels[f"{mth}_{t}"].append([
                        m.isoformat()[:7], len(vals), vals[len(vals) // 2],
                        round(sum(vals[:30]) / min(30, len(vals)))])
        # category & club as of the year's end (latest race on or before it)
        attr = {}
        year_end = date(Y, 12, 31)
        for lic in sorted(active):        # sorted: identical data must give identical files
            tl = attrs_timeline.get(lic)
            if not tl:
                continue
            ds = [x[0] for x in tl]
            i = bisect_right(ds, year_end.isoformat()) - 1
            if i >= 0:
                attr[lic] = [tl[i][1], tl[i][2]]
        dump(OUT / "snap" / f"attr_{Y}.json", attr)
        print(f"  snapshots {Y}: " + ", ".join(
            f"{m}/{t}={len(r):,}" for (m, t), r in sorted(files.items())), flush=True)

    prune(OUT / "snap", snap_keep)
    # a synced folder (OneDrive…) leaves conflict copies behind: never publish them
    for f in OUT.rglob("*Name clash*"):
        f.unlink()
        WRITES["deleted"] += 1

    # club aggregates, elite points, age curves and the co-runner network are
    # derived from the files above by site_extras.py, called once meta.json exists

    # -- overview statistics ------------------------------------------------
    per_year = defaultdict(lambda: {"For": [0, set(), 0], "Spr": [0, set(), 0]})
    for cid_, c in comps.items():
        per_year[c[7]][c[6]][0] += 1
    for (lic, cid), o in by_method["official"].items():
        c = comps[circuits[cid][0]]
        per_year[c[7]][c[6]][1].add(lic)
        per_year[c[7]][c[6]][2] += 1
    overview = {str(y): {t: [v[0], len(v[1]), v[2]] for t, v in d.items()}
                for y, d in sorted(per_year.items())}

    # method agreement on a common cohort: same runner, same month-end
    agree = {}
    for t in ("For", "Spr"):
        pairs = []
        Y = years[-1]
        try:
            s26 = json.loads((OUT / "snap" / f"fair_{t}_{Y}.json").read_text(encoding="utf-8"))
            s6 = json.loads((OUT / "snap" / f"top6w_{t}_{Y}.json").read_text(encoding="utf-8"))
            so = json.loads((OUT / "snap" / f"official_{t}_{Y}.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        last = len(s26["months"]) - 1
        d26 = {r[0]: r[1 + last] for r in s26["rows"]}
        d6 = {r[0]: r[1 + last] for r in s6["rows"]}
        do = {r[0]: r[1 + last] for r in so["rows"]}
        for lic in sorted(set(d26) & set(d6) & set(do)):   # sorted: the sample below is then stable
            if d26[lic] and d6[lic] and do[lic]:
                pairs.append([do[lic], d26[lic], d6[lic]])
        agree[t] = pairs[:4000]

    methods_meta = {
        "official": {"color": 1},
        "fair": {"color": 2, "params": {
            "eligible_fraction": pf.eligible_fraction, "weights": TITLE_WEIGHTS,
            "min_scores": pf.min_scores_for_cn, "min_ranked": pf.min_ranked,
            "window_days": pf.window_days, "lag_days": pf.lag_days,
            "anchor_top_k": norm_cfg.anchor_top_k, "anchor_top_fraction": norm_cfg.anchor_top_fraction,
            "anchor_target": norm_cfg.target, "anchor_lag_months": norm_cfg.lag_months}},
        "top6w": {"color": 3, "params": {
            "top_n": p6.top_n, "eligible_fraction": p6.eligible_fraction,
            "weights": TITLE_WEIGHTS,
            "min_scores": p6.min_scores_for_cn, "min_ranked": p6.min_ranked,
            "window_days": p6.window_days, "lag_days": p6.lag_days,
            "anchor_top_k": norm_cfg.anchor_top_k, "anchor_top_fraction": norm_cfg.anchor_top_fraction,
            "anchor_target": norm_cfg.target, "anchor_lag_months": norm_cfg.lag_months}},
    }
    meta = {
        "built": date.today().isoformat(),
        "min_season": min_season or None,
        "seasons": years,
        "months": [m.isoformat() for m in months if m.year >= min_season],
        "split_year": SPLIT_YEAR,
        "methods": methods_meta,
        "normalisation": {t: [[d, round(f, 6)] for d, f, _ in v] for t, v in norm.items()},
        "names": names,
        "counts": {"runners": len(runners), "competitions": len(comps),
                   "circuits": len(circuits), "results": len(raw_res)},
        "overview": overview,
        "levels": levels,
        "agreement": agree,
    }
    dump(OUT / "meta.json", meta)
    site_extras.main(OUT)
    total = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    nfiles = sum(1 for _ in OUT.rglob("*.json"))
    print(f"done in {time.monotonic()-t0:.0f}s: {nfiles:,} files, {total/1e6:.1f} MB — "
          f"{WRITES['written']:,} written, {WRITES['unchanged']:,} unchanged, {WRITES['deleted']:,} deleted")


if __name__ == "__main__":
    main()

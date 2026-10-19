"""The tables of « IA » (pages/ask.js): the published data as a few Parquet files the browser queries with DuckDB.

A question asked on « IA » goes to a language model (functions/api/ask.js, Workers AI) with the description of these
tables (ASK_SCHEMA in functions/_lib/ask.js: keep the two in step); the model answers with one SQL query, which the
browser runs on these files, so the model never sees the data. Built from site/data after every build (site_extras.main),
so it carries exactly what the site publishes: the anonymised runners as the site shows them, the official CN and the
Ozimut index only (the usual level stays out).

    site/data/ask/runners.parquet   one row per runner
    site/data/ask/clubs.parquet     one row per club
    site/data/ask/races.parquet     one row per competition
    site/data/ask/results.parquet   one row per runner and race
    site/data/ask/cn.parquet        each runner's CN at each month's end, per discipline and method
    site/data/ask/manifest.json     when built, and each table's size

Needs pyarrow (requirements.txt); without it nothing is written.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

OUT = Path("site/data")
TERRAIN = {"For": "For", "Spr": "Spr", "VTT": "VTT", "Ski": "Ski"}


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _day(s: str | None):
    return date.fromisoformat(s[:10]) if s else None


def _club(code: str | None) -> tuple[str | None, str | None]:
    """'6408NA' -> ('6408', 'NA')."""
    m = re.match(r"^(\d{3,4})([A-Z]{2})?", code or "")
    return (m.group(1).zfill(4), m.group(2)) if m else (None, None)


def build(out: Path = OUT) -> None:
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        print("  ask: pyarrow missing, not built")
        return
    dest = out / "ask"
    dest.mkdir(parents=True, exist_ok=True)
    meta = load(out / "meta.json")
    names = meta.get("names", {})
    sizes = {}

    def write(name: str, table) -> None:
        path = dest / f"{name}.parquet"
        tmp = path.with_suffix(".tmp")
        pq.write_table(table, tmp, compression="zstd", compression_level=19, row_group_size=256_000)
        # unchanged content keeps the old file (and its date)
        if path.exists() and path.read_bytes() == tmp.read_bytes():
            tmp.unlink()
        else:
            tmp.replace(path)
        sizes[name] = {"rows": table.num_rows, "bytes": path.stat().st_size}

    # ---- runners ---------------------------------------------------------------------------------------------------
    rj = load(out / "runners.json")
    ix = {c: i for i, c in enumerate(rj["cols"])}
    ligue_of: dict[str, dict[str, int]] = {}
    cols = {k: [] for k in ("licence", "name", "sex", "category", "club", "ligue", "first_race", "last_race",
                            "races", "races_for", "races_spr", "races_vtt", "races_ski")}
    for r in rj["rows"]:
        club, lig = _club(r[ix["club"]])
        if club and lig:
            ligue_of.setdefault(club, {}).setdefault(lig, 0)
            ligue_of[club][lig] += 1
        cols["licence"].append(int(r[ix["licence"]]))
        cols["name"].append(r[ix["nom"]])
        cols["sex"].append(r[ix["sexe"]] or None)
        cols["category"].append(r[ix["cat"]] or None)
        cols["club"].append(club)
        cols["ligue"].append(lig)
        cols["first_race"].append(_day(r[ix["first"]]))
        cols["last_race"].append(_day(r[ix["last"]]))
        for k, c in (("races", "n"), ("races_for", "nFor"), ("races_spr", "nSpr"), ("races_vtt", "nVTT"), ("races_ski", "nSki")):
            cols[k].append(int(r[ix[c]] or 0))
    write("runners", pa.table(cols, schema=pa.schema([
        ("licence", pa.int32()), ("name", pa.string()), ("sex", pa.string()), ("category", pa.string()), ("club", pa.string()),
        ("ligue", pa.string()), ("first_race", pa.date32()), ("last_race", pa.date32()), ("races", pa.int32()),
        ("races_for", pa.int32()), ("races_spr", pa.int32()), ("races_vtt", pa.int32()), ("races_ski", pa.int32())])))

    # ---- clubs -----------------------------------------------------------------------------------------------------
    ligues = names.get("ligues", {})
    clubs = sorted(set(names.get("clubs", {})) | set(ligue_of))
    lig = [max(ligue_of[c], key=ligue_of[c].get) if c in ligue_of else None for c in clubs]
    write("clubs", pa.table({"club": clubs, "name": [names.get("clubs", {}).get(c) for c in clubs], "ligue": lig,
                             "ligue_name": [ligues.get(x) if x else None for x in lig]}))

    # ---- races -----------------------------------------------------------------------------------------------------
    cj = load(out / "competitions.json")
    ix = {c: i for i, c in enumerate(cj["cols"])}
    rcols = {k: [] for k in ("race_id", "date", "season", "name", "location", "organiser", "organiser_club", "level",
                             "format", "discipline", "runners", "circuits")}
    for rid, r in cj["rows"].items():
        rcols["race_id"].append(int(rid))
        rcols["date"].append(_day(r[ix["date"]]))
        rcols["season"].append(int(r[ix["season"]]))
        rcols["name"].append((r[ix["title"]] or "").strip() or None)
        rcols["location"].append(r[ix["location"]] or None)
        rcols["organiser"].append(r[ix["organizer"]] or None)
        m = re.match(r"^\s*(\d{3,4})\b", r[ix["organizer"]] or "")
        rcols["organiser_club"].append(m.group(1).zfill(4) if m else None)
        rcols["level"].append(r[ix["groupe"]] or None)
        rcols["format"].append(r[ix["epreuve"]] or None)
        rcols["discipline"].append(TERRAIN.get(r[ix["terrain"]], r[ix["terrain"]]))
        rcols["runners"].append(int(r[ix["n"]] or 0))
        rcols["circuits"].append(int(r[ix["circuits"]] or 0))
    write("races", pa.table(rcols, schema=pa.schema([
        ("race_id", pa.int32()), ("date", pa.date32()), ("season", pa.int16()), ("name", pa.string()), ("location", pa.string()),
        ("organiser", pa.string()), ("organiser_club", pa.string()), ("level", pa.string()), ("format", pa.string()),
        ("discipline", pa.string()), ("runners", pa.int32()), ("circuits", pa.int16())])))

    # ---- results (the runners' race rows, data.js R) ---------------------------------------------------------------
    keys = ("licence", "race_id", "date", "season", "discipline", "format", "level", "circuit", "distance_km", "category",
            "club", "place", "finishers", "time_s", "status", "cn_j15_official", "score_official", "cn_j15_top", "score_top")
    res = {k: [] for k in keys}
    for f in sorted((out / "r").glob("*.json")):
        for lic, rows in load(f).items():
            for r in rows:
                d = _day(r[4])
                res["licence"].append(int(lic))
                res["race_id"].append(int(r[1]))
                res["date"].append(d)
                res["season"].append(d.year if d else None)
                res["discipline"].append(TERRAIN.get(r[5], r[5]))
                res["format"].append(r[6] or None)
                res["level"].append(r[7] or None)
                res["circuit"].append(r[2] or None)
                res["distance_km"].append(float(r[3]) if r[3] else None)
                res["category"].append(r[8] or None)
                res["club"].append(_club(r[9])[0])
                res["place"].append(int(r[10]) if r[10] else None)
                res["finishers"].append(int(r[11]) if r[11] else None)
                res["time_s"].append(int(r[12]) if r[12] else None)
                res["status"].append(r[13] or None)
                # the Top's columns are the linear pair's (t6*, data.js R) since 2026-10-16
                for k, i in (("cn_j15_official", 15), ("score_official", 14), ("cn_j15_top", 23), ("score_top", 22)):
                    v = r[i] if i < len(r) else None
                    res[k].append(int(round(v)) if isinstance(v, (int, float)) else None)
    # by race, circuit and place: the race's columns repeat and compress to almost nothing (by runner 14 MB, by race 9;
    # the CN after each race is left out - the monthly table has it - and delta encoding gained nothing)
    order = sorted(range(len(res["licence"])), key=lambda i: (res["date"][i] or date.min, res["race_id"][i], res["circuit"][i] or "",
                                                             res["place"][i] or 99999, res["licence"][i]))
    res = {k: [v[i] for i in order] for k, v in res.items()}
    i32 = pa.int32()
    write("results", pa.table(res, schema=pa.schema([
        ("licence", i32), ("race_id", i32), ("date", pa.date32()), ("season", pa.int16()), ("discipline", pa.string()),
        ("format", pa.string()), ("level", pa.string()), ("circuit", pa.string()), ("distance_km", pa.float32()),
        ("category", pa.string()), ("club", pa.string()), ("place", i32), ("finishers", i32), ("time_s", i32),
        ("status", pa.string()), ("cn_j15_official", i32), ("score_official", i32), ("cn_j15_top", i32), ("score_top", i32)])))

    # ---- monthly CN (the month-end snapshots, official and Top) ----------------------------------------------------
    cn = {"licence": [], "month": [], "discipline": [], "method": [], "cn": []}
    for f in sorted((out / "snap").glob("*.json")):
        m = re.match(r"^(official|top6w)_(For|Spr|VTT|Ski|Ped)_\d{4}\.json$", f.name)
        if not m:
            continue
        method = "official" if m.group(1) == "official" else "top"
        s = load(f)
        months = [_day(x) for x in s["months"]]
        for row in s["rows"]:
            lic = int(row[0])
            for mo, v in zip(months, row[1:]):
                if v:
                    cn["licence"].append(lic)
                    cn["month"].append(mo)
                    cn["discipline"].append(m.group(2))
                    cn["method"].append(method)
                    cn["cn"].append(int(v))
    order = sorted(range(len(cn["licence"])), key=lambda i: (cn["method"][i], cn["discipline"][i], cn["licence"][i], cn["month"][i]))
    cn = {k: [v[i] for i in order] for k, v in cn.items()}
    write("cn", pa.table(cn, schema=pa.schema([("licence", i32), ("month", pa.date32()), ("discipline", pa.string()),
                                               ("method", pa.string()), ("cn", pa.int16())])))

    manifest = {"built": meta.get("built"), "last_month": max(cn["month"]).isoformat() if cn["month"] else None,
                "tables": sizes}
    (dest / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print("  ask: " + ", ".join(f"{k} {v['rows']:,} rows {v['bytes'] / 1e6:.1f} MB" for k, v in sizes.items()))


if __name__ == "__main__":
    build()

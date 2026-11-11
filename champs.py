"""France's individual championships for Stats' « Palmarès » (owner, 2026-11-05): on foot the Championnat de France Moyenne
Distance (CFMD), Longue Distance (CFLD), de Sprint (CFS) and de Nuit (CFN, formerly the Championnat National de Nuit, CNN), and
the VTT and ski championships (middle, long, sprint), every edition the results database holds — FFCO's archive starts in 2011 —
and those of 2001-2010 from the archives (`old_editions`, below). A championship's key is its discipline and its format: « fmd », « fld », « fsp », « fnu »,
« vmd », « vld », « vsp », « smd », « sld », « ssp » (the race's « specialite » says the discipline: a VTT or ski championship's
title names the same formats as a foot one's).

Read from the database at every run (cheap: a few thousand rows): `fr/champs.json`, each edition's place, day, races and each
category's podium, and `fr/champs/<champ>-<year>.json`, each category's whole ranking, for the page `pages/relayhistory.js`
(tabs « Champions », « Éditions championnats », « Classements championnats »).

Which races give the titles is read from their names (FFCO's « groupe » B1, the championship's name): qualifications, B finals,
opens, the finals « sans inscription », university and league championships run beside are left out, as are circuits named
« OPEN »; an élite final (CFMD 2011, 2013-2016) gives the H21 and D21 titles, a « jeunes et élites » final its own categories,
the main race the others. A category's ranking: its runners on that race in their circuit's order, its place counted within the
category; those without a place keep their status (pm, abandon…). Anonymised runners (privacy.py) are shown as everywhere else.
"""
from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from pathlib import Path

import privacy

VERSION = 2   # 2026-11-05: keyed by discipline and format, VTT and ski added (they had been taken for the foot ones)
DISCS = {"PEDESTRE": "f", "VTT": "v", "SKI": "s"}
FORMATS = ("md", "ld", "sp", "nu")
CHAMPS = tuple(d + f for d in ("f", "v", "s") for f in FORMATS if not (d != "f" and f == "nu"))
# a race that is no championship's title race, whatever its name says
LEFT_OUT = re.compile(r"QUALIF|FINALES? B\b|\bOPEN\b|SANS INSCRIPTION|UNIVERSITAIRE|\bLIGUE\b|VOSGES|NON SELECTION|COURSE OPEN")
STATUS = {"pm": "pm", "abandon": "ab", "abd": "ab", "absent": "abs", "disq": "dsq", "disqualifie": "dsq", "nc": "nc",
          "hors delai": "hd", "temps max": "hd"}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).upper()


def champ_of(title: str, specialite: str = "Pédestre") -> str | None:
    """The championship a race names — its discipline (from the race's « specialite ») and its format (from its title) —, or None."""
    t = fold(title)
    disc = DISCS.get(re.sub(r"[^A-Z]", "", fold(specialite)))
    if not disc or LEFT_OUT.search(t) or "RELAIS" in t:
        return None
    if not re.search(r"CHAMPIONNAT (DE FRANCE|NATIONAL)|\bCF(MD|LD|S|N)\b|\bCNN\b", t):
        return None
    fmt = ("nu" if re.search(r"\bNUIT\b|\bCFN\b|\bCNN\b", t) else "sp" if re.search(r"\bSPRINT\b|\bCFS\b", t)
           else "md" if re.search(r"MOYENNE DISTANCE|\bCFMD\b", t) else "ld" if re.search(r"LONGUE DISTANCE|\bCFLD\b|DE FRANCE LD\b", t)
           else None)
    key = disc + fmt if fmt else None
    return key if key in CHAMPS else None


def rank_of(title: str) -> tuple[int, set | None]:
    """A race's priority among its edition's (lower first) and the categories it gives, None = all."""
    t = fold(title)
    if "ELITE" in t and "JEUNE" not in t:
        return 0, {"H21", "D21"}
    if "ELITE" in t:
        return 1, None
    return 2, None


def cat_key(c: str):
    m = re.fullmatch(r"([HD])(\d+)", c or "")
    return (0 if m and m.group(1) == "D" else 1, int(m.group(2)) if m else 999, c)


def _time(s: str) -> str | None:
    """« 0:32:52 » → « 32:52 », « 1:05:03 » kept; None when not a time."""
    m = re.fullmatch(r"(\d+):(\d{2}):(\d{2})", (s or "").strip())
    if not m:
        m2 = re.fullmatch(r"(\d+):(\d{2})", (s or "").strip())
        return f"{int(m2.group(1))}:{m2.group(2)}" if m2 else None
    h, mi, se = int(m.group(1)), int(m.group(2)), m.group(3)
    return f"{h}:{mi:02d}:{se}" if h else f"{mi}:{se}"


def compile_(db: sqlite3.Connection, anon: privacy.Anon) -> tuple[dict, dict]:
    races: dict[tuple[str, int], list] = {}
    for cid, date, title, location, groupe, spec in db.execute(
            "select course_id, date_iso, title, location, groupe, specialite from competitions where has_results = 1 order by date_iso"):
        ch = champ_of(title or "", spec or "")
        if not ch or (groupe or "").strip() != "B1" or not date:
            continue
        pr, only = rank_of(title)
        races.setdefault((ch, int(date[:4])), []).append({"id": cid, "date": date, "title": title, "at": location or "",
                                                          "pr": pr, "only": only})
    index: dict = {"v": VERSION, "editions": {c: {} for c in CHAMPS}}
    files: dict = {}
    for (ch, y), rs in sorted(races.items()):
        rs.sort(key=lambda r: (r["pr"], r["date"]))
        cats: dict[str, list] = {}
        for r in rs:
            rows = db.execute(
                "select c.name, res.place, res.nom, res.licence, res.categorie, res.club, res.temps from results res "
                "join circuits c on c.circuit_id = res.circuit_id where c.course_id = ?", (r["id"],)).fetchall()
            by: dict[str, list] = {}
            for circ, place, name, lic, cat, club, temps in rows:
                cat = (cat or "").strip().upper()
                if not re.fullmatch(r"[HD]\d{2}", cat) or "OPEN" in fold(circ or "") or cat in cats:
                    continue
                if r["only"] is not None and cat not in r["only"]:
                    continue
                by.setdefault(cat, []).append((place, name, lic, club, temps))
            for cat, lst in by.items():
                placed = sorted((x for x in lst if str(x[0] or "").isdigit() and _time(x[4])), key=lambda x: int(x[0]))
                rest = [x for x in lst if x not in placed]
                out = []
                for i, (place, name, lic, club, temps) in enumerate(placed + rest):
                    lic_n = int(lic) if str(lic or "").isdigit() else None
                    shown = anon.lic(lic_n) if lic_n is not None else None
                    if anon.has(lic_n) or (lic_n is None and anon.named(name)):
                        name = privacy.label(shown if anon.has(lic_n) else None)
                    st = "" if i < len(placed) else STATUS.get(fold(temps or "").strip().lower(), "nc")
                    m = re.match(r"(\d{4})", club or "")
                    out.append([i + 1 if i < len(placed) else None, shown, (name or "").strip(), m.group(1) if m else "",
                                _time(temps) if not st else None, st])
                cats[cat] = out
        if not cats:
            continue
        main = next((r for r in rs if r["pr"] == 2), rs[-1])
        key = f"{ch}-{y}"
        index["editions"][ch][str(y)] = {
            "at": main["at"], "date": min(r["date"] for r in rs), "races": [r["id"] for r in rs],
            "n": sum(sum(1 for x in v if x[0]) for v in cats.values()),
            "cats": {c: [x for x in cats[c] if x[0] and x[0] <= 3] for c in sorted(cats, key=cat_key)},
        }
        files[key] = {"v": VERSION, "cats": {c: cats[c] for c in sorted(cats, key=cat_key)}}
    return index, files


# ---- The editions before 2011 (owner, 2026-11-11) ----------------------------------------------------------------------------
# FFCO's results database starts in 2011. The editions of 2001-2010 were gathered from FFCO's former site (www.ffco.asso.fr, on
# the Wayback Machine), LIFCO's and the organisers' copies and WinSplits, into one CSV — results, so outside the repository: R2
# `champs/old.csv`, which the workflow copies to `$CN_DATA_DIR/champs/`. Columns:
# champ;year;date;at;cat;src_place;name;club;club_name;time;status;foreign;source (one row a runner; `foreign` 1 = not eligible
# for a French title). Before 2008 FFCO's categories were age groups, already turned into today's codes there (Senior → 21,
# Vétéran 1 → 40 for 40-49…). A database edition of the same championship and year wins. Runners are linked to their page
# when the site's index holds one runner of that name, of that sex and of an age that fits both categories (`_linker`).


def _secs(t: str | None) -> int | None:
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})", (t or "").strip())
    return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None


def _ages(cat: str, year: int) -> tuple[int, int] | None:
    """The birth years a category of `year` holds: before 2008 FFCO's age groups (21 = 21-39, then ten-year bands), after it
    today's (21 = 21-34, then five-year bands); the youths' two-year bands both ways."""
    m = re.fullmatch(r"[HD](\d+)", cat or "")
    if not m:
        return None
    a = int(m.group(1))
    if a <= 20:
        lo, hi = (0 if a <= 12 else a - 1), a
    elif a == 21:
        lo, hi = 21, 39 if year < 2008 else 34
    else:
        lo, hi = a, a + (9 if year < 2008 else 4)
    return year - hi, year - lo


def _linker(fr_out: Path):
    """name (folded) → licence, for the runners of the site's index whose name is theirs alone, whose sex and age fit."""
    try:
        idx = json.loads((fr_out / "runners.json").read_text(encoding="utf-8"))
        cols = idx["cols"]
        rows = [dict(zip(cols, r)) for r in idx["rows"]]
    except (OSError, ValueError, KeyError):
        return lambda name, cat, year: None
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(fold(r.get("nom") or "").strip(), []).append(r)

    def link(name: str, cat: str, year: int):
        cands = by.get(fold(name).strip()) or []
        if len(cands) != 1:
            return None
        r = cands[0]
        if (r.get("sexe") or "") != cat[:1]:
            return None
        mine, now = _ages(cat, year), _ages(r.get("cat") or "", int((r.get("last") or "0000")[:4] or 0))
        if not mine or not now or max(mine[0], now[0]) > min(mine[1], now[1]):
            return None
        return int(r["licence"]) if str(r.get("licence") or "").isdigit() else None
    return link


def old_editions(path: Path, fr_out: Path, anon: privacy.Anon) -> dict[tuple[str, int], tuple[dict, dict]]:
    """(champ, year) → (its index entry, its file) from the CSV of the editions before 2011."""
    import csv
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return {}
    link = _linker(fr_out)
    groups: dict[tuple, list] = {}
    for r in csv.DictReader(text.splitlines(), delimiter=";"):
        ch, y, cat = (r.get("champ") or "").strip(), (r.get("year") or "").strip(), (r.get("cat") or "").strip().upper()
        if ch not in CHAMPS or not y.isdigit() or not re.fullmatch(r"[HD]\d{2}", cat):
            continue
        groups.setdefault((ch, int(y)), []).append({**r, "cat": cat})
    out = {}
    for (ch, y), rs in groups.items():
        cats: dict[str, list] = {}
        for r in rs:
            cats.setdefault(r["cat"], []).append(r)
        body = {}
        for cat, lst in cats.items():
            for r in lst:
                r["sp"] = int(r["src_place"]) if str(r.get("src_place") or "").strip().isdigit() else None
                r["t"] = _secs(r.get("time"))
                r["st"] = (r.get("status") or "").strip().lower()
                r["fx"] = (r.get("foreign") or "").strip() == "1"
            ok = [r for r in lst if not r["st"] and (r["sp"] is not None or r["t"] is not None)]
            # the place among the runners who may hold the title: the printed place less the foreigners ahead; without a
            # printed place, by time
            if all(r["sp"] is not None for r in ok):
                ok.sort(key=lambda r: (r["sp"], r["t"] or 0))
                for r in ok:
                    r["pl"] = None if r["fx"] else r["sp"] - sum(1 for o in ok if o["fx"] and o["sp"] < r["sp"])
            else:
                ok.sort(key=lambda r: (r["t"] is None, r["t"] or 0, r["sp"] or 0))
                n = 0
                prev = None
                for i, r in enumerate(x for x in ok if not x["fx"]):
                    n = n if prev is not None and r["t"] == prev else i + 1
                    prev = r["t"]
                    r["pl"] = n
                for r in ok:
                    if r["fx"]:
                        r["pl"] = None
            rest = [r for r in lst if r not in ok]
            rows = []
            for r in ok + rest:
                name = (r.get("name") or "").strip()
                lic = link(name, cat, y)
                shown = anon.lic(lic) if lic is not None else None
                if anon.has(lic) or (lic is None and anon.named(name)):
                    name = privacy.label(shown if anon.has(lic) else None)
                club = (r.get("club") or "").strip()
                club = club if re.fullmatch(r"\d{4}", club) else ""
                if r in ok and r["pl"] is not None:
                    rows.append([r["pl"], shown, name, club, _time(r.get("time")) if r["t"] is not None else None, ""])
                else:
                    st = "hc" if r["fx"] and r in ok else STATUS.get(r["st"], r["st"] if r["st"] in STATUS.values() else "nc")
                    rows.append([None, shown, name, club, _time(r.get("time")) if st == "hc" else None, st])
            body[cat] = rows
        if not any(x[0] for v in body.values() for x in v):
            continue
        dates = sorted(r["date"] for r in rs if re.fullmatch(r"\d{4}-\d{2}-\d{2}", (r.get("date") or "").strip()))
        ats = [r["at"].strip() for r in rs if (r.get("at") or "").strip()]
        main = max(set(ats), key=ats.count) if ats else ""
        order = sorted(body, key=cat_key)
        out[(ch, y)] = ({"at": main, "date": dates[0] if dates else f"{y}-01-01", "races": [], "old": 1,
                         "n": sum(sum(1 for x in v if x[0]) for v in body.values()),
                         "cats": {c: [x for x in body[c] if x[0] and x[0] <= 3] for c in order}},
                        {"v": VERSION, "cats": {c: body[c] for c in order}})
    return out


def build(db_path: Path, fr_out: Path, anon: privacy.Anon | None = None) -> bool:
    """Write fr_out/champs.json and fr_out/champs/*.json from the database; True when anything changed."""
    if not Path(db_path).exists():
        return False
    anon = anon if anon is not None else privacy.load()
    db = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        index, files = compile_(db, anon)
    finally:
        db.close()
    import paths
    for (ch, y), (entry, body) in sorted(old_editions(paths.DATA_DIR / "champs" / "old.csv", fr_out, anon).items()):
        if str(y) not in index["editions"][ch]:
            index["editions"][ch][str(y)] = entry
            files[f"{ch}-{y}"] = body
    for ch in index["editions"]:
        index["editions"][ch] = dict(sorted(index["editions"][ch].items()))
    changed = False
    folder = fr_out / "champs"
    folder.mkdir(parents=True, exist_ok=True)
    for key, body in files.items():
        changed |= _write(folder / f"{key}.json", body)
    for old in folder.glob("*.json"):                          # an edition no longer read (a race renamed)
        if old.stem not in files:
            old.unlink()
            changed = True
    changed |= _write(fr_out / "champs.json", index)
    return changed


def _write(path: Path, body) -> bool:
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


if __name__ == "__main__":
    import sys
    import paths
    fr = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "site" / "data" / "fr"
    print("champs.json:", "written" if build(paths.DB, fr) else "unchanged")

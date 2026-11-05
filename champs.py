"""France's individual championships for Stats' « Palmarès » (owner, 2026-11-05): on foot the Championnat de France Moyenne
Distance (CFMD), Longue Distance (CFLD), de Sprint (CFS) and de Nuit (CFN, formerly the Championnat National de Nuit, CNN), and
the VTT and ski championships (middle, long, sprint), every edition the results database holds — FFCO's archive starts in 2011, so
the editions before are not there. A championship's key is its discipline and its format: « fmd », « fld », « fsp », « fnu »,
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


def build(db_path: Path, fr_out: Path, anon: privacy.Anon | None = None) -> bool:
    """Write fr_out/champs.json and fr_out/champs/*.json from the database; True when anything changed."""
    if not Path(db_path).exists():
        return False
    db = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        index, files = compile_(db, anon if anon is not None else privacy.load())
    finally:
        db.close()
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

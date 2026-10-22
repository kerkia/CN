"""Spain's results archive: its database (CN_DATA_DIR/es.sqlite3) in France's tables — competitions, circuits, results —,
so that the CN engine and the site build read it as they read France's.

Where its results come from:
- the provisional results (ffco_scraper/prov): every Spanish race they read (O-Replay, liveresultat, WinSplits…), once its
  documents are there — the races of the last weeks, then each new one, at no extra request;
- O-Replay's past events (2024 on), read once each, a budget per run until done (`backfill_oreplay`).

A race is one competition; its circuits are its classes that ran the same course (the same controls in the same order —
the punches show it —, else each class its own). A runner's row keeps the name, club and category as printed (`cat_src`),
the category the engine reads (`categorie`, countries/es/categories.py), and what tells runners apart (`card`, `sex`,
`birth`); the club as printed (`club_src`) becomes the club's number (`club`, countries/es/clubs.py), and `licence` the
runner's (countries/identity.py).
"""
from __future__ import annotations

import json
import re
import sqlite3
import time

from datetime import date
from pathlib import Path

from ffco_scraper.store import SCHEMA

from . import COUNTRY, fmt_of, terrain as terrain_of
from .categories import normalise

EXTRA = """
CREATE TABLE IF NOT EXISTS es_sources (
  source     TEXT NOT NULL,          -- 'prov' (a race of the provisional results) | 'oreplay' (an O-Replay stage) | 'fedo'
  sid        TEXT NOT NULL,          -- the race's key, the stage's id, the file's address
  course_id  INTEGER NOT NULL,
  sha        TEXT,                   -- what was imported (a new reading of the same race replaces it)
  read_at    TEXT NOT NULL,
  PRIMARY KEY (source, sid)
);
CREATE TABLE IF NOT EXISTS es_meta (k TEXT PRIMARY KEY, v TEXT);
"""
RESULT_EXTRA = ("cat_src", "card", "sex", "birth", "club_src", "club_key", "person_key")
# not a race against the clock between individuals: score-O and rogaines (points), relays (a team's time), orienteering on
# a phone app, team games
NOT_RANKED = re.compile(r"\bscore\b|\brogain|\brelevos?\b|\brelleus?\b|\bo-?m[oó]vil\b|\bpollo sin cabeza\b|\bequipos\b", re.I)
STATUS_WORD = {"mp": "pm", "dnf": "abandon", "dsq": "disqualifié", "ot": "hors délai"}


def connect(db: Path | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(db or COUNTRY.db)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    con.executescript(EXTRA)
    cols = {r[1] for r in con.execute("PRAGMA table_info(results)")}
    for c in RESULT_EXTRA:
        if c not in cols:
            con.execute(f"ALTER TABLE results ADD COLUMN {c} TEXT")
    return con


def meta_get(con, k, default=None):
    row = con.execute("SELECT v FROM es_meta WHERE k = ?", (k,)).fetchone()
    return json.loads(row[0]) if row else default


def meta_set(con, k, v):
    con.execute("INSERT OR REPLACE INTO es_meta (k, v) VALUES (?, ?)", (k, json.dumps(v)))


def _hms(s: float | None) -> str | None:
    if not s or s <= 0:
        return None
    s = int(round(s))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def circuits_of(doc: dict) -> list[dict]:
    """A document's classes grouped by course: the classes whose finishers punched the same controls in the same order
    (and the same length when printed) ran one circuit; a class without punches is a circuit of its own."""
    groups: dict[tuple, dict] = {}
    for i, k in enumerate(doc.get("classes") or []):
        ctl = tuple(k.get("controls") or ())
        key = ("c", ctl, k.get("length_m")) if len(ctl) >= 3 else ("k", i)
        g = groups.setdefault(key, {"names": [], "length_m": k.get("length_m"), "runners": []})
        g["names"].append(k["name"])
        g["runners"] += [dict(r, _class=k["name"]) for r in k["runners"]]
    return list(groups.values())


def club_key(club: str | None) -> str:
    """« Málaga COMA » -> "coma", « Madrid O-GETAFE » -> "o getafe": the club without the province (or country) the lists
    print before it."""
    from .places import PROVINCES, ALIASES, _key
    s = _key(club or "")
    names = sorted({_key(n) for n, _ in PROVINCES.values()} | set(ALIASES) | COUNTRY_NAMES, key=len, reverse=True)
    for n in names:
        if s.startswith(n + " ") and len(s) > len(n) + 1:
            s = s[len(n) + 1:]
            break
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


COUNTRY_NAMES = {"portugal", "francia", "finlandia", "suecia", "noruega", "italia", "suiza", "alemania", "reino unido", "irlanda",
                 "belgica", "holanda", "paises bajos", "republica checa", "austria", "dinamarca", "polonia", "estonia", "ucrania",
                 "fedo", "independiente"}


def store_race(con, source: str, sid: str, meta: dict, doc: dict, sha: str | None = None) -> int | None:
    """One race (its document) into the tables, replacing an earlier import of the same race: -> its course_id, or None
    when it has nobody to keep."""
    circuits = circuits_of(doc)
    if not any(c["runners"] for c in circuits) or NOT_RANKED.search(f"{meta.get('name') or ''} {doc.get('title') or ''}"):
        return None
    row = con.execute("SELECT course_id, sha FROM es_sources WHERE source = ? AND sid = ?", (source, sid)).fetchone()
    if row and (row["sha"] or "").startswith("dup:"):
        return None                                     # the federation's own file has this race (dedupe)
    if row and sha and row["sha"] == sha:
        return row["course_id"]
    if row and row["course_id"]:                        # (0: a file that could not be read before)
        cid = row["course_id"]
        _drop_course(con, cid)
    else:
        cid = (con.execute("SELECT MAX(course_id) FROM competitions").fetchone()[0] or 0) + 1
    day = meta.get("date") or doc.get("date")
    if not day:
        return None
    epr = meta.get("epreuve") or fmt_of(meta.get("name"), doc.get("title"))
    spec = meta.get("spec") or ("VTT" if re.search(r"\bmtb-?o\b|\bbtt\b", (meta.get("name") or "").lower()) else "Pédestre")
    terrain = meta.get("terrain") or terrain_of(spec, epr) or "Forêt"
    d = date.fromisoformat(day)
    con.execute("""INSERT INTO competitions (course_id, season, date, date_iso, title, location, organizer, groupe, specialite,
                   epreuve, terrain, has_results) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)""",
                (cid, d.year, d.strftime("%d/%m/%Y"), day, meta.get("name") or doc.get("title"), meta.get("place"),
                 meta.get("org"), meta.get("league"), spec, epr, terrain))
    base = (con.execute("SELECT MAX(circuit_id) FROM circuits").fetchone()[0] or 0)
    for i, c in enumerate(circuits):
        circ = base + i + 1
        con.execute("INSERT INTO circuits (circuit_id, course_id, name, distance_km, valeur) VALUES (?,?,?,?,NULL)",
                    (circ, cid, " / ".join(c["names"])[:200], (c["length_m"] or 0) / 1000 or None))
        for r in c["runners"]:
            st = r.get("status") or "ok"
            if st == "dns":
                continue
            temps = _hms(r.get("time_s")) if st in ("ok", "nc") else STATUS_WORD.get(st)
            if not temps:
                continue
            place = "nc" if st == "nc" else (str(r["place"]) if r.get("place") else "")
            cat_src = r.get("category") or r["_class"]
            con.execute("""INSERT INTO results (circuit_id, place, nom, licence, categorie, club, temps, cat_src, card, sex,
                           birth, club_src, club_key) VALUES (?,?,?,NULL,?,NULL,?,?,?,?,?,?,?)""",
                        (circ, place, r["name"], normalise(cat_src, r.get("sex")), temps,
                         cat_src, r.get("card"), r.get("sex"), r.get("birth"), r.get("club"), club_key(r.get("club")) or None))
    con.execute("INSERT OR REPLACE INTO es_sources (source, sid, course_id, sha, read_at) VALUES (?,?,?,?,?)",
                (source, sid, cid, sha, _now()))
    return cid


def _drop_course(con, cid: int) -> None:
    for (circ,) in con.execute("SELECT circuit_id FROM circuits WHERE course_id = ?", (cid,)).fetchall():
        con.execute("DELETE FROM results WHERE circuit_id = ?", (circ,))
    con.execute("DELETE FROM circuits WHERE course_id = ?", (cid,))
    con.execute("DELETE FROM competitions WHERE course_id = ?", (cid,))


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _best(docs: list[dict]) -> dict | None:
    """A race's fullest list of results (not a start list, not a registration)."""
    keep = [d for d in docs if d and d.get("kind") not in ("startlist", "registration", "announcement", "coursedata")]
    return max(keep, key=lambda d: sum(len(k["runners"]) for k in d.get("classes") or []), default=None)


def from_prov(con, prov_db: Path, agenda: Path | None = None) -> int:
    """Every Spanish race the provisional results have read: its fullest list, imported (again when it changed). Its league
    (its weight, cn.title_weight) from Spain's agenda."""
    import hashlib
    leagues = {}
    try:
        leagues = {e["id"]: e.get("league") for e in json.loads(agenda.read_text(encoding="utf-8"))["events"]} if agenda else {}
    except (OSError, ValueError, KeyError):
        pass
    p = sqlite3.connect(f"file:{prov_db}?mode=ro", uri=True)
    p.row_factory = sqlite3.Row
    n = 0
    try:
        races = p.execute("SELECT * FROM prov_races WHERE country = 'ES'").fetchall()
    except sqlite3.OperationalError:
        return 0
    for race in races:
        docs = [json.loads(r["parsed"]) for r in p.execute(
            "SELECT parsed FROM prov_docs WHERE race_key = ? AND parsed IS NOT NULL", (race["key"],)).fetchall()]
        doc = _best(docs)
        if not doc:
            continue
        sha = hashlib.sha1(json.dumps(doc, sort_keys=True).encode()).hexdigest()
        meta = {"name": race["name"], "date": race["date_iso"], "place": race["place"], "org": race["org"],
                "epreuve": race["epreuve"], "terrain": race["terrain"], "league": leagues.get(race["key"])}
        if store_race(con, "prov", race["key"], meta, doc, sha) is not None:
            n += 1
            # an O-Replay stage read for the race is that race: the backfill does not read it again
            for k, v in json.loads(race["links"] or "{}").items():
                if k == "oreplay":
                    con.execute("INSERT OR IGNORE INTO es_sources (source, sid, course_id, sha, read_at) "
                                "SELECT 'oreplay', ?, course_id, NULL, read_at FROM es_sources WHERE source='prov' AND sid=?",
                                (v, race["key"]))
    con.commit()
    p.close()
    return n


def backfill_oreplay(con, http, budget_s: float, since: str = "2024-01-01", today: date | None = None,
                     recent_days: int = 70) -> dict:
    """O-Replay's Spanish events from `since`, each stage read once (the ones of the last weeks are the provisional
    results'); stops when the budget is spent — the next run goes on."""
    from ffco_scraper.prov.sources.oreplay import OReplay
    t0 = time.monotonic()
    today = today or date.today()
    recent = (date.fromordinal(today.toordinal() - recent_days)).isoformat()        # (0: every race run, a study's)
    o = OReplay(http)
    done = {r[0] for r in con.execute("SELECT sid FROM es_sources WHERE source = 'oreplay'")}
    tried = set(meta_get(con, "oreplay_empty", []))        # stages read with nothing in them (none uploaded)
    finished = set(meta_get(con, "oreplay_events", []))    # events whose every stage was read: not asked for again
    got = left = 0
    for ev in o.events(since):
        if (ev.get("country_code") or ("ES" if (ev.get("timezone") or "") in COUNTRY.time_zones else None)) != "ES":
            continue
        if ev["id"] in finished or (ev.get("initial_date") or "") >= recent or (ev.get("initial_date") or "") > today.isoformat():
            continue                                      # done, or the provisional results' (or not run yet)
        if time.monotonic() - t0 > budget_s:
            left += 1
            continue
        complete = True
        for st in o.stages(ev):
            if st["id"] in done or st["id"] in tried:
                continue
            if time.monotonic() - t0 > budget_s:
                complete = False
                break
            doc = o.read(st["id"])
            if doc is None and hasattr(http, "out_of_time") and http.out_of_time():
                complete = False
                break
            org = ev.get("organizer") or {}
            # the day the runners started, else the stage's (guessed from the stages' order when it gives none)
            meta = {"name": st["name"], "date": (doc or {}).get("date") or st["date"], "org": org.get("name"), "place": None,
                    "epreuve": fmt_of(st.get("stage"), ev.get("description")),
                    # O-Replay's scope: a national race weighs as the Liga Española's (cn.title_weight)
                    "league": "Liga Nacional" if ev.get("scope") in ("nat", "int") else (org.get("region") or None)}
            if doc and store_race(con, "oreplay", st["id"], meta, doc) is not None:
                got += 1
                done.add(st["id"])
            else:
                tried.add(st["id"])
            con.commit()
        if complete:
            finished.add(ev["id"])
        else:
            left += 1
    meta_set(con, "oreplay_empty", sorted(tried))
    meta_set(con, "oreplay_events", sorted(finished))
    con.commit()
    return {"read": got, "left": left, "requests": http.requests, "seconds": round(time.monotonic() - t0)}


def prune(con) -> int:
    """Races the rules now leave out (NOT_RANKED), imported before them: gone, with their circuits and results; their
    sources stay noted, so that they are not read again."""
    gone = 0
    for cid, title in con.execute("SELECT course_id, title FROM competitions").fetchall():
        if NOT_RANKED.search(title or ""):
            _drop_course(con, cid)
            gone += 1
    con.commit()
    return gone


def _signature(con, cid: int) -> set:
    """A race's finishers as (name's words, time): the same race read from two sources gives the same pairs, whatever the
    name order or the title; two races of one weekend share runners, never their times."""
    from countries.identity import words
    return {(frozenset(words(nom)), temps) for nom, temps in con.execute(
        "SELECT r.nom, r.temps FROM results r JOIN circuits c ON c.circuit_id = r.circuit_id "
        "WHERE c.course_id = ? AND r.temps LIKE '%:%'", (cid,))}


def dedupe(con, days: int = 3) -> dict:
    """A race both FEDO's file and another source hold (O-Replay, the provisional results — sometimes both, or O-Replay
    twice: « Sprint » and « Sprint-Test »): FEDO's kept (the federation's own), every other copy gone and noted
    (« dup:<course> »), so that it is not imported again. Same race: at least half of the smaller one's finishers with the
    same name and time, 10 or more, within `days` of each other."""
    rows = con.execute("""SELECT c.course_id, c.date_iso, EXISTS (SELECT 1 FROM es_sources s WHERE s.course_id = c.course_id
                          AND s.source = 'fedo') AS fedo FROM competitions c""").fetchall()
    fedo = [r for r in rows if r["fedo"]]
    others = [r for r in rows if not r["fedo"]]
    sig: dict[int, set] = {}

    def s(cid):
        if cid not in sig:
            sig[cid] = _signature(con, cid)
        return sig[cid]

    gone = 0
    for f in fedo:
        d = date.fromisoformat(f["date_iso"])
        a = s(f["course_id"])
        for o in list(others):
            if abs((date.fromisoformat(o["date_iso"]) - d).days) > days:
                continue
            b = s(o["course_id"])
            n = min(len(a), len(b))
            if n < 10 or len(a & b) < 0.5 * n:
                continue
            _drop_course(con, o["course_id"])
            con.execute("UPDATE es_sources SET course_id = 0, sha = ? WHERE course_id = ?", (f"dup:{f['course_id']}", o["course_id"]))
            others.remove(o)
            gone += 1
    con.commit()
    return {"duplicates": gone}


def drop_overall(con, prov_db: Path, http) -> dict:
    """Once: the multi-day totals (O-Replay's « Overall » stages: « Totales », « Total Trofeo… ») read as races before they
    were left out (2026-10-22) — gone from the archive and from the provisional results (a race of its own: the race and
    its documents; a race of the agenda the total was linked to: the link and the total's document)."""
    from ffco_scraper.prov.sources.oreplay import OReplay, is_overall
    if meta_get(con, "overall_dropped"):
        return {}
    stage = re.compile(r"([0-9a-f-]{36}/[0-9a-f-]{36})")
    mine = {r[0]: r[1] for r in con.execute("SELECT sid, course_id FROM es_sources WHERE source = 'oreplay'")}
    p = sqlite3.connect(prov_db)
    p.row_factory = sqlite3.Row
    try:
        races = p.execute("SELECT key, links FROM prov_races WHERE country = 'ES'").fetchall()
    except sqlite3.OperationalError:
        races = []
    docs = p.execute("SELECT race_key, url FROM prov_docs WHERE source = 'oreplay'").fetchall()
    seen = set(mine) | {json.loads(r["links"] or "{}").get("oreplay") for r in races} | \
        {m.group(1) for d in docs if (m := stage.search(d["url"]))}
    o = OReplay(http)
    overall = set()
    for ev in sorted({s.split("/")[0] for s in seen if s}):
        overall |= {f"{ev}/{st['id']}" for st in (o.detail(ev) or {}).get("stages") or [] if is_overall(st)}
    out = {"archive": 0, "prov_races": 0, "prov_docs": 0}
    for sid in overall & set(mine):
        cid = mine[sid]
        if cid:
            _drop_course(con, cid)
            con.execute("UPDATE es_sources SET course_id = 0, sha = 'overall' WHERE course_id = ?", (cid,))
            out["archive"] += 1
    for d in docs:
        m = stage.search(d["url"])
        if m and m.group(1) in overall:
            p.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ?", (d["race_key"], d["url"]))
            out["prov_docs"] += 1
    for r in races:
        links = json.loads(r["links"] or "{}")
        if links.get("oreplay") not in overall:
            continue
        if r["key"].startswith("eso"):                  # the total itself, from O-Replay alone
            p.execute("DELETE FROM prov_docs WHERE race_key = ?", (r["key"],))
            p.execute("DELETE FROM prov_races WHERE key = ?", (r["key"],))
            out["prov_races"] += 1
        else:
            links.pop("oreplay")
            p.execute("UPDATE prov_races SET links = ? WHERE key = ?", (json.dumps(links) if links else None, r["key"]))
    p.commit()
    p.close()
    meta_set(con, "overall_dropped", True)
    con.commit()
    return out

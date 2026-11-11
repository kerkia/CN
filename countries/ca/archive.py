"""Canada's results archive: its database (CN_DATA_DIR/ca.sqlite3) in France's tables — competitions, circuits, results —,
so that the CN engine and the site build read it as they read France's and Spain's.

Where its results come from (studied 2026-11-11):
- the provisional results (ffco_scraper/prov): every Canadian race they read (the clubs' files the agenda links, WhyJustRun's
  IOF XML, WinSplits), once its documents are there;
- the clubs' own past files, each read once (`backfill_files`): Orienteering Ottawa's MeOS split lists since January 2023,
  Ramblers' MeOS lists — the names of Ottawa's events from WhyJustRun's calendar of that day;
- WhyJustRun's results of every Canadian club's past events (IOF XML), read once each, a budget per run until done
  (`backfill_wjr`): British Columbia's, Alberta's, the Maritimes' clubs since 2010.

Runners are told apart by their names alone (countries/identity.py, no club: Ottawa's files print none, and a club in one
file and none in another would make two runners of one); a club, when a file prints one, is kept for the club pages.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from datetime import date, datetime, timezone
from pathlib import Path

from countries import agenda
from countries.es.archive import _drop_course, _hms, circuits_of
from ffco_scraper.store import SCHEMA

from . import COUNTRY

EXTRA = """
CREATE TABLE IF NOT EXISTS ca_sources (
  source     TEXT NOT NULL,          -- 'prov' (a race of the provisional results) | 'file' (a club's results file) | 'wjr'
  sid        TEXT NOT NULL,          -- the race's key, the file's address, the WhyJustRun event's id
  course_id  INTEGER NOT NULL,       -- 0: read, nothing kept
  sha        TEXT,
  read_at    TEXT NOT NULL,
  PRIMARY KEY (source, sid)
);
CREATE TABLE IF NOT EXISTS ca_meta (k TEXT PRIMARY KEY, v TEXT);
"""
RESULT_EXTRA = ("cat_src", "card", "sex", "birth", "club_src", "club_key", "person_key")
# not a race against the clock between individuals: score-O (points), relays, rogaines, games and socials; summer series
# totals; Ottawa's « Summer Series » score-O nights
NOT_RANKED = re.compile(r"\bscore\b|\brogain|\brela(?:y|is)\b|\bstaffel|\bgoat\b|\bspook|\bhallowe+n\b|\bfamily\b|\bscavenger"
                        r"|\bstar-?o\b|\bline-?o\b|\bcorridor\b|\bwindow-?o\b|\bmemory\b|\bseries (?:results|totals|standings)\b"
                        r"|\bsummer series\b|\btraining\b|\bpractice\b|\bclinic\b|\bteam\b|\bpairs?\b", re.I)
# the classes not raced alone and on time: groups, beginners walking with a guide, snowshoers in a ski race
OPEN_CLASS = re.compile(r"\bgroup|\bteam|\bpairs?\b|\bfamily|\bnovice\b|\bbeginner|\bnew\b|\bwalk|\bguided\b|\bopen\b|"
                        r"\bdébutant|\bdecouverte|\bdécouverte|\bfamille|\béquipe", re.I)
REPEAT = re.compile(r"\s#\d+\s*$|\(2nd run\)|\(second run\)", re.I)
TOO_FAST = 0.25
STATUS_WORD = {"mp": "pm", "dnf": "abandon", "dsq": "disqualifié", "ot": "hors délai"}
# a class of another discipline than its race's (an Ottawa winter day: « Ski Long », « Snowshoe », « Fatbike »)
CLASS_SPEC = (("Ski", re.compile(r"\bski\b|\bski-?o\b", re.I)), ("VTT", re.compile(r"\bmtb|\bbike\b|\bfat ?bike|\bvélo", re.I)),
              ("Raquettes", re.compile(r"\bsnow ?shoe|\braquette", re.I)))


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
    row = con.execute("SELECT v FROM ca_meta WHERE k = ?", (k,)).fetchone()
    return json.loads(row[0]) if row else default


def meta_set(con, k, v):
    con.execute("INSERT OR REPLACE INTO ca_meta (k, v) VALUES (?, ?)", (k, json.dumps(v)))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Canada's classes: M/F (W) and an age, « M21 », « F35 », « W21E », « M10- », « F65+ », « Men 21+ »; the courses by level
# (« Intermediate », « Short Advanced ») say nothing of the runner
_CAT = re.compile(r"^(?:(m|h|men|male|hommes?)|(f|w|d|women|female|femmes?|dames?))\s*-?\s*(\d{1,2})\s*(?:[-+e]|\b)", re.I)


def category(text: str | None) -> str | None:
    m = _CAT.match((text or "").strip())
    if not m:
        return None
    age = int(m.group(3))
    return ("H" if m.group(1) else "D") + f"{max(10, age):02d}"


def club_key(club: str | None) -> str | None:
    s = agenda.fold(club or "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s or None


def _spec_of_title(title: str) -> str:
    from . import _spec
    return _spec(title)


def store_race(con, source: str, sid: str, meta: dict, doc: dict, sha: str | None = None) -> int | None:
    """One race (its document) into the tables, replacing an earlier import of the same race: -> its course_id, or None
    when it has nobody to keep."""
    title = meta.get("name") or doc.get("title") or ""
    row = con.execute("SELECT course_id, sha FROM ca_sources WHERE source = ? AND sid = ?", (source, sid)).fetchone()
    if row and (row["sha"] or "").startswith("dup:"):
        return None
    if row and sha and row["sha"] == sha:
        return row["course_id"] or None
    if row and row["course_id"]:
        _drop_course(con, row["course_id"])
    day = meta.get("date") or doc.get("date")
    circuits = circuits_of(doc)
    spec = meta.get("spec") or _spec_of_title(title)
    keep = day and spec in ("Pédestre", "VTT", "Ski") and any(c["runners"] for c in circuits) \
        and not NOT_RANKED.search(f"{title} {doc.get('title') or ''}")
    if not keep:
        con.execute("INSERT OR REPLACE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,0,?,?)",
                    (source, sid, sha, _now()))
        return None
    cid = (con.execute("SELECT MAX(course_id) FROM competitions").fetchone()[0] or 0) + 1
    epr = meta.get("epreuve") or agenda.fmt_of(title, doc.get("title"))
    terrain = meta.get("terrain") or agenda.terrain(spec, epr) or "Forêt"
    d = date.fromisoformat(day)
    con.execute("""INSERT INTO competitions (course_id, season, date, date_iso, title, location, organizer, groupe, specialite,
                   epreuve, terrain, has_results) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)""",
                (cid, d.year, d.strftime("%d/%m/%Y"), day, title, meta.get("place"), meta.get("org"), meta.get("level"),
                 spec, epr, terrain))
    base = con.execute("SELECT MAX(circuit_id) FROM circuits").fetchone()[0] or 0
    n = 0
    for i, c in enumerate(circuits):
        names = " / ".join(c["names"])
        other = next((s for s, rx in CLASS_SPEC if rx.search(names)), None)
        if other and other != spec:
            continue
        circ = base + i + 1
        con.execute("INSERT INTO circuits (circuit_id, course_id, name, distance_km, valeur) VALUES (?,?,?,?,NULL)",
                    (circ, cid, names[:200], (c["length_m"] or 0) / 1000 or None))
        for r in c["runners"]:
            st = r.get("status") or "ok"
            if st == "dns" or REPEAT.search(r.get("name") or ""):
                continue
            temps = _hms(r.get("time_s")) if st in ("ok", "nc") else STATUS_WORD.get(st)
            if not temps:
                continue
            cat_src = r.get("category") or r["_class"]
            place = "nc" if st == "nc" or OPEN_CLASS.search(r["_class"] or "") else (str(r["place"]) if r.get("place") else "")
            con.execute("""INSERT INTO results (circuit_id, place, nom, licence, categorie, club, temps, cat_src, card, sex,
                           birth, club_src, club_key) VALUES (?,?,?,NULL,?,NULL,?,?,?,?,?,?,NULL)""",
                        (circ, place, r["name"], category(cat_src) or category(r["_class"]), temps, cat_src, r.get("card"),
                         r.get("sex"), r.get("birth"), r.get("club")))
            n += 1
    if not n:
        _drop_course(con, cid)
        con.execute("INSERT OR REPLACE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,0,?,?)",
                    (source, sid, sha, _now()))
        return None
    con.execute("INSERT OR REPLACE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,?,?,?)",
                (source, sid, cid, sha, _now()))
    return cid


FMT_NAME = {agenda.SPRINT: "Sprint", agenda.MIDDLE: "Middle", agenda.LONG: "Long", agenda.NIGHT: "Night"}


def _best(docs: list[dict]) -> dict | None:
    keep = [d for d in docs if d and d.get("kind") not in ("startlist", "registration", "announcement", "coursedata")]
    return max(keep, key=lambda d: sum(len(k["runners"]) for k in d.get("classes") or []), default=None)


def from_prov(con, prov_db: Path) -> int:
    """Every Canadian race the provisional results have read: its fullest list, imported (again when it changed); its file
    or WhyJustRun event noted, so that the backfills do not read it again."""
    try:
        p = sqlite3.connect(f"file:{prov_db}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        return 0
    p.row_factory = sqlite3.Row
    n = 0
    try:
        races = p.execute("SELECT * FROM prov_races WHERE country = 'CA'").fetchall()
    except sqlite3.OperationalError:
        return 0
    for race in races:
        rows = p.execute("SELECT url, parsed FROM prov_docs WHERE race_key = ? AND parsed IS NOT NULL", (race["key"],)).fetchall()
        # a weekend's event with a file per race (the Eastern Canadian Championships: « Results-Sprint-by-Class.pdf »,
        # « …-Middle-… », « …-Long-… »): each format a race of its own, its fullest file
        groups: dict[str, list] = {}
        for r in rows:
            # a file a backfill already imported (read before the provisional results had the race): kept as it is
            m = re.search(r"/events/(\d+)/result_list", r["url"])
            if con.execute("SELECT 1 FROM ca_sources WHERE source = ? AND sid = ? AND course_id > 0",
                           ("wjr", m.group(1)) if m else ("file", r["url"])).fetchone():
                continue
            # a file of another format than a race against the clock (Ramblers' « 2026-11-07-ResultsScore.html »: its
            # « club » column holds the points)
            if NOT_RANKED.search(re.sub(r"(?<=[a-z])(?=[A-Z])|[-_.]", " ", r["url"].rsplit("/", 1)[-1])):
                continue
            fmt = agenda.fmt_of(re.sub(r"[-_.]", " ", r["url"].rsplit("/", 1)[-1])) or ""
            groups.setdefault(fmt, []).append(json.loads(r["parsed"]))
        if len(groups) > 1 and "" in groups:
            groups.pop("")
        for fmt, docs in groups.items():
            doc = _best(docs)
            if not doc:
                continue
            sha = hashlib.sha1(json.dumps(doc, sort_keys=True).encode()).hexdigest()
            name = race["name"] if len(groups) == 1 or not fmt else f"{race['name']} — {FMT_NAME.get(fmt, fmt)}"
            meta = {"name": name, "date": race["date_iso"], "place": race["place"], "org": race["org"],
                    "epreuve": fmt or race["epreuve"], "terrain": None if len(groups) > 1 else race["terrain"]}
            sid = race["key"] if len(groups) == 1 else f"{race['key']}#{fmt}"
            was = con.execute("SELECT sha FROM ca_sources WHERE source = 'prov' AND sid = ?", (sid,)).fetchone()
            if was and was["sha"] == sha:                  # (unchanged: nothing to compute again)
                continue
            if store_race(con, "prov", sid, meta, doc, sha) is not None:
                n += 1
        for r in rows:                                 # the backfills leave these alone
            m = re.search(r"/events/(\d+)/result_list", r["url"])
            src, sid = ("wjr", m.group(1)) if m else ("file", r["url"])
            con.execute("INSERT OR IGNORE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,0,?,?)",
                        (src, sid, f"dup:{race['key']}", _now()))
    con.commit()
    p.close()
    return n


def backfill_files(con, http, budget_s: float) -> dict:
    """The clubs' past results files (countries/ca/results.py), each read once; Ottawa's events named from WhyJustRun's
    calendar of their day."""
    from ffco_scraper.prov.run import parse_any

    from . import results, wjr
    t0 = time.monotonic()
    files = results.club_files(http)
    done = {r[0] for r in con.execute("SELECT sid FROM ca_sources WHERE source = 'file'")}
    days = sorted({d for f in files.values() for d in f})
    names = _wjr_names(http, days[0], days[-1]) if days else {}
    got = left = 0
    for club, by_day in files.items():
        org = {"OOC": "Orienteering Ottawa", "ROC": "Ramblers Orienteering Club"}.get(club, club)
        for day, urls in sorted(by_day.items()):
            for url in urls:
                if url in done or NOT_RANKED.search(re.sub(r"(?<=[a-z])(?=[A-Z])|[-_.]", " ", url.rsplit("/", 1)[-1])):
                    continue
                if time.monotonic() - t0 > budget_s:
                    left += 1
                    continue
                a = http.get(url)
                doc = parse_any(a.content, url) if a.status == 200 else None
                ev = (names.get((club, day)) or [None])[0] if club == "OOC" else None
                title = ev or _title(doc, url)
                meta = {"name": title, "date": day, "org": org, "place": None}
                sha = hashlib.sha1(a.content).hexdigest() if a.status == 200 else None
                if doc and store_race(con, "file", url, meta, doc, sha) is not None:
                    got += 1
                elif not doc:
                    con.execute("INSERT OR REPLACE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,0,?,?)",
                                ("file", url, sha, _now()))
                con.commit()
    return {"read": got, "left": left}


def _title(doc: dict | None, url: str) -> str:
    """A file's own title made readable: « KanataLakes_November8_2026 » -> « Kanata Lakes »."""
    t = (doc or {}).get("title") or url.rsplit("/", 1)[-1]
    t = re.sub(r"[_]+", " ", t)
    t = re.sub(r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{1,2}\b.*$", "", t)
    t = re.sub(r"\b20\d\d(\d{4})?\b", "", t)
    t = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t)
    return re.sub(r"\s+", " ", t).strip(" -–") or "Orienteering"


def _wjr_names(http, lo: str, hi: str) -> dict:
    """{(club, day): [event names]} from WhyJustRun's calendar."""
    from . import wjr
    out: dict = {}
    for x in wjr.events(http, date.fromisoformat(lo), date.fromisoformat(hi)):
        club = (x.get("club") or {}).get("acronym")
        day = datetime.fromtimestamp(int(x["start"]), timezone.utc).astimezone(_tz()).date().isoformat()
        out.setdefault((club, day), []).append(re.sub(r"\s+", " ", x.get("title") or "").strip())
    return out


def _tz():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/Toronto")


def backfill_wjr(con, http, budget_s: float, since: str = "2010-01-01", today: date | None = None,
                 recent_days: int = 70) -> dict:
    """WhyJustRun's results of every Canadian club's past events from `since`, each event read once (those of the last weeks
    are the provisional results'); stops when the budget is spent — the next run goes on."""
    from ffco_scraper.prov.run import parse_any

    from . import wjr, _spec
    t0 = time.monotonic()
    today = today or date.today()
    recent = date.fromordinal(today.toordinal() - recent_days)
    orgs = wjr.organisations(http)
    done = {r[0] for r in con.execute("SELECT sid FROM ca_sources WHERE source = 'wjr'")}
    got = left = asked = 0
    # the latest seasons first: the indices of today need them, the oldest only seed the first seasons
    y = recent.year
    while y >= int(since[:4]):
        lo, hi = date(y, 1, 1), min(date(y, 12, 31), recent)
        for x in wjr.events(http, lo, hi):
            oid = str((x.get("club") or {}).get("id") or "")
            sid = str(x["id"])
            if sid in done or not wjr.canadian(orgs, oid):
                continue
            name = re.sub(r"\s+", " ", x.get("title") or "").strip()
            from . import NOT_EVENT, TRAINING
            if NOT_EVENT.search(name) or TRAINING.search(name) or _spec(name) not in ("Pédestre", "VTT", "Ski"):
                continue
            if time.monotonic() - t0 > budget_s:
                left += 1
                continue
            a = http.get(wjr.result_list_url(sid))
            asked += 1
            doc = parse_any(a.content, wjr.result_list_url(sid)) if a.status == 200 else None
            day = datetime.fromtimestamp(int(x["start"]), timezone.utc).date().isoformat()
            meta = {"name": name, "date": (doc or {}).get("date") or day, "org": (orgs.get(oid) or {}).get("name"),
                    "level": (x.get("event_classification") or {}).get("name")}
            if not (doc and doc.get("classes") and store_race(con, "wjr", sid, meta, doc) is not None):
                con.execute("INSERT OR REPLACE INTO ca_sources (source, sid, course_id, sha, read_at) VALUES (?,?,0,NULL,?)",
                            ("wjr", sid, _now()))
            else:
                got += 1
            done.add(sid)
            con.commit()
        y -= 1
    if not left:
        meta_set(con, "wjr_backfilled", True)
        con.commit()
    return {"read": got, "asked": asked, "left": left, "seconds": round(time.monotonic() - t0)}


def prune(con) -> int:
    """A run cut short (a time far below its circuit's median): « nc »."""
    from collections import defaultdict
    gone = 0
    # files the rules now leave out (a score-O list read before), and races whose title says so
    for sid, cid in con.execute("SELECT sid, course_id FROM ca_sources WHERE course_id > 0 AND source IN ('file', 'prov')").fetchall():
        if NOT_RANKED.search(re.sub(r"(?<=[a-z])(?=[A-Z])|[-_.]", " ", sid.rsplit("/", 1)[-1])):
            _drop_course(con, cid)
            con.execute("UPDATE ca_sources SET course_id = 0 WHERE course_id = ?", (cid,))
            gone += 1
    for cid, title in con.execute("SELECT course_id, title FROM competitions").fetchall():
        if NOT_RANKED.search(title or ""):
            _drop_course(con, cid)
            con.execute("UPDATE ca_sources SET course_id = 0 WHERE course_id = ?", (cid,))
            gone += 1
    times = defaultdict(list)
    for rid, circ, t in con.execute("SELECT id, circuit_id, temps FROM results WHERE place NOT IN ('', 'nc') AND temps LIKE '%:%'"):
        h, m, sec = (int(x) for x in t.split(":"))
        times[circ].append((rid, h * 3600 + m * 60 + sec))
    for circ, v in times.items():
        if len(v) >= 4:
            med = sorted(x for _, x in v)[len(v) // 2]
            for rid, x in v:
                if x < TOO_FAST * med:
                    con.execute("UPDATE results SET place = 'nc' WHERE id = ?", (rid,))
                    gone += 1
    con.commit()
    return gone

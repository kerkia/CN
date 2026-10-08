"""The races the pilot watches, and the organisers' websites.

Two inputs: the agenda (site/data/agenda.json: upcoming and just-past races, with the organiser's website) and
FFCO's competitions already in the database (to cover the past month, and to know when FFCO has published a
race). A race is keyed 'a<agenda id>' when the agenda knows it, else 'f<FFCO course id>'; an agenda race gets its
FFCO id once FFCO publishes it (same day, same organiser, the closest name).

When to look again after a race (next_check): at every run (hourly) for three days, then once a day until the
14th day; a race FFCO has published is looked at a last time, then left alone.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .model import plain

WATCH_DAYS = 14
HOURLY_DAYS = 3
EPREUVE_TERRAIN = {"Sprint": "Sprint", "MD": "Forêt", "LD": "Forêt", "Nuit": "Forêt", "Relais": None}
SPEC_TERRAIN = {"VTT": "VTT", "Ski": "Ski"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def org_code(org: str | None) -> str | None:
    m = re.match(r"^\s*(\d{1,4})\s*-", org or "")
    return m.group(1) if m else None


def terrain_of(e: dict) -> str | None:
    if e.get("spec") in SPEC_TERRAIN:
        return SPEC_TERRAIN[e["spec"]]
    return EPREUVE_TERRAIN.get(e.get("epr") or "", "Forêt" if e.get("cn") else None)


# words every race shares: they never tell two races apart
GENERIC = {"de", "la", "le", "du", "des", "et", "en", "a", "au", "aux", "d", "l", "co", "club", "course", "courses", "orientation",
           "regionale", "regional", "departementale", "departemental", "dep", "nationale", "national", "championnat", "chpt", "champ",
           "cdl", "ligue", "sprint", "md", "ld", "moyenne", "longue", "distance", "nuit", "nocturne", "night", "challenge", "urbain",
           "sans", "qualif", "open", "trophee", "etape", "manche", "mass", "start", "vtt", "ski", "pied", "relais", "wre", "o",
           "sport", "sports", "association", "ass", "union", "sportive", "team", "amicale", "laique", "ville"}
TYPE_WORDS = {"Sprint": ("sprint",), "MD": ("md", "moyenne"), "LD": ("ld", "longue"), "Nuit": ("nuit", "nocturne", "night")}


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", plain(text).replace("'", " "))


def initials(org: str | None) -> str:
    """'1905 - BRIVE LIMOUSIN COURSE D'ORIENTATION' -> 'blco'; 'CLUB ORIENTATION BUHL ET FLORIVAL' -> 'cobf'."""
    name = re.sub(r"^\s*\d+\s*-\s*", "", org or "")
    return "".join(w[0] for w in _words(name.replace("-", " ")) if w not in ("de", "la", "le", "du", "des", "et", "d", "l") and not w.isdigit())


def match_score(race, name: str, organiser: str) -> float:
    """How surely a platform's competition (name, organiser, same day) is this race: 0 = not it; >= 1 = take it.
    Needs distinctive evidence — a word of the place or of the race's own name, the organiser's initials or club
    number; generic words ("championnat de ligue sprint") count for nothing, and a contradicting race type rules it out."""
    cw = set(_words(f"{name} {organiser}"))
    if ("relais" in cw or "relay" in cw) and not is_relay(race["name"], race["epreuve"]):
        return 0.0                            # a relay is never the individual race of the same day
    t = race["epreuve"]
    if t in TYPE_WORDS:
        others = {w for k, ws in TYPE_WORDS.items() if k != t for w in ws}
        if cw & others and not cw & set(TYPE_WORDS[t]):
            return 0.0
    distinct = {w for w in _words(f"{race['name']} {race['place'] or ''}") if w not in GENERIC and not w.isdigit() and len(w) >= 3}
    weak = {w for w in _words(race["name"]) if re.fullmatch(r"[a-z]+\d+|\d+[a-z]+", w)}       # md1, e3, j2…
    org_words = {w for w in _words(re.sub(r"^\s*\d+\s*-\s*", "", race["org"] or "")) if w not in GENERIC and len(w) >= 4}
    s = min(2, len(distinct & cw)) * 1.0 + min(1, len(org_words & cw)) * 0.6 + 0.4 * len(weak & cw)
    # generic words in common only break ties between two races of one organiser that day ("Championnat…" vs
    # "Challenge…"): too weak to make a match alone
    s += 0.15 * len((set(_words(race["name"])) & GENERIC - {"de", "la", "le", "du", "des", "et", "d", "l", "o"}) & set(_words(name)))
    # the organiser field written as the club's initials (« BLCO »): evidence, not proof (other countries' clubs
    # have initials too), so it needs a race type or a place to agree
    ini = initials(race["org"])
    abbrevs = {re.sub(r"[^a-z0-9]", "", plain(x)) for x in re.split(r"[()\-,/]", organiser or "") if x.strip()}
    if len(ini) >= 3 and any(a and (a == ini or (len(a) >= 3 and (ini.startswith(a) or a.startswith(ini)))) for a in abbrevs):
        s += 0.8
    if race["org_code"] and len(race["org_code"]) == 4 and race["org_code"] in f"{name} {organiser}":
        s += 1.0
    if t in TYPE_WORDS and cw & set(TYPE_WORDS[t]):
        s += 0.3
    return s


def assign(races_list, items, min_score: float = 1.0) -> dict:
    """One-to-one: each platform competition goes to the watched race of its day it matches best (and each race gets
    at most one), so two races of a weekend never share a competition. items: [(id, name, organiser, date)]."""
    pairs = []
    for r in races_list:
        for iid, name, org, d in items:
            if d == r["date_iso"]:
                s = match_score(r, name, org)
                if s >= min_score:
                    pairs.append((s, r["key"], iid))
    taken_r, taken_i, out = set(), set(), {}
    for s, rk, iid in sorted(pairs, key=lambda p: -p[0]):
        if rk in taken_r or iid in taken_i:
            continue
        taken_r.add(rk); taken_i.add(iid)
        out[rk] = iid
    return out


def similarity(a: str, b: str) -> float:
    """Share of the shorter name's words found in the other (accents, case and punctuation ignored)."""
    wa = set(re.findall(r"[a-z0-9]+", plain(a))) - {"de", "la", "le", "du", "des", "et", "co", "course"}
    wb = set(re.findall(r"[a-z0-9]+", plain(b))) - {"de", "la", "le", "du", "des", "et", "co", "course"}
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / min(len(wa), len(wb))


# ---- the organisers' websites -----------------------------------------------------------------------------------
def refresh_clubs(con, agenda_path: Path) -> int:
    """Club number -> website, from the agenda (each event names its organiser's site). FFCO's club directory
    (api.ffcorientation.fr) is closed to robots by its robots.txt, so it is not read."""
    if not agenda_path.exists():
        return 0
    n = 0
    for e in json.loads(agenda_path.read_text(encoding="utf-8")).get("events", []):
        code = org_code(e.get("org"))
        if code and e.get("site"):
            con.execute("INSERT OR REPLACE INTO prov_clubs (code, name, site, read_at) VALUES (?,?,?,?)",
                        (code.zfill(4) if len(code) > 2 else code, e["org"], e["site"], now_iso()))
            n += 1
    con.commit()
    return n


def club_site(con, code: str | None) -> str | None:
    if not code:
        return None
    row = con.execute("SELECT site FROM prov_clubs WHERE code = ?", (code.zfill(4) if len(code) > 2 else code,)).fetchone()
    return row["site"] if row else None


# ---- the races ---------------------------------------------------------------------------------------------
def is_relay(name: str | None, epreuve: str | None = None) -> bool:
    """Relays are out of the pilot's scope (team races: neither individual results nor a CN)."""
    return epreuve == "Relais" or "relais" in plain(name) or "relay" in plain(name)


def sync(con, agenda_path: Path, today: date, back_days: int) -> dict:
    """Add the races of the last `back_days` days (agenda + FFCO) to prov_races and link them to FFCO."""
    lo = (today - timedelta(days=back_days)).isoformat()
    hi = today.isoformat()
    added = linked = 0
    stamp = now_iso()
    # the agenda: competitions (kind 'c') of the period, with their organiser's website
    if agenda_path.exists():
        a = json.loads(agenda_path.read_text(encoding="utf-8"))
        for e in a.get("events", []):
            # upcoming races too: the agenda drops a race a few days after it, and its website and place go with it
            if e.get("kind") != "c" or not e.get("id") or e.get("date", "") < lo or e.get("cancelled") or is_relay(e.get("name"), e.get("epr")):
                continue
            key = f"a{e['id']}"
            code = org_code(e.get("org"))
            site = e.get("site") or club_site(con, code)
            cur = con.execute("SELECT key FROM prov_races WHERE key = ?", (key,)).fetchone()
            if cur:
                con.execute("UPDATE prov_races SET name=?, place=?, org=?, org_code=?, terrain=?, epreuve=?, cn=?, site=COALESCE(?, site) WHERE key=?",
                            (e["name"], e.get("place"), e.get("org"), code, terrain_of(e), e.get("epr"), int(bool(e.get("cn"))), site, key))
            else:
                con.execute("""INSERT INTO prov_races (key, date_iso, name, place, org, org_code, terrain, epreuve, cn, site, agenda_id,
                    first_seen, next_check) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (key, e["date"], e["name"], e.get("place"), e.get("org"), code, terrain_of(e), e.get("epr"),
                             int(bool(e.get("cn"))), site, e["id"], stamp, stamp))
                added += 1
    # FFCO's competitions of the period: link the agenda's races, add the others (the past month's pilot)
    for c in con.execute("SELECT course_id, date_iso, title, organizer, terrain, epreuve, location FROM competitions WHERE date_iso BETWEEN ? AND ?",
                         (lo, hi)).fetchall():
        if is_relay(c["title"], c["epreuve"]):
            continue
        code = org_code(c["organizer"])
        same = con.execute("SELECT key, name, ffco_id FROM prov_races WHERE date_iso = ? AND org_code IS ? AND agenda_id IS NOT NULL",
                           (c["date_iso"], code)).fetchall()
        best = max(same, key=lambda r: similarity(r["name"], c["title"] or ""), default=None)
        if best and (best["ffco_id"] in (None, c["course_id"])) and similarity(best["name"], c["title"] or "") >= 0.5:
            if best["ffco_id"] is None:
                con.execute("UPDATE prov_races SET ffco_id = ? WHERE key = ?", (c["course_id"], best["key"]))
                linked += 1
            continue
        key = f"f{c['course_id']}"
        if con.execute("SELECT 1 FROM prov_races WHERE key = ? OR ffco_id = ?", (key, c["course_id"])).fetchone():
            # a race only FFCO knows: its place (FFCO's location) and website, once known, help find its results
            con.execute("UPDATE prov_races SET place = COALESCE(place, ?), site = COALESCE(site, ?) WHERE key = ?",
                        (c["location"], club_site(con, code), key))
            continue
        con.execute("""INSERT INTO prov_races (key, date_iso, name, place, org, org_code, terrain, epreuve, cn, site, ffco_id,
            first_seen, next_check) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)""",
                    (key, c["date_iso"], c["title"], c["location"], c["organizer"], code, c["terrain"], c["epreuve"],
                     club_site(con, code), c["course_id"], stamp, stamp))
        added += 1
    # relays taken in before they were left out, and relay files found next to an individual race
    con.execute("DELETE FROM prov_docs WHERE lower(url) LIKE '%relais%' OR lower(url) LIKE '%relay%' OR lower(COALESCE(title, '')) LIKE '%relais%'")
    for (key,) in con.execute("SELECT key FROM prov_races").fetchall():
        r = con.execute("SELECT name, epreuve FROM prov_races WHERE key = ?", (key,)).fetchone()
        if is_relay(r["name"], r["epreuve"]):
            con.execute("DELETE FROM prov_docs WHERE race_key = ?", (key,))
            con.execute("DELETE FROM prov_races WHERE key = ?", (key,))
    con.commit()
    return {"added": added, "linked": linked}


def due(con, today: date, now: str) -> list:
    """Races to look at in this run: raced already, not done, and their next check has come."""
    return con.execute("""SELECT * FROM prov_races WHERE done = 0 AND date_iso <= ? AND (next_check IS NULL OR next_check <= ?)
                          ORDER BY date_iso DESC""", (today.isoformat(), now)).fetchall()


def schedule(con, race, today: date) -> None:
    """After a look: when to look again, or stop."""
    age = (today - date.fromisoformat(race["date_iso"])).days
    now = datetime.now(timezone.utc)
    if age > WATCH_DAYS:                      # FFCO publishing a race does not stop it: FFCO never has the splits
        con.execute("UPDATE prov_races SET last_check = ?, done = 1 WHERE key = ?", (now.isoformat(timespec="seconds"), race["key"]))
        return
    step = timedelta(minutes=50) if age < HOURLY_DAYS else timedelta(hours=23)
    con.execute("UPDATE prov_races SET last_check = ?, next_check = ? WHERE key = ?",
                (now.isoformat(timespec="seconds"), (now + step).isoformat(timespec="seconds"), race["key"]))

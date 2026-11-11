"""Canada's clubs as the site keys them (France's « 7707IF »: a number of four digits, then its region's letters): each club
gets a number of its own once and for all (table ca_clubs) and its province's letters (« 0003ON »: Orienteering Ottawa).
The clubs are WhyJustRun's Canadian organisations (full name and short name both name them) and the Quebec clubs; a club a
file prints that none of them is gets a number of its own, without a province.
"""
from __future__ import annotations

import re

from countries import agenda

SCHEMA = """
CREATE TABLE IF NOT EXISTS ca_clubs (
  code      TEXT PRIMARY KEY,         -- four digits, the club's own
  key       TEXT UNIQUE NOT NULL,     -- the folded name it is known by
  name      TEXT NOT NULL,
  province  TEXT                      -- two letters (ON, QC, BC…)
);
CREATE TABLE IF NOT EXISTS ca_club_alias (alias TEXT PRIMARY KEY, key TEXT NOT NULL);
"""
PROVINCES = {"British Columbia": "BC", "Yukon": "YT", "Alberta": "AB", "Saskatchewan": "SK", "Manitoba": "MB", "Ontario": "ON",
             "Québec": "QC", "New Brunswick": "NB", "Nova Scotia": "NS", "Prince Edward Island": "PE",
             "Newfoundland and Labrador": "NL"}
# the Quebec clubs (FQCO's list) and names files print for clubs WhyJustRun also lists
EXTRA = [("Ramblers Orienteering Club", "QC", ("ramblers", "roc", "club de course d orientation ramblers")),
         ("Accro O Sport", "QC", ("accro o sport", "accro-o-sport", "aos")),
         ("Azimut Laurentides", "QC", ("azimut", "azimut laurentides", "azm")),
         ("Viking", "QC", ("viking", "viking ski club")), ("Rikico", "QC", ("rikico",)),
         ("Orienteering Ottawa", "ON", ("ooc", "oo", "ottawa", "orienteering ottawa", "ottawa orienteering club", "ottawa oc"))]


def key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", agenda.fold(name or "")).strip()


# the words a club's name ends or starts with that tell nothing (« Ramblers OC » = « Ramblers Orienteering Club »)
GENERIC = re.compile(r"^(?:club(?: de course)? d ?orientation|club)\s+|\s+(?:orienteering(?: club)?|o ?club|oc|club|orientation)$")
NOT_CLUB = re.compile(r"^[\d\s.,:+-]*(?:p|pts?|points?)?\.?$", re.I)


def short(name: str | None) -> str:
    k = key(name)
    for _ in range(2):
        k = GENERIC.sub("", k).strip()
    return k


def refresh(con, http) -> int:
    """The known clubs (WhyJustRun's Canadian clubs, the Quebec ones), numbered once."""
    from . import wjr
    con.executescript(SCHEMA)
    orgs = wjr.organisations(http)
    known = []
    for oid, o in orgs.items():
        if o.get("type") in ("NationalFederation", "IOF") or not wjr.canadian(orgs, oid) or oid == wjr.CANADA:
            continue
        prov = PROVINCES.get(wjr.region_of(orgs, oid) or "")
        known.append((o["name"], prov, (o["name"], o["short"])))
    known += EXTRA
    n = 0
    for name, prov, aliases in known:
        k = key(name)
        if not con.execute("SELECT 1 FROM ca_clubs WHERE key = ?", (k,)).fetchone():
            code = (con.execute("SELECT MAX(CAST(code AS INTEGER)) FROM ca_clubs").fetchone()[0] or 0) + 1
            con.execute("INSERT INTO ca_clubs (code, key, name, province) VALUES (?,?,?,?)", (f"{code:04d}", k, name, prov))
            n += 1
        for a in {k, short(name), *(key(x) for x in aliases if x), *(short(x) for x in aliases if x)} - {""}:
            # (a short name two clubs share, ROC: Ramblers and Rochester — the first, Canadian one, keeps it)
            con.execute("INSERT OR IGNORE INTO ca_club_alias (alias, key) VALUES (?, ?)", (a, k))
    con.commit()
    return n


def assign(con) -> dict:
    """Every result row's club number (results.club = « 0003ON »), from the club it prints; a club no list knows gets a
    number of its own."""
    con.executescript(SCHEMA)
    alias = dict(con.execute("SELECT alias, key FROM ca_club_alias").fetchall())
    for (src,) in con.execute("SELECT DISTINCT club_src FROM results WHERE club_src IS NOT NULL AND club IS NULL").fetchall():
        if NOT_CLUB.match(src.strip()):                    # (a score list's points: « 270 p. »)
            continue
        k = alias.get(key(src)) or alias.get(short(src))
        if not k:
            k = key(src)
            if not k or len(k) < 2:
                continue
            if not con.execute("SELECT 1 FROM ca_clubs WHERE key = ?", (k,)).fetchone():
                code = (con.execute("SELECT MAX(CAST(code AS INTEGER)) FROM ca_clubs").fetchone()[0] or 0) + 1
                con.execute("INSERT INTO ca_clubs (code, key, name, province) VALUES (?,?,?,NULL)", (f"{code:04d}", k, src.strip()))
            con.execute("INSERT OR IGNORE INTO ca_club_alias (alias, key) VALUES (?, ?)", (k, k))
            alias[k] = k
        con.execute("""UPDATE results SET club_key = ?, club = (SELECT code || COALESCE(province, '') FROM ca_clubs WHERE key = ?)
                       WHERE club_src = ? AND club IS NULL""", (k, k, src))
    con.commit()
    return {"clubs": con.execute("SELECT COUNT(*) FROM ca_clubs").fetchone()[0]}


def names(con) -> dict:
    """The build's names (build_site `names`): clubs by number, the provinces as « ligues », no départements."""
    con.executescript(SCHEMA)
    clubs = {code: name for code, name in con.execute("SELECT code, name FROM ca_clubs")}
    ligues = {v: k for k, v in PROVINCES.items()}
    return {"clubs": clubs, "ligues": ligues, "depts": {}}

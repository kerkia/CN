"""Canada: its clubs' calendars and results (owner, 2026-11-11: « start with Orienteering Ottawa, then Canada in general »).

Orienteering Canada's own site sits behind a Cloudflare challenge (never worked around); its clubs publish instead:
- WhyJustRun (countries/ca/wjr.py): about twenty clubs' events — British Columbia, Alberta, Saskatchewan, Manitoba,
  Ontario (Orienteering Ottawa posts its events there), the Maritimes — and some of their results, IOF XML;
- the Quebec federation's calendar (FQCO, courseorientationquebec.ca, countries/ca/fqco.py): Ramblers, Accro O Sport,
  Azimut… through WordPress's events API;
- the clubs' own results files: Orienteering Ottawa's MeOS split lists (ottawaoc.ca/Results/<yyyymmdd>_results.html, from
  2023), Ramblers' MeOS lists (ramblersoc.ca's « Résultats » page); WinSplits Online for the British Columbia clubs.

Every result is public on the clubs' sites, so is what Ozimut computes from them (`access`). A runner is ca + a number of
Ozimut's (no licence in the results lists; WhyJustRun's person ids and the SportIdent cards tell runners apart).
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

# Canada's results on the site (« Résultats », its ranking): built and published since 2026-11-11, but read by the
# administrators only (`access` « admins », functions/_lib/access.js) until the clubs have been asked (owner); the calendar
# is everyone's, as the other countries'. False: neither built nor in « Résultats »
OPEN = True

COUNTRY = Country(
    code="CA", federation="Orienteering Canada", access="admins", db=paths.DATA_DIR / "ca.sqlite3", results=OPEN,
    time_zones=("America/Toronto", "America/Montreal", "America/Vancouver", "America/Edmonton", "America/Winnipeg",
                "America/Regina", "America/Halifax", "America/Moncton", "America/St_Johns", "America/Whitehorse"),
    lang="en-CA,en;q=0.9,fr-CA;q=0.7,fr;q=0.5")
AGENDA_VERSION = 1
FRESH_DAYS = 3                # an event's page is looked at again for its results this many days after it, then kept as read

# WhyJustRun's classifications -> the agenda's level, in Canada's words
LEVEL = {"Local": "Local", "Club": "Club", "Regional": "Regional", "National": "National", "International": "International",
         "Championship": "Championship"}
# not an event to race: meetings, socials, volunteering, courses of instruction (a training is kind « e », a race « c »)
NOT_EVENT = re.compile(r"\b(agm|annual general|board meeting|meeting|social|banquet|potluck|volunteer|work ?party|map ?making|"
                       r"mapping day|webinar|zoom|assembl[ée]e|strategic plan|planning session|town hall|fundraiser)\b", re.I)
TRAINING = re.compile(r"\b(training|practice|clinic|camp|lesson|learn|skills|intro(duction)?|coaching|formation|atelier|"
                      r"entra[iî]nement|vikazimut|youth program|junior program)\b", re.I)
CANCELLED = re.compile(r"[\s\-–(]*\b(?:cancell?ed|annulée?|postponed|reportée?)\b[\s)!.]*", re.I)
SNOWSHOE = re.compile(r"\bsnow ?shoe|\braquette", re.I)


def _spec(name: str) -> str:
    """The discipline a name says; a snowshoe-O alone is no discipline Ozimut ranks (raced against the clock but on
    snowshoes: its own word)."""
    if SNOWSHOE.search(name) and not re.search(r"\bski\b|\bski-?o\b|\bmtb", name, re.I):
        return "Raquettes"
    return agenda.spec_of(name)


def read(http, today: date, prev: dict | None) -> list[dict]:
    from . import fqco, results, wjr
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=400)
    old = {e["id"]: e for e in (prev or {}).get("events") or []}
    orgs = wjr.organisations(http)
    files = results.club_files(http)                 # the clubs' own results pages: {club: {day: [url, …]}}
    out = []
    wjr_clubs: set[str] = set()
    for x in wjr.events(http, lo, hi):
        club = x.get("club") or {}
        oid = str(club.get("id") or "")
        if not orgs or not wjr.canadian(orgs, oid):
            continue
        name = re.sub(r"\s+", " ", x.get("title") or "").strip()
        if not name or NOT_EVENT.search(name):
            continue
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        region = wjr.region_of(orgs, oid)
        tz = ZoneInfo(TZ_OF.get(region or "", "America/Toronto"))
        start = datetime.fromtimestamp(int(x["start"]), timezone.utc).astimezone(tz)
        end = datetime.fromtimestamp(int(x.get("end") or x["start"]), timezone.utc).astimezone(tz)
        short = club.get("acronym") or (orgs.get(oid) or {}).get("short")
        wjr_clubs.add(short)
        if short == "OOC" and wjr.QUEBEC_SIDE.search(name):
            region = "Québec"
        kind = "e" if TRAINING.search(name) else "c"
        cls = (x.get("event_classification") or {}).get("name")
        day = start.date().isoformat()
        eid = f"w{x['id']}"
        src = {"wjr": x.get("url") or f"{wjr.BASE}/events/view/{x['id']}"}
        # the results: the club's own files of that day, else what the event's page links (looked at a few days after,
        # then kept)
        if kind == "c" and day <= today.isoformat():
            mine = (files.get(short) or {}).get(day)
            if mine:
                src["file"] = mine
            else:
                was = (old.get(f"ca{eid}") or {}).get("src") or {}
                if day < (today - timedelta(days=FRESH_DAYS)).isoformat() and "seen" in was:
                    src.update({k: v for k, v in was.items() if k in ("winsplits", "file", "seen")})
                else:
                    src.update(wjr.result_links(http, src["wjr"]))
                    src["seen"] = today.isoformat()
        # another club's event posted here, its club in brackets (« (Ramblers) Eastern Canadian… »): the name without it,
        # the club kept to find the organiser's own row
        host = re.match(r"^\(([^)]{2,40})\)\s*", name)
        if host:
            name = name[host.end():]
        off = bool(CANCELLED.search(name))           # (« Confederation Park WJR- CANCELLED »: the word after the name)
        name = CANCELLED.sub("", name).strip(" -–") or name
        e = agenda.event("CA", eid, day, name, kind=kind, cancelled=off, end=end.date().isoformat(), region=region,
                         org=(orgs.get(oid) or {}).get("name") or short, spec=_spec(name), level=LEVEL.get(cls),
                         site=x.get("url"), src=src)
        if host:
            e["_host"] = host.group(1)
        if x.get("lat") and x.get("lng"):
            e["gps"] = [round(float(x["lat"]), 5), round(float(x["lng"]), 5)]
        out.append(e)
    quebec = fqco.events(http, lo, hi)
    # a WhyJustRun club's post of another club's event (Orienteering Ottawa's « Ramblers - Morgan Arboretum »): the
    # organiser's own calendar has it
    # (one row kept: the WhyJustRun post when its page links the results — a championship's files —, else the organiser's)
    drop_q = set()
    kept = []
    for e in out:
        named = [s for s, rx in fqco.NAMED.items() if re.search(rx, e.get("_host") or e["name"], re.I)]
        e.pop("_host", None)
        twins = [q for q in quebec if q.get("_org_short") in named and e["date"] <= q["date"] <= (e.get("end") or e["date"])]
        if not twins:
            kept.append(e)
        elif (e.get("src") or {}).get("file"):
            kept.append(e)
            drop_q |= {q["id"] for q in twins}
    out = kept
    quebec = [q for q in quebec if q["id"] not in drop_q]
    for e in quebec:
        if e.get("_org_short") in wjr_clubs:          # (Orienteering Ottawa: its events are WhyJustRun's)
            continue
        e.pop("_org_short", None)
        mine = (files.get(e.pop("_club", None)) or {}).get(e["date"])
        if mine and e["kind"] == "c":
            e["src"] = {**(e.get("src") or {}), "file": mine}
        out.append(e)
    return out


TZ_OF = {"British Columbia": "America/Vancouver", "Yukon": "America/Whitehorse", "Alberta": "America/Edmonton",
         "Saskatchewan": "America/Regina", "Manitoba": "America/Winnipeg", "Ontario": "America/Toronto", "Québec": "America/Montreal",
         "New Brunswick": "America/Moncton", "Nova Scotia": "America/Halifax", "Prince Edward Island": "America/Halifax",
         "Newfoundland and Labrador": "America/St_Johns"}
REGIONS = ["British Columbia", "Yukon", "Alberta", "Saskatchewan", "Manitoba", "Ontario", "Québec", "New Brunswick",
           "Nova Scotia", "Prince Edward Island", "Newfoundland and Labrador"]

refresh_agenda, agenda_path, agenda_current = agenda.hooks(
    COUNTRY, read, AGENDA_VERSION, sources={"wjr": "WhyJustRun", "fqco": "FQCO"}, order=REGIONS)

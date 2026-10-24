"""Great Britain: British Orienteering's event finder (www.britishorienteering.org.uk/event), its agenda only.

The finder's list, server-rendered, 20 events a page in date order (studied 2026-10-23): its pages are read until a year
ahead — about 40 requests a day, each event with its venue, nearest town, club (and its website), association (the
region) and level. Northern Ireland's races are in it (NIOA). Past events are not in it: the agenda keeps the last
weeks' from its own earlier runs. Discipline and format are read from the name.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="GB", federation="British Orienteering", access="all", db=paths.DATA_DIR / "gb.sqlite3",
                  time_zones=("Europe/London",), lang="en-GB,en;q=0.8", results=False)
AGENDA_VERSION = 2                       # 2: the county from the place (countries/places, 2026-10-24)
BASE = "https://www.britishorienteering.org.uk/"
MAX_PAGES = 70
ASSOC = {"EAOA": "East Anglia", "EMOA": "East Midlands", "NEOA": "North East", "NWOA": "North West", "SCOA": "South Central",
         "SEOA": "South East", "SWOA": "South West", "WMOA": "West Midlands", "YHOA": "Yorkshire and Humberside",
         "SOA": "Scotland", "WOA": "Wales", "NIOA": "Northern Ireland"}


def _day(s: str) -> str | None:
    """« Sat 24th Oct 2026 » -> 2026-10-24."""
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", s or "")
    try:
        return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %Y").date().isoformat() if m else None
    except ValueError:
        return None


def read(http, today: date, prev: dict | None) -> list[dict]:
    from lxml import html as lh
    hi = (today + timedelta(days=366)).isoformat()
    out = []
    for page in range(MAX_PAGES):
        a = http.get(f"{BASE}event", params={"page": str(page)})
        if a.status != 200:
            break
        cards = lh.fromstring(a.content).cssselect("div.event_item")
        if not cards:
            break
        for c in cards:
            head = c.cssselect(".card-header strong")
            if len(head) < 2:
                continue
            name, day = head[0].text_content().strip(), _day(head[1].text_content())
            eid = (c.get("id") or "").removeprefix("evt")
            if not day or not eid.isdigit():
                continue
            fields = {}
            for div in c.cssselect(".card-body > div.d-inline-block"):
                lab = div.cssselect("label")
                if lab:
                    key = lab[0].text_content().strip(" :").lower()
                    fields[key] = div.text_content().replace(lab[0].text_content(), "", 1).replace("\xa0", " ").strip()
                    link = div.cssselect("a")
                    if key == "club" and link and (link[0].get("href") or "").startswith("http"):
                        fields["club_site"] = link[0].get("href")
            venue, town = fields.get("venue"), fields.get("nearest town")
            out.append(agenda.event(
                "GB", eid, day, name, place=", ".join(dict.fromkeys(x for x in (venue, town) if x)) or None,
                region=ASSOC.get(fields.get("association") or "", fields.get("association") or None),
                org=fields.get("club") or None, level=fields.get("level") or None, site=fields.get("club_site"),
                src={"bof": f"{BASE}event?event={eid}"}))
        if out and out[-1]["date"] > hi:
            break
    out = [e for e in out if e["date"] <= hi]
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


def place(e: dict) -> None:
    """The county (or unitary authority) of the event's nearest town, else of its venue (`dep`), under the calendar's
    own association."""
    parts = [x.strip() for x in (e.get("place") or "").split(",")]
    nation = e.get("region") if e.get("region") in ("Scotland", "Wales", "Northern Ireland") else "England"
    agenda.locate("GB", e, *dict.fromkeys(x for x in (parts[-1], e.get("place")) if x), keep_region=True, expect=nation)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION,
                                                           sources={"bof": "British Orienteering"}, place=place)

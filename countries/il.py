"""Israel: the Israel Sport Orienteering Association's calendar (ISOA, nivut.org.il/calendar.aspx), its agenda only.

The calendar's grid, server-rendered (studied 2026-10-23): one request a day — the coming events and the last week's,
with date, place, description, club and kind (foot league, MTBO league, training…). Older ones come from the agenda's own
earlier runs. Closed events (« אירוע סגור ») are left out.
"""
from __future__ import annotations

import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="IL", federation="ISOA", access="all", db=paths.DATA_DIR / "il.sqlite3",
                  time_zones=("Asia/Jerusalem",), lang="he,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
BASE = "https://nivut.org.il/"
TRAINING = "אימון"                  # « training »
MTBO = "רכוב"                       # « mounted » (on a bike)
NIGHT = "לילה"
CLOSED = "אירוע סגור"


def read(http, today: date, prev: dict | None) -> list[dict]:
    from lxml import html as lh
    a = http.get(f"{BASE}calendar.aspx")
    if a.status != 200:
        return []
    out = []
    for tr in lh.fromstring(a.content).cssselect("table.rgMasterTable > tbody > tr"):
        tds = tr.cssselect("td")
        link = tr.cssselect("a[href$='/Info']")
        if len(tds) < 6 or not link:
            continue
        m = re.fullmatch(r"(\d\d)/(\d\d)/(\d{4})", tds[0].text_content().strip())
        if not m:
            continue
        place = link[0].text_content().strip()
        desc, club, kind = (re.sub(r"\s+", " ", tds[i].text_content()).strip() for i in (3, 4, 5))
        if CLOSED in desc:
            continue
        eid = re.search(r"(\d+)/Info", link[0].get("href")).group(1)
        name = desc if desc and desc != "-" else place
        both = f"{kind} {desc}"
        out.append(agenda.event(
            "IL", eid, f"{m.group(3)}-{m.group(2)}-{m.group(1)}", name, kind="e" if TRAINING in kind else "c",
            place=place or None, org=club or None, spec=agenda.MTBO if MTBO in both else agenda.spec_of(name),
            epr=agenda.NIGHT if NIGHT in both else agenda.fmt_of(name), level=kind or None,
            src={"isoa": f"{BASE}{eid}/Info"}))
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"isoa": "ISOA"})

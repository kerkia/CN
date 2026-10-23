"""Romania: the Romanian orienteering federation's calendar (FRO, www.fro.ro), its agenda only.

The public JSON list its calendar page reads (api/events/public_events.php; studied 2026-10-23): every event in one
request, with dates, place, organising club and entry link. It also lists the Romanian teams' races abroad, left out.
Discipline and format are read from the name (« MTBO », « Noapte »…).
"""
from __future__ import annotations

import json
import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="RO", federation="FRO", access="all", db=paths.DATA_DIR / "ro.sqlite3",
                  time_zones=("Europe/Bucharest",), lang="ro,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://www.fro.ro/api/events/public_events.php"
CALENDAR = "https://www.fro.ro/app/"
# a county's code after the town (« Hunedoara, HD »)
COUNTY = re.compile(r",\s*([A-Z]{1,2})\b")


def read(http, today: date) -> list[dict]:
    a = http.get(LIST)
    if a.status != 200:
        return []
    try:
        rows = json.loads(a.content).get("events") or []
    except ValueError:
        return []
    out = []
    for r in rows:
        place = (r.get("location") or "").strip(" .") or None
        if not r.get("start_date") or agenda.abroad(place, "romania"):
            continue
        name = r.get("name") or ""
        out.append(agenda.event(
            "RO", r["id"], r["start_date"][:10], name, end=(r.get("end_date") or "")[:10] or None, place=place,
            org=r.get("club_name") or None, epr=agenda.fmt_of(name) or (agenda.NIGHT if re.search(r"\bnoapte\b", name, re.I) else ""),
            reg={"url": r["registration_url"]} if (r.get("registration_url") or "").startswith("http") else None,
            src={"fro": CALENDAR}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"fro": "FRO"})

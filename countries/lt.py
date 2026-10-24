"""Lithuania: the Lithuanian orienteering federation's calendar (LOSF, calendar.orienteering.lt), its agenda only.

The calendar's page holds its events as JSON (« $scope.events »: national races, local series and the Lithuanians'
races abroad; studied 2026-10-23): one request a day. The races abroad (« int ») and the federation's meetings are left
out; the rest keeps its date and last day, place, organiser, discipline, website and entry deadline.
"""
from __future__ import annotations

import json
import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="LT", federation="LOSF", access="all", db=paths.DATA_DIR / "lt.sqlite3",
                  time_zones=("Europe/Vilnius",), lang="lt,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
PAGE = "https://calendar.orienteering.lt/"
SPEC = {"Bėgte": agenda.FOOT, "OSKD": agenda.MTBO, "OSS": agenda.SKI, "Takais": agenda.TRAIL, "Rogaining": "Rogaining"}


def events_of(html: str) -> dict:
    """The page's « $scope.events = {...}; »."""
    i = html.find("$scope.events")
    if i < 0:
        return {}
    j = html.index("=", i) + 1
    return json.JSONDecoder().raw_decode(html[j:].lstrip())[0]


def read(http, today: date) -> list[dict]:
    a = http.get(PAGE)
    if a.status != 200:
        return []
    out = []
    for kind_, rows in events_of(a.text()).items():
        if kind_ not in ("lt", "mass"):              # « int »: races abroad; « other »: meetings, promotions
            continue
        for r in rows:
            if not r.get("date") or r.get("deleted_at"):
                continue
            disc = [d.strip() for d in r.get("discipline") or [] if d.strip()]
            place = r.get("place") or (r.get("city") if r.get("city") not in (None, "0") else None)
            reg = r.get("registration_date")
            entry = f"https://dbsportas.lt/lt/varz/{r['db_sportas_id']}" if r.get("db_sportas_id") else r.get("link")
            name = r.get("title") or ""
            if r.get("prefix") and kind_ == "mass":          # a weekly series' race, named by its forest alone
                name = f"{r['prefix'].replace('-', ' ').capitalize()} — {name}"
            out.append(agenda.event(
                "LT", r["id"], r["date"], name, end=r.get("date_to") or None, place=place,
                cancelled=bool(re.match(r"nevyks\b", agenda.fold(r.get("title")))),   # « not held »
                org=r.get("organizer") or None, spec=SPEC.get(disc[0]) if disc else None, site=r.get("link") or None,
                level="LOSF" if kind_ == "lt" else None,
                reg={"url": entry, "close": reg[:10]} if reg and entry and re.match(r"\d{4}-", reg) else None,
                src={"losf": PAGE}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION,
                                                           sources={"losf": "calendar.orienteering.lt"})

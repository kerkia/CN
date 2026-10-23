"""Czechia: the Czech orienteering federation's calendar (ČSOS, ORIS — oris.orientacnisporty.cz), its agenda only.

ORIS's public JSON API, one request a day (studied 2026-10-23): `getEventList` with `all=1` over the window — national,
regional and local races, foot, MTBO, ski-O and trail-O, with their regional sections, organising clubs, format and entry
deadlines. A multi-stage event is listed with its stages (`ParentID`): the stages are kept, the event itself is not.
"""
from __future__ import annotations

from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="CZ", federation="ČSOS", access="all", db=paths.DATA_DIR / "cz.sqlite3",
                  time_zones=("Europe/Prague",), lang="cs,en;q=0.5", results=False)
AGENDA_VERSION = 1
API = "https://oris.orientacnisporty.cz/API/"
EVENT = "https://oris.orientacnisporty.cz/Zavod?id={}"
SPEC = {"1": agenda.FOOT, "2": agenda.SKI, "3": agenda.MTBO, "4": agenda.TRAIL}
# ORIS's disciplines (ShortName) -> the agenda's format
FMT = {"SP": agenda.SPRINT, "KO": agenda.SPRINT, "MD": agenda.MIDDLE, "LD": agenda.LONG, "UD": agenda.LONG,
       "NO": agenda.NIGHT, "RE": agenda.RELAY, "SR": agenda.RELAY}
TRAINING = {"TC", "STK"}               # training camps
SEMINAR = {"SEM"}                      # courses, meetings, seminars


def read(http, today: date) -> list[dict]:
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    a = http.get(API, params={"format": "json", "method": "getEventList", "all": "1",
                              "datefrom": lo.isoformat(), "dateto": hi.isoformat()})
    if a.status != 200:
        return []
    import json
    rows = list((json.loads(a.content).get("Data") or {}).values())
    parents = {r.get("ParentID") for r in rows if r.get("ParentID") not in (None, "", "0", 0)}
    out = []
    for r in rows:
        if r["ID"] in parents or not r.get("Date"):
            continue
        disc = (r.get("Discipline") or {}).get("ShortName") or ""
        level = (r.get("Level") or {}).get("ShortName") or ""
        kind = "f" if disc in SEMINAR or level == "SEM" else "e" if disc in TRAINING or level in TRAINING else "c"
        regions = [x.get("Name") for x in (r.get("Regions") or {}).values() if x.get("ID") != "ČR"] \
            or [x.get("Name") for x in (r.get("Regions") or {}).values()]
        org = (r.get("Org1") or {}).get("Name") or None
        e1 = r.get("EntryDate1") or ""
        out.append(agenda.event(
            "CZ", r["ID"], r["Date"], r.get("Name") or "", kind=kind, place=r.get("Place") or None,
            region=regions[0] if regions else None, org=org, spec=SPEC.get((r.get("Sport") or {}).get("ID")),
            epr=FMT.get(disc) or agenda.fmt_of(r.get("Name")), level=(r.get("Level") or {}).get("NameCZ") or None,
            cancelled=r.get("Cancelled") == "1",
            reg={"url": EVENT.format(r["ID"]), "close": e1[:10]} if e1[:4].isdigit() else None,
            src={"oris": EVENT.format(r["ID"])}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"oris": "ORIS"})

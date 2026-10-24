"""Austria: the Austrian orienteering federation's calendar (ÖFOL, ANNE — anne.orienteeringaustria.at), its agenda only.

ANNE's own JSON API (anne-api.oefol.at, read by its pages; no key for what is public; studied 2026-10-23): the events of
the window in one request — competitions, trainings, courses, with their hosts (the club, then its Land's association),
place, discipline and status. The format is only in the title.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="AT", federation="ÖFOL", access="all", db=paths.DATA_DIR / "at.sqlite3",
                  time_zones=("Europe/Vienna",), lang="de-AT,de;q=0.8,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: Land and Bezirk from the place (countries/places, 2026-10-24)
API = "https://anne-api.oefol.at/v1/event"
SPEC = {"footOrienteering": agenda.FOOT, "mountainbikeOrienteering": agenda.MTBO, "skiOrienteering": agenda.SKI,
        "trailOrienteering": agenda.TRAIL}
KIND = {"competition": "c", "training": "e", "education": "f"}
# the Länder's associations (a host whose code is one of them names the event's region)
LAND = {"WOLV": "Wien", "NOLV": "Niederösterreich", "BOLV": "Burgenland", "OÖ-OLV": "Oberösterreich", "SOLV": "Salzburg",
        "STOLV": "Steiermark", "KOLV": "Kärnten", "TOLV": "Tirol", "VOLV": "Vorarlberg"}


def read(http, today: date) -> list[dict]:
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out, page = [], 1
    while page < 10:
        a = http.get(API, params={"minDate": lo.isoformat(), "maxDate": hi.isoformat(), "perPage": "1000", "page": str(page)})
        if a.status != 200:
            break
        d = json.loads(a.content)
        for r in d.get("data") or []:
            kind = KIND.get(r.get("eventType"))
            if not kind or r.get("visibility") not in (None, "public") or not r.get("dateFrom"):
                continue                       # the federation's meetings, a club's own events
            hosts = r.get("hosts") or []
            land = next((LAND[h["code"]] for h in hosts if h.get("code") in LAND), None)
            club = next((h.get("name") for h in hosts if h.get("code") not in LAND and h.get("id", 0) < 10000), None)
            name = r.get("title") or r.get("shortTitle") or ""
            epr = agenda.fmt_of(name, r.get("slug")) or (agenda.RELAY if r.get("competitionType") == "relay" else "")
            out.append(agenda.event(
                "AT", r["id"], r["dateFrom"][:10], name, kind=kind, end=(r.get("dateTo") or "")[:10] or None,
                place=r.get("location") or None, region=land, org=club or (hosts[0].get("name") if hosts else None),
                spec=SPEC.get(r.get("sportType")) or agenda.spec_of(name), epr=epr,
                cancelled=r.get("status") == "canceled", src={"anne": r.get("url")} if r.get("url") else None))
        meta = d.get("meta") or {}
        if (meta.get("currentPage") or 1) >= (meta.get("lastPage") or 1):
            break
        page += 1
    return out


def place(e: dict) -> None:
    """The Land and the Bezirk of the event's place; the host's Land, when one hosts it, settles a name met in two."""
    agenda.locate("AT", e, expect=e.get("region"))


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"anne": "ANNE"},
                                                           place=place)

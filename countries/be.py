"""Belgium: the calendar of both Belgian federations, FRSO and Orienteering Vlaanderen, on O'Punch (www.opunch.org), the
platform they share for events and entries; its agenda only.

O'Punch's own JSON list (the one its map and calendar read; studied 2026-10-23): every coming event in one request, with
its dates, place, organising club, federation, terrain tags and entry window. A few Dutch and Luxembourg clubs use it
too: only the events held in Belgium are kept. The list also carries the clubs' contacts and bank details, never kept.
Past events are not in it: the agenda keeps the last weeks' from its own earlier runs.
"""
from __future__ import annotations

import json
import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="BE", federation="ABSO-BOSV", access="all", db=paths.DATA_DIR / "be.sqlite3",
                  time_zones=("Europe/Brussels",), lang="fr-BE,nl-BE;q=0.8,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://www.opunch.org/event/list/"
PAGE = "https://www.opunch.org/event/{}"
BELGIUM = 249                             # O'Punch's country id
# the organisations above the clubs: the two federations, and the national one with its own body
REGION = {1: "FRSO (Wallonie-Bruxelles)", 19: "Orienteering Vlaanderen"}
NATIONAL = {16, 17}
TRAINING = re.compile(r"\btraining|\bentra[iî]nement|\binitiation|\becole co\b|\bstage\b|\btest physique|\bformation", re.I)


def read(http, today: date, prev: dict | None) -> list[dict]:
    a = http.get(LIST)
    if a.status != 200:
        return []
    try:
        rows = json.loads(a.content).get("events") or []
    except ValueError:
        return []
    out = []
    for r in rows:
        where = r.get("address") or {}
        parent = r.get("parent_organization_id")
        if r.get("private") or not r.get("start_dt"):
            continue
        if where.get("country_id") not in (None, BELGIUM) or (not where.get("country_id") and parent not in {*REGION, *NATIONAL}):
            continue
        name = r.get("event_name") or ""
        tags = {t.get("name_en") for t in r.get("tags") or []}
        spec = agenda.MTBO if "MTB-O" in tags else agenda.spec_of(name)
        epr = agenda.fmt_of(name) or (agenda.NIGHT if "Night" in tags else agenda.SPRINT if "Urban" in tags else "")
        place = where.get("city") or where.get("common_name") or None
        url = PAGE.format(r["event_id"])
        out.append(agenda.event(
            "BE", r["event_id"], r["start_dt"][:10], name, kind="f" if re.search(r"\bformation", name, re.I) else
            "e" if TRAINING.search(name) else "c", end=(r.get("end_dt") or "")[:10] or None, place=place,
            region=REGION.get(parent), org=r.get("org_long_name") or r.get("organization_name") or None, spec=spec, epr=epr,
            site=r.get("org_website") or None,
            reg={"url": url, "close": r["reg_close_dt"][:10]} if r.get("reg_close_dt") else None, src={"opunch": url}))
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"opunch": "O'Punch"})

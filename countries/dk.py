"""Denmark: the Danish orienteering federation's calendar (DOF, do-f.dk « Stævnekalender »), its agenda only.

One server-rendered table of the coming races (studied 2026-10-23): one request a day — day, region (« kreds »: Nord,
Syd, Øst), name, place linked to the race's own site. Past races are not in it: the agenda keeps the last weeks' from
its own earlier runs. Discipline and format are read from the name.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="DK", federation="DOF", access="all", db=paths.DATA_DIR / "dk.sqlite3",
                  time_zones=("Europe/Copenhagen",), lang="da,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: the kommune from the place (countries/places, 2026-10-24)
PAGE = "https://do-f.dk/for-medlemmer/staevnekalender"
REGION = {"Nord": "Nordkredsen", "Syd": "Sydkredsen", "Øst": "Østkredsen"}


def read(http, today: date, prev: dict | None) -> list[dict]:
    from lxml import html as lh
    a = http.get(PAGE)
    if a.status != 200:
        return []
    doc = lh.fromstring(a.content)
    out = []
    for tr in doc.cssselect("#calendar-table tr"):
        tds = tr.cssselect("td")
        if len(tds) < 4:
            continue
        m = re.fullmatch(r"(\d\d)-(\d\d)-(\d{4})", tds[0].text_content().strip())
        if not m:
            continue
        day = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        kreds, name, place = (x.text_content().strip() for x in tds[1:4])
        link = tds[3].cssselect("a")
        site = link[0].get("href") if link and (link[0].get("href") or "").startswith("http") else None
        key = hashlib.sha1(f"{day}|{name}|{place}".encode()).hexdigest()[:10]
        out.append(agenda.event(
            "DK", key, day, name, place=place or None, region=REGION.get(kreds, kreds or None),
            epr=agenda.fmt_of(name) or ("Nuit" if re.search(r"\bnat", agenda.fold(name)) else ""), site=site,
            src={"dof": PAGE}))
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


# the regions (« regioner ») each district of DOF covers
KREDS_REGIONS = {"Nordkredsen": ("Region Nordjylland", "Region Midtjylland"),
                 "Sydkredsen": ("Region Syddanmark", "Region Midtjylland"),
                 "Østkredsen": ("Region Hovedstaden", "Region Sjælland")}


def place(e: dict) -> None:
    """The kommune of the event's place (`dep`) under the calendar's own district (« kreds »)."""
    agenda.locate("DK", e, keep_region=True, expect=KREDS_REGIONS.get(e.get("region") or ""))


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"dof": "DOF"},
                                                           place=place)

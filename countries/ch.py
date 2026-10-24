"""Switzerland: Swiss Orienteering's calendar (« Terminkalender », www.o-l.ch/cgi-bin/fixtures), its agenda only.

The calendar's CSV export, one per year (ISO-8859-1, « ; »): every national and regional race, foot, MTBO and ski-O, one
row per day, with its region (the regional associations' codes: ZH/SH, BE/SO, NWS…), club, place, website and entry
deadline. Two or three requests a day (studied 2026-10-23; its robots.txt allows /cgi-bin/fixtures).
"""
from __future__ import annotations

import csv
import io
import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="CH", federation="Swiss Orienteering", access="all", db=paths.DATA_DIR / "ch.sqlite3",
                  time_zones=("Europe/Zurich",), lang="de-CH,de;q=0.8,fr;q=0.6,en;q=0.4", results=False)
AGENDA_VERSION = 2                       # 2: the canton from the place (countries/places, 2026-10-24)
BASE = "https://www.o-l.ch/cgi-bin/fixtures"
SPEC = {"foot": agenda.FOOT, "bike": agenda.MTBO, "ski": agenda.SKI}
# the regional associations (the CSV's codes)
REGION = {"AG": "Aargau", "BE/SO": "Bern/Solothurn", "SR": "Suisse romande", "ZH/SH": "Zürich/Schaffhausen", "TI": "Ticino",
          "NOS": "Nordostschweiz", "NWS": "Nordwestschweiz", "GL/GR": "Glarus/Graubünden", "ZS": "Zentralschweiz"}


def read(http, today: date) -> list[dict]:
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        a = http.get(f"{BASE}?&year={year}&kind=-1&csv=1")
        if a.status != 200:
            continue
        for r in csv.DictReader(io.StringIO(a.content.decode("iso-8859-1")), delimiter=";"):
            if r.get("region") == "AUSL." or not r.get("date"):        # the Swiss runners' races abroad
                continue
            night = r.get("day_night") == "night"
            name = r.get("event_name") or ""
            epr = agenda.fmt_of(name) or (agenda.NIGHT if night else "")
            out.append(agenda.event(
                "CH", r["unique_id"], r["date"], name, place=r.get("location") or r.get("map") or None,
                region=REGION.get(r.get("region") or "", r.get("region") or None), org=r.get("club") or None,
                spec=SPEC.get(r.get("kind")) or agenda.spec_of(name), epr=epr, site=r.get("event_link") or None,
                reg={"url": r["event_link"], "close": r["deadline"]} if r.get("deadline") and r.get("event_link") else None,
                src={"solv": f"{BASE}?&mode=show&unique_id={r['unique_id']}"}))
    return out


def place(e: dict) -> None:
    """The canton of the event's place (`dep`, its two letters) under its regional association; the calendar's own
    association settles a name met in two cantons, and a place elsewhere counts only when it is plainly a town there.
    A canton's letters after the place, there or in the name, decide (« Cressier FR », « … Sprint Roveredo GR »)."""
    from countries import places
    of = places.dept_region("CH")
    place = e.get("place") or ""
    codes = "|".join(of)
    m = re.search(rf"\s({codes})$", place) or (re.search(rf"\b{re.escape(place.split()[0])}\s+({codes})\b", e.get("name") or "")
                                              if place.split() else None)
    if m:
        e["dep"], e["region"] = m.group(1), of[m.group(1)]
        return
    agenda.locate("CH", e, expect=e.get("region"))


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"solv": "o-l.ch"},
                                                           place=place)

"""Switzerland: Swiss Orienteering's calendar (« Terminkalender », www.o-l.ch/cgi-bin/fixtures), its agenda only.

The calendar's CSV export, one per year (ISO-8859-1, « ; »): every national and regional race, foot, MTBO and ski-O, one
row per day, with its region (the regional associations' codes: ZH/SH, BE/SO, NWS…), club, place, website and entry
deadline. Two or three requests a day (studied 2026-10-23; its robots.txt allows /cgi-bin/fixtures).
"""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="CH", federation="Swiss Orienteering", access="all", db=paths.DATA_DIR / "ch.sqlite3",
                  time_zones=("Europe/Zurich",), lang="de-CH,de;q=0.8,fr;q=0.6,en;q=0.4", results=False)
AGENDA_VERSION = 1
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


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"solv": "o-l.ch"})

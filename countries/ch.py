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
AGENDA_VERSION = 4                       # 2: the canton from the place (countries/places, 2026-10-24); 3: from the coordinates;
                                         # 4: the CSV's region always kept
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
                gps=wgs84(r.get("coord_x"), r.get("coord_y")),
                region=REGION.get(r.get("region") or "", r.get("region") or None), org=r.get("club") or None,
                spec=SPEC.get(r.get("kind")) or agenda.spec_of(name), epr=epr, site=r.get("event_link") or None,
                reg={"url": r["event_link"], "close": r["deadline"]} if r.get("deadline") and r.get("event_link") else None,
                src={"solv": f"{BASE}?&mode=show&unique_id={r['unique_id']}"}))
    return out


def wgs84(x: str | None, y: str | None) -> list[float] | None:
    """The calendar's Swiss grid coordinates (CH1903 / LV03 « 665750 ; 257950 », or LV95 with 2 000 000 and 1 000 000
    added) as [lat, lon], by swisstopo's approximate formulas (about a metre); None when missing or outside the grid."""
    try:
        e, n = float(x), float(y)
    except (TypeError, ValueError):
        return None
    if e > 2e6:
        e, n = e - 2e6, n - 1e6
    if not (480000 < e < 840000 and 70000 < n < 300000):
        return None
    yp, xp = (e - 600000) / 1e6, (n - 200000) / 1e6
    lon = 2.6779094 + 4.728982 * yp + 0.791484 * yp * xp + 0.1306 * yp * xp ** 2 - 0.0436 * yp ** 3
    lat = 16.9023892 + 3.238272 * xp - 0.270978 * yp ** 2 - 0.002528 * xp ** 2 - 0.0447 * yp ** 2 * xp - 0.0140 * xp ** 3
    return [round(lat * 100 / 36, 5), round(lon * 100 / 36, 5)]


def place(e: dict) -> None:
    """The canton of the event (`dep`, its two letters) under its regional association — the CSV's, always (an association
    races outside its cantons: Ticino's « Roveredo GR », Zentralschweiz's ski-O in Davos). First where the calendar puts
    it — its coordinates, read against the places around (`places.nearest`) —; else by name: a canton's letters after
    the place, there or in the name, decide (« Cressier FR », « … Sprint Roveredo GR »); else the place read, the
    calendar's own association settling a name met in two cantons, a place elsewhere counting only when it is plainly
    a town there."""
    region = e.get("region")
    _place(e)
    if region:                      # the calendar's own region (its « region » column) is kept whatever the canton
        e["region"] = region


def _place(e: dict) -> None:
    from countries import places
    if e.get("gps"):
        r, d = places.nearest("CH", *e["gps"])
        if d:
            e["region"], e["dep"] = r, d
            return
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

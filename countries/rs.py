"""Serbia: the Serbian orienteering federation's calendar (OSS, its ORIS — oris.orijentiring.rs), its agenda only.

The year's competitions, one server-rendered table (studied 2026-10-23): one request a day (two across the new year) —
date, number of days, name, place, organising club, distances (SP sprint, SR middle, D long…) and ranking. The entry
lists it links name the runners: never read.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="RS", federation="OSS", access="all", db=paths.DATA_DIR / "rs.sqlite3",
                  time_zones=("Europe/Belgrade",), lang="sr-Latn,sr;q=0.8,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
BASE = "http://oris.orijentiring.rs/"
FMT = {"SP": agenda.SPRINT, "SR": agenda.MIDDLE, "D": agenda.LONG, "ŠT": agenda.RELAY, "ST": agenda.RELAY,
       "N": agenda.NIGHT, "NOĆ": agenda.NIGHT}


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        a = http.get(f"{BASE}takmicenja.php", params={"godina": str(year)})
        if a.status != 200:
            continue
        for tr in lh.fromstring(a.content).cssselect("table.tak tr"):
            tds = tr.cssselect("td")
            if len(tds) < 7:
                continue
            m = re.fullmatch(r"(\d\d)\.(\d\d)\.(\d{4})", tds[0].text_content().strip())
            if not m or int(m.group(3)) != year:            # (a year not published yet answers with the current one)
                continue
            day = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            name, place, org, dist, ndays, rank = (x.text_content().strip() for x in tds[1:7])
            link = tds[1].cssselect("a")
            rid = re.search(r"id=(\d+)", link[0].get("href") or "") if link else None
            key = f"{year}-{rid.group(1)}" if rid else hashlib.sha1(f"{day}|{name}".encode()).hexdigest()[:10]
            codes = [c.strip().upper() for c in dist.split(",") if c.strip()]
            n = int(ndays) if ndays.isdigit() else 1
            out.append(agenda.event(
                "RS", key, day.isoformat(), name, end=(day + timedelta(days=n - 1)).isoformat() if n > 1 else None,
                place=place or None, org=org or None, spec=agenda.MTBO if "MOB" in codes else None,
                epr=agenda.RELAY if agenda.fmt_of(name) == agenda.RELAY else next((FMT[c] for c in codes if c in FMT), "")
                or agenda.fmt_of(name), level=rank or None,
                src={"oss": f"{BASE}takmicenja.php?godina={year}"}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"oss": "ORIS (OSS)"})

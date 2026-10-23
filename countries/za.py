"""South Africa: the South African Orienteering Federation's calendar (SAOF, www.orienteering.co.za/<year>-events/), its
agenda only.

One page a year, a table the federation keeps by hand (studied 2026-10-23): a month's heading row, then one row an
event — day, club, venue, area, type/distance, series, the event sheet and the entry link. One or two requests a day.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="ZA", federation="SAOF", access="all", db=paths.DATA_DIR / "za.sqlite3",
                  time_zones=("Africa/Johannesburg",), lang="en-ZA,en;q=0.8", results=False)
AGENDA_VERSION = 1
PAGE = "https://www.orienteering.co.za/{}-events/"
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
          "december"]
OFF = re.compile(r"\b(postponed|cancel+ed)\b", re.I)


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        url = PAGE.format(year)
        a = http.get(url)
        if a.status != 200:
            continue
        month = None
        for tr in lh.fromstring(a.content).cssselect("table.tablepress tbody tr"):
            cells = [re.sub(r"\s+", " ", td.text_content()).strip() for td in tr.cssselect("td")]
            if len(cells) < 7:
                continue
            if cells[0].lower() in MONTHS:
                month = MONTHS.index(cells[0].lower()) + 1
                continue
            days = re.findall(r"\d{1,2}", cells[0])
            if not month or not days:
                continue
            try:
                start = date(year, month, int(days[0]))
                end = date(year, month, int(days[-1])) if len(days) > 1 else None
            except ValueError:
                continue
            club, venue, area, typ, log = cells[2:7]
            name = f"{log} — {venue}" if log and venue else venue or log
            if not name:
                continue
            links = {a_.text_content().strip().lower(): a_.get("href") for a_ in tr.cssselect("a[href]")}
            sheet = next((v for k, v in links.items() if "sheet" in k or "details" in k), None)
            entry = tr.cssselect("td")[8].cssselect("a[href]") if len(tr.cssselect("td")) > 8 else []
            text = " ".join(cells)
            out.append(agenda.event(
                "ZA", hashlib.sha1(f"{start}|{club}|{venue}".encode()).hexdigest()[:10], start.isoformat(), name,
                end=end.isoformat() if end and end > start else None, place=", ".join(x for x in (venue, area) if x) or None,
                org=club or None, spec=agenda.spec_of(typ, name),
                epr=agenda.fmt_of(typ, name) or (agenda.NIGHT if "night" in typ.lower() else ""), level=log or None,
                cancelled=bool(OFF.search(text)), invitation=sheet,
                reg={"url": entry[0].get("href")} if entry else None, src={"saof": url}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"saof": "SAOF"})

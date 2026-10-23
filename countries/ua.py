"""Ukraine: the Ukrainian orienteering federation's calendar (FSOU, events.orienteering.org.ua), its agenda only.

The calendar's month view, the form the page itself posts (studied 2026-10-23): one request a month of the window —
dates, name, region (the oblast), organiser. Its entry and result buttons are forms too: the event's link is the
calendar. Discipline and format from the name (« бігом », « велоорієнтування »…). Its register of athletes is never read.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="UA", federation="FSOU", access="all", db=paths.DATA_DIR / "ua.sqlite3",
                  time_zones=("Europe/Kyiv",), lang="uk,en;q=0.5", results=False)
AGENDA_VERSION = 1
PAGE = "https://events.orienteering.org.ua/index.php"
OFF = re.compile(r"\s*(ЗМАГАННЯ\s+)?(ПЕРЕНЕСЕН\w*|СКАСОВАН\w*|ВІДМІНЕН\w*)\b.*$", re.I)
INTERNATIONAL = re.compile(r"^\s*міжнародн", re.I)


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out, m = [], date(lo.year, lo.month, 1)
    while m <= hi:
        a = http.post(PAGE, data={"lanq": "1", "vid": "0", "tip": "9", "reg": "", "god": str(m.year), "mes": str(m.month)})
        y, mo = m.year, m.month
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
        if a.status != 200:
            continue
        try:
            text = a.content.decode("utf-8")
        except UnicodeDecodeError:
            text = a.content.decode("cp1251", "replace")
        for tr in lh.fromstring(text).cssselect("tr"):
            tds = tr.cssselect("td")
            ide = tr.cssselect("input[name=ide]")
            if len(tds) < 4 or not ide or not (ide[0].get("value") or "").isdigit():
                continue
            when = tds[0].text_content().strip()
            if not re.fullmatch(r"\d\d-\d\d(?:\s*\d\d-\d\d)?", when):     # (the page's own layout rows)
                continue
            days = re.findall(r"(\d\d)-(\d\d)", when)
            try:
                start = date(y, int(days[0][1]), int(days[0][0]))
                end = date(y, int(days[-1][1]), int(days[-1][0])) if len(days) > 1 else None
            except ValueError:
                continue
            if end and end < start:
                end = end.replace(year=y + 1)
            if start.month != mo:                # (a month's view also shows the events running into it)
                continue
            name = re.sub(r"\s+", " ", tds[1].text_content()).strip()
            cancelled = bool(OFF.search(name))
            name = OFF.sub("", name).strip(" -–,") or name
            org_lines = [x.strip() for x in tds[3].itertext() if x.strip()]
            out.append(agenda.event(
                "UA", ide[0].get("value"), start.isoformat(), name, end=end.isoformat() if end and end != start else None,
                region=tds[2].text_content().strip() or None,
                org=next((x for x in org_lines if not re.search(r"суддя|секретар", x, re.I)), None),
                spec="Rogaining" if re.search(r"рогейн", name, re.I) else None, cancelled=cancelled,
                level="Міжнародні" if INTERNATIONAL.search(name) else None, src={"fsou": "https://events.orienteering.org.ua/"}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"fsou": "FSOU"})

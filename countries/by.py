"""Belarus: the Belarusian orienteering federation's calendar (orient.by), its agenda only.

The year's competitions, one server-rendered table (studied 2026-10-23): one request a published year — dates, category
(A-D), name, region (the oblast; « Общереспубликанские » national), place. Discipline and format from the name. The rows
held for a whole season (« 01.01-31.12 », a championship whose date is not set) are left out.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="BY", federation="BFO", access="all", db=paths.DATA_DIR / "by.sqlite3",
                  time_zones=("Europe/Minsk",), lang="ru,be;q=0.8,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: oblast and raion from the place (countries/places, 2026-10-24)
BASE = "https://orient.by"
SPAN = re.compile(r"(\d\d)\.(\d\d)(?:\.(\d{4}))?(?:-(\d\d)\.(\d\d)(?:\.(\d{4}))?)?")
MAX_DAYS = 31                            # longer: a placeholder for the season


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out, published = [], None
    for year in range(lo.year, hi.year + 1):
        if published is not None and str(year) not in published:
            continue                             # (a year not published answers with every year's rows)
        a = http.get(f"{BASE}/competitions/{year}/")
        if a.status != 200:
            continue
        page = a.text()
        if published is None:
            published = set(re.findall(r'href="/competitions/(\d{4})/"', page)) | {str(year)}
        for tr in lh.fromstring(a.content).cssselect("table.ramka tr"):
            tds = tr.cssselect("td")
            link = tr.cssselect("a[href*='/competitions/']")
            if len(tds) < 5 or not link:
                continue
            m = SPAN.fullmatch(tds[0].text_content().strip())
            if not m:
                continue
            try:
                start = date(int(m.group(3) or year), int(m.group(2)), int(m.group(1)))
                end = date(int(m.group(6) or year), int(m.group(5)), int(m.group(4))) if m.group(4) else None
            except ValueError:
                continue
            if end and end < start:
                end = end.replace(year=end.year + 1)
            if end and (end - start).days > MAX_DAYS:
                continue
            href = link[0].get("href")
            eid = re.search(r"/(\d+)-", href)
            name = link[0].text_content().strip()
            cancelled = bool(re.match(r"отмен", name, re.I))
            name = re.sub(r"^отмена\W*", "", name, flags=re.I)
            cat, region, place = (x.text_content().strip() for x in (tds[1], tds[3], tds[4]))
            region = region.split(",")[0].strip()
            scope = None
            if region and not re.search(r"област|^г\. ?Минск|^Минск", region, re.I):
                scope, region = region, None         # « Общереспубликанские », « Международные »: the calendar, not a place
            out.append(agenda.event(
                "BY", eid.group(1) if eid else href.strip("/").split("/")[-1][:20], start.isoformat(), name,
                end=end.isoformat() if end and end != start else None,
                place=None if place in ("", "по назначению") else place, region=region or None, cancelled=cancelled,
                spec="Rogaining" if re.search(r"рогейн", name, re.I) else None,
                level=" · ".join(x for x in (f"Категория {cat}" if cat else None, scope) if x) or None,
                src={"orient": BASE + href}))
    return out


def place(e: dict) -> None:
    """The oblast and the raion of the event's place (« Лидский район », « г. Полоцк »); else the oblast the calendar
    gives."""
    region = e.get("region")
    agenda.locate("BY", e, expect=region)
    if not e.get("region") and region:
        e["region"] = region


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"orient": "orient.by"},
                                                           place=place)

"""Bulgaria: the Bulgarian orienteering federation's events (BFO, www.bgof.org — its entry system), its agenda only.

The year's list, server-rendered (studied 2026-10-23): one request a year of the window — date, name, organisers (the
federation, then the clubs) and entry deadline, with the announcement. No place; discipline and format from the name.
The entry lists it links name the runners: never read.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="BG", federation="BFO", access="all", db=paths.DATA_DIR / "bg.sqlite3",
                  time_zones=("Europe/Sofia",), lang="bg,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: the oblast a name or a club names (countries/places, 2026-10-24)
BASE = "https://www.bgof.org/"
FEDERATION = "БФО"


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        a = http.get(BASE, params={"PFlt[Year]": str(year)})
        if a.status != 200:
            continue
        for tr in lh.fromstring(a.content).cssselect("tr.event-header"):
            tds = tr.cssselect("td")
            title = tr.cssselect("td.event-title")
            if len(tds) < 3 or not title:
                continue
            m = re.fullmatch(r"(\d\d)\.(\d\d)\.(\d{4})", tds[0].text_content().strip())
            ev = re.search(r"subpage\('info',\s*'(\d+)'\)", lh.tostring(title[0], encoding="unicode"))
            if not m or not ev:
                continue
            day = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
            b = title[0].cssselect("b")
            name = (b[0] if b else title[0]).text_content().strip()
            org_cell = title[0].getnext()
            orgs = [x.strip() for x in (org_cell.itertext() if org_cell is not None else []) if x.strip()]
            clubs = [x for x in orgs if x != FEDERATION]
            close = re.search(r"(\d\d)\.(\d\d)\.(\d{4})", tds[-1].text_content())
            nxt = tr.getnext()
            invite = None
            if nxt is not None and "event-header" not in (nxt.get("class") or ""):
                pdf = [x.get("href") for x in nxt.cssselect("a[href]") if (x.get("href") or "").lower().endswith(".pdf")
                       and "покана" in x.text_content().lower()]                   # the invitation, not the results
                invite = BASE + re.sub(r"^\.\./", "", pdf[0]).lstrip("/") if pdf else None
            page = f"{BASE}?act=info&idEvent={ev.group(1)}"
            out.append(agenda.event(
                "BG", ev.group(1), day, name, org=", ".join(clubs) or FEDERATION, invitation=invite,
                reg={"url": page, "close": f"{close.group(3)}-{close.group(2)}-{close.group(1)}"} if close else None,
                src={"bfo": page}))
    return out


def place(e: dict) -> None:
    """The oblast of the town a name gives (« Купа Троян »): the list gives no place. (Not the clubs' names: « Рила »,
    « Компас » are villages too.)"""
    e.pop("dep", None)
    e["region"] = None
    agenda.locate("BG", e, e.get("name"), region_only=True)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"bfo": "BFO"},
                                                           place=place)

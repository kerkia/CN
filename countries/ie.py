"""Ireland: Orienteering Ireland's fixtures (orienteering.ie/fixtures), its agenda only.

One server-rendered table of the coming fixtures (studied 2026-10-23): one request a day — a month heading, then each
fixture's day, venue (its page, which is also its entry form), county, league, event type (« Night Orienteering »,
« Come and Try It »), organising club and its site. Past fixtures are not in it: the agenda keeps the last weeks' from
its own earlier runs. Closed events (a club's own) are left out. Northern Ireland's events are British Orienteering's
(NIOA), on Great Britain's agenda.
"""
from __future__ import annotations

import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="IE", federation="Orienteering Ireland", access="all", db=paths.DATA_DIR / "ie.sqlite3",
                  time_zones=("Europe/Dublin",), lang="en", results=False)
AGENDA_VERSION = 1
PAGE = "https://www.orienteering.ie/fixtures/"
MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"), 1)}


def read(http, today: date, prev: dict | None) -> list[dict]:
    from lxml import html as lh
    a = http.get(PAGE)
    if a.status != 200:
        return []
    out, month = [], None
    for tr in lh.fromstring(a.content.decode("utf-8", "replace")).cssselect("table.oie-fixtures-table tr"):
        head = re.fullmatch(r"([A-Za-z]+) (\d{4})", tr.text_content().strip())
        if head and head.group(1).lower() in MONTHS:
            month = (int(head.group(2)), MONTHS[head.group(1).lower()])
            continue
        tds = tr.cssselect("td")
        if not month or len(tds) < 6 or "fixture-closed-event" in (tr.get("class") or ""):
            continue
        try:
            day = date(month[0], month[1], int(tds[0].text_content().strip()))
        except ValueError:
            continue
        venue = tds[1].cssselect("a")
        if not venue:
            continue
        name = re.sub(r"\s+", " ", venue[0].text_content()).strip()
        if name.isupper():
            name = name.title()
        league, kind_ = (re.sub(r"\s+", " ", x.text_content()).strip() for x in tds[3:5])
        if agenda.fold(name) in ("tbc", "tba"):                  # (no venue yet)
            name = league or name.upper()
        club = tds[5].cssselect("a")
        url = venue[0].get("href")
        rogaine = bool(re.search(r"rogain", f"{league} {name}", re.I))
        out.append(agenda.event(
            "IE", url.rstrip("/").rsplit("/", 1)[-1], day.isoformat(), name, region=tds[2].text_content().strip() or None,
            org=club[0].text_content().strip() if club else (tds[5].text_content().strip() or None),
            spec="Rogaining" if rogaine else None,
            epr="" if rogaine else agenda.fmt_of(kind_, name), level=" · ".join(x for x in (league, kind_) if x) or None,
            reg={"url": url}, src={"oi": url}))
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION,
                                                           sources={"oi": "Orienteering Ireland"})

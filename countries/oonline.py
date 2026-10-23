"""OrienteeringOnline.net, the entry platform of the Balkans and the Caucasus: the agenda of a country whose federation
publishes no calendar of its own that Ozimut can read (Croatia's is a PDF, North Macedonia's and Georgia's none).

Its competition search (studied 2026-10-23), the form the page itself posts: one GET for the form's state, then a POST
with the country and a window of dates — date, name, the number of entries, the competition's page. The list shows
30 rows at most: a window that fills it is cut in two. Each competition's page gives its last day, organiser, place,
website and entry deadline (an e-mail too, never kept): read once, when the competition is first seen. Only the
competitions taking entries there are listed: a part of each country's calendar.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone

from countries import agenda

BASE = "https://www.orienteeringonline.net/"
SEARCH = BASE + "CompetitionSearch.aspx"
EVENT = BASE + "CompetitionBasicInfo.aspx?CompetitionID={}"
F = "ctl00$ctl00$PH_Main$PH_Lg$"
ROWS = 30                                           # (the list's page)
OFF = re.compile(r"\s*[-–]?\s*\b(otkazano|odgođeno|cancell?ed|postponed)\b(?:\s*/\s*\w+)?", re.I)
TRAINING = re.compile(r"\b(training|trening|camp|kamp)\b", re.I)


def _form(content: bytes) -> dict:
    from lxml import html as lh
    doc = lh.fromstring(content.decode("utf-8", "replace"))
    return {i.get("name"): i.get("value") or "" for i in doc.cssselect("input")
            if i.get("name") and (i.get("type") or "text") in ("hidden", "text")}


def _ms(d: date) -> str:
    return str(int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000))


def search(http, country: int, lo: date, hi: date, state: dict, depth: int = 0) -> list[dict]:
    """The competitions of a country between two days: [{id, date, name, entries}]. `state`: the form's fields, kept
    from one answer to the next (ASP.NET's view state)."""
    from lxml import html as lh
    form = dict(state)
    form.update({"ctl00_ctl00_PH_Main_PH_Lg_CountryComboBox_VI": str(country),
                 F + "FromDateEdit": lo.strftime("%d.%m.%Y"), F + "ToDateEdit": hi.strftime("%d.%m.%Y"),
                 # (the date pickers' own state: without it the search starts today)
                 F + "FromDateEdit$State": json.dumps({"rawValue": _ms(lo)}),
                 F + "ToDateEdit$State": json.dumps({"rawValue": _ms(hi)}), F + "SearchButton": "Search"})
    a = http.post(SEARCH, data=form)
    if a.status != 200:
        return []
    state.update(_form(a.content))
    out = []
    for link in lh.fromstring(a.content.decode("utf-8", "replace")).cssselect('a[href*="CompetitionBasicInfo.aspx?CompetitionID="]'):
        tr = next((p for p in link.iterancestors("tr")), None)
        cells = [re.sub(r"\s+", " ", td.text_content()).strip() for td in tr.cssselect("td")] if tr is not None else []
        d = re.fullmatch(r"(\d\d)\.(\d\d)\.(\d{4})", cells[0]) if cells else None
        cid = re.search(r"CompetitionID=(\d+)", link.get("href") or "")
        if d and cid:
            out.append({"id": cid.group(1), "date": f"{d.group(3)}-{d.group(2)}-{d.group(1)}",
                        "name": link.text_content().strip() or cells[3],
                        "entries": int(cells[-1]) if cells[-1].isdigit() else None})
    if len(out) >= ROWS and depth < 5 and hi > lo:           # (a full page: the rest is on the next one)
        mid = lo + (hi - lo) / 2
        return search(http, country, lo, mid, state, depth + 1) + search(http, country, mid + timedelta(days=1), hi, state, depth + 1)
    return out


def info(http, cid: str) -> dict:
    """A competition's page: its labelled fields ({"Start date": "07.11.2026", "Organizer": …, "Competition website": …})."""
    from lxml import html as lh
    a = http.get(EVENT.format(cid))
    if a.status != 200:
        return {}
    out = {}
    for item in lh.fromstring(a.content.decode("utf-8", "replace")).cssselect(".new-basic-info-read-item"):
        k, v = item.cssselect("span"), item.cssselect("strong")
        if k and v:
            href = v[0].cssselect("a")
            out[k[0].text_content().strip()] = (v[0].text_content().strip(), href[0].get("href") if href else None)
    return out


def _day(s: str | None) -> str | None:
    d = re.findall(r"(\d\d)\.(\d\d)\.(\d{4})", s or "")
    return f"{d[-1][2]}-{d[-1][1]}-{d[-1][0]}" if d else None


def read_country(cc: str, country: int, http, today: date, prev: dict | None) -> list[dict]:
    """A country's agenda from the platform: the window's competitions, each one's page read when first seen."""
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    a = http.get(SEARCH)
    if a.status != 200:
        return []
    known = {e["id"]: e for e in (prev or {}).get("events", [])}
    out = []
    for c in search(http, country, lo, hi, _form(a.content)):
        old = known.get(f"{cc.lower()}{c['id']}")
        if old and old.get("date") == c["date"]:         # (its page read on an earlier day)
            end, place, org, site = (old.get(k) for k in ("end", "place", "org", "site"))
            close, entries = (old.get("reg") or {}).get("close"), bool(old.get("reg"))
        else:
            page = info(http, c["id"])
            got = {k: v for k, (v, _) in page.items()}
            end, close = _day(got.get("End date")), _day(got.get("Entry dates"))
            place, org = got.get("Location (city, area, ...)") or None, got.get("Organizer") or None
            site = page.get("Competition website", (None, None))
            site = next((u for u in (site[1], site[0]) if u and u.startswith("http")), None)
            entries = got.get("Use our online entries system", "Yes") != "No"
        name = c["name"]
        cancelled = bool(OFF.search(name))
        name = OFF.sub("", name).strip(" -–") or name
        url = EVENT.format(c["id"])
        reg = {k: v for k, v in (("url", url), ("close", close), ("count", c["entries"])) if v is not None}
        out.append(agenda.event(
            cc, c["id"], c["date"], name, kind="e" if TRAINING.search(name) else "c", end=end, place=place, org=org,
            site=site, cancelled=cancelled, reg=reg if entries else None, src={"oo": url}))
    return out


SOURCES = {"oo": "OrienteeringOnline"}

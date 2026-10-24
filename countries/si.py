"""Slovenia: the Slovenian orienteering federation's calendar (OZS, orientacijska-zveza.si « Koledar »), its agenda only.

The calendar's year page (studied 2026-10-23): one server-rendered list a year, past races included — the discipline's
icon (« ot » foot, « mtb-o », « ski-o », « pre-o », « drugo » other; « _1 » the national league, « _2 » a national
championship), the name with its format after the last dash (« ZL 7 – srednja »), the day and place
(« sobota, 17. 1. 2026, Črni Les »), the organising club, the invitation and the entries (OrienteeringOnline).
« Drugo » events (orienteering walks, festivals) are not races: left out. « ODPOVEDANO » cancelled, « PRESTAVLJENO »
postponed (its date no longer holds): both shown struck through.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import urljoin

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="SI", federation="OZS", access="all", db=paths.DATA_DIR / "si.sqlite3",
                  time_zones=("Europe/Ljubljana",), lang="sl,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
BASE = "https://www.orientacijska-zveza.si"
SPEC = {"ot": agenda.FOOT, "mtb-o": agenda.MTBO, "ski-o": agenda.SKI, "pre-o": agenda.TRAIL}
LEVEL = {"1": "Slovenska liga", "2": "Državno prvenstvo"}
OFF = re.compile(r"\s*\b(odpovedano|prestavljeno)\b!?", re.I)
# a place abroad (the calendar lists the region's races its runners go to)
SUFFIX = re.compile(r"\s+–\s+(srednja|dolga|ultra dolga|sprint|štafeta|tempo|preo|nočna)$", re.I)
ABROAD = re.compile(r"\b(hrva[sš]ka|italija|avstrija|madžarska|hun|ita|cro|aut)\s*$", re.I)


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        page = f"{BASE}/koledar/?leto={year}&tip=0&panoga=0&rez=0&prikaz=0"
        a = http.get(page)
        if a.status != 200:
            continue
        for tr in lh.fromstring(a.content.decode("utf-8", "replace")).cssselect("tr.razpis"):
            icon = tr.cssselect("td.koledar_image img")
            m = re.search(r"pict_([a-z-]+?)(?:_(\d))?\.png", icon[0].get("src") or "") if icon else None
            spec = SPEC.get(m.group(1)) if m else None
            h2, line = tr.cssselect("h2"), tr.cssselect(".ozs-koledar-date-line")
            if not spec or not h2 or not line:
                continue
            d = re.search(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}),?\s*(.*)", line[0].text_content().replace("\xa0", " "))
            if not d:
                continue
            try:
                day = date(int(d.group(3)), int(d.group(2)), int(d.group(1)))
            except ValueError:
                continue
            name = re.sub(r"\s+", " ", h2[0].text_content()).strip()
            place = d.group(4).strip(" ,") or None
            cancelled = bool(OFF.search(name) or OFF.search(place or ""))
            name = re.sub(r"(\s*–)+", " –", OFF.sub("", name)).strip(" –-") or name
            if place and OFF.fullmatch(place):
                place = None
            if (place and ABROAD.search(place)) or re.search(r"– drugo$", name):
                continue
            epr = agenda.fmt_of(name)
            name = SUFFIX.sub("", name) or name           # (the format, shown apart)
            if re.search(r"rogain", agenda.fold(name)):
                spec, epr = "Rogaining", ""
            club = tr.cssselect(".ozs-koledar-club-line a")
            links = {}
            for x in tr.cssselect(".ozs-koledar-actions a"):
                img = x.cssselect("img")
                links[(img[0].get("alt") if img else "") or ""] = urljoin(BASE, x.get("href") or "")
            cid = re.search(r"cid=(\d+)", links.get("Razpis", "") + " " + (tr.cssselect("td.koledar_image")[0].get("onclick") or ""))
            key = cid.group(1) if cid else f"{day.isoformat()}-{agenda.fold(name)[:40]}"
            invitation = links.get("Razpis")
            out.append(agenda.event(
                "SI", key, day.isoformat(), name, place=place, org=club[0].text_content().strip() if club else None,
                spec=spec, epr=epr,
                level=LEVEL.get(m.group(2) or ""), cancelled=cancelled,
                reg={"url": links["Prijave"]} if links.get("Prijave") else None,
                invitation=invitation if invitation and "/razpis?" not in invitation else None,
                src={"ozs": f"{BASE}/razpis?cid={cid.group(1)}" if cid else page}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"ozs": "OZS"})

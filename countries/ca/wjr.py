"""WhyJustRun (whyjustrun.ca): the club platform about twenty Canadian clubs use (studied 2026-11-11; its robots.txt allows
everything). Its open API (github.com/WhyJustRun/Core/wiki/API):
- the organisations, IOF XML 3.0 (`/iof/3.0/organization_list.xml`): every club with its parent (a province's association,
  Orienteering Canada, Orienteering USA…);
- the events, FullCalendar JSON (`/events.json?start=&end=`, Unix times): id, name, start, end, its classification (Local,
  Club, Regional, National, International, Championship), position, club, page;
- each event's results, IOF XML 3.0 (`/iof/3.0/events/<id>/result_list.xml`): a person's WhyJustRun id with each result —
  the same runner in every club's results. Few events carry results there since about 2020 (GVOC, KOC, ONB, Stars): the
  others link theirs (WinSplits Online, the club's own files) from the event's page.
The platform is no longer maintained (its home page, 2026-11-11).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

BASE = "https://whyjustrun.ca"
NS = {"i": "http://www.orienteering.org/datastandard/3.0"}
CANADA = "76"                 # Orienteering Canada's id there

# the provinces' associations (WhyJustRun's « NationalRegion » ids) and a few clubs whose parent says nothing of their
# province (Orienteering Ottawa's parent is Orienteering Quebec — it is affiliated with both —, PEI's is Canada itself)
REGION_OF_ORG = {"40": "Yukon", "41": "British Columbia", "47": "Alberta", "53": "Manitoba", "54": "Ontario", "63": "Québec",
                 "65": "New Brunswick", "69": "Nova Scotia", "152": "Saskatchewan"}
REGION_OF_CLUB = {"OOC": "Ontario", "PEI": "Prince Edward Island", "HPP": None}
# words naming a part of Quebec on Orienteering Ottawa's events (Gatineau Park, the Outaouais)
QUEBEC_SIDE = re.compile(r"\b(gatineau|chelsea|wakefield|la p[eê]che|denholm|aylmer|cantley|val-des-monts|pontiac|qu[eé]bec|qc)\b",
                         re.I)


def organisations(http) -> dict[str, dict]:
    """{id: {short, name, parent}} of every organisation WhyJustRun lists."""
    a = http.get(f"{BASE}/iof/3.0/organization_list.xml")
    if a.status != 200:
        return {}
    root = ET.fromstring(a.content)
    out = {}
    for o in root.findall("i:Organisation", NS):
        oid = (o.findtext("i:Id", "", NS) or "").strip()
        out[oid] = {"short": (o.findtext("i:ShortName", "", NS) or "").strip(), "name": (o.findtext("i:Name", "", NS) or "").strip(),
                    "parent": (o.findtext("i:ParentOrganisationId", "", NS) or "").strip(), "type": o.findtext("i:Type", "", NS)}
    return out


def canadian(orgs: dict[str, dict], oid: str) -> bool:
    seen = set()
    while oid and oid not in seen:
        if oid == CANADA:
            return True
        seen.add(oid)
        oid = (orgs.get(oid) or {}).get("parent", "")
    return False


def region_of(orgs: dict[str, dict], oid: str) -> str | None:
    o = orgs.get(oid) or {}
    if o.get("short") in REGION_OF_CLUB:
        return REGION_OF_CLUB[o["short"]]
    seen = set()
    while oid and oid not in seen:
        if oid in REGION_OF_ORG:
            return REGION_OF_ORG[oid]
        seen.add(oid)
        oid = (orgs.get(oid) or {}).get("parent", "")
    return None


def events(http, lo: date, hi: date) -> list[dict]:
    """WhyJustRun's events between two days (every club's)."""
    ts = lambda d: int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
    a = http.get(f"{BASE}/events.json", params={"start": ts(lo), "end": ts(hi)})
    if a.status != 200:
        return []
    import json
    try:
        return json.loads(a.content.decode("utf-8", "replace"))
    except ValueError:
        return []


def result_list_url(event_id) -> str:
    return f"{BASE}/iof/3.0/events/{event_id}/result_list.xml"


def event_id(url: str) -> str | None:
    m = re.search(r"/events/view/(\d+)", url or "", re.I)
    return m.group(1) if m else None


WS_ID = re.compile(r"winsplits[^\"']*?[?&]databaseId=(\d+)", re.I)


def result_links(http, page_url: str) -> dict:
    """What an event's page links its results to: WinSplits Online's database id, the club's own results files (HTML,
    PDF)."""
    a = http.get(page_url)
    if a.status != 200:
        return {}
    text = a.content.decode("utf-8", "replace")
    out: dict = {}
    m = WS_ID.search(text)
    if m:
        out["winsplits"] = m.group(1)
    files = [h for h in re.findall(r'href="(https?://[^"]+)"', text)
             if re.search(r"result", h, re.I) and re.search(r"\.(html?|pdf|xml)(\?|$)", h, re.I)
             and "whyjustrun.ca/iof/" not in h]
    if files:
        out["file"] = sorted(set(files))[:4]
    return out

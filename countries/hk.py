"""Hong Kong: the Orienteering Association of Hong Kong's calendar (OAHK, www.oahk.org.hk), its agenda only.

The public Google Calendar the association's site shows (studied 2026-10-23; OAHK keeps it beside Eventor World, which
answers robots with a challenge): one iCalendar request a day — the ranking league, the championships and the open
events, with their venue and entry link in the description. The format is in the title (« Sprint », « Middle/Long »).
"""
from __future__ import annotations

import re
from datetime import date

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="HK", federation="OAHK", access="all", db=paths.DATA_DIR / "hk.sqlite3",
                  time_zones=("Asia/Hong_Kong",), lang="zh-HK,en;q=0.8", results=False)
AGENDA_VERSION = 2                       # 2: area and district from the venue (countries/places, 2026-10-24)
ICS = ("https://calendar.google.com/calendar/ical/c_ersqpfme3gnrqgptnsu3qe66lo%40group.calendar.google.com/"
       "public/basic.ics")
SITE = "https://www.oahk.org.hk/"
TBA = {"待定", "將於稍後公佈"}                 # « to be decided », « to be announced »


def _field(desc: str, label: str) -> str | None:
    """A line of the description, « 賽事地點：… » (its HTML taken out)."""
    m = re.search(rf"{label}\s*[:：]\s*([^<\n]*?)(?=<|\n|$|賽事資訊|報名連結|封場範圍)", desc or "", re.I)
    v = m.group(1).replace("\xa0", " ").strip() if m else ""
    return None if not v or v in TBA else v


def _link(desc: str, label: str) -> str | None:
    m = re.search(rf"{label}\s*[:：]\s*(?:<a[^>]*href=\"([^\"]+)\"|(https?://[^\s<]+))", desc or "", re.I)
    return (m.group(1) or m.group(2)) if m else None


def read(http, today: date) -> list[dict]:
    a = http.get(ICS)
    if a.status != 200:
        return []
    out = []
    for e in agenda.ics(a.text()):
        if (e.get("status") or "").upper() == "CANCELLED":
            continue
        name = re.sub(r"\s+", " ", e["summary"])
        desc = e.get("description") or ""
        entry = _link(desc, "報名連結")
        out.append(agenda.event(
            "HK", re.sub(r"@.*", "", e.get("uid") or name)[:16], e["start"], name, end=e.get("end"),
            place=e.get("location") or _field(desc, "賽事地點"), org="OAHK",
            invitation=_link(desc, "賽事資訊"), reg={"url": entry} if entry else None,
            src={"oahk": SITE}))
    return out


def place(e: dict) -> None:
    """The area and the district of the event's venue, else of a place its name gives (« 大埔海濱公園 »)."""
    agenda.locate("HK", e, e.get("place"), e.get("name"))


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"oahk": "OAHK"},
                                                           place=place)

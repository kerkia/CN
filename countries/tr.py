"""Türkiye: the Turkish orienteering federation's calendar (TOF, www.oryantiring.org.tr), its agenda only.

Its home page draws the calendar from a JSON list written into the page (FullCalendar's `events`; studied 2026-10-23):
one request a day, every season since 2021 — foot, MTBO, ski-O and trail-O, with dates, province and organiser. The IOF's
and the Balkan association's championships it also lists are held abroad: left out.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="TR", federation="TOF", access="all", db=paths.DATA_DIR / "tr.sqlite3",
                  time_zones=("Europe/Istanbul",), lang="tr,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
PAGE = "https://www.oryantiring.org.tr/"
SPEC = {"running": agenda.FOOT, "biking": agenda.MTBO, "skiing": agenda.SKI, "walking": agenda.TRAIL}
ABROAD_ORG = {"IOF", "SEEOA"}
LOCAL = ZoneInfo("Europe/Istanbul")
# the formats in Turkish (« Uzun Mesafe - Orta Mesafe - Sürat »)
FMT = [(agenda.RELAY, r"\bbayrak\b"), (agenda.NIGHT, r"\bgece\b"), (agenda.SPRINT, r"\bsurat\b|\bsprint\b"),
       (agenda.MIDDLE, r"\borta mesafe\b"), (agenda.LONG, r"\buzun mesafe\b")]


def _day(s: str | None) -> str | None:
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00")).astimezone(LOCAL).date().isoformat()
    except ValueError:
        return None


def turkish_title(s: str) -> str:
    """« İZMİR » -> « İzmir » (Turkish casing: I/ı and İ/i)."""
    low = s.replace("I", "ı").replace("İ", "i").lower()
    return " ".join(w[:1].replace("i", "İ").replace("ı", "I").upper() + w[1:] for w in low.split(" "))


def events_of(html: str) -> list:
    m = re.search(r"\bevents\s*:\s*\[", html)
    if not m:
        return []
    return json.JSONDecoder().raw_decode(html[m.end() - 1:])[0]


def read(http, today: date) -> list[dict]:
    a = http.get(PAGE)
    if a.status != 200:
        return []
    out = []
    for r in events_of(a.text()):
        start, end = _day(r.get("start")), _day(r.get("end"))
        if not start or (r.get("organizer") or "").strip() in ABROAD_ORG:
            continue
        if end and r.get("allDay") in (True, "true") and end > start:      # FullCalendar's end: the day after
            end = (date.fromisoformat(end) - timedelta(days=1)).isoformat()
        name = r.get("title") or ""
        both = agenda.fold(f"{name} {r.get('description') or ''}")
        epr = next((f for f, rx in FMT if re.search(rx, both)), "") or agenda.fmt_of(name)
        key = hashlib.sha1(f"{r.get('start')}|{name}".encode()).hexdigest()[:10]
        place = (r.get("location") or "").strip() or None
        out.append(agenda.event(
            "TR", key, start, name, end=end, place=turkish_title(place) if place and place.isupper() else place,
            org=(r.get("organizer") or "").strip() or None, spec=SPEC.get(r.get("icon")), epr=epr,
            site=r.get("orgurl") or None, src={"tof": PAGE}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"tof": "TOF"})

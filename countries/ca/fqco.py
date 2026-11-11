"""The Quebec federation's calendar (Fédération québécoise de course d'orientation, courseorientationquebec.ca): WordPress's
« The Events Calendar » and its REST API (`/wp-json/tribe/events/v1/events`), 50 events a page; each with its place, its
organising club, its website. Studied 2026-11-11 (61 events in 2026: Ramblers, Accro O Sport, Orienteering Ottawa…).
"""
from __future__ import annotations

import html
import json
import re
from datetime import date

from countries import agenda

BASE = "https://courseorientationquebec.ca/wp-json/tribe/events/v1/events"
# the calendar's organisers -> the clubs' short names (the clubs' own results pages, countries/ca/results.py; WhyJustRun's)
CLUBS = {"ramblers": "ROC", "orienteering ottawa": "OOC", "accro o sport": "AOS", "azimut": "AZM", "rikico": "RIK",
         "viking": "VIK"}
# the clubs as other clubs' posts name them (« Ramblers - Morgan Arboretum » on Orienteering Ottawa's WhyJustRun calendar)
NAMED = {"ROC": r"^\W*ramblers\b", "AOS": r"^\W*accro\b"}
# the provinces the calendar's places may name (an event across the river from Ottawa)
ONTARIO = re.compile(r"\b(ottawa|nepean|kanata|kemptville|calabogie|orleans|barrhaven|ontario|on)\b", re.I)


def _club(name: str) -> str | None:
    low = agenda.fold(html.unescape(name or ""))
    return next((v for k, v in CLUBS.items() if k in low), None)


def events(http, lo: date, hi: date) -> list[dict]:
    from . import TRAINING, NOT_EVENT, _spec
    out = []
    page = 1
    while page <= 10:
        a = http.get(BASE, params={"per_page": 50, "page": page, "start_date": lo.isoformat(), "end_date": hi.isoformat()})
        if a.status != 200:
            break
        try:
            d = json.loads(a.content.decode("utf-8", "replace"))
        except ValueError:
            break
        for x in d.get("events") or []:
            name = re.sub(r"\s+", " ", html.unescape(x.get("title") or "")).strip()
            if not name or NOT_EVENT.search(name):
                continue
            v = x.get("venue") if isinstance(x.get("venue"), dict) else {}
            orgs = [html.unescape(o.get("organizer") or "") for o in x.get("organizer") or [] if isinstance(o, dict)]
            org = orgs[0] if orgs else None
            city = html.unescape(v.get("city") or "") or None
            place = city or html.unescape(v.get("venue") or "") or None
            prov = (v.get("province") or v.get("state") or "").strip()
            region = "Ontario" if prov.upper() in ("ON", "ONTARIO") or (not prov and ONTARIO.search(place or "")) else "Québec"
            day = (x.get("start_date") or "")[:10]
            end = (x.get("end_date") or "")[:10] or None
            if not day:
                continue
            kind = "f" if re.search(r"\bformation\b|\batelier\b", name, re.I) else "e" if TRAINING.search(name) else "c"
            e = agenda.event("CA", f"q{x['id']}", day, f"{name} — {place}" if place and agenda.fold(place) not in agenda.fold(name)
                             and re.fullmatch(r"(?i)foot-?o|ski-?o|mtb-?o", name) else name,
                             kind=kind, end=end, place=place, region=region, org=org, spec=_spec(name),
                             site=x.get("website") or None, src={"fqco": x.get("url")})
            try:
                lat, lng = float(v.get("geo_lat")), float(v.get("geo_lng"))
                if lat and lng:
                    e["gps"] = [round(lat, 5), round(lng, 5)]
            except (TypeError, ValueError):
                pass
            e["_org_short"] = _club(org or "")
            e["_club"] = e["_org_short"]
            out.append(e)
        if page >= int(d.get("total_pages") or 1):
            break
        page += 1
    return out

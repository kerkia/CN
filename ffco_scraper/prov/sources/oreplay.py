"""O-Replay (www.oreplay.es): results and split times of Spanish races (and some Bulgarian ones), uploaded by the
organisers' timing software, read through its public JSON API — no login, no robots.txt (2026-10-22).

    /api/v1/events?limit=100&page=N        every event, the latest first: id, description, website, scope, country_code,
                                           initial_date, final_date, timezone, organizer {name, region_code, region}
    /api/v1/events/{id}                    one event and its stages [{id, description, start}]
    …/stages/{sid}/classes/                its classes [{id, short_name}] (« M-21A O-Pie »)
    …/stages/{sid}/results/?class_id=…&forceSameDay=true
                                           a class's runners: full_name, club.short_name (« Madrid O-GETAFE », province and
                                           club), sex, sicard, bib_number, stage {start_time, time_seconds, position,
                                           status_code, is_nc, splits [{order_number, reading_time, control.station}]}

A whole stage asked at once times out (60 s): one class at a time. A competition here is one stage, « <event>/<stage> ».
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from ..model import doc, klass, runner

API = "https://www.oreplay.es/api/v1"
SITE = "https://www.oreplay.es"
# status_code (checked on a Madrid league race, 2026-01-17: 1 without a start, 2 and 3 without a time) — the IOF's order
STATUS = {"0": "ok", "1": "dns", "2": "dnf", "3": "mp", "4": "dsq", "5": "ot", "6": "nc"}
SUFFIX = re.compile(r"\s+(O-Pie|MTBO|MTB-O|BTT|Trail-O|Ski-O)$", re.I)       # the discipline the class names repeat
# a name the timing software padded where a second surname was missing: « Anne Souplet   XXX »
PAD = re.compile(r"(\s+X{2,})+\s*$")


def stage_url(comp: str) -> str:
    """The page of a competition (« <event>/<stage> ») on O-Replay."""
    ev, _, st = comp.partition("/")
    return f"{SITE}/competitions/{ev}/{st}" if st else f"{SITE}/competitions/{ev}"


class OReplay:
    def __init__(self, fetcher):
        self.f = fetcher
        self._events = None
        self._detail: dict[str, dict] = {}

    def _json(self, url: str, params: dict | None = None):
        a = self.f.get(url, conditional=False, params=params) if params else self.f.get(url, conditional=False)
        if a.status != 200:
            return None
        try:
            return json.loads(a.content)
        except ValueError:
            return None

    def events(self, since: str) -> list[dict]:
        """Every event from `since` on (ISO day), the latest first (one request per 100 events)."""
        if self._events is None:
            out, page = [], 1
            while page < 20:
                d = self._json(f"{API}/events", {"limit": 100, "page": page})
                rows = (d or {}).get("data") or []
                out += rows
                if not rows or rows[-1].get("initial_date", "") < since or not (d.get("_links") or {}).get("next"):
                    break
                page += 1
            self._events = out
        return [e for e in self._events if (e.get("final_date") or e.get("initial_date") or "") >= since]

    def detail(self, ev_id: str) -> dict | None:
        if ev_id not in self._detail:
            self._detail[ev_id] = (self._json(f"{API}/events/{ev_id}") or {}).get("data")
        return self._detail[ev_id]

    def stages(self, ev: dict) -> list[dict]:
        """An event's stages as competitions: [{id: "<event>/<stage>", name, date, event}]. A stage's day: its own start,
        else the event's days in order (one stage a day), else the event's first day."""
        d = self.detail(ev["id"]) or {}
        # a multi-day event's totals (stage type « Overall »: « Totales », « Total Trofeo… ») are not a race
        st = [s for s in d.get("stages") or [] if not is_overall(s)]
        first = ev.get("initial_date")
        last = ev.get("final_date") or first
        span = (date.fromisoformat(last) - date.fromisoformat(first)).days + 1 if first and last else 1
        out = []
        for i, s in enumerate(st):
            day = (s.get("start") or "")[:10] or (
                (date.fromisoformat(first) + timedelta(days=i)).isoformat() if first and span == len(st) else first)
            name = ev.get("description") or ""
            if len(st) > 1 and s.get("description"):
                name = f"{name} — {s['description']}"
            out.append({"id": f"{ev['id']}/{s['id']}", "name": name, "stage": s.get("description") or "", "date": day,
                        "organizer": (ev.get("organizer") or {}).get("name") or "", "event": ev})
        return out

    def read(self, comp: str) -> dict | None:
        """One stage's results, class by class, as a document (kind "oreplay"; classes are the categories)."""
        ev_id, _, st_id = comp.partition("/")
        base = f"{API}/events/{ev_id}/stages/{st_id}"
        classes = (self._json(f"{base}/classes/") or {}).get("data") or []
        ev = self.detail(ev_id) or {}
        tz = ZoneInfo(ev.get("timezone") or "Europe/Madrid")
        out, day = [], None
        for c in classes:
            if self.f.out_of_time() if hasattr(self.f, "out_of_time") else False:
                return None                       # never a part of a race: the next run reads it whole
            rows = (self._json(f"{base}/results/", {"class_id": c["id"], "forceSameDay": "true"}) or {}).get("data")
            if rows is None:
                return None
            k, d = _klass(c, rows, tz)
            day = day or d
            out.append(k)
        if not any(k["runners"] for k in out):
            return None
        title = ev.get("description")
        return doc("oreplay", out, by="category", title=title, date=day)


def is_overall(stage: dict) -> bool:
    return ((stage.get("stage_type") or {}).get("description") or "").lower() == "overall"


def _local(iso: str | None, tz) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
    except ValueError:
        return None


def _klass(c: dict, rows: list[dict], tz) -> tuple[dict, str | None]:
    """A class's runners; its controls: the sequence most of its finishers punched."""
    name = SUFFIX.sub("", c.get("short_name") or c.get("long_name") or "").strip()
    seqs = Counter()
    for r in rows:
        s = r.get("stage") or {}
        if s.get("status_code") == "0":
            seqs[tuple((x.get("control") or {}).get("station") for x in sorted(s.get("splits") or [], key=lambda x: x.get("order_number") or 0)
                       if not x.get("is_intermediate"))] += 1         # a split without its control (a reading lost): None
    controls = [c for c in seqs.most_common(1)[0][0] if c] or None if seqs else None
    day = None
    runners = []
    for r in rows:
        s = r.get("stage") or {}
        start = _local(s.get("start_time"), tz)
        status = "nc" if (s.get("is_nc") or r.get("is_nc")) else STATUS.get(str(s.get("status_code")), "dnf")
        t = s.get("time_seconds") or None
        splits = None
        if controls and start:
            got = {}
            for x in s.get("splits") or []:
                at = _local(x.get("reading_time"), tz)
                code = (x.get("control") or {}).get("station")
                if at and code and code not in got:
                    got[code] = (at - start).total_seconds()
            splits = [got.get(code) for code in controls]
            if not any(v is not None for v in splits):
                splits = None
        day = day or (start.date().isoformat() if start else None)
        runners.append(runner(
            PAD.sub("", r.get("full_name") or ""), club=(r.get("club") or {}).get("short_name"), category=name or None,
            bib=r.get("bib_number") or None, time_s=float(t) if t and status == "ok" else None, status=status,
            place=s.get("position") or None if status == "ok" else None, splits=splits,
            start_s=(start.hour * 3600 + start.minute * 60 + start.second) if start else None,
            sex=r.get("sex") or None, card=r.get("sicard") or None))
    return klass(name, runners, controls=controls), day

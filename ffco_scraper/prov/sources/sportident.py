"""SPORTident Center (center.sportident.com): SPORTident's cloud, where its Orienteering App, its Reader, OE12 and SiTiming
publish results — live while the race runs (online controls, readouts) and kept afterwards. Mostly club trainings in
France (333 public events, 41 in 2026: a few league championships among them), more abroad (Spain, Switzerland, Austria,
Germany). Only what its own public results page reads is read here (no login, no key; no robots.txt, 2026-10-24); none
of its code is used — the shape of its results file was read from the field numbers its page's script decodes.

    /api/rest/v1/public-events?country=FR&dateFrom=…&dateTo=…&hasPublishedData=true&page=0&size=100
                                          the public events with published data (JSON): id, name, startDate, endDate,
                                          slug (« jms01/2026/cdl-md-aranc »), eventType (« orienteering », « enduro »…),
                                          timezone, location.country, organisation.name, guid (none: no results file)
    /api/rest/v1/public/events/slug/<slug>  one event, as above (a link from a club's site names its slug)
    /event-files/<guid>/results/r.1.latest.bin
                                          its results (protobuf « Results », below); d.1.<n>.<n+1>.bin the change from
                                          revision n (the live relay reads those, live/src/sportident.js)
    /results/orienteering/<slug>          the page people open (si.events/<code> redirects there)

The results file: the event's controls (id -> SI code, type control / start / finish), sections (from a control to the
next), classes (each on a course), courses (their sections in order, length, climb), entries (first and last name, club,
bib, birth year, card, classes) and each entry's result by section (the leg's time, the cumulative time, a status, the
start and the end as milliseconds after the event's zero time). A course is a circuit: every list here is by circuit,
each runner's class kept as their category. Runners still out, not started or finished but not yet evaluated are left out
and counted in the document's `live`. Score courses (« scoreO ») give no splits; team classes are not read.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime, timezone

from ..model import category, doc, klass, live_state, runner

HOST = "center.sportident.com"
BASE = f"https://{HOST}"
API = f"{BASE}/api/rest/v1"
PAGE = f"{BASE}/results/orienteering"
# an event's id on Ozimut, « <slug>?event=<id> »: its page's address (the page ignores the query), and the number the live
# relay gives it (600 000 000 + id, live/src/sportident.js) found in it
PID = re.compile(r"^(.+?)\?event=(\d+)$")

# IndividualStatus -> ours; 1 inactive, 2 active (out), 3 finished (not yet evaluated), 99 expected: not listed yet
STATUS = {4: "ok", 5: "dns", 6: "dnf", 7: "dsq", 8: "mp", 9: "ot", 10: "nc", 11: "dnf", 80: "ok"}
OUT = {2, 3}
WAIT = {1, 99}
CONTROL, START, FINISH = 1, 2, 3
SCORE_O = 7
OPTIONAL = 2                # a section's evaluation mode: not on the course's line

# ---- protobuf, the fields read (d.center.*; numbers as its page's script decodes them) ----------------------------------
U, I, S, B = "u", "i", "s", "b"
SCHEMA = {
    "Results": {1: ("fileFormat", U), 2: ("revision", U), 3: ("isDiff", B), 4: ("diffFromRevision", U), 5: ("eventDefinition", "EventDefinition"),
                7: ("entries", ("map", "Entry")), 9: ("individualResults", ("map", "IndividualResult")), 10: ("remove", "Remove"),
                13: ("createdTimeUnix", U)},
    "Remove": {1: ("entries", [U]), 3: ("individualResults", [U]), 5: ("resultLists", [U])},
    "EventDefinition": {1: ("eventInfo", "EventInfo"), 3: ("controls", ("map", "ControlDefinition")),
                        5: ("sections", ("map", "SectionDefinition")), 7: ("classes", ("map", "ClassDefinition")),
                        9: ("courses", ("map", "CourseDefinition"))},
    "EventInfo": {1: ("name", S), 3: ("location", S), 5: ("organisation", S), 7: ("startDate", S), 8: ("endDate", S),
                  9: ("zeroTimeUnix", U), 15: ("timeFieldMultiplier", U)},
    "ControlDefinition": {1: ("codes", [U]), 2: ("type", I), 3: ("name", S)},
    "SectionDefinition": {1: ("name", S), 5: ("fromControl", U), 7: ("toControl", U), 9: ("evaluationMode", I)},
    "ClassDefinition": {1: ("name", S), 2: ("shortName", S), 7: ("course", U), 15: ("isTeamClass", B), 17: ("displayOrder", U)},
    "CourseDefinition": {1: ("name", S), 4: ("type", I), 5: ("sections", [U]), 9: ("distance", U), 10: ("climb", U)},
    "Entry": {1: ("type", I), 2: ("cards", [U]), 3: ("plate", S), 4: ("firstName", S), 5: ("lastName", S), 12: ("classes", [U]),
              13: ("course", U), 15: ("yearOfBirth", S), 18: ("country", S), 20: ("club", S)},
    "IndividualResult": {1: ("sectionResults", ("map", "SectionResult")), 3: ("status", I)},
    "SectionResult": {1: ("time", U), 2: ("cumulativeTime", U), 5: ("status", I), 6: ("actualStartTime", U), 7: ("actualFinishTime", U)},
}


def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 127) << s
        s += 7
        if c < 128:
            return r, i


def _skip(b: bytes, i: int, wire: int) -> int:
    if wire == 0:
        return _varint(b, i)[1]
    if wire == 1:
        return i + 8
    if wire == 5:
        return i + 4
    if wire == 2:
        n, i = _varint(b, i)
        return i + n
    raise ValueError(f"wire type {wire}")


def decode(b: bytes, msg: str = "Results", i: int = 0, end: int | None = None) -> dict:
    """A message of SCHEMA from protobuf bytes (fields not listed skipped; maps as dicts, repeated numbers as lists)."""
    sch, out = SCHEMA[msg], {}
    end = len(b) if end is None else end
    while i < end:
        key, i = _varint(b, i)
        field, wire = key >> 3, key & 7
        if field not in sch:
            i = _skip(b, i, wire)
            continue
        name, t = sch[field]
        if isinstance(t, tuple):                       # map<uint32, message>: entries of key 1, value 2
            n, i = _varint(b, i)
            j, k, v = i + n, 0, {}
            while i < j:
                kk, i = _varint(b, i)
                if kk >> 3 == 1:
                    k, i = _varint(b, i)
                elif kk >> 3 == 2:
                    n2, i = _varint(b, i)
                    v = decode(b, t[1], i, i + n2)
                    i += n2
                else:
                    i = _skip(b, i, kk & 7)
            out.setdefault(name, {})[k] = v
        elif isinstance(t, list):                      # repeated numbers, packed or not
            lst = out.setdefault(name, [])
            if wire == 2:
                n, i = _varint(b, i)
                j = i + n
                while i < j:
                    v, i = _varint(b, i)
                    lst.append(v)
            else:
                v, i = _varint(b, i)
                lst.append(v)
        elif t in (U, I, B):
            v, i = _varint(b, i)
            out[name] = (v - (1 << 64) if v >= 1 << 63 else v) if t == I else bool(v) if t == B else v
        elif t == S:
            n, i = _varint(b, i)
            out[name] = b[i:i + n].decode("utf-8", "replace")
            i += n
        else:
            n, i = _varint(b, i)
            out[name] = decode(b, t, i, i + n)
            i += n
    return out


# ---- the event read as a document ---------------------------------------------------------------------------------------
def course_codes(ed: dict, course: dict) -> list[str] | None:
    """A course's controls' SI codes in order (the finish apart; optional sections left out); None for a score course."""
    if course.get("type") == SCORE_O:
        return None
    controls, sections = ed.get("controls", {}), ed.get("sections", {})
    out = []
    for sid in course.get("sections", []):
        sec = sections.get(sid, {})
        if sec.get("evaluationMode") == OPTIONAL:
            continue
        c = controls.get(sec.get("toControl"), {})
        if c.get("type", CONTROL) == CONTROL and c.get("codes"):
            out.append(str(c["codes"][0]))
    return out


def course_sections(ed: dict, course: dict) -> list[int]:
    """The sections counted on a course's line: each ends at a control, the last at the finish."""
    sections = ed.get("sections", {})
    return [s for s in course.get("sections", []) if sections.get(s, {}).get("evaluationMode") != OPTIONAL]


def name_of(e: dict) -> str:
    return " ".join(x for x in (e.get("firstName", "").strip(), e.get("lastName", "").strip()) if x) or e.get("plate", "")


def to_doc(r: dict, title: str | None = None, day: str | None = None) -> dict | None:
    """A decoded results file -> a provisional document by circuit (sources' common shape, model.py)."""
    ed = r.get("eventDefinition") or {}
    info = ed.get("eventInfo") or {}
    zero = info.get("zeroTimeUnix") or 0
    ms = info.get("timeFieldMultiplier") or 1                 # (times in milliseconds, times this)
    classes, courses = ed.get("classes", {}), ed.get("courses", {})

    def clock(t):
        # a time of the event, seconds after local midnight: the Center writes the local clock as if it were UTC (the zero
        # time is the local midnight; checked 2026-10-24 against its files' dates: the DM MTBO's file was made at 14:02 UTC,
        # three minutes after its last finish, « 15:59 » read this way)
        if t is None:
            return None
        d = datetime.fromtimestamp((zero + t * ms) / 1000, timezone.utc)
        return d.hour * 3600 + d.minute * 60 + d.second

    by_course: dict[int, list] = {}
    out_n, nxt, last = 0, None, None
    entries, results = r.get("entries", {}), r.get("individualResults", {})
    for eid, e in entries.items():
        if e.get("type", 1) != 1:                             # (a team: its members are entries of their own)
            continue
        cls = next((classes[c] for c in e.get("classes", []) if c in classes), None)
        if cls and cls.get("isTeamClass"):
            continue
        cid = e.get("course") or (cls or {}).get("course")
        if cid not in courses:
            continue
        res = results.get(eid) or {}
        st = res.get("status")
        secs = res.get("sectionResults", {})
        line = course_sections(ed, courses[cid])
        first = secs.get(line[0], {}) if line else {}
        start = clock(first.get("actualStartTime")) if first.get("actualStartTime") else None
        if st not in STATUS:
            if st in OUT or st in WAIT or st is None:
                out_n += 1
                if st in WAIT and start is not None:
                    nxt = start if nxt is None else min(nxt, start)
            continue
        status = STATUS[st]
        end = secs.get(line[-1], {}) if line else {}
        total = end.get("cumulativeTime") if end.get("status") == 4 or status == "ok" else None
        time_s = round(total * ms / 1000, 1) if total else None
        codes = course_codes(ed, courses[cid])
        splits = None
        if codes:
            splits = [round(secs[s]["cumulativeTime"] * ms / 1000, 1) if secs.get(s, {}).get("cumulativeTime") and secs[s].get("status") == 4
                      else None for s in line[:-1]][:len(codes)]
            if not any(v is not None for v in splits):
                splits = None
        if end.get("actualFinishTime"):
            f = clock(end["actualFinishTime"])
            last = f if last is None else max(last, f)
        born = (e.get("yearOfBirth") or "").strip()
        cat = (cls or {}).get("name") or (cls or {}).get("shortName") or None
        by_course.setdefault(cid, []).append(runner(
            name_of(e), club=(e.get("club") or "").strip() or None, bib=(e.get("plate") or "").strip() or None,
            birth=int(born) if born.isdigit() and len(born) == 4 else None, status=status,
            time_s=time_s if status == "ok" else None, category=category(cat) or cat, splits=splits, start_s=start,
            card=str(e["cards"][0]) if e.get("cards") else None))
    out = []
    for cid, rs in by_course.items():
        c = courses[cid]
        ok = sorted(x["time_s"] for x in rs if x["status"] == "ok" and x["time_s"] is not None)
        for x in rs:
            if x["status"] == "ok" and x["time_s"] is not None:
                x["place"] = ok.index(x["time_s"]) + 1
        rs.sort(key=lambda x: (x["place"] is None, x["place"] or 0, x["name"]))
        out.append(klass(c.get("name") or f"#{cid}", rs, controls=course_codes(ed, c) or None,
                         length_m=c.get("distance") or None, climb_m=c.get("climb") or None))
    d = doc("sportident", out, by="circuit", title=title or (info.get("name") or "").strip() or None,
            date=day or info.get("startDate") or None)
    if live := live_state(out_n, nxt, last):
        d["live"] = live
    return d if d["classes"] else None


def organiser(e: dict) -> str:
    """The event's organisation, none when the Center says « Not assigned » or names SPORTident itself (its national
    branches publish their own trainings: « SPORTident France » shared « France » with a « Coupe de France » of that day)."""
    org = ((e.get("organisation") or {}).get("name") or "").strip()
    return "" if org == "Not assigned" or org.lower().startswith("sportident") else org


def make_pid(slug: str, eid: int | str) -> str:
    return f"{slug}?event={eid}"


def split_pid(pid: str) -> tuple[str, int]:
    m = PID.match(pid)
    if not m:
        raise ValueError(pid)
    return m[1], int(m[2])


class SportIdent:
    """SPORTident Center's public events (ids: « <slug>?event=<id> »), read as documents of kind « sportident »."""

    def __init__(self, fetcher):
        self.f = fetcher
        self._events: dict[int, dict] = {}            # id -> the event's JSON
        self._lists: dict[tuple, list] = {}
        self._files: dict[str, bytes] = {}           # guid -> the results file read this run

    def _json(self, url: str):
        a = self.f.get(url, conditional=False)
        if a.status != 200:
            return None
        try:
            return json.loads(a.content)
        except ValueError:
            return None

    def competitions(self, country: str, lo: str, hi: str) -> list[dict]:
        """[{id: pid, name, organizer, date}] of a country's orienteering events with results from lo to hi (ISO days)."""
        key = (country, lo, hi)
        if key not in self._lists:
            out, page = [], 0
            while page < 10 and not self.f.out_of_time():
                q = urllib.parse.urlencode({"page": page, "size": 100, "hasPublishedData": "true", "country": country,
                                            "dateFrom": lo, "dateTo": hi})
                rows = self._json(f"{API}/public-events?{q}")
                if not isinstance(rows, list):
                    break
                for e in rows:
                    if e.get("eventType") == "orienteering" and e.get("guid") and e.get("slug") and e.get("startDate"):
                        self._events[e["id"]] = e
                        out.append({"id": make_pid(e["slug"], e["id"]), "name": e.get("name") or "",
                                    "organizer": organiser(e), "date": e["startDate"]})
                if len(rows) < 100:
                    break
                page += 1
            self._lists[key] = out
        return self._lists[key]

    def event(self, pid: str) -> dict | None:
        slug, eid = split_pid(pid)
        if eid not in self._events:
            e = self._json(f"{API}/public/events/slug/{urllib.parse.quote(slug, safe='/-')}")
            if not isinstance(e, dict) or e.get("id") != eid:
                return None
            self._events[eid] = e
        return self._events[eid]

    def resolve(self, url: str) -> str | None:
        """A link from a club's site (its results page, or a si.events short link) -> the event's pid."""
        if "si.events/" in url:
            a = self.f.get(url, conditional=False)
            url = a.url if a.status in (200, 304) else ""
        m = re.search(r"center\.sportident\.com/results/orienteering/([^?#]+)", url or "")
        if not m:
            return None
        slug = urllib.parse.unquote(m[1]).strip("/")
        e = self._json(f"{API}/public/events/slug/{urllib.parse.quote(slug, safe='/-')}")
        if not isinstance(e, dict) or not e.get("id"):
            return None
        self._events[e["id"]] = e
        return make_pid(e.get("slug") or slug, e["id"])

    def _file(self, guid: str, conditional: bool):
        a = self.f.get(f"{BASE}/event-files/{guid}/results/r.1.latest.bin", conditional=conditional)
        if a.status == 200:
            self._files[guid] = a.content
        return a

    def fingerprint(self, pid) -> str | None:
        """The results file's hash: unchanged (a 304 to the conditional request) when nothing moved."""
        e = self.event(pid)
        if not e or not e.get("guid"):
            return None
        a = self._file(e["guid"], True)
        return a.sha if a.status in (200, 304) else None

    def read(self, pid) -> dict | None:
        e = self.event(pid)
        if not e or not e.get("guid"):
            return None
        body = self._files.get(e["guid"])
        if body is None:
            a = self._file(e["guid"], False)
            body = a.content if a.status == 200 else None
        if not body:
            return None
        try:
            r = decode(body)
        except (IndexError, ValueError):
            return None
        return to_doc(r, title=(e.get("name") or "").strip() or None, day=e.get("startDate"))

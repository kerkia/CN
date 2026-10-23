"""MeOSDjango: a MeOS results site any club can install (github.com/Jolatomme/MeOSDjango, 2026), fed by MeOS during the
race and kept afterwards. Orientation Data (heyries.alwaysdata.net, sources.heyries) is one; COCS 73's is another
(jolatomme.alwaysdata.net). No robots.txt (2026-10-22). Only its public pages and JSON are read — none of its code is
used here.

    /?months=3                               the competitions of the last 3 months and the coming ones, as cards: name
                                             (span title), date (dd/mm/yyyy badge), organiser (org-site-link), a link
                                             /competition/<cid>/ (the plain / lists only the 3 latest)
    /competition/<cid>/                      its classes (« N classés / M partants ») and its courses, each course with a
                                             link /competition/<cid>/course/<hash>/live/
    /api/<cid>/course/<hash>/live/           a course's runners (JSON): name, org, class_name, stat (MeOS's status
                                             code), rank, st (start, tenths of a second after midnight), rt (running time,
                                             tenths), radio_punches [{ctrl, time}] (every control punched, tenths after
                                             the start), the course's controls [{ctrl_id, ctrl_name « 1-146 »}],
                                             competition_date, race_state (upcoming / live / finished)

A course is a circuit: every list here is by circuit, each runner's class kept as their category (« D12 / H12 » are
read once, not once per class and once per course). Before the race the same JSON gives the start list (stat 0, st):
kept only when the start times are drawn (two times at least; a course whose every start is the zero time is not one).
Sites: KNOWN, plus those met on a club's website — a link to a page of the shape /competition/<n>/ on a new host, or a
page read as a results file that bears MeOSDjango's signature (its footer's link to the project) — probed once and
remembered in prov_meta 'meosdjango' (sites, and the hosts probed that were not one).
"""

from __future__ import annotations

import html as htmllib
import json
import re
import urllib.parse
from datetime import date, timedelta

from ..model import category, doc, klass, live_state, runner
from ..parsers import meos_html
from ..store import meta_get, meta_set

KNOWN = ("jolatomme.alwaysdata.net",)
OWN_KIND = {"heyries.alwaysdata.net": "heyries"}     # a site read under its own source name (its documents kept as they were)
REPROBE_DAYS = 30                                    # a host found not to be one is asked again after this
# MeOS's status codes (RunnerStatus) -> ours; 0 = unknown: not started or still out
STATUS = {1: "ok", 2: "nc", 3: "mp", 4: "dnf", 5: "dsq", 6: "ot", 15: "nc", 20: "dns", 21: "dns", 99: "dns"}
COMP_PATH = re.compile(r"^/competition/(\d+)(?:/|$)")


def is_meosdjango(content: bytes) -> bool:
    """A page of a MeOSDjango site: its footer's link to the project, or its competition cards."""
    low = content[:400_000].lower()
    return b"github.com/jolatomme/meosdjango" in low or (b"co-card" in low and bool(re.search(rb'href="/competition/\d+/"', low)))


def comp_id(host: str, cid: int | str) -> str:
    """A competition's id across sites, « host/competition/<cid> » (its address is https://<id>/)."""
    return f"{host}/competition/{cid}"


def split_id(pid: str) -> tuple[str, int]:
    host, _, cid = pid.partition("/competition/")
    return host, int(cid)


def _name(s: str) -> str:
    """« GOBILLOT, Amelie » (MeOS's « family, given ») -> « Amelie GOBILLOT »."""
    a, sep, b = (s or "").partition(",")
    return f"{b.strip()} {a.strip()}" if sep and b.strip() else (s or "").strip()


class Site:
    """One MeOSDjango site (https://<host>)."""

    def __init__(self, fetcher, base: str, kind: str = "meosdjango"):
        self.f = fetcher
        self.base = base.rstrip("/")
        self.kind = kind
        self._list = None
        self._pages: dict[int, str] = {}

    def competitions(self) -> list[dict]:
        """[{id: <cid>, name, organizer, date}] from the home page's cards."""
        if self._list is None:
            out = []
            for q in ("/?months=3", "/"):                    # (an older version may not filter by months)
                a = self.f.get(f"{self.base}{q}", conditional=False)
                out = cards(a.content.decode("utf-8", "replace")) if a.status == 200 else []
                if out:
                    break
            self._list = out
        return self._list

    def page(self, cid: int) -> str:
        if cid not in self._pages:
            a = self.f.get(f"{self.base}/competition/{cid}/", conditional=False)
            self._pages[cid] = a.content.decode("utf-8", "replace") if a.status == 200 else ""
        return self._pages[cid]

    def courses(self, cid: int) -> list[str]:
        return list(dict.fromkeys(re.findall(rf'href="/competition/{cid}/course/([0-9a-f]+)/live/"', self.page(cid))))

    def fingerprint(self, cid: int) -> str | None:
        """What changes on the competition's page when results come in: its courses and each class's « N classés / M
        partants ». An unchanged fingerprint spares reading every course again."""
        s = self.page(cid)
        if not s:
            return None
        counts = re.findall(r"(\d+)\s+class\S*\s*/\s*(\d+)\s+partant", s)
        return json.dumps([self.courses(cid), counts])

    def read(self, cid: int, startlist: bool = False) -> dict | None:
        """One competition, course by course: a model.doc (kind self.kind, by circuit). startlist: its runners not yet
        through with their start times (status "start"), kind "startlist" — None when no start time is drawn."""
        hashes = self.courses(cid)
        if not hashes:
            return self._read_html(cid) if not startlist else None
        classes, day, starts = [], None, set()
        out, nxt, last, state = 0, None, None, None     # the race under way (model.live_state): runners out or to start
        for h in hashes:
            if self.f.out_of_time():
                return None                                  # never a part of a race: the next run reads it whole
            a = self.f.get(f"{self.base}/api/{cid}/course/{h}/live/", conditional=False)
            if a.status == 404 and not classes:
                return self._read_html(cid) if not startlist else None      # (a version without the JSON)
            if a.status != 200:
                return None
            try:
                data = json.loads(a.content)
            except ValueError:
                return None
            k = course(data, startlist)
            day = day or data.get("competition_date")
            state = state or data.get("race_state")
            now = data.get("server_now_abs") or 0
            for x in data.get("runners") or []:
                st = x.get("st_abs", x.get("st")) or 0
                if not x.get("stat") and st > 0:
                    out += 1
                    if st > now and (nxt is None or st / 10 < nxt):
                        nxt = st / 10
                elif x.get("stat") == 1 and st > 0 and (x.get("rt") or 0) > 0:
                    last = max(last or 0, (st + x["rt"]) / 10)
            starts |= {r["start_s"] for r in k["runners"] if r.get("start_s")}
            classes.append(k)
        if startlist and len(starts) < 2:
            return None
        d = doc(self.kind, classes, by="circuit", title=self.title(cid), date=day)
        if startlist and d["classes"]:
            d["kind"] = "startlist"
        elif not startlist and (live := live_state(out, nxt, last, state)):
            d["live"] = live
        return d if d["classes"] else None

    def _read_html(self, cid: int) -> dict | None:
        """A site without the JSON: each course's results page (parsers.meos_html reads its split rows), no start times."""
        classes = []
        for h in dict.fromkeys(re.findall(rf'href="/competition/{cid}/class/([0-9a-f]{{8}})/"', self.page(cid))):
            if self.f.out_of_time():
                return None
            c = self.f.get(f"{self.base}/competition/{cid}/class/{h}/", conditional=False)
            d = meos_html.parse(c.content, c.url) if c.status == 200 else None
            classes += (d or {}).get("classes", [])
        if not classes:
            return None
        comp = next((c for c in self.competitions() if c["id"] == cid), {})
        return doc(self.kind, classes, by="circuit", title=self.title(cid), date=comp.get("date"))

    def title(self, cid: int) -> str:
        comp = next((c for c in self.competitions() if c["id"] == cid), None)
        if comp:
            return f"{comp['name']} ({comp['organizer']})" if comp["organizer"] else comp["name"]
        m = re.search(r"<title>(.*?)</title>", self.page(cid), re.S)
        return htmllib.unescape(m.group(1)).strip() if m else ""


def cards(s: str) -> list[dict]:
    """The home page's competition cards: [{id, name, organizer, date}]."""
    out = []
    for card in re.split(r'<div class="co-card', s)[1:]:
        cid = re.search(r'href="/competition/(\d+)/"', card)
        name = re.search(r'<span class="text-truncate" title="([^"]+)"', card)
        day = re.search(r">\s*(\d{2})/(\d{2})/(\d{4})\s*<", card)
        org = re.search(r'class="org-site-link"[^>]*>([^<]+)<', card) or re.search(r"bi-building[^>]*></i>\s*([^<]+)<", card)
        if cid and name and day:
            out.append({"id": int(cid.group(1)), "name": htmllib.unescape(name.group(1)).strip(),
                        "organizer": htmllib.unescape(org.group(1).strip()) if org else "",
                        "date": f"{day.group(3)}-{day.group(2)}-{day.group(1)}"})
    return out


def course(data: dict, startlist: bool = False) -> dict:
    """A course's JSON as a class (model.klass): split times by control code, cumulative, a repeated control's second
    punch on its second visit."""
    name = (data.get("course") or {}).get("display_name") or data.get("cls_name") or ""
    controls = [str(c.get("ctrl_id")) for c in data.get("controls") or [] if c.get("ctrl_id") is not None]
    rows = []
    for x in data.get("runners") or []:
        st = STATUS.get(int(x.get("stat") or 0))
        if st is None:                                       # not started yet / still out
            if not startlist:
                continue
            st = "start"
        elif startlist and st == "dns":
            continue
        rt = x.get("rt")
        t = rt / 10 if st == "ok" and isinstance(rt, (int, float)) and rt > 0 else None
        start = x.get("st_abs", x.get("st"))
        splits = None
        if controls and x.get("radio_punches"):
            punches, i, splits = x["radio_punches"], 0, []
            for code in controls:
                j = next((n for n in range(i, len(punches)) if str(punches[n].get("ctrl")) == code), None)
                v = punches[j].get("time") if j is not None else None
                splits.append(v / 10 if isinstance(v, (int, float)) and v > 0 else None)
                i = j + 1 if j is not None else i
            if not any(v is not None for v in splits):
                splits = None
        cls = x.get("class_name") or ""
        rank = x.get("rank")
        rows.append(runner(_name(x.get("name") or ""), club=x.get("org") or None, time_s=t, status=st,
                           place=rank if st == "ok" and isinstance(rank, int) else None,
                           # (an FFCO class only, « D18-20 » too: match.py reads its first letter as the sex — never
                           # « Open Orange » or « Parcours 1 »)
                           category=category(cls) or (cls if re.match(r"[HD]\d", cls) else None),
                           splits=splits,
                           start_s=start / 10 if isinstance(start, (int, float)) and start > 0 else None))
    return klass(name, rows, controls=controls or None)


class MeOSDjango:
    """Every MeOSDjango site known: their competitions under one id (comp_id), read, and new sites found on the way."""

    def __init__(self, fetcher, con):
        self.f = fetcher
        self.con = con
        self._sites: dict[str, Site] = {}

    def _state(self) -> dict:
        s = meta_get(self.con, "meosdjango", None) or {}
        s.setdefault("sites", {})
        s.setdefault("probed", {})
        return s

    def hosts(self) -> list[str]:
        return list(dict.fromkeys([*KNOWN, *self._state()["sites"]]))

    def site(self, host: str) -> Site:
        if host not in self._sites:
            self._sites[host] = Site(self.f, f"https://{host}")
        return self._sites[host]

    def competitions(self) -> list[dict]:
        """[{id: comp_id, name, organizer, date}] of every known site."""
        out = []
        for h in self.hosts():
            if self.f.out_of_time():
                break
            out += [dict(c, id=comp_id(h, c["id"])) for c in self.site(h).competitions()]
        return out

    def read(self, pid: str, startlist: bool = False) -> dict | None:
        host, cid = split_id(pid)
        return self.site(host).read(cid, startlist)

    def fingerprint(self, pid: str) -> str | None:
        host, cid = split_id(pid)
        return self.site(host).fingerprint(cid)

    def add(self, host: str, via: str) -> bool:
        """A site met on a club's website; True when it is new."""
        if host in self.hosts() or host in OWN_KIND:
            return False
        s = self._state()
        s["sites"][host] = {"since": date.today().isoformat(), "via": via[:300]}
        s["probed"].pop(host, None)
        meta_set(self.con, "meosdjango", s)
        return True

    def probe(self, url: str) -> str | None:
        """Is the host of `url` a MeOSDjango site? Its home page is read once (again after REPROBE_DAYS when it was
        not). The competition's id when `url` names one on such a site, else None."""
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc.lower()
        if not host or host in OWN_KIND:
            return None
        m = COMP_PATH.match(parts.path)
        if host not in self.hosts():
            s = self._state()
            seen = s["probed"].get(host)
            if seen and date.fromisoformat(seen) > date.today() - timedelta(days=REPROBE_DAYS):
                return None
            a = self.f.get(f"{parts.scheme or 'https'}://{host}/", conditional=False)
            if a.status == 200 and is_meosdjango(a.content):
                self.add(host, url)
            else:
                s["probed"][host] = date.today().isoformat()
                s["probed"] = dict(sorted(s["probed"].items(), key=lambda x: x[1])[-300:])
                meta_set(self.con, "meosdjango", s)
                return None
        return comp_id(host, m.group(1)) if m else None

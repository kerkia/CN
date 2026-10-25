"""O'Live (co-live.fr, Philippe Chambon's live results site): French organisers feed it from their timing software during
the race (the Championnat de France de Sprint's replacement at Le Bessat, 2026-10-24). No API: its public pages are read,
as a phone's browser reads them. Its robots.txt (Joomla's) forbids none of them. The live relay reads the same pages
(live/src/olive.js) for « En direct ».

    /olive/resultats.php                                the races on offer (« Courses disponibles »): a link
                                                        ?Action=ChoixResultats&IdCourse=<n>, its type (« Course
                                                        Individuelle »), « le : dd/mm/yyyy » — only the current ones:
                                                        a race leaves the list some time after it
    ?Action=ChoixCircuits&IdCourse=<n>                  its circuits, each ?Action=Result&IdCourse=<n>&Circuit=<c>
    ?Action=Result&IdCourse=<n>&Circuit=<c>             the circuit's runners: place, name « FAMILY Given » (bib in its
                                                        title), time (a runner out: their running time at O'Live's last
                                                        import; a runner waiting: their start « 12 h 46 »), status (Wait,
                                                        Run., Arr, OK, P.M, Abd, Abs, Dsq, H.D, N.C., Arr.?), category,
                                                        FFCO club number (« 4403PL ») and short name
    ?Action=Splits&IdCourse=<n>&Circuit=<c>             the circuit's split times: the controls' codes in order (the
                                                        finish « A » last), each runner through with their cumulative
                                                        times (« cumul »)

Every list is by circuit; a runner's category is kept (« H21-35 » too: match.py reads its first letter). Runners still
out, waiting or finished without their card read (« Arr ») are left out and counted in the document's `live`.

A relay (« Course en Relais »; owner, 2026-10-25: the CNE at Le Bessat, for « Analyse de course ») is read apart, for its
split times only (`read_relay`): each leg of each category a circuit (« RELAIS HOMMES · Relayeur 3 »), every runner of that
leg in it, a forked position under its codes together (« 127/172 ») and compared by position, as O'Live and WinSplits show it.

    ?Action=ChoixCategories&IdCourse=<n>                its categories, each ?Action=Result&IdCourse=<n>&IdCat=<k>
    ?Action=Result&IdCourse=<n>&IdCat=<k>               the category's teams: place, bib, name, state; each leg's runner,
                                                        leg time, place, state (live/src/olive.js `relay` reads it too)
    ?Action=Splits&IdCourse=<n>&IdCat=<k>&NumRel=<l>    leg l's split times: each position's codes (« 127 » « 172 »), the
                                                        finish « A » last; each runner (name, club number) and, per position,
                                                        their time from the leg's start (« cumul »; « PM »: a control missed)
"""

from __future__ import annotations

import html as htmllib
import json
import re
import urllib.parse

from ..model import category, club_code, doc, klass, live_state, parse_time, runner

HOST = "co-live.fr"
BASE = f"https://{HOST}/olive/resultats.php"
# O'Live's states -> ours (« Arr? »: a finish that does not fit, met on runners recorded absent or retired); None: still
# out, waiting, or finished without their card read
STATUS = {"ok": "ok", "pm": "mp", "abd": "dnf", "abs": "dns", "dsq": "dsq", "hd": "ot", "nc": "nc", "arr?": "nc"}
OUT = {"run", "ant", "dep?", "arr"}
WAIT = {"wait", "start", "dép", "dep"}


def _word(s: str) -> str:
    return (s or "").strip().lower().replace(".", "")


def _text(s: str) -> str:
    return htmllib.unescape(s or "").strip()


def races(s: str) -> list[dict]:
    """The races on offer: [{id, name, date, type}]."""
    out = []
    for m in re.finditer(r'<a href="\?Action=ChoixResultats&amp;IdCourse=(\d+)"[^>]*>([^<]*)</a>\s*<p class="InfoCourse">(.*?)</p>', s, re.S):
        day = re.search(r"(\d{2})/(\d{2})/(\d{4})", m.group(3))
        kind = re.search(r"<span>([^<]*)</span>", m.group(3))
        out.append({"id": int(m.group(1)), "name": _text(m.group(2)), "date": f"{day[3]}-{day[2]}-{day[1]}" if day else None,
                    "type": _text(kind.group(1)) if kind else ""})
    return out


def circuits(s: str, cid: int) -> list[str]:
    return list(dict.fromkeys(urllib.parse.unquote(htmllib.unescape(c))
                              for c in re.findall(rf'\?Action=Result&amp;IdCourse={cid}&amp;Circuit=([^"&]+)"', s)))


def rows(s: str) -> list[dict]:
    """A circuit's results page: [{place, bib, name, cat, club, code, word, time_s, start_s}]."""
    out = []
    for part in s.split('data-role="collapsible" data-enhanced="true"')[1:]:
        name = re.search(r'<span class="NomCoureur"(?: title="Dossard #([^"]*)")?>([^<]*)</span>', part)
        if not name:
            continue
        g = lambda cls: _text((re.search(rf'<span class="{cls}">(?:<a [^>]*>)?([^<]*)<', part) or [None, ""])[1])
        dep = re.search(r'<span class="HeureDepart">\s*(\d{1,2})\s*h\s*(\d{2})', part)
        start = int(dep[1]) * 3600 + int(dep[2]) * 60 if dep else 0               # (« 00 h 00 »: none)
        place = g("Place")
        out.append({"place": int(place) if place.isdigit() else None, "bib": name.group(1) or None, "name": _text(name.group(2)),
                    "cat": g("Categorie"), "club": g("LibClub"), "code": g("NumClub"), "word": _word(g("Status")),
                    "time_s": parse_time(g("Temps")), "start_s": start or None})
    return out


def split_page(s: str) -> tuple[list[str], dict]:
    """A circuit's split times page: the controls' codes in order (the finish apart), and each runner's cumulative times
    by « name|club number »."""
    head = [c.strip() for c in re.findall(r'<th class="split"><div class="ordre">[^<]*</div><div class="code">([^<]*)</div>', s)]
    codes = head[:-1] if head and not head[-1].isdigit() else head
    times = {}
    for tr in re.split(r'<tr class="[^"]*"><td class="infos-coureur">', s)[1:]:
        name = re.search(r'<div class="coureur">([^<]*)</div>', tr)
        code = re.search(r'<div class="club">([^<]*)</div>', tr)
        if not name:
            continue
        cells = tr.split('<td class="split">')[1:len(codes) + 1]
        t = []
        for i in range(len(codes)):
            m = re.search(r'<div class="cumul[^"]*">([^<]*)<', cells[i] if i < len(cells) else "")
            v = parse_time(_text(m.group(1))) if m else None
            t.append(v if v else None)
        times[f"{_text(name.group(1))}|{_text(code.group(1)) if code else ''}"] = t
    return codes, times


def relay_cats(s: str, cid: int) -> list[tuple[int, str]]:
    """A relay's categories, in the page's order: [(id, name)]."""
    return [(int(m[1]), _text(m[2])) for m in re.finditer(rf'\?Action=Result&amp;IdCourse={cid}&amp;IdCat=(\d+)"[^>]*>([^<]*)<', s)]


def relay_teams(s: str) -> list[dict]:
    """A relay category's teams: [{bib, name, place, word, legs: [{leg, name, time_s, place, word}]}], the legs in the order
    of their numbers (live/src/olive.js `relay`, in Python)."""
    span = lambda k, p: _text((re.search(rf'<span class="{k}">([^<]*)<', p) or [None, ""])[1])
    state = lambda k, p: _word(_text((re.search(rf'<span class="{k}">\s*(?:<a [^>]*>)?([^<]*)<', p) or [None, ""])[1]))
    num = lambda x: int(x) if x.isdigit() else None
    teams = []
    for part in s.split('<div class="EnteteEquipe')[1:]:
        bib = span("Dossard", part)
        pieces = part.split('<p class="Detail_1">')
        # (a leg's block, in the piece before it, is « Arrive DetailEquipe » once the leg is through)
        legs = [{"leg": num(span("NumRelayeur", p)) or i + 1, "name": span("NomRelayeur", p),
                 "time_s": parse_time(span("TempsRelayeur", p)), "place": num(span("PlaceRelayeur", p)),
                 "cumul": parse_time(span("TempsCumulRelayeur", p)), "word": state("StatusRelayeur", p),
                 "arrived": bool(re.search(r'<div class="Arrive\b[^"]*DetailEquipe', pieces[i]))}
                for i, p in enumerate(pieces[1:])]
        name = span("NomEquipe", part)
        teams.append({"bib": bib or None, "name": re.sub(rf"^{re.escape(bib)}\s+", "", name) if bib else name,
                      "place": num(span("PlaceEquipe", part)), "word": state("StatusEquipe", part),
                      "legs": sorted(legs, key=lambda x: x["leg"])})
    return teams


def relay_split_page(s: str) -> tuple[list[str], dict]:
    """A relay leg's split times page: each position's label (its codes, « 127/172 » where forked; the finish apart), and
    each runner's times from the leg's start by « name|club number » (None for a control missed)."""
    head = s.split("<tbody")[0]
    cols = ["/".join(c.strip() for c in re.findall(r"<div class>([^<]*)</div>", th))
            for th in re.findall(r'<th class="split">(.*?)</th>', head, re.S) if '<div class="ordre">' in th]
    labels = cols[:-1] if cols and cols[-1] in ("A", "") else cols
    times = {}
    for tr in re.split(r'<tr class="[^"]*"><td class="infos-coureur">', s)[1:]:
        name = re.search(r'<div class="coureur">([^<]*)</div>', tr)
        code = re.search(r'<div class="club">([^<]*)</div>', tr)
        if not name:
            continue
        cells = tr.split('<td class="split">')[1:len(labels) + 1]
        t = []
        for i in range(len(labels)):
            m = re.search(r'<div class="cumul[^"]*"[^>]*>([^<]*)<', cells[i] if i < len(cells) else "")
            t.append((parse_time(_text(m.group(1))) or None) if m else None)
        times[f"{_text(name.group(1))}|{_text(code.group(1)) if code else ''}"] = t
    return labels, times


class OLive:
    """co-live.fr's races (ids: its IdCourse numbers), read as documents of kind « olive »."""

    def __init__(self, fetcher):
        self.f = fetcher
        self._list = None
        self._pages: dict[tuple, str | None] = {}

    def _get(self, q: str) -> str | None:
        if q not in self._pages:
            a = self.f.get(f"{BASE}?{q}" if q else BASE, conditional=False)
            self._pages[q] = a.content.decode("utf-8", "replace") if a.status == 200 else None
        return self._pages[q]

    def competitions(self) -> list[dict]:
        """[{id, name, organizer, date}] of the individual races on offer (O'Live gives no organiser)."""
        if self._list is None:
            self._list = [{"id": r["id"], "name": r["name"], "organizer": "", "date": r["date"]}
                          for r in races(self._get("") or "") if r["date"] and not re.search(r"relais", r["type"], re.I)]
        return self._list

    def relays(self) -> list[dict]:
        """[{id, name, date}] of the relays on offer."""
        return [{"id": r["id"], "name": r["name"], "date": r["date"]} for r in races(self._get("") or "")
                if r["date"] and re.search(r"relais", r["type"], re.I)]

    def _relay(self, cid: int) -> list[tuple[int, str, list[dict]]] | None:
        """A relay's categories and their teams, or None when a page fails or the budget runs out."""
        page = self._get(f"Action=ChoixCategories&IdCourse={cid}")
        if page is None:
            return None
        out = []
        for k, name in relay_cats(page, cid):
            if self.f.out_of_time():
                return None
            s = self._get(f"Action=Result&IdCourse={cid}&IdCat={k}")
            if s is None:
                return None
            out.append((k, name, relay_teams(s)))
        return out

    def relay_fingerprint(self, cid: int) -> str | None:
        """What changes as a relay's legs come in: each category's legs and their states (the category pages, which a
        read needs anyway: the split times pages are spared when nothing moved)."""
        cats = self._relay(int(cid))
        if not cats:
            return None
        return json.dumps({name: sorted(f"{t['bib']}.{x['leg']}:{x['word']}:{x['time_s'] if x['word'] in STATUS else ''}"
                                        for t in teams for x in t["legs"]) for _, name, teams in cats}, sort_keys=True)

    def read_relay(self, cid: int) -> dict | None:
        """A relay's split times: one class per category and leg, its runners those of that leg who are through — their
        team as their « club », their FFCO club number from the split times page, the leg's time and place."""
        cid = int(cid)
        cats = self._relay(cid)
        if not cats:
            return None
        meta = next((c for c in self.relays() if c["id"] == cid), {})
        classes, out = [], 0
        for k, cat, teams in cats:
            for leg in range(1, max((x["leg"] for t in teams for x in t["legs"]), default=0) + 1):
                legs = [(t, x) for t in teams for x in t["legs"] if x["leg"] == leg]
                # « Ant »: the leg started in the mass start, and keeps that word once through (2026-10-25, the CNE's last
                # legs): through when its block says « Arrive » or the team has its total at the handover — a control
                # missed when its split times lack one
                done = lambda x: x["word"] in STATUS or (x["word"] == "ant" and (x["arrived"] or x["cumul"] is not None))
                out += sum(1 for _, x in legs if not done(x) and (x["word"] in OUT or x["word"] in WAIT))
                through = [(t, x) for t, x in legs if done(x)]
                if not through:
                    continue
                if self.f.out_of_time():
                    return None
                labels, times = relay_split_page(self._get(f"Action=Splits&IdCourse={cid}&IdCat={k}&NumRel={leg}") or "")
                by_name = {}
                for key, v in times.items():
                    name, code = key.split("|", 1)
                    by_name.setdefault(name, []).append((code, v))
                runners = []
                for t, x in through:
                    got = by_name.get(x["name"]) or []
                    code, sp = got[0] if len(got) == 1 else (None, None)      # (a name twice on a leg: neither taken)
                    st = STATUS.get(x["word"]) or ("mp" if not sp or None in sp else "ok")
                    runners.append(runner(x["name"], club=t["name"] or None, club_code=club_code(code), bib=t["bib"],
                                          status=st, time_s=x["time_s"] if st == "ok" else None,
                                          splits=sp if sp and any(v is not None for v in sp) else None))
                # the leg's places by its times: O'Live's « place » there is the team's at the handover
                done_t = sorted(r["time_s"] for r in runners if r["status"] == "ok")
                for r in runners:
                    if r["status"] == "ok":
                        r["place"] = 1 + sum(1 for v in done_t if v < r["time_s"])
                classes.append(klass(f"{cat} · Relayeur {leg}", runners, controls=labels or None))
        d = doc("olive", classes, by="circuit", title=meta.get("name"), date=meta.get("date"))
        if live := live_state(out, None, None):
            d["live"] = live
        return d if d["classes"] else None

    def of_day(self, race, context: str = "", named: bool = True) -> tuple[int | None, str | None]:
        """A link to O'Live naming no race (« Résultats provisoires » -> its home page): the race of that day whose name
        fits the race's best; else the one alone of the day with a word of its name (a place, not « sprint ») on the page
        holding the link (2026-10-24: the CF Sprint, cancelled, replaced by « Sprint Labyrinthe - Le Bessat », its page
        « Sprint Forêt … Fléchage depuis l'entrée du village du Bessat »); else, when the link itself names the race
        (`named`), the day's only one. Answers (its id, how: "name", "page" or "only"), (None, None) when none fits."""
        from ..races import GENERIC, QUALIFIERS, _words, match_score
        day = [c for c in self.competitions() if c["date"] == race["date_iso"]]
        best = sorted(((match_score(race, c["name"], ""), c["id"]) for c in day), reverse=True)
        if best and best[0][0] >= 1.0 and (len(best) == 1 or best[1][0] < best[0][0]):
            return best[0][1], "name"
        page = set(_words(re.sub(r"<[^>]+>", " ", htmllib.unescape(context or ""))))
        own = lambda c: {w for w in _words(c["name"]) if len(w) >= 4 and w not in GENERIC and w not in QUALIFIERS and not w.isdigit()}
        said = [c["id"] for c in day if own(c) & page]
        if len(said) == 1:
            return said[0], "page"
        return (day[0]["id"], "only") if named and len(day) == 1 else (None, None)

    def _circuits(self, cid: int) -> dict[str, list[dict]] | None:
        page = self._get(f"Action=ChoixCircuits&IdCourse={cid}")
        if page is None:
            return None
        out = {}
        for c in circuits(page, cid):
            if self.f.out_of_time():
                return None
            s = self._get(f"Action=Result&IdCourse={cid}&Circuit={urllib.parse.quote(c)}")
            if s is None:
                return None
            out[c] = rows(s)
        return out

    def fingerprint(self, cid: int) -> str | None:
        """What changes as results come in: each circuit's runners and their states (the circuits' pages, which a read
        needs anyway: the split times pages are spared when nothing moved)."""
        by = self._circuits(int(cid))
        if not by:
            return None
        return json.dumps({c: sorted(f"{r['bib']}:{r['word']}:{r['time_s'] if r['word'] in STATUS else ''}" for r in rs)
                           for c, rs in by.items()}, sort_keys=True)

    def read(self, cid: int) -> dict | None:
        cid = int(cid)
        by = self._circuits(cid)
        if not by:
            return None
        title = next((c["name"] for c in self.competitions() if c["id"] == cid), None)
        if not title:
            m = re.search(r"<h1>([^<]*)</h1>", self._get(f"Action=ChoixCircuits&IdCourse={cid}") or "")
            title = _text(m.group(1)) if m else None
        day = next((c["date"] for c in self.competitions() if c["id"] == cid), None)
        classes, out, nxt = [], 0, None
        for c, rs in by.items():
            through = [r for r in rs if r["word"] in STATUS]
            out += sum(1 for r in rs if r["word"] in OUT or (r["word"] in WAIT and r["start_s"]))
            starts = [r["start_s"] for r in rs if r["word"] in WAIT and r["start_s"]]
            if starts:
                nxt = min([nxt, *starts]) if nxt is not None else min(starts)
            if not through:
                continue
            if self.f.out_of_time():
                return None
            codes, times = split_page(self._get(f"Action=Splits&IdCourse={cid}&Circuit={urllib.parse.quote(c)}") or "")
            runners = []
            for r in through:
                st = STATUS[r["word"]]
                sp = times.get(f"{r['name']}|{r['code']}")
                runners.append(runner(r["name"], club=r["club"] or None, club_code=club_code(r["code"]), bib=r["bib"],
                                      status=st, time_s=r["time_s"] if st == "ok" else None,
                                      place=r["place"] if st == "ok" else None,
                                      # (an FFCO class only, « D18-20 » too: match.py reads its first letter as the sex)
                                      category=category(r["cat"]) or (r["cat"] if re.match(r"[HD]\d", r["cat"]) else None),
                                      splits=sp if sp and any(v is not None for v in sp) else None))
            classes.append(klass(c, runners, controls=codes or None))
        d = doc("olive", classes, by="circuit", title=title, date=day)
        if live := live_state(out, nxt, None):
            d["live"] = live
        return d if d["classes"] else None

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
out, waiting or finished without their card read (« Arr ») are left out and counted in the document's `live`. A relay's
pages show teams: only individual races are read.
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

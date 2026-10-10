"""liveresultat.orientering.se: the live results MeOS (and OE) publish during a race, through a public JSON API.

getcompetitions lists every competition (id, name, organizer, date; about 1 MB, read once per run); the French
ones of a race's day are matched to it by name, place, organiser and race type, then each class is read with
getclassresults (times in hundredths). No category, no year of birth; its radio controls' times are not kept (a
spectator control and the last one: too few for a split analysis). The class is usually the circuit.
"""

from __future__ import annotations

import json
import re

from ..model import club_code, category, doc, klass, plain, runner

API = "https://liveresultat.orientering.se/api.php"
# liveresultat status codes -> ours (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 OT, 9/10 not started yet, 11 walkover, 12 moved up)
STATUS = {0: "ok", 1: "dns", 2: "dnf", 3: "mp", 4: "dsq", 5: "ot", 11: "dns", 12: "nc", 13: "ok"}
TYPE_WORDS = {"Sprint": ("sprint",), "MD": ("md", "moyenne"), "LD": ("ld", "longue"), "Nuit": ("nuit", "nocturne", "night")}


def _json(content: bytes):
    """The API's JSON, which is sometimes not quite JSON (stray backslashes in names)."""
    s = content.decode("utf-8", "replace")
    try:
        return json.loads(s)
    except ValueError:
        return json.loads(re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", s))


def _competitions(s: str) -> list[dict]:
    """The competition list, entry by entry: names carry unescaped quotes (« PD "Avala" Beograd ») that break
    the whole document as JSON, so each field is read between its fixed neighbours instead."""
    out = []
    for chunk in re.split(r'\}\s*,\s*\{(?=\s*"id")', s):
        cid = re.search(r'"id"\s*:\s*(\d+)', chunk)
        day = re.search(r'"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"', chunk)
        if not cid or not day:
            continue
        def between(a: str, b: str) -> str:
            i = chunk.find(a)
            j = chunk.find(b, i + len(a)) if i >= 0 else -1
            return chunk[i + len(a):j] if i >= 0 and j >= 0 else ""
        out.append({"id": int(cid.group(1)), "name": between('"name": "', '", "organizer"'),
                    "organizer": between('"organizer": "', '", "date"'), "date": day.group(1)})
    return out


class LiveResultat:
    def __init__(self, fetcher):
        self.f = fetcher
        self._comps = None
        self._info: dict[int, dict] = {}

    def competitions(self) -> list[dict]:
        if self._comps is None:
            a = self.f.get(API, conditional=False, params={"method": "getcompetitions"})
            self._comps = _competitions(a.content.decode("utf-8", "replace")) if a.status == 200 else []
        return self._comps

    def info(self, comp_id: int) -> dict:
        if comp_id not in self._info:
            a = self.f.get(API, conditional=False, params={"method": "getcompetitioninfo", "comp": comp_id})
            self._info[comp_id] = _json(a.content) if a.status == 200 else {}
        return self._info[comp_id]

    def candidates(self, race) -> list[tuple[float, dict]]:
        """The competitions of the race's day that look like it, best first, with a score in 0..1."""
        out = []
        words = set(re.findall(r"[a-z0-9]+", plain(f"{race['name']} {race['place'] or ''} {race['org'] or ''}")))
        words -= {"de", "la", "le", "du", "des", "et", "co", "course", "orientation", "club", "d", "l"}
        for c in self.competitions():
            if c.get("date") != race["date_iso"]:
                continue
            text = plain(f"{c.get('name', '')} {c.get('organizer', '')}")
            cw = set(re.findall(r"[a-z0-9]+", text))
            score = len(words & cw) / max(1, min(len(words), len(cw)))
            code = race["org_code"]
            if code and len(code) == 4 and code in text:
                score += 0.5
            # the race type must not contradict (a sprint is not the MD of the same weekend)
            t = race["epreuve"]
            if t in TYPE_WORDS:
                others = [w for k, ws in TYPE_WORDS.items() if k != t for w in ws]
                if any(w in cw for w in TYPE_WORDS[t]):
                    score += 0.3
                elif any(w in cw for w in others):
                    score -= 0.6
            if score >= 0.34:
                out.append((score, c))
        out.sort(key=lambda x: -x[0])
        # keep only French competitions (time zone Europe/Paris), and only the best when they tie badly
        return [(s, c) for s, c in out[:4] if (self.info(c["id"]).get("timezone") or "Europe/Paris") == "Europe/Paris"]

    def read(self, comp_id: int) -> dict | None:
        """One competition, every class: a model.doc."""
        a = self.f.get(API, conditional=False, params={"method": "getclasses", "comp": comp_id})
        if a.status != 200:
            return None
        classes = []
        for c in _json(a.content).get("classes", []):
            if self.f.out_of_time():
                break
            name = c.get("className")
            r = self.f.get(API, conditional=False, params={"method": "getclassresults", "comp": comp_id,
                                                         "unformattedTimes": "true", "class": name})
            if r.status != 200:
                continue
            data = _json(r.content)
            # (its "splits" are the radio controls only — a spectator control and the last one —: no split analysis)
            rows = []
            for x in data.get("results", []):
                st = STATUS.get(int(x.get("status", 0)), None)
                if st is None:                       # not started yet / still running
                    continue
                res = x.get("result")
                t = int(res) / 100 if st == "ok" and str(res).lstrip("-").isdigit() else None
                place = x.get("place")
                start = x.get("start")                      # hundredths of a second after midnight
                rows.append(runner(x.get("name", ""), place=int(place) if str(place).isdigit() else None,
                                   club=x.get("club"), club_code=club_code(x.get("club")), time_s=t, status=st,
                                   category=category(name),
                                   start_s=int(start) / 100 if str(start).isdigit() and int(start) > 0 else None))
            classes.append(klass(name, rows))
        by = "category" if classes and all(category(c["name"]) for c in classes) else "circuit"
        info = self.info(comp_id)
        return doc("liveresultat", classes, by=by, title=f"{info.get('name', '')} ({info.get('organizer', '')})".strip(),
                   date=info.get("date"))

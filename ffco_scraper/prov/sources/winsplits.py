"""WinSplits Online (obasen.orientering.se): split times uploaded by organisers, worldwide.

Events have sequential ids (databaseId). Each run moves forward from the last id seen, reading each new event's
class page, whose title says "Name, Organiser [dd/mm/yyyy]"; an event of a watched race's day whose name or
organiser matches it is kept. Its split tables (one HTML table per class: leg and cumulative time per control,
plus the finish) are then read. The binary .spl download is a private format: the HTML tables are used instead.
"""

from __future__ import annotations

import html as htmllib
import re

from ..model import category, club_code, doc, klass, parse_time, plain, runner, status_of
from ..store import meta_get, meta_set

BASE = "https://obasen.orientering.se/winsplits/online/en"
START_ID = 115300              # early September 2026: the pilot covers the past month
MISSES_TO_STOP = 8             # consecutive ids that do not exist yet: the end of the list


def _text(cell: str) -> str:
    cell = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", cell)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def _time(text: str | None) -> float | None:
    """WinSplits writes times as m.ss or h.mm.ss ("1.19", "14.00", "1.02.03"), sometimes with a rank: "1.19 (3)"."""
    t = re.sub(r"\s*\(\d+\)$", "", str(text or "")).strip()
    if re.fullmatch(r"\d+(\.\d{2}){1,2}", t) or re.fullmatch(r"\d+:\d{2}\.\d{2}", t):   # "1:10.08" is 1 h 10 min 8 s
        t = t.replace(".", ":")
    return parse_time(t)


class WinSplits:
    def __init__(self, fetcher, con):
        self.f = fetcher
        self.con = con

    def event(self, db_id: int) -> dict | None:
        """{id, name, organiser, date, classes: [(categoryId, name)]} or None if the id does not exist."""
        a = self.f.get(f"{BASE}/classes.asp", conditional=False, params={"databaseId": db_id})
        if a.status != 200:
            return None
        s = a.content.decode("latin-1")
        # the event's title is one text node: "Name, Organiser [dd/mm/yyyy]"
        node = re.search(r">([^<>]*\[\d{2}/\d{2}/\d{4}\])\s*<", s)
        head = node and re.search(r"(.+),\s*([^,]+?)\s*\[(\d{2})/(\d{2})/(\d{4})\]", htmllib.unescape(node.group(1)).strip())
        if not head:
            return None
        classes = []
        for cid, name in re.findall(r'categoryId=(\d+)"[^>]*>([^<]+)</a>', s, re.I):
            if (int(cid), name.strip()) not in classes:
                classes.append((int(cid), htmllib.unescape(name.strip())))
        return {"id": db_id, "name": head.group(1).strip(), "organiser": head.group(2).strip(),
                "date": f"{head.group(5)}-{head.group(4)}-{head.group(3)}", "classes": classes}

    def discover(self, limit: int = 1500) -> list[dict]:
        """New events since the last run (saved in prov_meta 'winsplits'), each with its header."""
        state = meta_get(self.con, "winsplits", {"next": START_ID, "events": {}})
        i, misses, found = state["next"], 0, []
        for _ in range(limit):           # the run's time budget stops it first
            if self.f.out_of_time():
                break
            ev = self.event(i)
            if ev is None:
                misses += 1
                if misses >= MISSES_TO_STOP:
                    break
            else:
                misses = 0
                state["events"][str(i)] = {k: ev[k] for k in ("name", "organiser", "date")}
                state["next"] = i + 1
                found.append(ev)
                if len(found) % 25 == 0:               # saved as it goes: a long first scan is never redone
                    meta_set(self.con, "winsplits", state)
                    self.con.commit()
            i += 1
        # keep the headers of the last few weeks only
        keep = sorted(state["events"], key=int)[-600:]
        state["events"] = {k: state["events"][k] for k in keep}
        meta_set(self.con, "winsplits", state)
        self.con.commit()
        return found

    def candidates(self, race) -> list[tuple[float, int]]:
        """Known events of the race's day that look like it: (score, id), best first."""
        state = meta_get(self.con, "winsplits", {"events": {}})
        words = set(re.findall(r"[a-z0-9]+", plain(f"{race['name']} {race['place'] or ''} {race['org'] or ''}")))
        words -= {"de", "la", "le", "du", "des", "et", "co", "course", "orientation", "club", "d", "l"}
        out = []
        for k, ev in state["events"].items():
            if ev["date"] != race["date_iso"]:
                continue
            ew = set(re.findall(r"[a-z0-9]+", plain(f"{ev['name']} {ev['organiser']}")))
            score = len(words & ew) / max(1, min(len(words), len(ew)))
            if score >= 0.34:
                out.append((score, int(k)))
        return sorted(out, reverse=True)

    def read(self, db_id: int) -> dict | None:
        ev = self.event(db_id)
        if not ev:
            return None
        classes = []
        for cid, name in ev["classes"]:
            if self.f.out_of_time():
                break
            a = self.f.get(f"{BASE}/table.asp", conditional=False, params={"databaseId": db_id, "categoryId": cid})
            if a.status != 200:
                continue
            k = self._table(a.content.decode("latin-1"), name)
            if k:
                classes.append(k)
        by = "category" if classes and all(category(c["name"]) for c in classes) else "circuit"
        return doc("winsplits", classes, by=by, title=f"{ev['name']}, {ev['organiser']}", date=ev["date"])

    def _table(self, s: str, name: str) -> dict | None:
        """One class's split table: rows of two lines (leg / cumulative); header cells give the control codes."""
        rows = re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", s)
        if len(rows) < 2:
            return None
        cells = lambda r: [_text(c) for c in re.findall(r"(?is)<td[^>]*>(.*?)</td>", r)]
        # control codes: the second header row labels each leg "S-1 (36)", "1-2 (37)"…, the last one the finish
        codes = []
        for r in rows[:3]:
            for c in cells(r):
                m = re.match(r"^(?:S|\d+)-(\d+|F)\s*\((\d+)\)$", c)
                if m:
                    codes.append(m.group(2))
        out = []
        i = 0
        while i < len(rows):
            c = cells(rows[i])
            if c and re.fullmatch(r"\d+|-|", c[0] or "-") and len(c) > 3 and re.search(r"[A-Za-zÀ-ÿ]", c[1] if len(c) > 1 else ""):
                # first line: place, name, leg times…, the name again; second line: club, cumulative times
                # (the last one at the finish), the club again
                nxt = cells(rows[i + 1]) if i + 1 < len(rows) else []
                place = int(c[0]) if c[0].isdigit() else None
                cum = [_time(x) for x in nxt[1:-1]] if nxt else []
                total = cum[-1] if cum and cum[-1] else None
                st = "ok" if total and place else (status_of(c[-2] if len(c) > 1 else "") or "mp")
                splits = cum[:-1] if len(cum) > 1 else None
                out.append(runner(c[1], place=place, club=nxt[0] if nxt else None, club_code=club_code(nxt[0] if nxt else ""),
                                  time_s=total if st == "ok" else None, status=st, splits=splits, category=category(name)))
                i += 2
                continue
            i += 1
        if not out:
            return None
        n = max((len(r["splits"] or []) for r in out), default=0)
        controls = codes[:n] if len(codes) >= n else [str(j + 1) for j in range(n)]
        for r in out:
            if r["splits"] is not None and len(r["splits"]) != n:
                r["splits"] = (r["splits"] + [None] * n)[:n]
        return klass(name, out, controls=controls or None)

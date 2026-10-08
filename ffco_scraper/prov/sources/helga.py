"""Helga (helga-o.live): results and split times from the HELGA timing software, used by some French clubs (and in
Belgium, Portugal, Brazil…).

Its results pages (helga-o.com/webres, the helga-o.live home page) answer robots with "403": they are not read. Its
SplitsBrowser pages are open to them, and robots.txt allows /splits/ to every robot it does not name: there,
splitsbrowser.php?lauf=N is a small page titled "Name - d.m.yyyy", and readsplits.php?lauf=N the full result list in
IOF XML 3.0, with split and start times (parsers.iofxml). Events are numbered in sequence when the organiser creates
them (before the race): each run reads the titles of the new numbers, and an event whose date and name match a
watched race (races.assign) has its list read. State in prov_meta 'helga': next = the next number to try, events =
the titles seen (the last few weeks').
"""

from __future__ import annotations

import html as htmllib
import re

from ..parsers import iofxml
from ..store import meta_get, meta_set

BASE = "https://helga-o.live/splits"
START_ID = 6950                # early September 2026: the pilot covers the past month
MISSES_TO_STOP = 12            # numbers in a row without an event: none created yet


class Helga:
    def __init__(self, fetcher, con):
        self.f = fetcher
        self.con = con

    def event(self, n: int) -> dict | None:
        """{name, date} of event n, or None if there is none (yet)."""
        a = self.f.get(f"{BASE}/splitsbrowser.php", conditional=False, params={"lauf": n})
        if a.status != 200:
            return None
        m = re.search(r"<title>\s*(.*?)\s+-\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s*</title>", a.content.decode("utf-8", "replace"), re.S)
        if not m:
            return None
        return {"name": htmllib.unescape(m.group(1)).strip(), "date": f"{m.group(4)}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"}

    def discover(self, limit: int = 200) -> int:
        """Reads the titles of the numbers created since the last run; the number of events found."""
        state = meta_get(self.con, "helga", None) or {"next": START_ID, "events": {}}
        i, misses, found = state["next"], 0, 0
        while limit > 0 and misses < MISSES_TO_STOP and not self.f.out_of_time():
            limit -= 1
            ev = self.event(i)
            if ev is None:
                misses += 1
            else:
                misses = 0
                state["events"][str(i)] = ev
                state["next"] = i + 1
                found += 1
            i += 1
        kept = sorted(state["events"], key=int)[-600:]
        state["events"] = {k: state["events"][k] for k in kept}
        meta_set(self.con, "helga", state)
        self.con.commit()
        return found

    def events(self) -> dict[str, dict]:
        return (meta_get(self.con, "helga", None) or {"events": {}})["events"]

    def read(self, n: int) -> dict | None:
        a = self.f.get(f"{BASE}/readsplits.php", conditional=False, params={"lauf": n})
        if a.status != 200:
            return None
        return iofxml.parse(a.content, a.url)

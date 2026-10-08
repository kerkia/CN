"""Orientation Data (heyries.alwaysdata.net): a results site fed by MeOS, used in Provence-Alpes-Côte d'Azur.

The home page lists the competitions (name, date, organiser) with a link to each; a competition's page lists its
classes, and each class page gives the results with every split time (read by parsers.meos_html). No robots.txt
restriction. A class shared by several categories ("D12 / H12 / Open Bleu") is a circuit, and names carry an
annotation ("(1e cat.)") that is not part of them.
"""

from __future__ import annotations

import html as htmllib
import re

from ..model import doc
from ..parsers import meos_html

BASE = "https://heyries.alwaysdata.net"


class Heyries:
    def __init__(self, fetcher):
        self.f = fetcher
        self._list = None

    def competitions(self) -> list[dict]:
        """[{id, name, organizer, date}] from the home page's cards."""
        if self._list is None:
            a = self.f.get(f"{BASE}/", conditional=False)
            s = a.content.decode("utf-8", "replace") if a.status == 200 else ""
            out = []
            for card in re.split(r'<div class="co-card', s)[1:]:
                cid = re.search(r'href="/competition/(\d+)/"', card)
                name = re.search(r'<span class="text-truncate" title="([^"]+)"', card)
                day = re.search(r">\s*(\d{2})/(\d{2})/(\d{4})\s*<", card)
                org = re.search(r'class="org-site-link">([^<]+)<', card) or re.search(r"bi-building[^>]*></i>\s*([^<]+)<", card)
                if cid and name and day:
                    out.append({"id": int(cid.group(1)), "name": htmllib.unescape(name.group(1)),
                                "organizer": htmllib.unescape(org.group(1).strip()) if org else "",
                                "date": f"{day.group(3)}-{day.group(2)}-{day.group(1)}"})
            self._list = out
        return self._list

    def read(self, comp_id: int) -> dict | None:
        a = self.f.get(f"{BASE}/competition/{comp_id}/", conditional=False)
        if a.status != 200:
            return None
        s = a.content.decode("utf-8", "replace")
        classes = []
        for path in dict.fromkeys(re.findall(rf'href="(/competition/{comp_id}/class/[\w-]+/)"', s)):
            if self.f.out_of_time():
                break
            c = self.f.get(f"{BASE}{path}", conditional=False)
            d = meos_html.parse(c.content, f"{BASE}{path}") if c.status == 200 else None
            for k in (d or {}).get("classes", []):
                for r in k["runners"]:
                    r["name"] = re.sub(r"\s*\([^)]*\)\s*$", "", r["name"]).strip()
                classes.append(k)
        if not classes:
            return None
        comp = next((c for c in self.competitions() if c["id"] == comp_id), {})
        by = "circuit" if any("/" in k["name"] or "open" in k["name"].lower() for k in classes) else "category"
        return doc("heyries", classes, by=by, title=f"{comp.get('name', '')} ({comp.get('organizer', '')})", date=comp.get("date"))

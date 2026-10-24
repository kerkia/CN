"""Slovakia: the Slovak orienteering federation's information system (SZOŠ IS, is.orienteering.sk), its agenda only.

The competitions' year list (studied 2026-10-23): a server-rendered table, 30 rows a page, every competition of the
year, past ones included — day or days, name, place, branch (« OB » foot, « LOB » ski, « MTBO », « TRAIL »),
classification (« Majstrovstvá Slovenska », « Slovenský rebríček », « Oblastný rebríček », « Verejné preteky »…),
organising clubs' codes, the invitation. Seminars are courses, « tréning » trainings. Its robots.txt asks for 10 s
between two requests: about 4 pages a year, so ~80 s a day.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="SK", federation="SZOŠ", access="all", db=paths.DATA_DIR / "sk.sqlite3",
                  time_zones=("Europe/Bratislava",), lang="sk,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
BASE = "https://is.orienteering.sk"
SPEC = {"OB": agenda.FOOT, "LOB": agenda.SKI, "MTBO": agenda.MTBO, "TRAIL": agenda.TRAIL}
PAGES = 12                                   # (a year has 3-4)


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        for page in range(PAGES):
            a = http.get(f"{BASE}/competitions/filter/{year}" + (f"?page={page}" if page else ""))
            if a.status != 200:
                break
            doc = lh.fromstring(a.content.decode("utf-8", "replace"))
            rows = doc.cssselect("table.competitions tbody tr")
            for tr in rows:
                tds = tr.cssselect("td")
                if len(tds) < 7:
                    continue
                days = re.findall(r"(\d\d)\.(\d\d)\.(\d{4})", tds[0].text_content())
                link = tds[1].cssselect('a[href^="/competitions/"]')
                if not days or not link:
                    continue
                try:
                    start, end = (date(int(y), int(m), int(d)) for d, m, y in (days[0], days[-1]))
                except ValueError:
                    continue
                branch = tds[3].cssselect("abbr")
                level = tds[4].cssselect("abbr")
                level = (level[0].get("title") or "").strip() if level else ""
                name = re.sub(r"\s+", " ", link[0].text_content()).strip()
                inv = [x.get("href") for x in tds[6].cssselect("a") if x.get("title") == "Propozície"]
                out.append(agenda.event(
                    "SK", link[0].get("href").rsplit("/", 1)[-1], start.isoformat(), name,
                    kind="f" if re.match(r"školenie|seminár", level, re.I) else "e" if re.search(r"tréning", name, re.I) else "c",
                    end=end.isoformat(),
                    place=tds[2].text_content().strip() or None,
                    org=" ".join(x.text_content().strip() for x in tds[5].cssselect("a")) or None,
                    spec=SPEC.get(branch[0].text_content().strip()) if branch else None, level=level or None,
                    invitation=inv[0] if inv else None, src={"szos": BASE + link[0].get("href")}))
            if not rows or not doc.cssselect(f'a[href$="?page={page + 1}"]'):
                break
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"szos": "SZOŠ IS"},
                                                           pause=10.0)

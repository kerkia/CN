"""Poland: the Polish orienteering federation's competitions (PZOS, orienteering.org.pl/pzos), its agenda only.

The system's year page (studied 2026-10-23): one server-rendered table a year, every competition of the year, past ones
included — name, dates (day/month, the year in its own column), each stage's discipline (« BnO » foot, « MTBO »,
« NBnO » ski, « Trail-O ») and label (« Etap 1 », « Trening »), rank (« CTZ » the national calendar, « regionalne »,
« międzynarodowe »), organiser (« club, town »), website. One row per competition; the stages' places and entry
deadlines are on each competition's page, not read. « WRE zagraniczne » rows are World Ranking races abroad: left out.
"""
from __future__ import annotations

import collections
import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="PL", federation="PZOS", access="all", db=paths.DATA_DIR / "pl.sqlite3",
                  time_zones=("Europe/Warsaw",), lang="pl,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: the voivodeship of the organiser's town (countries/places, 2026-10-24)
BASE = "https://www.orienteering.org.pl"
SPEC = {"BnO": agenda.FOOT, "MTBO": agenda.MTBO, "NBnO": agenda.SKI, "Trail-O": agenda.TRAIL}
LEVEL = {"CTZ": "Centralny Terminarz Zawodów", "CTZ WRE polskie": "Centralny Terminarz Zawodów, WRE",
         "regionalne": "Regionalne", "międzynarodowe": "Międzynarodowe"}


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        a = http.get(f"{BASE}/pzos/competitions/{year}")
        if a.status != 200:
            continue
        for tr in lh.fromstring(a.content.decode("utf-8", "replace")).cssselect('tr[data-href^="/pzos/detail/competition/"]'):
            tds = tr.cssselect("td")
            if len(tds) < 7:
                continue
            rank = re.sub(r"\s+", " ", tds[4].text_content()).strip()
            if "zagraniczne" in rank:                     # (abroad)
                continue
            days = re.findall(r"(\d{1,2})/(\d{1,2})", tds[1].text_content())
            y = re.search(r"\d{4}", tds[3].text_content())
            if not days or not y:
                continue
            y = int(y.group(0))
            try:
                start = date(y, int(days[0][1]), int(days[0][0]))
                end = date(y, int(days[-1][1]), int(days[-1][0]))
            except ValueError:
                continue
            if end < start:                               # (« 30/12 - 2/1 »)
                end = end.replace(year=y + 1)
            stages = [(img.get("title"), (img.tail or "").strip()) for img in tds[2].cssselect("img")]
            specs = collections.Counter(SPEC.get(s) for s, _ in stages if SPEC.get(s))
            name = re.sub(r"\s+", " ", tds[0].text_content()).strip()
            training = bool(stages) and all(re.match(r"trening", lbl, re.I) for _, lbl in stages)
            link = tds[6].cssselect("a")
            site = link[0].get("href") if link and (link[0].get("href") or "").startswith("http") else None
            org = "; ".join(x.strip() for x in tds[5].itertext() if x.strip())
            labels = " ".join(lbl for _, lbl in stages)
            out.append(agenda.event(
                "PL", tr.get("data-href").rsplit("/", 1)[-1], start.isoformat(), name, kind="e" if training else "c",
                end=end.isoformat(), org=org or None, spec=specs.most_common(1)[0][0] if specs else None,
                epr=agenda.fmt_of(name, labels), site=site, level=LEVEL.get(rank, rank or None),
                src={"pzos": BASE + tr.get("data-href")}))
    return out


def place(e: dict) -> None:
    """The voivodeship of the organising club's town (« UKS Azymut 45, Gdynia »): the list gives no place, and a club
    races near home; no finer unit, which the club's town would not tell."""
    e.pop("dep", None)
    e["region"] = None
    for org in (e.get("org") or "").split(";"):
        if "," in org:
            agenda.locate("PL", e, org.rsplit(",", 1)[1], region_only=True)
            if e.get("region"):
                return
    agenda.locate("PL", e, e.get("name"), region_only=True)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"pzos": "PZOS"},
                                                           place=place)

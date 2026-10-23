"""Estonia: the Estonian orienteering federation's calendar (EOL, orienteerumine.ee/kalender), its agenda only.

The calendar's month view over any range of dates (server-rendered; studied 2026-10-23): one request a day for the
window — championships, the weekly « päevak » races, foot, ski-O, MTBO, trail-O and rogaines, with place, organising club,
format and entry deadline. It also lists the Estonian teams' races abroad, left out.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="EE", federation="EOL", access="all", db=paths.DATA_DIR / "ee.sqlite3",
                  time_zones=("Europe/Tallinn",), lang="et,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://orienteerumine.ee/kalender/kuu-ulevaade/"
SPEC = {"OJ": agenda.FOOT, "SO": agenda.SKI, "RO": agenda.MTBO, "TO": agenda.TRAIL, "RG": "Rogaining"}
FMT = {"Öine": agenda.NIGHT, "Teade": agenda.RELAY, "Öine teade": agenda.RELAY}
MONTHS = ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"]
LEVEL = {"EM": "Eesti meistrivõistlused", "KV": "Karikavõistlused"}
# the countries' names in Estonian (« Veszprém, Ungari »: a race abroad)
ABROAD = re.compile(r",\s*(?:ungari|soome|läti|leedu|rootsi|norra|taani|tšehhi|poola|slovakkia|sloveenia|horvaatia|šveits|"
                    r"saksamaa|austria|itaalia|hispaania|portugal|prantsusmaa|belgia|holland|suurbritannia|šotimaa|inglismaa|"
                    r"iirimaa|bulgaaria|rumeenia|kreeka|türgi|ukraina|valgevene|venemaa|jaapan|austraalia|uus-meremaa|island)\s*$",
                    re.I)


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    a = http.get(LIST, params={"view": "bymonth", "type": "ALL", "date_start": lo.isoformat(), "date_end": hi.isoformat()})
    if a.status != 200:
        return []
    doc = lh.fromstring(a.content)
    out = []
    for sec in doc.cssselect("section.eol-results"):
        ym = sec.get("id") or ""
        if not re.fullmatch(r"\d{6}", ym):
            continue
        for it in sec.cssselect("div.eol-result-item"):
            day = it.cssselect(".eol-result-item__col-date .day")
            link = it.cssselect(".row-name a")
            if not day or not link:
                continue
            d = f"{ym[:4]}-{ym[4:]}-{int(day[0].text_content().strip()):02d}"
            end = None                             # « 05 mai - 08 mai »: a multi-day event
            months = [m.text_content().strip(" .").lower() for m in it.cssselect(".eol-result-item__col-date .month")]
            if len(day) > 1 and len(months) > 1 and months[1] in MONTHS:
                mo = MONTHS.index(months[1]) + 1
                y = int(ym[:4]) + (mo < int(ym[4:]))
                end = f"{y}-{mo:02d}-{int(day[1].text_content().strip()):02d}"
            name = link[0].text_content().strip()
            code = re.search(r"eolcode=(\w+)", link[0].get("href") or "")
            place = " ".join(x.text_content().strip() for x in it.cssselect(".competiton-location")) or None
            if place and ABROAD.search(place):
                continue
            typ = " ".join(x.text_content().strip() for x in it.cssselect(".eol-result-item__col-type-club .row-value"))
            club = " ".join(x.text_content().strip() for x in it.cssselect(".eol-result-item__col-type-club .row-label"))
            labels = [x.text_content().strip() for x in it.cssselect(".eol-label")]
            spec = next((SPEC[x] for x in labels if x in SPEC and x != "OJ"), None) or (agenda.FOOT if "OJ" in labels else None)
            reg = re.search(r"(\d\d)\.(\d\d)\.(\d{4})", " ".join(x.text_content() for x in it.cssselect(".eol-result-item__col-reg")))
            page = f"https://orienteerumine.ee/voistlus/?eolcode={code.group(1)}" if code else link[0].get("href")
            out.append(agenda.event(
                "EE", code.group(1) if code else f"{d}{name}"[:24], d, name, end=end, place=place, org=club or None,
                spec=spec or ("Rogaining" if typ == "Rogain" else None), epr=FMT.get(typ) or agenda.fmt_of(name),
                level=next((LEVEL[x] for x in labels if x in LEVEL), None),
                reg={"url": page, "close": f"{reg.group(3)}-{reg.group(2)}-{reg.group(1)}"} if reg else None,
                src={"eol": page}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"eol": "EOL"})

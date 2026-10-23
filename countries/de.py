"""Germany: the German orienteering federation's calendar (DOSV, OManager — omanager.o-sport.de), its agenda only.

OManager's « Termine » list exported as CSV (an Oracle APEX report, cp1252, « ; »; studied 2026-10-23): every coming
event in one request — national and regional races, foot, MTBO, ski-O and trail-O, with level, format, place, organiser,
entry deadline, entry link, the organiser's site and the announcement. Past events are not in it: the agenda keeps the
races of the last weeks from its own earlier runs. The export has no event id: a row is known by its day, name and place.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="DE", federation="DOSV", access="all", db=paths.DATA_DIR / "de.sqlite3",
                  time_zones=("Europe/Berlin",), lang="de,en;q=0.5", results=False)
AGENDA_VERSION = 1
CSV_URL = "https://omanager.o-sport.de/service/f?p=105:5:0:CSV::::"
LIST_URL = "https://omanager.o-sport.de/service/f?p=105:5"
SPEC = {"OL": agenda.FOOT, "MTB-O": agenda.MTBO, "Ski-OL": agenda.SKI, "Trail-O": agenda.TRAIL}
FMT = {"Sprint": agenda.SPRINT, "Mittel": agenda.MIDDLE, "Lang": agenda.LONG, "Ultralang": agenda.LONG, "Nacht": agenda.NIGHT}
# OManager's levels (« Kl »): those that are not races here — world championships abroad, the federation's meetings
SKIP = {"WM", "ADM"}
# its levels named (the rest as OManager writes them)
LEVEL = {"DM": "Deutsche Meisterschaft", "LM": "Landesmeisterschaft", "LRL": "Landesranglistenlauf",
         "BRL": "Bundesranglistenlauf", "REG": "Regional", "INT": "International", "DCUP": "Deutschland-Cup",
         "TRA": "Training", "TL": "Trainingslager", "AUS": "Ausbildung"}
KIND = {"TRA": "e", "TL": "e", "AUS": "f"}       # trainings, training camps, coaches' and mappers' courses
ABROAD = re.compile(r"\((?!GER\))[A-Z]{3}\)\s*$")  # « Szekszárd (HUN) »


def _text(cell: str) -> str:
    cell = re.sub(r"<b[^>]*>[^<]*</b>", " ", cell or "")          # the list's « MORGEN » / « HEUTE » badges
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", cell)).replace("&amp;", "&").strip()


def _href(cell: str, title: str | None = None) -> str | None:
    for m in re.finditer(r'<a\b([^>]*)>', cell or ""):
        attrs = m.group(1)
        if title and f'title="{title}"' not in attrs:
            continue
        h = re.search(r'href="([^"]+)"', attrs)
        if h and h.group(1).startswith("http"):
            return h.group(1).replace("&amp;", "&")
    return None


def _day(s: str) -> str | None:
    try:
        return datetime.strptime(s.strip(), "%d.%m.%y").date().isoformat()
    except ValueError:
        return None


def read(http, today: date, prev: dict | None) -> list[dict]:
    a = http.get(CSV_URL)
    if a.status != 200 or not a.content.startswith(b"Datum"):
        return []
    out = []
    for r in csv.DictReader(io.StringIO(a.content.decode("cp1252", "replace")), delimiter=";"):
        day = _day(r.get("Datum") or "")
        sport = (re.findall(r'alt="([^"]*)"', r.get("Sportart") or "") or [""])[0]
        level = (r.get("Kl") or "").strip()
        name, place = _text(r.get("Name")), _text(r.get("Ort"))
        if not day or level in SKIP or (sport and sport not in SPEC) or ABROAD.search(place):
            continue
        cancelled = bool(re.match(r"ABGESAGT\b", name, re.I))
        name = re.sub(r"^ABGESAGT:?\s*", "", name, flags=re.I)
        typ, disc = (r.get("Typ") or "").strip(), (r.get("Disziplin") or "").strip()
        epr = agenda.RELAY if typ == "Staffel" else FMT.get(disc) or agenda.fmt_of(name)
        entry = _href(r.get("Melden"))
        close = _day(r.get("Meldedat.") or "")
        key = hashlib.sha1(f"{day}|{name}|{place}".encode()).hexdigest()[:10]
        out.append(agenda.event(
            "DE", key, day, name, kind=KIND.get(level, "c"), place=place or None, org=_text(r.get("Ausrichter")) or None,
            spec=SPEC.get(sport) or agenda.spec_of(name), epr=epr, level=LEVEL.get(level, level) or None, cancelled=cancelled,
            site=_href(r.get("Links"), "Veranstalter"), invitation=_href(r.get("Links"), "Ausschreibung"),
            reg={"url": entry, "close": close, "closed": "Geschlossen" in (r.get("Status") or "")} if entry else None,
            src={"omanager": LIST_URL}))
    # the last weeks' races, which the export no longer lists: as the last run saw them
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"omanager": "OManager"})

"""Italy: the Italian orienteering federation's calendar (FISO, www.fiso.it/gare), its agenda only.

The calendar's CSV export (cp1252, « ; »; studied 2026-10-23). It exports what the page's filter shows, a filter kept in
the visitor's session: the page is opened, the filter set for a year as the page itself sets it, then the CSV read — about
five requests a day for the window's years. Every race, foot, MTBO, ski-O and trail-O, with its level, place (province),
organising club and regional committee; school races left out. One row per day of a multi-day event.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="IT", federation="FISO", access="all", db=paths.DATA_DIR / "it.sqlite3",
                  time_zones=("Europe/Rome",), lang="it,en;q=0.5", results=False)
AGENDA_VERSION = 1
BASE = "https://www.fiso.it"
SPEC = {"CO": agenda.FOOT, "MTBO": agenda.MTBO, "SCIO": agenda.SKI, "TRAILO": agenda.TRAIL}
# the regional committees (« Organo di appartenenza »); « FISO »: the federation's own races
REGION = {"TN": "Trentino", "AA": "Alto Adige", "VE": "Veneto", "FR": "Friuli Venezia Giulia", "LB": "Lombardia",
          "PI": "Piemonte", "VA": "Valle d'Aosta", "LI": "Liguria", "EM": "Emilia-Romagna", "TO": "Toscana", "UM": "Umbria",
          "MA": "Marche", "LZ": "Lazio", "AB": "Abruzzo", "MO": "Molise", "CP": "Campania", "PU": "Puglia", "BA": "Basilicata",
          "CL": "Calabria", "SI": "Sicilia", "SA": "Sardegna"}
LEVEL = {"1^ LIV": "1° livello", "2^ LIV": "2° livello", "3^ LIV": "3° livello", "4^ LIV": "4° livello",
         "M. INT": "Manifestazione internazionale"}


def _year(http, year: int) -> list[dict]:
    """One year of the calendar, every discipline and level, school races apart."""
    http.get(f"{BASE}/gare")
    flt = {"filtro_gare_disciplina": "csmt", "filtro_gare_interesse": "minrp", "filtro_gare_anno": str(year),
           "filtro_gare_mese": "", "filtro_gare_com": "", "filtro_gare_scolastica": "escludi"}
    ok = http.post(f"{BASE}/_site/_ajax/setFiltri.php", data={"dati": json.dumps(flt), "page": "gare.php"})
    if ok.status != 200:
        return []
    a = http.get(f"{BASE}/csv-gare")
    if a.status != 200 or not a.content.startswith(b"DATA;"):
        return []
    rows = list(csv.DictReader(io.StringIO(a.content.decode("cp1252", "replace")), delimiter=";"))
    return [r for r in rows if r.get("ANNO") == str(year)]           # (the session's filter not taken: nothing)


def read(http, today: date) -> list[dict]:
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    out = []
    for year in range(lo.year, hi.year + 1):
        for r in _year(http, year):
            try:
                day = datetime.strptime(r["DATA"], "%d/%m/%Y").date().isoformat()
            except (KeyError, ValueError):
                continue
            name = (r.get("NOME") or "").strip()
            org = re.sub(r"^\d+\s*-\s*", "", r.get("SOCIETÀ ORGANIZZATRICE") or "").strip()
            code = f"{r['ANNO']}{r['NUMERO']}"
            out.append(agenda.event(
                "IT", code, day, name, place=(r.get("LUOGO") or "").strip(" ;") or None,
                region=REGION.get(r.get("ORGANO DI APPARTENENZA") or ""), org=org or None, spec=SPEC.get(r.get("DISCIPLINA")),
                level=LEVEL.get(r.get("INTERESSE") or "", r.get("INTERESSE") or None),
                cancelled="ANNULLATA" in (r.get("NOTE") or "").upper(),
                reg={"url": f"{BASE}/iscrizioni/{code}"} if r.get("STATO") == "DA SVOLGERE" else None,
                src={"fiso": f"{BASE}/gara/{code}"}))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"fiso": "FISO"})

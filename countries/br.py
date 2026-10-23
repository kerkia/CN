"""Brazil: the Brazilian orienteering confederation's calendar (CBO, www.cbo.org.br), its agenda only.

The JSON service CBO's pages read (Azimute Certo, cbo.esp.br/azimuteweb-ws; studied 2026-10-23): one request a month of
the window — municipal, state, regional and national events, with their state, town and organising club or federation.
Neither discipline nor format has a field: both are read from the name. The organisers' contacts it also sends are not
kept.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="BR", federation="CBO", access="all", db=paths.DATA_DIR / "br.sqlite3",
                  time_zones=("America/Sao_Paulo",), lang="pt-BR,pt;q=0.8,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://cbo.esp.br/azimuteweb-ws/getEventos/"
PAGE = "https://www.cbo.org.br/evento/{}"
STATES = {"AC": "Acre", "AL": "Alagoas", "AM": "Amazonas", "AP": "Amapá", "BA": "Bahia", "CE": "Ceará",
          "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MG": "Minas Gerais",
          "MS": "Mato Grosso do Sul", "MT": "Mato Grosso", "PA": "Pará", "PB": "Paraíba", "PE": "Pernambuco", "PI": "Piauí",
          "PR": "Paraná", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RO": "Rondônia", "RR": "Roraima",
          "RS": "Rio Grande do Sul", "SC": "Santa Catarina", "SE": "Sergipe", "SP": "São Paulo", "TO": "Tocantins"}
LOCAL = ZoneInfo("America/Sao_Paulo")


def _day(s: str | None) -> str | None:
    """« 2026-11-01T04:00:00.000Z » (midnight in the state's time) -> its day."""
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00")).astimezone(LOCAL).date().isoformat()
    except ValueError:
        return None


def read(http, today: date) -> list[dict]:
    lo, hi = today - timedelta(days=agenda.BACK_DAYS), today + timedelta(days=366)
    months, m = [], date(lo.year, lo.month, 1)
    while m <= hi:
        months.append((m.year, m.month))
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    out, seen = [], set()
    for y, mo in months:
        a = http.post(LIST, json={"listaUf": sorted(STATES), "mes": mo, "ano": y})
        if a.status != 200:
            continue
        try:
            rows = json.loads(a.content).get("data") or []
        except ValueError:
            continue
        for r in rows:
            day = _day(r.get("inicio"))
            if not day or r.get("_id") in seen:
                continue
            seen.add(r["_id"])
            where = r.get("endereco") or {}
            name = r.get("nome") or r.get("descritivo") or ""
            if r.get("etapa") and "etapa" not in agenda.fold(name):      # a circuit's stages share its name
                name = f"{name} — {r['etapa']} etapa"
            out.append(agenda.event(
                "BR", r.get("numero") or r["_id"], day, name, end=_day(r.get("fim")), place=where.get("cidade") or None,
                region=STATES.get(where.get("uf") or ""), org=(r.get("entidadeResponsavel") or {}).get("sigla") or None,
                level=r.get("abrangencia") or None, src={"cbo": PAGE.format(r["rota"])} if r.get("rota") else None))
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"cbo": "CBO"})

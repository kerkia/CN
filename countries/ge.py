"""Georgia: its competitions on OrienteeringOnline.net (countries/oonline.py), its agenda only."""
from __future__ import annotations

from datetime import date

import paths
from countries import agenda, oonline
from countries.base import Country

COUNTRY = Country(code="GE", federation="Georgian Orienteering Federation", access="all", db=paths.DATA_DIR / "ge.sqlite3",
                  time_zones=("Asia/Tbilisi",), lang="ka,en;q=0.5", results=False)
AGENDA_VERSION = 2                       # 2: region and finer unit from the place (countries/places, 2026-10-24)
OO_COUNTRY = 79                                  # (the platform's number for Georgia)


def read(http, today: date, prev: dict | None) -> list[dict]:
    return oonline.read_country("GE", OO_COUNTRY, http, today, prev)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources=oonline.SOURCES)

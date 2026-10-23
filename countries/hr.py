"""Croatia: its competitions on OrienteeringOnline.net (countries/oonline.py), its agenda only."""
from __future__ import annotations

from datetime import date

import paths
from countries import agenda, oonline
from countries.base import Country

COUNTRY = Country(code="HR", federation="HOS", access="all", db=paths.DATA_DIR / "hr.sqlite3",
                  time_zones=("Europe/Zagreb",), lang="hr,en;q=0.5", results=False)
AGENDA_VERSION = 1
OO_COUNTRY = 52                                  # (the platform's number for Croatia)


def read(http, today: date, prev: dict | None) -> list[dict]:
    return oonline.read_country("HR", OO_COUNTRY, http, today, prev)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources=oonline.SOURCES)

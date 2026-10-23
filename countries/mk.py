"""North Macedonia: its competitions on OrienteeringOnline.net (countries/oonline.py), its agenda only."""
from __future__ import annotations

from datetime import date

import paths
from countries import agenda, oonline
from countries.base import Country

COUNTRY = Country(code="MK", federation="Macedonian Orienteering Federation", access="all", db=paths.DATA_DIR / "mk.sqlite3",
                  time_zones=("Europe/Skopje",), lang="mk,en;q=0.5", results=False)
AGENDA_VERSION = 1
OO_COUNTRY = 123                                  # (the platform's number for North Macedonia)


def read(http, today: date, prev: dict | None) -> list[dict]:
    return oonline.read_country("MK", OO_COUNTRY, http, today, prev)


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources=oonline.SOURCES)

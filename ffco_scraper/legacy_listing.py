"""Loads season listings for years the site gates behind an FFCO member
login (2010-2023 at the time this was written — only /course/?season=YYYY
itself requires login; course and circuit pages underneath are public).

Those listings were fetched once through an authenticated browser session
and saved to legacy_listings/ in two formats:

- JSON: {"season": int, "count": int, "rows": [{...CourseListing fields}]}
- Compact pipe-delimited text, possibly with multiple seasons per file,
  each introduced by a "===SEASON|COUNT===" marker line, and each row as
  "course_id|date|title|location|epreuve|has_results(0/1)". This format
  omits organizer/groupe/specialite (specialite is always "Pédestre" —
  filtering to it already happened when the dump was produced).

This module turns either format into the same CourseListing objects the
live-fetched path produces, so the rest of the crawler doesn't need to
know the difference.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .models import CourseListing


def _terrain_for(epreuve: str) -> str:
    return "Sprint" if epreuve == "Sprint" else "Forêt"


def _load_json(path: Path) -> list[CourseListing]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for r in obj["rows"]:
        out.append(
            CourseListing(
                course_id=r["course_id"],
                date=r["date"],
                title=r["title"],
                location=r["location"],
                organizer=r.get("organizer", ""),
                groupe=r.get("groupe", ""),
                specialite=r["specialite"],
                epreuve=r["epreuve"],
                terrain=_terrain_for(r["epreuve"]),
                has_results=bool(r["has_results"]),
                season=r["season"],
            )
        )
    return out


_MARKER_RE = re.compile(r"^===(\d+)\|(\d+)===$")


def _load_compact(path: Path) -> list[CourseListing]:
    out: list[CourseListing] = []
    season = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        m = _MARKER_RE.match(line)
        if m:
            season = int(m.group(1))
            continue
        parts = line.split("|")
        if len(parts) != 6 or season is None:
            continue
        course_id_s, date, title, location, epreuve, has_results_s = parts
        out.append(
            CourseListing(
                course_id=int(course_id_s) if course_id_s else None,
                date=date,
                title=title,
                location=location,
                organizer="",
                groupe="",
                specialite="Pédestre",
                epreuve=epreuve,
                terrain=_terrain_for(epreuve),
                has_results=has_results_s == "1",
                season=season,
            )
        )
    return out


def load_legacy_listings(dir_path: Path) -> list[CourseListing]:
    """Load every listing file in dir_path (both formats), deduped by
    (season, course_id) keeping the last occurrence."""
    listings: dict[tuple[int, int | None], CourseListing] = {}
    for path in sorted(dir_path.iterdir()):
        if path.suffix == ".json":
            rows = _load_json(path)
        elif path.suffix == ".txt":
            rows = _load_compact(path)
        else:
            continue
        for r in rows:
            listings[(r.season, r.course_id)] = r
    return list(listings.values())

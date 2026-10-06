from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CourseListing:
    """One row of the /course/?season=YYYY listing table.

    course_id is None when the site hasn't linked a results page yet
    (results not published) — such rows are still returned by the parser
    so callers can report on them, but there is nothing further to crawl.
    """

    course_id: int | None
    date: str
    title: str
    location: str
    organizer: str
    groupe: str
    specialite: str
    epreuve: str
    terrain: str  # "Forêt" or "Sprint" (pedestrian, from epreuve), "VTT" or "Ski" (the specialité)
    has_results: bool
    season: int


@dataclass
class Circuit:
    circuit_id: int
    course_id: int
    name: str
    distance_km: float | None = None
    valeur: int | None = None


@dataclass
class ResultRow:
    circuit_id: int
    place: str
    nom: str
    licence: str
    categorie: str
    club: str
    temps: str
    min_km: str
    cn_j15: str
    valeur: str
    points: str
    difference: str
    nouveau_cn: str
    raw_cells: list[str] = field(default_factory=list)

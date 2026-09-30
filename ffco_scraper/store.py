"""SQLite storage. Writes are synchronous but tiny (a page of results is a
few KB), so they run in a thread executor guarded by a lock rather than
needing an async database driver. Re-running the crawler is idempotent:
competitions/circuits are upserted by their site ID, and a circuit's
results are replaced wholesale on each (re-)scrape.
"""

from __future__ import annotations

import asyncio
import csv
import logging
import sqlite3
import unicodedata
from pathlib import Path

from .models import Circuit, CourseListing

logger = logging.getLogger("ffco_scraper.store")

SCHEMA = """
CREATE TABLE IF NOT EXISTS competitions (
    course_id INTEGER PRIMARY KEY,
    season INTEGER,
    date TEXT,
    date_iso TEXT,
    title TEXT,
    location TEXT,
    organizer TEXT,
    groupe TEXT,
    specialite TEXT,
    epreuve TEXT,
    terrain TEXT,
    has_results INTEGER
);

CREATE TABLE IF NOT EXISTS circuits (
    circuit_id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES competitions(course_id),
    name TEXT,
    distance_km REAL,
    valeur INTEGER
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circuit_id INTEGER NOT NULL REFERENCES circuits(circuit_id),
    place TEXT,
    nom TEXT,
    licence TEXT,
    categorie TEXT,
    club TEXT,
    temps TEXT,
    min_km TEXT,
    cn_j15 TEXT,
    valeur TEXT,
    points TEXT,
    difference TEXT,
    nouveau_cn TEXT
);

CREATE INDEX IF NOT EXISTS idx_results_circuit ON results(circuit_id);
CREATE INDEX IF NOT EXISTS idx_circuits_course ON circuits(course_id);
CREATE INDEX IF NOT EXISTS idx_competitions_season ON competitions(season);
"""

# Canonical column order the circuit results table is normalized to.
RESULT_COLUMNS = [
    "place",
    "nom",
    "licence",
    "categorie",
    "club",
    "temps",
    "min_km",
    "cn_j15",
    "valeur",
    "points",
    "difference",
    "nouveau_cn",
]

# Circuit result tables come in at least three shapes: 8 columns (2010:
# no min/km, no CN à J-15, no Différence/Nouveau CN), 11 columns (no
# min/km) and 12 columns. The 11- and 12-column variants are mixed within
# every season, so columns MUST be matched by header name — mapping them
# positionally silently shifts Valeur into cn_j15, Points into valeur, etc.
HEADER_TO_COLUMN = {
    "place": "place",
    "nom": "nom",
    "licence": "licence",
    "categorie": "categorie",
    "club": "club",
    "temps": "temps",
    "min/km": "min_km",
    "cn a j-15": "cn_j15",
    "cn a j-15 jours": "cn_j15",
    "valeur": "valeur",
    "points": "points",
    "difference": "difference",
    "nouveau cn": "nouveau_cn",
}


def _iso_date(ddmmyyyy: str) -> str | None:
    """'13/09/2026' -> '2026-09-13'. The site's DD/MM/YYYY strings sort
    incorrectly, and the CN needs a 365-day rolling window."""
    parts = (ddmmyyyy or "").split("/")
    if len(parts) != 3:
        return None
    d, m, y = parts
    if not (d.isdigit() and m.isdigit() and y.isdigit()):
        return None
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def _normalize_header(h: str) -> str:
    h = unicodedata.normalize("NFKD", h)
    h = "".join(ch for ch in h if not unicodedata.combining(ch))
    return " ".join(h.lower().split())


def header_column_index(header: list[str]) -> dict[str, int]:
    """Map canonical column name -> index in this table's rows."""
    out: dict[str, int] = {}
    for idx, raw in enumerate(header):
        col = HEADER_TO_COLUMN.get(_normalize_header(raw))
        if col and col not in out:
            out[col] = idx
    return out


def normalize_rows(circuit_id: int, header: list[str], rows: list[list[str]]) -> list[tuple]:
    """A circuit table's rows in RESULT_COLUMNS order — exactly what is stored,
    so a freshly fetched page can be compared with the database row by row."""
    index_of = header_column_index(header)
    if "temps" not in index_of or "nom" not in index_of:
        # Unrecognized table shape: fall back to positional mapping
        # rather than dropping the data, but make the noise visible.
        logger.warning("circuit %s: unrecognized header %s", circuit_id, header)
        index_of = {col: i for i, col in enumerate(RESULT_COLUMNS)}
    out: list[tuple] = []
    for row in rows:
        values = []
        for col in RESULT_COLUMNS:
            idx = index_of.get(col)
            values.append(row[idx] if idx is not None and idx < len(row) else "")
        out.append(tuple(values))
    return out


class Store:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._lock = asyncio.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Add columns introduced after a DB file already existed, so an
        older ffco_results.sqlite3 doesn't need to be deleted and rebuilt."""
        cols = {row[1] for row in self._conn.execute("PRAGMA table_info(competitions)")}
        if "terrain" not in cols:
            self._conn.execute("ALTER TABLE competitions ADD COLUMN terrain TEXT")
        if "date_iso" not in cols:
            self._conn.execute("ALTER TABLE competitions ADD COLUMN date_iso TEXT")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_competitions_date ON competitions(date_iso)")

    async def aclose(self) -> None:
        async with self._lock:
            self._conn.close()

    async def _run(self, fn, *args):
        async with self._lock:
            return await asyncio.to_thread(fn, *args)

    def _save_competition_sync(self, listing: CourseListing) -> None:
        self._conn.execute(
            """
            INSERT INTO competitions
                (course_id, season, date, date_iso, title, location, organizer, groupe, specialite, epreuve, terrain, has_results)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_id) DO UPDATE SET
                season=excluded.season, date=excluded.date, date_iso=excluded.date_iso,
                title=excluded.title,
                location=excluded.location, organizer=excluded.organizer, groupe=excluded.groupe,
                specialite=excluded.specialite, epreuve=excluded.epreuve, terrain=excluded.terrain,
                has_results=excluded.has_results
            """,
            (
                listing.course_id,
                listing.season,
                listing.date,
                _iso_date(listing.date),
                listing.title,
                listing.location,
                listing.organizer,
                listing.groupe,
                listing.specialite,
                listing.epreuve,
                listing.terrain,
                int(listing.has_results),
            ),
        )
        self._conn.commit()

    async def save_competition(self, listing: CourseListing) -> None:
        await self._run(self._save_competition_sync, listing)

    def _save_circuit_sync(self, circuit: Circuit) -> None:
        self._conn.execute(
            """
            INSERT INTO circuits (circuit_id, course_id, name, distance_km, valeur)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(circuit_id) DO UPDATE SET
                course_id=excluded.course_id, name=excluded.name,
                distance_km=excluded.distance_km, valeur=excluded.valeur
            """,
            (circuit.circuit_id, circuit.course_id, circuit.name, circuit.distance_km, circuit.valeur),
        )
        self._conn.commit()

    async def save_circuit(self, circuit: Circuit) -> None:
        await self._run(self._save_circuit_sync, circuit)

    def _save_results_sync(self, circuit_id: int, header: list[str], rows: list[list[str]]) -> None:
        n = len(RESULT_COLUMNS)
        normalized = [(circuit_id, *values) for values in normalize_rows(circuit_id, header, rows)]

        self._conn.execute("DELETE FROM results WHERE circuit_id = ?", (circuit_id,))
        self._conn.executemany(
            f"""
            INSERT INTO results (circuit_id, {", ".join(RESULT_COLUMNS)})
            VALUES ({", ".join(["?"] * (n + 1))})
            """,
            normalized,
        )
        self._conn.commit()

    async def save_results(self, circuit_id: int, header: list[str], rows: list[list[str]]) -> None:
        await self._run(self._save_results_sync, circuit_id, header, rows)

    def export_csv_sync(self, out_path: Path) -> int:
        cur = self._conn.execute(
            """
            SELECT
                comp.season, comp.date, comp.title, comp.location, comp.organizer,
                comp.specialite, comp.epreuve, comp.terrain, circ.name AS circuit,
                circ.distance_km, r.place, r.nom, r.licence, r.categorie, r.club,
                r.temps, r.min_km, r.cn_j15, r.valeur, r.points, r.difference, r.nouveau_cn
            FROM results r
            JOIN circuits circ ON circ.circuit_id = r.circuit_id
            JOIN competitions comp ON comp.course_id = circ.course_id
            ORDER BY comp.date, comp.title, circ.name, CAST(r.place AS INTEGER)
            """
        )
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(columns)
            writer.writerows(rows)
        return len(rows)

    async def export_csv(self, out_path: Path) -> int:
        return await self._run(self.export_csv_sync, out_path)

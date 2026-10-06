"""Bring the scraped tables up to date with the official site.

The site gives no "last modified" signal (no ETag, no Last-Modified), and
competitions can appear at any date — a race published weeks late, a season
re-opened — while published results can be corrected afterwards. So changes
are found by comparing content, as cheaply as the site allows:

  1. Every season listing is fetched afresh (one page per season). That alone
     reveals competitions added at any date, removed ones, and changed
     metadata (date, title, level, format…).
  2. Competitions are then re-read in depth — course page and every circuit
     page — when they are new, when their listing entry changed, or when they
     fall within the last `recent_days` days. In practice results are only
     published or corrected within about three months of the race, so by
     default nothing older is re-read and only the seasons covering that
     window are listed. `audit_every=N` additionally re-reads a rotating 1/N
     of the whole archive each run; `full=True` re-reads everything.
  3. Each circuit page is compared with the database row by row; only real
     differences are written, and each one is logged with its date.

The results export of a competition is named after its upload time
(`…_2026-07-07T07:15:49.csv`, readable with a HEAD request). With
`use_stamps=True`, a competition older than `always_days` whose stamp and
circuit list are unchanged is not re-read. This is off by default, because
the federation revises published values without a new upload: when one
runner's result is corrected, the CN J-15 printed on their later races
changes too. Measured on 30 Sep 2026: 47 circuits revised since the day
before, back to races of 23 August, none with a new upload stamp.

`new_only=True` is the quick variant: it reads the listings of the seasons
covering the last `recent_days` days and fetches only competitions the
database does not have yet — nothing already stored is re-read or compared.
Meant to run often, between the regular runs that also catch corrections.

Runners appear through new result rows (a new competition, or a row added to
an existing one); every licence not in the database before is reported.

The earliest date touched by any change is what the CN recomputation and the
site build restart from.

Seasons whose listing is members-only (the archive, without a valid session
cookie) are reported as not checked rather than treated as empty.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .fetcher import Fetcher, LoginWallError
from .models import Circuit, CourseListing
from .parser import parse_circuit, parse_course_detail, parse_course_list
from .store import RESULT_COLUMNS, Store, _iso_date, normalize_rows

logger = logging.getLogger("ffco_scraper.updater")

SPECIALITES = ("Pédestre", "VTT", "Ski")      # the specialités with a CN
META_FIELDS = ("season", "date", "title", "location", "organizer", "groupe", "specialite",
               "epreuve", "terrain", "has_results")


@dataclass
class Change:
    kind: str                 # new | removed | meta | results | circuit_added | circuit_removed
    course_id: int
    date_iso: str | None      # the competition's date (the earlier one if it moved)
    title: str = ""
    detail: str = ""


@dataclass
class UpdateReport:
    started: str
    seasons_checked: list[int] = field(default_factory=list)
    seasons_not_checked: list[str] = field(default_factory=list)
    competitions_listed: int = 0
    competitions_read: int = 0
    competitions_skipped_by_stamp: int = 0
    circuits_read: int = 0
    pending: list[str] = field(default_factory=list)
    new_runners: list[str] = field(default_factory=list)   # "licence Nom" first seen in this run
    audit_slice: str = ""
    changes: list[Change] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    requests: int = 0
    seconds: float = 0.0

    @property
    def earliest(self) -> str | None:
        ds = [c.date_iso for c in self.changes if c.date_iso]
        return min(ds) if ds else None

    def summary(self) -> dict:
        by_kind: dict[str, int] = {}
        for c in self.changes:
            by_kind[c.kind] = by_kind.get(c.kind, 0) + 1
        return {"changes": by_kind, "earliest": self.earliest, "new_runners": len(self.new_runners)}

    def to_json(self) -> str:
        d = asdict(self)
        d["earliest"] = self.earliest
        d["summary"] = self.summary()
        return json.dumps(d, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------------------
class _Db:
    """Read side of the comparison, plus the few writes the store lacks."""

    def __init__(self, path: Path) -> None:
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("CREATE TABLE IF NOT EXISTS update_state (key TEXT PRIMARY KEY, value TEXT)")
        # the results-upload stamp and circuit list seen at each competition's last full read
        self.conn.execute("""CREATE TABLE IF NOT EXISTS course_stamps (
            course_id INTEGER PRIMARY KEY, stamp TEXT, circuits TEXT, checked TEXT)""")
        self.conn.commit()

    def stamp_of(self, course_id: int) -> tuple[str | None, str | None]:
        row = self.conn.execute("SELECT stamp, circuits FROM course_stamps WHERE course_id = ?", (course_id,)).fetchone()
        return (row[0], row[1]) if row else (None, None)

    def set_stamp(self, course_id: int, stamp: str | None, circuits: str, checked: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO course_stamps VALUES (?, ?, ?, ?)", (course_id, stamp, circuits, checked))
        self.conn.commit()

    def competitions(self) -> dict[int, sqlite3.Row]:
        return {r["course_id"]: r for r in self.conn.execute(
            f"SELECT * FROM competitions WHERE specialite IN ({','.join('?' * len(SPECIALITES))})", SPECIALITES)}

    def seasons(self) -> list[int]:
        return [r[0] for r in self.conn.execute("SELECT DISTINCT season FROM competitions ORDER BY season")]

    def circuits_of(self, course_id: int) -> dict[int, sqlite3.Row]:
        return {r["circuit_id"]: r for r in self.conn.execute(
            "SELECT * FROM circuits WHERE course_id = ?", (course_id,))}

    def rows_of(self, circuit_id: int) -> list[tuple]:
        cols = ", ".join(RESULT_COLUMNS)
        return [tuple(r) for r in self.conn.execute(
            f"SELECT {cols} FROM results WHERE circuit_id = ? ORDER BY id", (circuit_id,))]

    def delete_circuit(self, circuit_id: int) -> None:
        self.conn.execute("DELETE FROM results WHERE circuit_id = ?", (circuit_id,))
        self.conn.execute("DELETE FROM circuits WHERE circuit_id = ?", (circuit_id,))
        self.conn.commit()

    def delete_competition(self, course_id: int) -> None:
        for cid in self.circuits_of(course_id):
            self.delete_circuit(cid)
        self.conn.execute("DELETE FROM competitions WHERE course_id = ?", (course_id,))
        self.conn.commit()

    def next_audit_index(self, audit_every: int) -> int:
        row = self.conn.execute("SELECT value FROM update_state WHERE key = 'audit_index'").fetchone()
        i = (int(row[0]) + 1) % audit_every if row else 0
        self.conn.execute("INSERT OR REPLACE INTO update_state VALUES ('audit_index', ?)", (str(i),))
        self.conn.commit()
        return i


def _listing_meta(l: CourseListing) -> dict:
    return {"season": l.season, "date": l.date, "title": l.title, "location": l.location,
            "organizer": l.organizer, "groupe": l.groupe, "specialite": l.specialite,
            "epreuve": l.epreuve, "terrain": l.terrain, "has_results": int(l.has_results)}


# ---------------------------------------------------------------------------
async def run_update(
    fetcher: Fetcher,
    db_path: Path,
    *,
    seasons: list[int] | None = None,
    recent_days: int = 100,
    audit_every: int = 0,
    full: bool = False,
    use_stamps: bool = False,
    new_only: bool = False,
    always_days: int = 14,
    dry_run: bool = False,
    today: date | None = None,
) -> UpdateReport:
    today = today or date.today()
    report = UpdateReport(started=today.isoformat())
    db = _Db(db_path)
    store = Store(db_path)
    lock = asyncio.Lock()             # one writer on the SQLite file at a time
    requests_before = fetcher.stats.network_requests
    t0 = asyncio.get_running_loop().time()

    recent_from = (today - timedelta(days=recent_days)).isoformat()
    always_from = (today - timedelta(days=always_days)).isoformat()
    if seasons is None:
        if full or audit_every:
            seasons = sorted(set(db.seasons()) | {today.year})
        else:                                           # only the seasons the recent window touches
            seasons = list(range(int(recent_from[:4]), today.year + 1))
        if today.month == 12:
            seasons.append(today.year + 1)
    known = db.competitions()
    known_licences = {r[0] for r in db.conn.execute("SELECT DISTINCT licence FROM results")}
    lic_col, nom_col = RESULT_COLUMNS.index("licence"), RESULT_COLUMNS.index("nom")

    # ---- 1. season listings -------------------------------------------------------
    listed: dict[int, CourseListing] = {}
    checked_seasons: set[int] = set()
    for season in seasons:
        try:
            html = await fetcher.get_text(f"/course/?season={season}", use_cache=False, login_retries=1)
        except LoginWallError:
            report.seasons_not_checked.append(f"{season}: réservée aux licenciés (cookie de session requis)")
            continue
        except Exception as exc:                       # network trouble: never read as "empty season"
            report.seasons_not_checked.append(f"{season}: {exc!r}")
            continue
        rows = [l for l in parse_course_list(html, season) if l.specialite in SPECIALITES]
        if not rows:
            report.seasons_not_checked.append(f"{season}: listing vide")
            continue
        checked_seasons.add(season)
        report.seasons_checked.append(season)
        for l in rows:
            if l.course_id is not None:
                listed[l.course_id] = l
    report.competitions_listed = len(listed)

    # ---- 2. what to read in depth ----------------------------------------------------
    audit = db.next_audit_index(audit_every) if audit_every and not full and not new_only else None
    report.audit_slice = ("nouvelles compétitions seulement, " if new_only else "") + (
        "tout" if full else (f"{audit + 1}/{audit_every}" if audit is not None else f"{recent_days} derniers jours"))
    to_read: dict[int, str] = {}                       # course -> why
    for cid, l in listed.items():
        k = known.get(cid)
        if new_only:
            # quick mode: only what the database has never had, in the window
            if l.has_results and (_iso_date(l.date) or "") >= recent_from and (k is None or not db.circuits_of(cid)):
                to_read[cid] = "new" if k is None else "empty"
            continue
        if not l.has_results:
            if k is not None and db.circuits_of(cid):
                to_read[cid] = "unpublished"
            continue
        if k is None:
            to_read[cid] = "new"
        elif any(str(k[f] if f != "has_results" else int(k[f] or 0)) != str(v)
                 for f, v in _listing_meta(l).items()):
            to_read[cid] = "meta"
        elif not db.circuits_of(cid):
            to_read[cid] = "empty"
        elif full or (_iso_date(l.date) or "") >= recent_from or (audit is not None and cid % audit_every == audit):
            to_read[cid] = "check"

    # competitions gone from a listing that was read successfully (within the
    # window unless the whole archive is being checked)
    for cid, k in known.items():
        if new_only:
            break
        if k["season"] in checked_seasons and cid not in listed and (full or (k["date_iso"] or "") >= recent_from):
            report.changes.append(Change("removed", cid, k["date_iso"], k["title"], "absente de la liste officielle"))
            if not dry_run:
                db.delete_competition(cid)

    # ---- 3. read, compare, write -----------------------------------------------------
    async def read_course(cid: int, why: str) -> None:
        l = listed[cid]
        k = known.get(cid)
        new_date = _iso_date(l.date)
        date_touched = min(d for d in (new_date, k["date_iso"] if k else None) if d) if (new_date or k) else None
        if why == "unpublished":
            report.changes.append(Change("removed", cid, date_touched, l.title, "résultats retirés"))
            if not dry_run:
                async with lock:
                    for c in db.circuits_of(cid):
                        db.delete_circuit(c)
            return
        detail = parse_course_detail(await fetcher.get_text(f"/course/{cid}/", use_cache=False, login_retries=1))
        if not detail.circuits:
            async with lock:
                report.pending.append(f"{l.date} {l.title} ({cid}): listée, aucun circuit publié")
                if not dry_run and k is None:
                    store._save_competition_sync(l)
            return
        # upload stamp of the results export: unchanged stamp + same circuits = nothing to re-read
        stamp = None
        if detail.csv_href:
            try:
                disp = await fetcher.head_header(detail.csv_href, "content-disposition") or ""
                stamp = disp.split("filename=")[-1].strip('"; ') or None
            except Exception:
                stamp = None
        circuit_list = ",".join(str(r.circuit_id) for r in detail.circuits)
        if why == "check" and stamp and use_stamps and (new_date or "") < always_from:
            old_stamp, old_list = db.stamp_of(cid)
            if old_stamp == stamp and old_list == circuit_list:
                async with lock:
                    report.competitions_skipped_by_stamp += 1
                return
        pages = await asyncio.gather(
            *(fetcher.get_text(f"/circuit/{ref.circuit_id}/", use_cache=False, login_retries=1) for ref in detail.circuits),
            return_exceptions=True)
        async with lock:
            report.competitions_read += 1
            if why == "meta":
                changed = [f for f, v in _listing_meta(l).items()
                           if str(k[f] if f != "has_results" else int(k[f] or 0)) != str(v)]
                report.changes.append(Change("meta", cid, date_touched, l.title, ", ".join(changed)))
            elif why in ("new", "empty"):
                report.changes.append(Change("new", cid, new_date, l.title, f"{len(detail.circuits)} circuits"))
            if not dry_run and why in ("new", "meta", "empty"):
                store._save_competition_sync(l)
            before = db.circuits_of(cid)
            seen = set()
            for ref, page_html in zip(detail.circuits, pages):
                if isinstance(page_html, BaseException):
                    report.failures.append(f"circuit {ref.circuit_id} ({l.title}): {page_html!r}")
                    seen.add(ref.circuit_id)           # unknown state: leave it untouched
                    continue
                report.circuits_read += 1
                seen.add(ref.circuit_id)
                page = parse_circuit(page_html)
                rows = normalize_rows(ref.circuit_id, page.header, page.rows)
                old = before.get(ref.circuit_id)
                meta_same = old is not None and (old["name"], old["distance_km"], old["valeur"]) == (ref.name, page.distance_km, page.valeur)
                rows_same = old is not None and db.rows_of(ref.circuit_id) == rows
                if meta_same and rows_same:
                    continue
                if why not in ("new", "empty"):
                    kind = "circuit_added" if old is None else "results"
                    what = "nouveau circuit" if old is None else (
                        f"{ref.name} : {len(db.rows_of(ref.circuit_id))} → {len(rows)} lignes" if not rows_same else f"{ref.name} : en-tête")
                    report.changes.append(Change(kind, cid, date_touched, l.title, what))
                for row in rows:
                    if row[lic_col] and row[lic_col] not in known_licences:
                        known_licences.add(row[lic_col])
                        report.new_runners.append(f"{row[lic_col]} {row[nom_col]}")
                if not dry_run:
                    store._save_circuit_sync(Circuit(ref.circuit_id, cid, ref.name, page.distance_km, page.valeur))
                    store._save_results_sync(ref.circuit_id, page.header, page.rows)
            for gone in set(before) - seen:
                report.changes.append(Change("circuit_removed", cid, date_touched, l.title, before[gone]["name"]))
                if not dry_run:
                    db.delete_circuit(gone)
            if not dry_run and not any(isinstance(x, BaseException) for x in pages):
                db.set_stamp(cid, stamp, circuit_list, today.isoformat())

    results = await asyncio.gather(*(read_course(cid, why) for cid, why in to_read.items()), return_exceptions=True)
    for (cid, _), res in zip(to_read.items(), results):
        if isinstance(res, BaseException):
            report.failures.append(f"course {cid}: {res!r}")

    report.requests = fetcher.stats.network_requests - requests_before
    report.seconds = round(asyncio.get_running_loop().time() - t0, 1)
    await store.aclose()
    db.conn.close()
    return report

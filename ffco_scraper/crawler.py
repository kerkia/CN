"""Orchestrates the crawl: season listing -> filtered competitions ->
circuits -> results. All fan-out is done with asyncio.gather so the
Fetcher's semaphore is what actually bounds concurrency; this module just
describes the dependency graph between pages.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from .fetcher import Fetcher
from .models import Circuit, CourseListing
from .parser import parse_circuit, parse_course_detail, parse_course_list
from .store import Store

logger = logging.getLogger("ffco_scraper.crawler")


def _matches_month(date_str: str, month: int | None) -> bool:
    if month is None:
        return True
    try:
        return datetime.strptime(date_str, "%d/%m/%Y").month == month
    except ValueError:
        return False


def _new_summary(seasons: list[int]) -> dict:
    return {
        "seasons": seasons,
        "competitions_seen": 0,
        "competitions_matched": 0,
        "competitions_crawled": 0,
        "competitions_pending_no_results": 0,
        "pending_competitions": [],
        "circuits": 0,
        "result_rows": 0,
        "failed_competitions": [],
        "failed_seasons": [],
    }


async def _crawl_one_season_listings(
    listings: list[CourseListing],
    season: int,
    fetcher: Fetcher,
    store: Store,
    specialite: str,
    exclude_epreuves: frozenset[str],
    month: int | None,
    summary: dict,
) -> None:
    summary["competitions_seen"] += len(listings)

    matched = [
        l
        for l in listings
        if l.specialite == specialite
        and l.epreuve not in exclude_epreuves
        and _matches_month(l.date, month)
    ]
    # A matched row can still have nothing to crawl: the site hasn't
    # linked a results page yet (course_id is None), or it linked one
    # but flagged has_results False. Report these instead of silently
    # dropping them, so counts match what a person browsing the site
    # would see.
    pending = [l for l in matched if l.course_id is None or not l.has_results]
    crawlable = [l for l in matched if l.course_id is not None and l.has_results]
    summary["competitions_matched"] += len(matched)
    summary["competitions_crawled"] += len(crawlable)
    summary["competitions_pending_no_results"] += len(pending)
    summary["pending_competitions"].extend(
        f"{l.date} {l.title} — {l.location} ({l.epreuve})" for l in pending
    )

    logger.info(
        "season %s: %d listed, %d match filter, %d crawlable, %d pending (no results yet)",
        season,
        len(listings),
        len(matched),
        len(crawlable),
        len(pending),
    )

    results = await asyncio.gather(
        *(_process_course(listing, fetcher, store) for listing in crawlable),
        return_exceptions=True,
    )
    for listing, result in zip(crawlable, results):
        if isinstance(result, BaseException):
            logger.warning("giving up on course %s (%s): %s", listing.course_id, listing.title, result)
            summary["failed_competitions"].append(
                f"{listing.date} {listing.title} — {listing.location} ({listing.course_id}): {result}"
            )
            continue
        n_circuits, n_rows = result
        summary["circuits"] += n_circuits
        summary["result_rows"] += n_rows


async def crawl(
    fetcher: Fetcher,
    store: Store,
    seasons: list[int],
    specialite: str = "Pédestre",
    exclude_epreuves: frozenset[str] = frozenset(),
    month: int | None = None,
) -> dict:
    """Crawl the given seasons, keeping competitions whose Spécialité matches
    `specialite` (default: all pedestrian races, both forest — LD/MD/Nuit —
    and sprint). Each stored competition keeps a `terrain` field ("Forêt" or
    "Sprint", derived from Epreuve) so the two stay distinguishable in the
    output. Pass exclude_epreuves (e.g. {"Sprint"}) to narrow to one terrain.
    Returns a small summary dict for reporting.
    """
    summary = _new_summary(seasons)
    for season in seasons:
        # A season's listing page failing (transient network trouble, a
        # sleeping laptop) must not abandon the seasons after it — record
        # it and move on, since a re-run resumes the rest from cache.
        try:
            html = await fetcher.get_text(f"/course/?season={season}")
        except Exception as exc:
            logger.error("season %s: listing fetch failed, skipping season: %s", season, exc)
            summary["failed_seasons"].append(f"{season}: {exc!r}")
            continue
        listings = parse_course_list(html, season)
        await _crawl_one_season_listings(
            listings, season, fetcher, store, specialite, exclude_epreuves, month, summary
        )
    return summary


async def crawl_prefetched_listings(
    fetcher: Fetcher,
    store: Store,
    listings_by_season: dict[int, list[CourseListing]],
    specialite: str = "Pédestre",
    exclude_epreuves: frozenset[str] = frozenset(),
    month: int | None = None,
) -> dict:
    """Same as crawl(), but for seasons whose listing page requires a login
    this scraper doesn't have — the listings were fetched separately (e.g.
    through an authenticated browser session) and are passed in directly.
    Course and circuit pages underneath are public, so the actual result
    fetching still goes through the normal unauthenticated Fetcher.
    """
    seasons = sorted(listings_by_season)
    summary = _new_summary(seasons)
    for season in seasons:
        await _crawl_one_season_listings(
            listings_by_season[season],
            season,
            fetcher,
            store,
            specialite,
            exclude_epreuves,
            month,
            summary,
        )
    return summary


async def _process_course(listing: CourseListing, fetcher: Fetcher, store: Store) -> tuple[int, int]:
    await store.save_competition(listing)
    detail_html = await fetcher.get_text(f"/course/{listing.course_id}/")
    detail = parse_course_detail(detail_html)

    circuit_results = await asyncio.gather(
        *(
            _process_circuit(listing.course_id, ref.circuit_id, ref.name, fetcher, store)
            for ref in detail.circuits
        ),
        return_exceptions=True,
    )
    n_ok = 0
    total_rows = 0
    for ref, result in zip(detail.circuits, circuit_results):
        if isinstance(result, BaseException):
            logger.warning(
                "giving up on circuit %s (course %s, %s): %s",
                ref.circuit_id,
                listing.course_id,
                ref.name,
                result,
            )
            continue
        n_ok += 1
        total_rows += result
    return n_ok, total_rows


async def _process_circuit(
    course_id: int, circuit_id: int, name: str, fetcher: Fetcher, store: Store
) -> int:
    html = await fetcher.get_text(f"/circuit/{circuit_id}/")
    page = parse_circuit(html)
    circuit = Circuit(
        circuit_id=circuit_id,
        course_id=course_id,
        name=name,
        distance_km=page.distance_km,
        valeur=page.valeur,
    )
    await store.save_circuit(circuit)
    await store.save_results(circuit_id, page.header, page.rows)
    return len(page.rows)

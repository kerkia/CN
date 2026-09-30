from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time
from pathlib import Path

import paths

from .crawler import crawl, crawl_prefetched_listings
from .fetcher import Fetcher
from .legacy_listing import load_legacy_listings
from .store import Store

DEFAULT_BASE_URL = "https://cn.ffcorientation.fr"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="ffco_scraper",
        description="Scrape FFCO CN competition results. Default: all pedestrian races "
        "(Spécialité Pédestre), both forest (LD/MD/Nuit) and sprint — each result row "
        "keeps a 'terrain' field so the two remain distinguishable.",
    )
    p.add_argument("--seasons", type=int, nargs="*", default=[], help="e.g. --seasons 2026")
    p.add_argument(
        "--legacy-listings-dir",
        type=Path,
        default=None,
        help="Directory of pre-fetched listing dumps (for seasons whose /course/?season= "
        "listing page requires an FFCO login this scraper doesn't have — course/circuit "
        "pages themselves are public). See legacy_listing.py for the file formats.",
    )
    p.add_argument("--month", type=int, default=None, help="Restrict to this month (1-12), e.g. 9")
    p.add_argument("--specialite", default="Pédestre")
    p.add_argument(
        "--exclude-epreuve",
        nargs="*",
        default=[],
        help="Epreuve values to exclude, e.g. --exclude-epreuve Sprint to keep only forest events",
    )
    p.add_argument("--db", type=Path, default=paths.DB)
    p.add_argument("--cache-dir", type=Path, default=paths.CACHE)
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--min-interval", type=float, default=0.05, help="Seconds between requests")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument(
        "--session-cookie-env",
        default="FFCO_SESSIONID",
        help="Name of the env var holding an FFCO 'sessionid' cookie. Required for "
        "archived seasons (pre-2024), which are otherwise served as a 'réservée aux "
        "licenciés' page. Read from the environment so the credential is never written "
        "to a file in the project.",
    )
    p.add_argument("--export-csv", type=Path, default=None)
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


async def _main_async(args: argparse.Namespace) -> None:
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if not args.seasons and not args.legacy_listings_dir:
        raise SystemExit("Pass --seasons and/or --legacy-listings-dir")

    session_cookie = os.environ.get(args.session_cookie_env) or None
    if session_cookie:
        logging.getLogger("ffco_scraper").info(
            "using session cookie from $%s (archived seasons unlocked)", args.session_cookie_env
        )

    store = Store(args.db)
    started = time.monotonic()
    async with Fetcher(
        base_url=args.base_url,
        cache_dir=args.cache_dir,
        concurrency=args.concurrency,
        min_interval=args.min_interval,
        session_cookie=session_cookie,
    ) as fetcher:
        summaries = []
        if args.seasons:
            summaries.append(
                await crawl(
                    fetcher,
                    store,
                    seasons=args.seasons,
                    specialite=args.specialite,
                    exclude_epreuves=frozenset(args.exclude_epreuve),
                    month=args.month,
                )
            )
        if args.legacy_listings_dir:
            listings = load_legacy_listings(args.legacy_listings_dir)
            by_season: dict[int, list] = {}
            for listing in listings:
                by_season.setdefault(listing.season, []).append(listing)
            summaries.append(
                await crawl_prefetched_listings(
                    fetcher,
                    store,
                    listings_by_season=by_season,
                    specialite=args.specialite,
                    exclude_epreuves=frozenset(args.exclude_epreuve),
                    month=args.month,
                )
            )

        elapsed = time.monotonic() - started
        for summary in summaries:
            pending = summary.pop("pending_competitions")
            failed = summary.pop("failed_competitions")
            failed_seasons = summary.pop("failed_seasons", [])
            print(f"Crawl summary ({summary['seasons']}):")
            for k, v in summary.items():
                print(f"  {k}: {v}")
            if pending:
                print("  Pending (matched filter, but no results published yet on the site):")
                for line in pending:
                    print(f"    - {line}")
            if failed:
                print("  Failed (gave up after retries):")
                for line in failed:
                    print(f"    - {line}")
            if failed_seasons:
                print("  Seasons skipped (listing page unreachable — re-run to retry):")
                for line in failed_seasons:
                    print(f"    - {line}")
        print(f"elapsed_seconds: {elapsed:.1f}")
        print(
            f"http: {fetcher.stats.network_requests} network requests, "
            f"{fetcher.stats.cache_hits} cache hits, "
            f"{fetcher.stats.retries} retries, {fetcher.stats.errors} errors"
        )

        if args.export_csv:
            n = await store.export_csv(args.export_csv)
            print(f"Exported {n} result rows to {args.export_csv}")

    await store.aclose()


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    asyncio.run(_main_async(args))


if __name__ == "__main__":
    main()

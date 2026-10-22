"""France: the FFCO's national ranking (cn.ffcorientation.fr) and its agenda.

Its sources are the FFCO's own pages, read by ffco_scraper (fetcher, crawler, parser, updater — the « CN officiel »
copied verbatim, the competitions, circuits and results) and ffco_scraper.agenda (the calendar of upcoming events).
A runner is identified by their FFCO licence: fr1234567 on the site. Only the accounts that joined France see its data
(the FFCO's older seasons are members-only on its own site).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path

import paths
from countries.base import ROOT, Country

COUNTRY = Country(
    code="FR", federation="FFCO", access="members", db=paths.DB, time_zones=("Europe/Paris",),
    official="ffco_cn", extras=("cfc", "elite"),
)
REPORTS = ROOT / "exports" / "updates"


def fetch(args) -> tuple[str | None, list]:
    """Read FFCO's site and store what changed (ffco_scraper.updater): -> (the earliest date changed or None, the changes
    for the e-mail digest). Prints the run's report."""
    from ffco_scraper.fetcher import Fetcher
    from ffco_scraper.updater import run_update

    async def go():
        async with Fetcher(base_url="https://cn.ffcorientation.fr", cache_dir=args.cache_dir,
                           concurrency=args.concurrency, min_interval=0.05,
                           session_cookie=os.environ.get("FFCO_SESSIONID") or None) as f:
            return await run_update(f, args.db, seasons=args.seasons, recent_days=args.recent_days,
                                    audit_every=args.audit_every, full=args.full, use_stamps=args.use_stamps,
                                    new_only=args.new_only, dry_run=args.dry_run)
    report = asyncio.run(go())
    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / f"update_{datetime.now():%Y%m%d-%H%M%S}{'_new' if args.new_only else ''}{'_dry' if args.dry_run else ''}.json"
    path.write_text(report.to_json(), encoding="utf-8")
    s = report.summary()
    print(f"1. fetch: {report.requests} requests in {report.seconds}s — seasons {report.seasons_checked}, "
          f"{report.competitions_read} competitions / {report.circuits_read} circuits read, "
          f"{report.competitions_skipped_by_stamp} unchanged by upload stamp ({report.audit_slice})")
    for line in report.pending:
        print(f"   pending: {line}")
    for line in report.seasons_not_checked:
        print(f"   not checked: {line}")
    for c in report.changes[:40]:
        print(f"   {c.kind:<15} {c.date_iso}  {c.course_id:>5}  {c.title[:55]}  {c.detail}")
    if len(report.changes) > 40:
        print(f"   … {len(report.changes) - 40} more (see {path.name})")
    for f in report.failures:
        print(f"   FAILED {f}")
    if report.new_runners and os.environ.get("GITHUB_ACTIONS"):
        print(f"   new runners: {len(report.new_runners)}")     # the repository's logs are public
    elif report.new_runners:
        print(f"   new runners ({len(report.new_runners)}): " + ", ".join(report.new_runners[:12])
              + (" …" if len(report.new_runners) > 12 else ""))
    print(f"   changes: {s['changes'] or 'none'}; earliest {s['earliest']}; report {path.relative_to(ROOT)}")
    return report.earliest, report.changes


def agenda_path(root: Path) -> Path:
    return COUNTRY.data_dir(root) / "agenda.json"


def agenda_current(root: Path) -> bool:
    """The agenda exists and was built by the scraper's current version."""
    import json
    import ffco_scraper.agenda as agenda
    try:
        return json.loads(agenda_path(root).read_text(encoding="utf-8")).get("v", 1) >= agenda.AGENDA_VERSION
    except (OSError, ValueError):
        return False


def refresh_agenda(root: Path) -> bool:
    """FFCO's calendar of upcoming events -> site/data/fr/agenda.json; True when it changed."""
    import ffco_scraper.agenda as agenda
    return agenda.refresh(agenda_path(root))

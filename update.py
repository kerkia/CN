"""Update everything from the official site, doing only the work changes need.

    py -3 update.py                 # usual run: the last ~3 months, corrections included
    py -3 update.py --new-only      # quick run: only competitions not yet stored,
                                    #   from the last 2 months (run it more often)
    py -3 update.py --dry-run       # report what changed, write nothing
    py -3 update.py --full          # re-check every competition (slow, rare)
    py -3 update.py --use-stamps    # faster, but misses the federation's own
                                    #   later revisions of CN values (not advised)
    py -3 update.py --since 2026-06-01 --no-fetch   # recompute & rebuild only
    py -3 update.py --new-only --deploy             # ... and publish to Cloudflare Pages
    py -3 update.py --deploy-only                   # publish the current site as it is

Schedule: `--new-only` every hour; the full run once a day at 03:00 Paris time
(the two never overlap: a run started while another is going simply skips).

Steps, each skipped when there is nothing to do:
  1. fetch & compare (ffco_scraper.updater) — writes only real differences
     to the scraped tables and logs each change with its date;
  2. recompute the three CN methods from the earliest changed date, resuming
     from the stored state instead of starting again from 2010;
  3. rebuild the site data from that date (earlier seasons' snapshots kept,
     unchanged files left untouched);
  4. with --deploy: publish site/ (and functions/) to Cloudflare Pages with
     wrangler, which uploads only the files that changed. A rebuilt site that
     could not be published is published by the next run, even if nothing
     changed then.

Archived seasons (before 2024) are members-only on the site: set a fresh
FFCO_SESSIONID in the environment for --full to check them. Nothing in the
default run needs it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

from ffco_scraper.cn_engine import CnEngine, build_methods
from ffco_scraper.fetcher import Fetcher
from ffco_scraper.updater import run_update

ROOT = Path(__file__).parent
import notify  # noqa: E402  (digest e-mails for subscribed accounts)
import paths  # noqa: E402  (the data folder, outside OneDrive)
REPORTS = ROOT / "exports" / "updates"
PAGES_PROJECT = os.environ.get("CN_PAGES_PROJECT", "observatoire-cn")
DEPLOY_PENDING = paths.DATA_DIR / "deploy.pending"     # site rebuilt, not yet published
# Bumped when a method's definition changes: the next run (of any kind) recomputes it once, everywhere.
#   2 (2026-10-03): a Top CN is the aggregate of the published race scores, no factor at the CN level
#   3 (2026-10-03): the monthly anchor is FFCO's: mean of the best 20 % of the CNs at 5600
#   4 (2026-10-05): the factor of a race is that of its day (straight line between monthly factors)
TOP6W_CN_VERSION = 4
# Same for a change of the computation itself: the computed methods recomputed from 2010, then the site.
#   1 (2026-10-03): "nc" (non classé) rows take no part in any calculation; Top: 6 weight slots, not 6 races
#   2 (2026-10-04): Top: 10 slots; weights by name (championnat de France 2, national 1.5, other 1)
#   3 (2026-10-05): Top: circuits valued by the uncapped best 60 %; no fallback first official CN
#   4 (2026-10-05): the 2026 method replaced by "fair" (weighted best 60 %); Top derived from it, 6 places
#   5 (2026-10-06): VTT and ski: windows of 2 and 3 years, best 70 % (their own params, CnParams.by_terrain)
#   6 (2026-10-07): the quadratic variants "fair2" and "top6w2" (circuit value and CN as quadratic means)
#   7 (2026-10-07): the quadratic variants keep FFCO's linear circuit value; only the CN is a quadratic mean
ENGINE_VERSION = 7
# Same for the second-stage datasets (site_extras.py): the next run rebuilds them once, nothing recomputed.
#   1 (2026-10-06): age pyramid / territory counts (pyramid/), co-runners per discipline (net/)
#   2 (2026-10-06): validation.json, the methods' head-to-head accuracy, for the Méthodes page
#   3 (2026-10-07): participation.json, the statistics moved from the home page to Réseau · Activité
EXTRAS_VERSION = 3
COMPUTED = ("fair", "top6w", "fair2", "top6w2")   # in this order: each Top is derived from its Fair


def migrate(db: Path, out: Path) -> bool:
    """One-off recomputation after a method change; True when the site data was rebuilt."""
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE IF NOT EXISTS engine_meta (key TEXT PRIMARY KEY, value TEXT)")
    meta = dict(con.execute("SELECT key, value FROM engine_meta").fetchall())
    con.close()
    engine_due = int(meta.get("engine", 0)) < ENGINE_VERSION
    top_due = int(meta.get("top6w_cn", 0)) < TOP6W_CN_VERSION
    extras_due = int(meta.get("extras", 0)) < EXTRAS_VERSION
    if not engine_due and not top_due and not extras_due:
        return False
    t0 = time.monotonic()
    (out / "validation.json").unlink(missing_ok=True)     # the methods' accuracy, rebuilt with them
    if not engine_due and not top_due:
        print("migration: second-stage site data rebuilt")
        import site_extras
        site_extras.main(out)
        _set_versions(db)
        DEPLOY_PENDING.touch()
        print(f"migration done in {time.monotonic() - t0:.0f}s")
        return True
    engine = CnEngine(db)
    if engine_due:
        print("migration: computed methods recomputed from the start")
        methods = build_methods()
        for table in ("scores", "cn_history", "circuit_values", "rescale_factors", "normalisation"):
            engine.conn.execute(f"DELETE FROM {table} WHERE method NOT IN ('official', {', '.join('?' * len(COMPUTED))})",
                                COMPUTED)             # methods that no longer exist (v2026)
        engine.conn.commit()
        for name in COMPUTED:
            t1 = time.monotonic()
            spec = methods[name]
            engine.derive(spec) if spec.derived_from else engine.run_method(spec)
            print(f"  {name}: {time.monotonic() - t1:.0f}s")
        engine.conn.execute("VACUUM")
    else:
        print("migration: Fair and Top — factors, race scores and CN recomputed, every season")
        methods = build_methods()
        for name in COMPUTED:
            spec = methods[name]
            engine.derive(spec) if spec.derived_from else engine._normalise(spec, None)
    engine.write_runners()
    engine.close()
    import build_site
    build_site.main(["--out", str(out), "--db", str(db)])      # site_extras included
    _set_versions(db)
    DEPLOY_PENDING.touch()
    print(f"migration done in {time.monotonic() - t0:.0f}s")
    return True


def _set_versions(db: Path) -> None:
    con = sqlite3.connect(db)
    con.executemany("INSERT OR REPLACE INTO engine_meta (key, value) VALUES (?, ?)",
                    [("top6w_cn", str(TOP6W_CN_VERSION)), ("engine", str(ENGINE_VERSION)),
                     ("extras", str(EXTRAS_VERSION))])
    con.commit()
    con.close()


def deploy() -> bool:
    """Publish site/ with the Pages Functions in functions/. True on success."""
    npx = shutil.which("npx.cmd") or shutil.which("npx")
    if not npx:
        print("4. deploy: npx not found (install Node.js)")
        return False
    t0 = time.monotonic()
    cmd = [npx, "--yes", "wrangler", "pages", "deploy", "site", "--project-name", PAGES_PROJECT,
           "--branch", "main", "--commit-dirty=true"]
    # run from the project root: wrangler picks up ./functions from the working directory
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = [ln for ln in (r.stdout + r.stderr).splitlines() if ln.strip()][-4:]
    print(f"4. deploy to {PAGES_PROJECT}: {'ok' if r.returncode == 0 else 'FAILED'} in {time.monotonic() - t0:.0f}s")
    for ln in tail:
        print(f"   {ln}")
    return r.returncode == 0


def recompute(db: Path, since: str) -> None:
    engine = CnEngine(db)
    methods = build_methods()
    for name in ("official", *COMPUTED):
        t0 = time.monotonic()
        if name == "official":
            stats = engine.populate_official(since=since)
        elif methods[name].derived_from:
            stats = engine.derive(methods[name], since=since)
        else:
            stats = engine.run_method(methods[name], since=since)
        print(f"  {name}: {time.monotonic() - t0:.0f}s  " + "  ".join(f"{k}={v:,}" for k, v in stats.items()))
    engine.write_runners()
    engine.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=paths.DB)
    ap.add_argument("--out", type=Path, default=ROOT / "site" / "data")
    ap.add_argument("--cache-dir", type=Path, default=paths.CACHE)
    ap.add_argument("--recent-days", type=int, default=None,
                    help="how far back results can still appear or change "
                         "(default 100; 60 with --new-only)")
    ap.add_argument("--new-only", action="store_true",
                    help="quick run: fetch only competitions not yet in the database; "
                         "nothing stored is re-read")
    ap.add_argument("--audit-every", type=int, default=0,
                    help="also re-check a rotating 1/N of the archive each run (default off)")
    ap.add_argument("--full", action="store_true", help="re-check every competition")
    ap.add_argument("--use-stamps", action="store_true",
                    help="skip competitions whose results upload is unchanged; faster, but "
                         "misses the federation's later revisions of CN values")
    ap.add_argument("--seasons", type=int, nargs="*", default=None)
    ap.add_argument("--dry-run", action="store_true", help="report only")
    ap.add_argument("--no-fetch", action="store_true", help="skip step 1 (use with --since)")
    ap.add_argument("--no-site", action="store_true", help="skip step 3")
    ap.add_argument("--since", default=None, help="recompute from this date even if nothing changed")
    ap.add_argument("--deploy", action="store_true", help="publish to Cloudflare Pages when the site changed")
    ap.add_argument("--deploy-only", action="store_true", help="publish the current site, nothing else")
    ap.add_argument("--agenda-only", action="store_true",
                    help="refresh the agenda of upcoming events (site/data/agenda.json) and publish it if it changed")
    ap.add_argument("--prov-only", action="store_true",
                    help="provisional results only (organisers' results before FFCO); publish if something new was found")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.recent_days is None:
        args.recent_days = 60 if args.new_only else 100
    t0 = time.monotonic()
    since = args.since

    # the quick and the regular runs may be scheduled close together: never overlap
    lock = args.db.with_suffix(".update.lock")
    try:
        if lock.exists() and time.time() - lock.stat().st_mtime > 3 * 3600:
            lock.unlink()                       # left by a crashed run
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        print("another update is running — skipped")
        sys.exit(0)
    try:
        if not args.dry_run:
            migrate(args.db, args.out)                          # no-op once done
        if args.deploy_only:
            import ffco_scraper.agenda as agenda
            try:
                current = json.loads((args.out / "agenda.json").read_text(encoding="utf-8")).get("v", 1) >= agenda.AGENDA_VERSION
            except (OSError, ValueError):
                current = False
            if not current:                                    # missing, or built by an older version of the scraper
                agenda.refresh(args.out / "agenda.json")
                print("agenda: rebuilt")
            ok = deploy()
            if ok:
                DEPLOY_PENDING.unlink(missing_ok=True)
            sys.exit(0 if ok else 1)
        if args.agenda_only:
            import ffco_scraper.agenda as agenda
            changed = agenda.refresh(args.out / "agenda.json")
            print(f"agenda: {'updated' if changed else 'unchanged'} in {time.monotonic() - t0:.0f}s")
            if changed:
                DEPLOY_PENDING.touch()
            if args.deploy and DEPLOY_PENDING.exists() and deploy():
                DEPLOY_PENDING.unlink(missing_ok=True)
            if args.deploy and not DEPLOY_PENDING.exists():       # the courses are online: alert the subscribers
                notify.run_agenda(args.out / "agenda.json")
            sys.exit(0)
        if args.prov_only:
            _provisional(args)
            if args.deploy and DEPLOY_PENDING.exists() and deploy():
                DEPLOY_PENDING.unlink(missing_ok=True)
            print(f"provisional run done in {time.monotonic() - t0:.0f}s")
            sys.exit(0)
        rebuilt = _run(args, since, t0)
        if rebuilt:
            DEPLOY_PENDING.touch()
        # 4b. provisional results (an admin pilot): what organisers publish before FFCO does (ffco_scraper/prov).
        # Published only when something new was found: a mere "looked again" must not cost a deploy.
        if not args.dry_run:
            _provisional(args)
        if args.deploy and DEPLOY_PENDING.exists() and deploy():
            DEPLOY_PENDING.unlink(missing_ok=True)
        # 5. e-mail the subscribers (only once nothing is waiting to be published) and drain the mail queue
        if args.deploy and not args.dry_run and not DEPLOY_PENDING.exists():
            notify.run(args.db)
    finally:
        lock.unlink(missing_ok=True)


def _provisional(args) -> None:
    """Provisional results (an admin pilot, ffco_scraper/prov); marks a deploy when something new was found."""
    try:
        import ffco_scraper.prov.run as prov
        st = prov.run(args.db, args.out, budget_s=float(os.environ.get("PROV_BUDGET", "240")))
        print(f"provisional: {st}")
        if st.get("changed") or st.get("added"):
            DEPLOY_PENDING.touch()
    except Exception as e:                       # the pilot must never stop the site's update
        print(f"provisional: failed — {type(e).__name__}: {e}")


def _run(args, since, t0) -> bool:
    """Steps 1-3; True when the site data was rebuilt."""
    # ---- 1. fetch & compare -------------------------------------------------------
    if not args.no_fetch:
        async def fetch():
            async with Fetcher(base_url="https://cn.ffcorientation.fr", cache_dir=args.cache_dir,
                               concurrency=args.concurrency, min_interval=0.05,
                               session_cookie=os.environ.get("FFCO_SESSIONID") or None) as f:
                return await run_update(f, args.db, seasons=args.seasons, recent_days=args.recent_days,
                                        audit_every=args.audit_every, full=args.full, use_stamps=args.use_stamps,
                                        new_only=args.new_only, dry_run=args.dry_run)
        report = asyncio.run(fetch())
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
        if not args.dry_run:
            notify.remember(report.changes)         # announced by main() once the site is deployed
        if report.earliest:
            since = min(since, report.earliest) if since else report.earliest
        if args.dry_run:
            return False

    if not since:
        print(f"nothing changed — done in {time.monotonic() - t0:.0f}s")
        return False

    # ---- 2. recompute from the earliest change ------------------------------------
    print(f"2. recompute CN from {since}")
    recompute(args.db, since)

    # ---- 3. rebuild the site data ---------------------------------------------------
    if not args.no_site:
        print(f"3. site data from {since}")
        import build_site
        build_site.main(["--since", since, "--out", str(args.out), "--db", str(args.db)])
    print(f"done in {time.monotonic() - t0:.0f}s")
    return not args.no_site


if __name__ == "__main__":
    main()

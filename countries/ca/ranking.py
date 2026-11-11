"""Canada's rankings, end to end (the daily full run, update.py, as Spain's): its archive (the provisional results'
Canadian races, the clubs' past files, WhyJustRun's past results a budget per run), who is who, its clubs, the CN engine —
the usual level (fair) bootstrapped without official values, the Ozimut method (top6w) derived from it — and the site's
files (site/data/ca/).

Built 2026-11-11 to show what Ozimut could be for Orienteering Ottawa and Canada (owner). `PUBLISH`: whether the site's
files are written (and so deployed); the owner decides it once the clubs have been asked.
"""
from __future__ import annotations

import time
from pathlib import Path

import paths

from . import COUNTRY, OPEN

PUBLISH = OPEN                    # (one switch: countries/ca OPEN)
BACKFILL_BUDGET = 1800            # seconds of WhyJustRun's history a night until it is read once (archive.backfill_wjr)


def category_level(cat: str | None) -> float:
    """A category's level against H21, as Spain's (France's measure); a course by level (most of Canada's local races): 0.75."""
    from countries.es.ranking import category_level as es_level
    return es_level(cat)


def update(root: Path, prov_db: Path = paths.DB, budget_s: float = 900, db: Path | None = None, publish: bool | None = None,
           since_wjr: str = "2010-01-01") -> dict:
    from countries import identity
    from countries.http import Http
    from ffco_scraper.cn_engine import CnEngine, bootstrap

    from . import agenda_current, archive, clubs, refresh_agenda
    publish = PUBLISH if publish is None else publish
    t0 = time.monotonic()
    db = db or COUNTRY.db
    con = archive.connect(db)
    stats: dict = {}
    with Http(pause=1.0, lang=COUNTRY.lang) as http:
        stats["clubs_known"] = clubs.refresh(con, http)
        if not agenda_current(root):
            stats["agenda"] = refresh_agenda(root)
        stats["from_prov"] = archive.from_prov(con, prov_db)
        stats["files"] = archive.backfill_files(con, http, budget_s=max(60, budget_s / 2 - (time.monotonic() - t0)))
        left = max(60, budget_s - (time.monotonic() - t0)) if archive.meta_get(con, "wjr_backfilled") else BACKFILL_BUDGET
        stats["wjr"] = archive.backfill_wjr(con, http, budget_s=left, since=since_wjr)
    stats["pruned"] = archive.prune(con)
    stats["identity"] = identity.resolve(con, None)
    stats["clubs"] = clubs.assign(con)
    changed = stats["identity"]["rows"] > 0 or stats["from_prov"] or stats["files"]["read"] or stats["wjr"]["read"]
    con.close()
    if not changed and (COUNTRY.data_dir(root) / "meta.json").exists() == publish:
        stats["built"] = False
        return stats
    e = CnEngine(db)
    methods = COUNTRY.methods()
    e.populate_official()
    # the starting levels never expire (days=None), as Spain's: Canada's archive has seasons with few results (WhyJustRun's
    # clubs stopped posting theirs there around 2020), after which nobody would hold an index to value a circuit again
    stats["fair"] = bootstrap(e, methods["fair"], prior=category_level, days=None)
    e.derive(methods["top6w"])
    e.write_runners()
    e.close()
    if publish:
        import build_site
        build_site.main(["--out", str(COUNTRY.data_dir(root)), "--db", str(db), "--country", COUNTRY.code])
        stats["built"] = True
    stats["seconds"] = round(time.monotonic() - t0)
    return stats

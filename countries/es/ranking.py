"""Spain's rankings, end to end (the daily full run, update.py): its licensees' list (once a month), its archive (the
provisional results' Spanish races, O-Replay's past events a budget per run), who is who, its clubs, the CN engine — the
usual level (fair) bootstrapped without official CNs, the Ozimut method (top6w) derived from it —, and the site's files
(site/data/es/). Nothing is published before the owner has seen the method measured on Spain's races (`PUBLISH`).
"""
from __future__ import annotations

import time
from pathlib import Path

import paths

from . import COUNTRY

# Spain's rankings are computed every day; they are published once the owner has approved the measure of the method on
# Spain's races (plan step 7): until then site/data/es/ holds its agenda only
PUBLISH = False


def update(root: Path, prov_db: Path = paths.DB, budget_s: float = 900, db: Path | None = None, publish: bool = PUBLISH,
           since_oreplay: str = "2024-01-01") -> dict:
    from countries import identity
    from countries.http import Http
    from ffco_scraper.cn_engine import CnEngine, bootstrap, build_methods

    from . import archive, clubs, licensees
    t0 = time.monotonic()
    db = db or COUNTRY.db
    con = archive.connect(db)
    stats: dict = {}
    with Http(pause=1.0) as http:
        stats["licensees"] = licensees.refresh(con, http, budget_s=min(300, budget_s / 3))
        from . import agenda_path
        stats["from_prov"] = archive.from_prov(con, prov_db, agenda_path(root))
        from . import fedo, official
        stats["official"] = official.refresh(con, http)            # FEDO's ranking files: the current season, past ones once
        stats["fedo"] = fedo.import_all(con, http, budget_s=max(60, budget_s / 3 - (time.monotonic() - t0)))
        left = max(60, budget_s - (time.monotonic() - t0))
        stats["oreplay"] = archive.backfill_oreplay(con, http, budget_s=left, since=since_oreplay)
    lic = identity.Licensees([dict(r) for r in con.execute("SELECT licence, name, club, card FROM es_licensees")]) \
        if con.execute("SELECT 1 FROM sqlite_master WHERE name = 'es_licensees'").fetchone() else None
    stats["pruned"] = archive.prune(con)                # races the rules now leave out
    stats["club_keys"] = clubs.canonical(con)           # before who is who: the club tells namesakes apart
    stats["identity"] = identity.resolve(con, lic)
    stats["clubs"] = clubs.assign(con)
    changed = stats["identity"]["rows"] > 0 or stats["from_prov"] or stats["oreplay"]["read"] or stats["fedo"]["read"]
    con.close()
    if not changed and (COUNTRY.data_dir(root) / "meta.json").exists() == publish:
        stats["built"] = False
        return stats
    # the engine: everything again (a few minutes for Spain's archive): the bootstrap's first season depends on all of it
    e = CnEngine(db)
    methods = build_methods()
    e.populate_official()                     # the results as rows of their own (no official points: the registry)
    stats["fair"] = bootstrap(e, methods["fair"])
    e.derive(methods["top6w"])
    e.write_runners()
    e.close()
    if publish:
        import build_site
        build_site.main(["--out", str(COUNTRY.data_dir(root)), "--db", str(db), "--country", COUNTRY.code])
        stats["built"] = True
    stats["seconds"] = round(time.monotonic() - t0)
    return stats

"""Spain's rankings, end to end (the daily full run, update.py): its licensees' list (once a month), its archive (the
provisional results' Spanish races, O-Replay's past events a budget per run), who is who, its clubs, the CN engine — the
usual level (fair) bootstrapped without official CNs, the Ozimut method (top6w) derived from it —, and the site's files
(site/data/es/), FEDO's own ranking beside it (official.site_table). Published once the owner had seen the method measured
on Spain's races (`PUBLISH`, 2026-10-22).
"""
from __future__ import annotations

import re
import time
from pathlib import Path

import paths

from . import COUNTRY

# Spain's rankings, computed every day, are published since 2026-10-22 (owner's go-ahead, after the measure on Spain's
# races: the scratch es_eval / es_cmp, the plan's step 7)
PUBLISH = True
BACKFILL_BUDGET = 3600            # seconds of O-Replay's history a night until it is read once (archive.backfill_oreplay)

# Each category's usual level against H21 (France's Ozimut index, forest, 2024-2026: the median of each category's runners
# over the median H21), Spain's first season's starting point (cn_engine.bootstrap `prior`): Spain has no official index
# to start from, and its categories mostly race on courses of their own, so an equal start left every category on one level
CATEGORY_LEVEL = {
    "D12": 0.51, "D14": 0.55, "D16": 0.61, "D18": 0.67, "D20": 0.77, "D21": 0.74, "D35": 0.67, "D40": 0.65, "D45": 0.58,
    "D50": 0.60, "D55": 0.57, "D60": 0.57, "D65": 0.53, "D70": 0.48, "D75": 0.41, "D80": 0.36,
    "H12": 0.61, "H14": 0.63, "H16": 0.74, "H18": 0.84, "H20": 1.01, "H21": 1.00, "H35": 0.91, "H40": 0.86, "H45": 0.84,
    "H50": 0.81, "H55": 0.82, "H60": 0.78, "H65": 0.72, "H70": 0.64, "H75": 0.61, "H80": 0.52,
}


def category_level(cat: str | None) -> float:
    """A category's level against H21 (CATEGORY_LEVEL; an age not listed: the nearest of its sex; unknown: 0.75)."""
    m = re.match(r"^([HD])(\d+)", cat or "")
    if not m:
        return 0.75
    ages = [(abs(int(k[1:]) - int(m.group(2))), v) for k, v in CATEGORY_LEVEL.items() if k[0] == m.group(1)]
    return min(ages)[1]


def update(root: Path, prov_db: Path = paths.DB, budget_s: float = 900, db: Path | None = None, publish: bool = PUBLISH,
           since_oreplay: str = "2024-01-01") -> dict:
    from countries import identity
    from countries.http import Http
    from ffco_scraper.cn_engine import CnEngine, bootstrap

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
        from . import agenda_current, refresh_agenda
        if not agenda_current(root):                    # an older agenda would bring the totals back to « Résultats »
            stats["agenda"] = refresh_agenda(root)
        if agenda_current(root):
            stats["overall"] = archive.drop_overall(con, prov_db, http)     # once
        # O-Replay's history (2024 on) takes about two hours of reading: an hour a night until it is all read once
        left = max(60, budget_s - (time.monotonic() - t0)) if archive.meta_get(con, "oreplay_backfilled") else BACKFILL_BUDGET
        stats["oreplay"] = archive.backfill_oreplay(con, http, budget_s=left, since=since_oreplay)
    stats["dedupe"] = archive.dedupe(con)               # a race FEDO's file and another source both hold: FEDO's kept
    lic = identity.Licensees([dict(r) for r in con.execute("SELECT licence, name, club, card FROM es_licensees")]) \
        if con.execute("SELECT 1 FROM sqlite_master WHERE name = 'es_licensees'").fetchone() else None
    stats["pruned"] = archive.prune(con)                # races the rules now leave out
    stats["club_keys"] = clubs.canonical(con)           # before who is who: the club tells namesakes apart
    stats["identity"] = identity.resolve(con, lic)
    stats["clubs"] = clubs.assign(con)
    changed = stats["identity"]["rows"] > 0 or stats["from_prov"] or stats["oreplay"]["read"] or stats["fedo"]["read"] \
        or stats["dedupe"]["duplicates"] or (stats.get("overall") or {}).get("archive")
    con.close()
    if not changed and (COUNTRY.data_dir(root) / "meta.json").exists() == publish:
        stats["built"] = False
        return stats
    # the engine: everything again (a few minutes for Spain's archive): the bootstrap's first season depends on all of it
    e = CnEngine(db)
    methods = COUNTRY.methods()                # Spain's parameters (countries/es COUNTRY.method_params)
    e.populate_official()                     # the results as rows of their own (no official points: the registry)
    # the starting levels never expire (days=None): Spain's archive has gaps longer than the window (no sprint results from
    # 2020 to 2024 in FEDO's files), after which nobody would hold an index to value a circuit again (2026-10-22: the sprint
    # index stopped in 2020, VTT's altogether); kept seeds cost nothing measurable (-0.17 forest, -0.09 sprint, ns)
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

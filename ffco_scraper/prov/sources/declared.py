"""Competitions their organisers declare where the site reads no calendar (« Organisation », functions/api/declared.js;
owner, 2026-10-20: Ozimut open to every orienteer, France's competitions coming from FFCO's calendar).

The Function keeps each in R2 as declared/<id>.json — {id, key "d<id>", country, club, name, date, place, terrain,
epreuve, site, owner, status "active" | "removed", created, updated}. The workflow copies declared/ to
CN_DATA_DIR/declared before the run; here each becomes a race of prov_races under its key and country (a change of its
fields is carried over, a removal takes the race and its documents away). The organiser then deposits its start list and
results (sources.upload: an upload's meta.json carries the competition too, so a file sent before the folder was copied
still finds its race). Its runners are never matched to French licences (run.build: a race of another country), and it
is never merged with FFCO's races (races.merge_duplicates: France's only).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .. import races

log = logging.getLogger(__name__)
FIELDS = ("date_iso", "name", "place", "org", "terrain", "epreuve", "site", "country")


def row_of(d: dict) -> dict | None:
    """The prov_races fields of a declared competition, or None when it lacks the essentials."""
    if not (d.get("id") and d.get("name") and d.get("date") and d.get("country")) or d.get("country") == "FR":
        return None
    return {"key": f"d{d['id']}", "date_iso": d["date"], "name": d["name"], "place": d.get("place") or None,
            "org": d.get("club") or None, "terrain": d.get("terrain") or None, "epreuve": d.get("epreuve") or None,
            "site": d.get("site") or None, "country": d["country"]}


def upsert(con, d: dict) -> int:
    """Adds or updates the race of a declared competition (active); 1 if something changed."""
    r = row_of(d)
    if r is None:
        return 0
    old = con.execute("SELECT * FROM prov_races WHERE key = ?", (r["key"],)).fetchone()
    if old is None:
        now = races.now_iso()
        # agenda_id 0, as for the races added with an upload: no agenda event of FFCO's to link
        con.execute("""INSERT INTO prov_races (key, date_iso, name, place, org, org_code, terrain, epreuve, cn, site, agenda_id,
            first_seen, next_check, country) VALUES (?,?,?,?,?,NULL,?,?,0,?,0,?,?,?)""",
                    (r["key"], r["date_iso"], r["name"], r["place"], r["org"], r["terrain"], r["epreuve"], r["site"], now, now,
                     r["country"]))
        return 1
    if all(old[k] == r[k] for k in FIELDS):
        return 0
    # a new day or name: looked at again (its documents may be found under it)
    con.execute(f"UPDATE prov_races SET {', '.join(f'{k} = ?' for k in FIELDS)}, done = 0, next_check = NULL WHERE key = ?",
                [r[k] for k in FIELDS] + [r["key"]])
    return 1


def remove(con, key: str) -> int:
    """A removed competition: its race and documents go."""
    n = con.execute("DELETE FROM prov_docs WHERE race_key = ?", (key,)).rowcount
    n += con.execute("DELETE FROM prov_races WHERE key = ?", (key,)).rowcount
    return n


def apply(con, folder: Path) -> int:
    """Brings prov_races in line with the declared competitions copied from R2; the number of races added, changed or removed."""
    changed = 0
    for f in sorted(folder.glob("*.json")) if folder.exists() else []:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        try:
            if d.get("status") == "active":
                changed += upsert(con, d)
            elif d.get("id"):
                changed += remove(con, f"d{d['id']}")
        except Exception:                                  # one odd file must not stop the run
            log.exception("declared %s failed", f.name)
    con.commit()
    return changed

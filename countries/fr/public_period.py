"""FFCO's open seasons (owner, 2026-10-30). cn.ffcorientation.fr shows its older seasons to its licensees only (the season's
listing answers « réservée aux licenciés »; 2026-10-30: 2023 and before closed, 2024 on open). What a visitor without an
account, or an account that has not joined France, sees of France's rankings follows it: the public copy of France's data
(site_public.py) holds the races from the first open season on. Checked once a month by the daily full run — a few listing
pages, without a session cookie —, kept in engine_meta (`ffco_public_from`, `ffco_public_checked`).
"""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

import httpx

BASE = "https://cn.ffcorientation.fr"
MARKER = "réservée aux licenciés"
DEFAULT = 2024                  # as read on 2026-10-30, until a check says otherwise
UA = "ffco-cn-scraper/1.0 (personal archival tool; contact via ffcorientation.fr account)"


def _meta(con: sqlite3.Connection) -> dict:
    """The kept values (none before the first check; the connection may be read-only, build_site's)."""
    try:
        return dict(con.execute("SELECT key, value FROM engine_meta WHERE key LIKE 'ffco_public_%'").fetchall())
    except sqlite3.OperationalError:
        return {}


def public_from(con: sqlite3.Connection) -> int:
    """The first season FFCO shows without a login, as last checked."""
    v = _meta(con).get("ffco_public_from")
    return int(v) if v and v.isdigit() else DEFAULT


def closed(season: int, client: httpx.Client) -> bool | None:
    """Is a season's listing for licensees only? None when the page could not be read."""
    try:
        r = client.get(f"{BASE}/course/?season={season}")
    except httpx.HTTPError:
        return None
    return MARKER in r.text if r.status_code == 200 else None


def check(db: Path, today: date | None = None, force: bool = False) -> int:
    """Once a month: the first open season, from the seasons around the last one known; -> the season (unchanged when the
    pages could not be read)."""
    today = today or date.today()
    con = sqlite3.connect(db)
    try:
        con.execute("CREATE TABLE IF NOT EXISTS engine_meta (key TEXT PRIMARY KEY, value TEXT)")
        m = _meta(con)
        known = public_from(con)
        if not force and m.get("ffco_public_checked", "")[:7] == today.isoformat()[:7]:
            return known
        first = known
        with httpx.Client(headers={"User-Agent": UA}, timeout=30, follow_redirects=True) as client:
            # walk back while the season before is open, forward while this one is closed
            while first - 1 >= 2010 and closed(first - 1, client) is False:
                first -= 1
            while first < today.year and closed(first, client) is True:
                first += 1
        con.executemany("INSERT OR REPLACE INTO engine_meta (key, value) VALUES (?, ?)",
                        [("ffco_public_from", str(first)), ("ffco_public_checked", today.isoformat())])
        con.commit()
        if first != known:
            print(f"FFCO's open seasons: from {first} (was {known})")
        return first
    finally:
        con.close()

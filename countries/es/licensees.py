"""Spain's licensees of the year, as SICO publishes them (sico.fedo.org's home page, « Federado <year> »: name « Apellidos,
Nombre », club, regional federation, SportIdent card, licence; about 6 500 in 2026, 25 a page). They tell the results'
runners apart (countries/es/identity.py): the results print no licence. Read once a month (~265 requests); the list is
only ever used to recognise runners — its licence and card numbers are never published.

The page's `pag` parameter pages the calendar and the licensees together (the calendar's own pages run out first).
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime, timezone

from lxml import html as lhtml

from .sico import BASE

EVERY_DAYS = 30
SCHEMA = """
CREATE TABLE IF NOT EXISTS es_licensees (
  licence    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,          -- « Apellidos, Nombre » as SICO writes it
  club       TEXT,                   -- its short code (« COMA »)
  federation TEXT,                   -- the regional federation (« FADO »)
  card       TEXT,                   -- the SportIdent card
  season     INTEGER,
  seen_at    TEXT NOT NULL
);
"""


def parse(content: bytes) -> tuple[list[dict], int, int | None]:
    """A page -> (its licensees, the number of pages, the season)."""
    s = content.decode("utf-8", "replace")
    part = s.split("filtro_federados", 1)[-1]
    season = re.search(r"Federado\s+(\d{4})", part)
    pages = re.search(r"P&aacute;g\. \d+ De (\d+)|Pág\. \d+ De (\d+)", part)
    out = []
    doc = lhtml.fromstring(part.split("filtro_titulaciones", 1)[0] or "<p></p>")
    for tr in doc.xpath("//tbody/tr"):
        tds = [re.sub(r"\s+", " ", td.text_content()).strip() for td in tr.xpath("./td")]
        if len(tds) >= 5 and tds[0] and tds[4]:
            out.append({"name": tds[0], "club": tds[1] or None, "federation": tds[2] or None, "card": tds[3] or None,
                        "licence": tds[4]})
    n = int(pages.group(1) or pages.group(2)) if pages else 1
    return out, n, int(season.group(1)) if season else None


def refresh(con, http, budget_s: float = 600, force: bool = False) -> dict:
    """Read the whole list again when it is older than EVERY_DAYS (a budget per run: the next goes on)."""
    con.executescript(SCHEMA)
    from .archive import meta_get, meta_set
    state = meta_get(con, "licensees", {})
    today = date.today()
    if not force and state.get("done") and (today - date.fromisoformat(state["done"])).days < EVERY_DAYS:
        return {"skipped": True}
    t0 = time.monotonic()
    # a new reading starts at the first page; one the budget cut short goes on where it stopped
    page = 0 if force or state.get("done") else state.get("next", 0)
    pages, got = state.get("pages") or 1, 0
    while page < pages:
        if time.monotonic() - t0 > budget_s:
            break
        a = http.get(f"{BASE}/index.php", params={"pag": page})
        if a.status != 200:
            break
        rows, pages, season = parse(a.content)
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for r in rows:
            con.execute("""INSERT OR REPLACE INTO es_licensees (licence, name, club, federation, card, season, seen_at)
                           VALUES (?,?,?,?,?,?,?)""", (r["licence"], r["name"], r["club"], r["federation"], r["card"], season, stamp))
        got += len(rows)
        page += 1
        meta_set(con, "licensees", {"next": page, "pages": pages, "done": None})
        con.commit()
    finished = page >= pages
    if finished:
        meta_set(con, "licensees", {"next": 0, "pages": pages, "done": today.isoformat()})
        con.commit()
    return {"rows": got, "pages": pages, "finished": finished, "seconds": round(time.monotonic() - t0)}

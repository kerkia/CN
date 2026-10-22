"""Spain's official ranking: the Liga Española's, as FEDO publishes it — one file a season, individual and sprint
(« HODOR »: www.fedo.org/competicion/O_Pie/Ranking/Ranking-Individual-<year>.html, the archive's pages for 2017 on), copied
as it is: each runner's licence, category, name, club, season total (the best 8 races), number of races, M1 (the mean of
the best 6, from 6 races), M2 (of every valid race), M3 (of every race), and their points race by race (the winner's time
over theirs × 100 in their category; 105 at the Campeonato de España).

A runner's official value on the site is their M1, else their M2 (from fewer races): FEDO's measure of their level over the
season, which Ozimut's is compared with as France's is with the CN.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from lxml import html as lhtml

SITE = "https://www.fedo.org"
CURRENT = SITE + "/web/ranking/o-pie"
ARCHIVE = SITE + "/web/ranking/o-pie/archivo"
SCHEMA = """
CREATE TABLE IF NOT EXISTS es_fedo_ranking (
  season     INTEGER NOT NULL,
  discipline TEXT NOT NULL,          -- 'For' (the individual ranking: middle and long distance) | 'Spr'
  category   TEXT NOT NULL,          -- « F-21A »
  licence    TEXT NOT NULL,          -- FEDO's licence
  name       TEXT,                   -- « Nombre Apellido1 Apellido2 »
  club       TEXT,
  rank       INTEGER,
  total      REAL, n INTEGER, m1 REAL, m2 REAL, m3 REAL,
  points     TEXT,                   -- JSON {race column: points}
  as_of      TEXT,                   -- the file's update day
  PRIMARY KEY (season, discipline, category, licence)
);
CREATE TABLE IF NOT EXISTS es_fedo_races (season INTEGER, discipline TEXT, code TEXT, name TEXT, PRIMARY KEY (season, discipline, code));
"""
FIXED = ["orden", "licencia", "cat", "nombre", "apellido1", "apellido2", "club", "total", "numero de carreras", "m1", "m2", "m3"]


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _fold(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def files(http) -> list[tuple[int, str, str]]:
    """[(season, discipline, address)] of every season's individual and sprint ranking files."""
    pages = [CURRENT]
    a = http.get(ARCHIVE)
    if a.status == 200:
        pages += sorted({SITE + h for h in re.findall(r'href="(/web/ranking/o-pie/archivo/\d+-ranking-liga-espanola[^"]+)"', a.text())})
    out = {}
    for page in pages:
        b = a if page == ARCHIVE else http.get(page)
        if b.status != 200:
            continue
        for href in re.findall(r'href="([^"]*/Ranking/[^"]+\.html)"', b.text()):
            low = href.lower()
            if any(w in low for w in ("clubes", "eyoc", "jwoc", "woc", "wc1", "comunidades", "ceo")):
                continue
            year = re.search(r"(20\d{2})", href) or re.search(r"(\d{2})\.html$", href)
            if not year:
                continue
            y = int(year.group(1)) if len(year.group(1)) == 4 else 2000 + int(year.group(1))
            disc = "Spr" if "sprint" in low else "For"
            url = SITE + "/" + href.replace("/web/../", "").lstrip("/") if not href.startswith("http") else href
            out[(y, disc)] = url
    return sorted((y, d, u) for (y, d), u in out.items())


def parse(content: bytes) -> tuple[list[dict], dict, str | None]:
    """A ranking file -> (its rows, its races {column: name}, its update day)."""
    s = content.decode("utf-8", "replace").replace("\\'", "'").replace('\\"', '"')
    races = {}
    legend = re.search(r"Lista de Carreras:\s*(.*?)(?:Todas valen|</)", s, re.S)
    if legend:
        for part in legend.group(1).split(";"):
            m = re.match(r"\s*([A-Za-z0-9]+)\s*-\s*(.+?)\s*$", re.sub(r"<[^>]+>", " ", part))
            if m:
                races[m.group(1)] = m.group(2)
    as_of = None
    m = re.search(r"Actualizaci[oó]n:\s*(\d{1,2}) de (\w+) de (\d{4})", s)
    MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
              "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
    if m and _fold(m.group(2)) in MONTHS:
        as_of = f"{m.group(3)}-{MONTHS[_fold(m.group(2))]:02d}-{int(m.group(1)):02d}"
    rows: dict[tuple, dict] = {}
    # every table: its header row, then its runners' rows (the per-category tables sit in the page's script as text)
    for chunk in re.split(r"(?=<th>Orden</th>)", s)[1:]:
        head = [_fold(re.sub(r"<[^>]+>", "", h)) for h in re.findall(r"<th[^>]*>(.*?)</th>", chunk.split('<tr class="fila"', 1)[0])]
        if head[: len(FIXED)] != FIXED:
            continue
        cols = re.findall(r"<th[^>]*>(.*?)</th>", chunk.split('<tr class="fila"', 1)[0])
        race_cols = [re.sub(r"<[^>]+>", "", c).strip() for c in cols[len(FIXED):]]
        for tr in re.findall(r'<tr class="fila">(.*?)</tr>', chunk, re.S):
            cells = [lhtml.fromstring(f"<td>{c}</td>").text_content().strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            if len(cells) < len(FIXED) or not cells[1]:
                continue
            pts = {c: _num(v) for c, v in zip(race_cols, cells[len(FIXED):]) if c and c not in ("Nom", "Ap1", "Ap2") and _num(v) is not None}
            r = {"rank": int(_num(cells[0]) or 0) or None, "licence": cells[1], "category": cells[2],
                 "name": " ".join(x for x in cells[3:6] if x), "club": cells[6] or None, "total": _num(cells[7]),
                 "n": int(_num(cells[8]) or 0), "m1": _num(cells[9]), "m2": _num(cells[10]), "m3": _num(cells[11]), "points": pts}
            rows[(r["category"], r["licence"])] = r
    return list(rows.values()), races, as_of


def refresh(con, http, seasons: set[int] | None = None) -> dict:
    """Every season's files (the current one each time; a past season once)."""
    con.executescript(SCHEMA)
    have = {(y, d) for y, d in con.execute("SELECT DISTINCT season, discipline FROM es_fedo_ranking")}
    current = datetime.now(timezone.utc).year
    got = 0
    for y, disc, url in files(http):
        if (seasons and y not in seasons) or ((y, disc) in have and y < current):
            continue
        a = http.get(url)
        if a.status != 200:
            continue
        rows, races, as_of = parse(a.content)
        if not rows:
            continue
        con.execute("DELETE FROM es_fedo_ranking WHERE season = ? AND discipline = ?", (y, disc))
        con.executemany("""INSERT OR REPLACE INTO es_fedo_ranking (season, discipline, category, licence, name, club, rank, total,
                           n, m1, m2, m3, points, as_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        [(y, disc, r["category"], r["licence"], r["name"], r["club"], r["rank"], r["total"], r["n"], r["m1"], r["m2"],
                          r["m3"], json.dumps(r["points"]), as_of) for r in rows])
        con.executemany("INSERT OR REPLACE INTO es_fedo_races (season, discipline, code, name) VALUES (?,?,?,?)",
                        [(y, disc, k, v) for k, v in races.items()])
        con.commit()
        got += 1
    return {"files": got}

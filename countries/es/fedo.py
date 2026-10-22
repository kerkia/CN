"""The Liga Española's results on fedo.org: each season's page (the current one, then the archive's, 2017 on) lists its
races — name, days (« 8-9 FEBRERO »), place — and, by format, their results: OE12's HTML (« Totales »), else a PDF.
Each file is one race in Spain's archive (source 'fedo'), read once: about 20 a season.

A file's day: the one its page was printed on when it falls within the race's days (OE12 prints « do. 30/08/2026 14:12 »),
else the race's first day for a sprint or a middle distance, its last for a long one."""
from __future__ import annotations

import re
from datetime import date

from lxml import html as lhtml

from .archive import store_race

SITE = "https://www.fedo.org"
CURRENT = SITE + "/web/competicion/o-pie/resultados"
ARCHIVE = SITE + "/web/archivo-resultados-o-pie"
MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
          "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
FORMAT = [("Sprint", r"sprint"), ("MD", r"media"), ("LD", r"larga"), ("Nuit", r"noche|nocturna")]
SKIP = re.compile(r"globales|parciales|relevo|\bko\b|-ko-|clasificacion|semifinal|final|mosc|equipos", re.I)
# the readers' version: a file they could not read is tried again once they improve (2: OE12's PDFs in Spanish, 2026-10-22)
READER = 2


def _fold(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def _days(text: str, season: int) -> list[str]:
    """« 8-9 FEBRERO », « 31 OCTUBRE - 1 NOVIEMBRE », « 29-30 AGOSTO » -> the ISO days."""
    t = _fold(text).split(" - ")[0] if " - " in text else _fold(text)
    out = []
    month = None
    for m in reversed(list(re.finditer(r"(\d{1,2})(?:\s*(?:-|y|al)\s*(\d{1,2}))?\s*(?:de\s+)?([a-z]+)?", t))):
        if m.group(3) in MONTHS:
            month = MONTHS[m.group(3)]
        if not month:
            continue
        for d in [m.group(2), m.group(1)]:
            if d:
                try:
                    out.append(date(season, month, int(d)).isoformat())
                except ValueError:
                    pass
    return sorted(set(out))


def races(page: bytes, season: int) -> list[dict]:
    """A season's page -> [{title, place, days, format, url}], one per results file."""
    doc = lhtml.fromstring(page)
    out = []
    for table in doc.xpath("//table[@id='tabla-resultados']"):
        head = table.xpath(".//tr[1]//span")
        title = next((re.sub(r"\s+", " ", s.text_content()).strip() for s in head if "r-subtitulo" not in (s.get("class") or "")), "")
        sub = next((re.sub(r"\s+", " ", s.text_content()).strip() for s in head if "r-subtitulo" in (s.get("class") or "")), "")
        place = sub.split(" - ", 1)[1].strip() if " - " in sub else None
        days = _days(sub, season)
        for tr in table.xpath(".//tr")[1:]:
            label = " ".join(td.text_content() for td in tr.xpath("./td[contains(@class,'r-prueba')]"))
            for a in tr.xpath(".//a[@href]"):
                href = a.get("href")
                if not re.search(r"\.(html?|pdf)$", href, re.I) or SKIP.search(href) or SKIP.search(_fold(label)):
                    continue
                fmt = next((f for f, rx in FORMAT if re.search(rx, _fold(label) + " " + href.lower())), "")
                url = href if href.startswith("http") else SITE + "/" + href.replace("/web/../", "").lstrip("/")
                out.append({"title": title, "place": place, "days": days, "format": fmt, "url": url})
    # one file per race and format: the HTML before the PDF
    best = {}
    for r in out:
        k = (r["title"], r["format"])
        if k not in best or (best[k]["url"].lower().endswith(".pdf") and not r["url"].lower().endswith(".pdf")):
            best[k] = r
    return list(best.values())


def season_pages(http) -> list[tuple[int, str]]:
    a = http.get(ARCHIVE)
    pages = []
    if a.status == 200:
        for href, y in re.findall(r'href="(/web/archivo-resultados-o-pie/\d+-liga-espanola-de-orientacion-a-pie-(\d{4}))"', a.text()):
            pages.append((int(y), SITE + href))
    pages.append((date.today().year, CURRENT))
    return sorted(set(pages))


def day_of(r: dict, content: bytes) -> str | None:
    printed = re.search(rb"(\d{2})/(\d{2})/(\d{4})\s+\d{1,2}:\d{2}", content[:20000])
    if printed:
        d = f"{printed.group(3).decode()}-{printed.group(2).decode()}-{printed.group(1).decode()}"
        if r["days"] and r["days"][0] <= d <= r["days"][-1]:
            return d
    if not r["days"]:
        return None
    return r["days"][-1] if r["format"] == "LD" else r["days"][0]


def import_all(con, http, budget_s: float = 600, seasons: set[int] | None = None) -> dict:
    """Every season's Liga Española results not yet in the archive (a budget per run)."""
    import time
    from ffco_scraper.prov.run import parse_any
    t0 = time.monotonic()
    done = {r[0] for r in con.execute("SELECT sid FROM es_sources WHERE source = 'fedo' AND (course_id != 0 OR sha = ?)",
                                      (f"unread:{READER}",))}
    got = left = 0
    for season, page in season_pages(http):
        if seasons and season not in seasons:
            continue
        a = http.get(page)
        if a.status != 200:
            continue
        for r in races(a.content, season):
            if r["url"] in done:
                continue
            if time.monotonic() - t0 > budget_s:
                left += 1
                continue
            b = http.get(r["url"])
            doc = parse_any(b.content, r["url"]) if b.status == 200 else None
            day = day_of(r, b.content) if b.status == 200 else None
            name = r["title"] + (f" — {dict(MD='Media distancia', LD='Larga distancia', Sprint='Sprint', Nuit='Nocturna')[r['format']]}"
                                 if r["format"] else "")
            meta = {"name": name, "date": day, "place": r["place"], "org": None, "epreuve": r["format"],
                    "league": "Liga Española"}
            if doc and day and store_race(con, "fedo", r["url"], meta, doc) is not None:
                got += 1
            else:                                   # unreadable or empty: not asked for again until the readers improve
                con.execute("INSERT OR REPLACE INTO es_sources (source, sid, course_id, sha, read_at) VALUES ('fedo', ?, 0, ?, ?)",
                            (r["url"], f"unread:{READER}", date.today().isoformat()))
            con.commit()
    return {"read": got, "left": left, "seconds": round(time.monotonic() - t0)}

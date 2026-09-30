"""HTML parsing for the three page types this scraper touches:

- /course/?season=YYYY   -> list of competitions (parse_course_list)
- /course/<id>/          -> one competition's circuits (parse_course_detail)
- /circuit/<id>/         -> one circuit's full results table (parse_circuit)

Parsing is kept separate from fetching so it can be unit-tested against
saved HTML fixtures without any network access.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from lxml import html as lhtml

from .models import CourseListing

_COURSE_HREF_RE = re.compile(r"^/course/(\d+)/$")
_CIRCUIT_HREF_RE = re.compile(r"^/circuit/(\d+)/$")


def _text(el) -> str:
    return (el.text_content() if el is not None else "").strip()


def parse_course_list(html_text: str, season: int) -> list[CourseListing]:
    if not html_text.strip():
        return []
    doc = lhtml.fromstring(html_text)
    out: list[CourseListing] = []
    for tr in doc.cssselect("table tr"):
        cells = tr.xpath("./td|./th")
        if len(cells) < 8:
            continue  # header row or malformed row
        date_txt = _text(cells[0])
        if not re.match(r"^\d{2}/\d{2}/\d{4}$", date_txt):
            continue  # skip the header row
        title_cell = cells[1]
        link = title_cell.xpath(".//a[@href]")
        course_id = None
        if link:
            m = _COURSE_HREF_RE.match(link[0].get("href", ""))
            if m:
                course_id = int(m.group(1))
        title = _text(title_cell)
        location = _text(cells[2])
        organizer = _text(cells[3])
        groupe = _text(cells[4])
        specialite = _text(cells[5])
        epreuve = _text(cells[6])
        # The site's own UI splits "CN pédestre forêt" (LD/MD/Nuit) from
        # "CN pédestre sprint" (Sprint) — mirror that split as an explicit
        # column rather than making callers infer it from epreuve.
        terrain = "Sprint" if epreuve == "Sprint" else "Forêt"
        img = cells[7].xpath(".//img/@src")
        has_results = bool(link) and course_id is not None
        if img and "icon-no" in img[0]:
            has_results = False
        # Rows with no results link yet (course_id is None) are still
        # reported — dropping them here would silently under-count the
        # competitions that exist but haven't had results uploaded.
        out.append(
            CourseListing(
                course_id=course_id,
                date=date_txt,
                title=title,
                location=location,
                organizer=organizer,
                groupe=groupe,
                specialite=specialite,
                epreuve=epreuve,
                terrain=terrain,
                has_results=has_results,
                season=season,
            )
        )
    return out


@dataclass
class CircuitRef:
    circuit_id: int
    name: str
    couleur: str


@dataclass
class CourseDetail:
    date: str
    circuits: list[CircuitRef]
    csv_href: str | None


def parse_course_detail(html_text: str) -> CourseDetail:
    doc = lhtml.fromstring(html_text)
    date = ""
    for el in doc.xpath("//*[contains(text(), 'Date')]"):
        txt = _text(el)
        m = re.search(r"(\d{2}/\d{2}/\d{4})", txt)
        if m:
            date = m.group(1)
            break

    csv_href = None
    csv_links = doc.xpath("//a[contains(@href, '/resultats_csv/')]/@href")
    if csv_links:
        csv_href = csv_links[0]

    circuits: list[CircuitRef] = []
    for row in doc.cssselect("table tr"):
        cells = row.xpath("./td|./th")
        if len(cells) < 2:
            continue
        link = cells[0].xpath(".//a[@href]")
        if not link:
            continue
        m = _CIRCUIT_HREF_RE.match(link[0].get("href", ""))
        if not m:
            continue
        circuits.append(
            CircuitRef(
                circuit_id=int(m.group(1)),
                name=_text(cells[0]),
                couleur=_text(cells[1]) if len(cells) > 1 else "",
            )
        )
    return CourseDetail(date=date, circuits=circuits, csv_href=csv_href)


_DISTANCE_RE = re.compile(r"Distance\s*:\s*([\d,.]+)\s*km", re.IGNORECASE)
_VALEUR_RE = re.compile(r"Valeur du circuit\s*:\s*(\d+)", re.IGNORECASE)


@dataclass
class CircuitPage:
    distance_km: float | None
    valeur: int | None
    header: list[str]
    rows: list[list[str]]


def parse_circuit(html_text: str) -> CircuitPage:
    doc = lhtml.fromstring(html_text)
    body_text = doc.text_content()

    distance_km = None
    m = _DISTANCE_RE.search(body_text)
    if m:
        distance_km = float(m.group(1).replace(",", "."))

    valeur = None
    m = _VALEUR_RE.search(body_text)
    if m:
        valeur = int(m.group(1))

    tables = doc.cssselect("table")
    header: list[str] = []
    rows: list[list[str]] = []
    if tables:
        trs = tables[0].xpath(".//tr")
        if trs:
            header = [_text(c) for c in trs[0].xpath("./td|./th")]
            for tr in trs[1:]:
                cells = [_text(c) for c in tr.xpath("./td|./th")]
                if any(cells):
                    rows.append(cells)
    return CircuitPage(distance_km=distance_km, valeur=valeur, header=header, rows=rows)

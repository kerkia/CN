"""SICO (sico.fedo.org), the Spanish federation's calendar and registration system: its competitions and activities,
their organisers, dates, places, stages (« Pruebas »), registration window, website and announcement, and the public list
of each one's entries (name, SportIdent card, IOF id, club, stage, category). No robots.txt (404, 2026-10-22).

The calendar page lists the events from today on (« ≥ hoy »), paginated (`index.php?pag=N`, from 0); a month is chosen with
the filter form (POST `index.php?_action=filtro` with `id_fecha=YYYY-MM`), kept in the session — hence one client, with
its cookies, for a whole read. An event's page is `carrera.php?id=N`.
"""
from __future__ import annotations

import html as htmllib
import re
from datetime import date

from lxml import html as lhtml

BASE = "https://sico.fedo.org"


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.text_content() if el is not None else "").strip()


def _day(s: str) -> str | None:
    """« 24/10/26 » or « 24/10/2026 » -> 2026-10-24."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", s or "")
    if not m:
        return None
    y = int(m.group(3))
    y = y + 2000 if y < 100 else y
    try:
        return date(y, int(m.group(2)), int(m.group(1))).isoformat()
    except ValueError:
        return None


def parse_list(content: bytes) -> tuple[list[dict], int]:
    """The calendar table -> ([{id, name, date, days, league, modality, org, place}], number of pages)."""
    doc = lhtml.fromstring(content)
    out = []
    for tr in doc.xpath("//tr[@href]"):
        m = re.search(r"carrera\.php\?id=(\d+)", tr.get("href", ""))
        tds = tr.xpath("./td")
        if not m or len(tds) < 7:
            continue
        out.append({"id": m.group(1), "name": _text(tds[0]), "date": _day(_text(tds[1])), "days": _int(_text(tds[2])),
                    "league": _text(tds[3]), "modality": _text(tds[4]), "org": _text(tds[5]), "place": _text(tds[6])})
    # the calendar's own pagination: right after its table, before the licensees' form (whose list has its own, 263 pages
    # in 2026 — read as the calendar's, a month asked for read them all)
    text = content.decode("utf-8", "replace").split("filtro_federados", 1)[0]
    pages = re.search(r"P&aacute;g\. \d+ De (\d+)|Pág\. \d+ De (\d+)", text.split("<tbody>", 1)[-1])
    n = int(pages.group(1) or pages.group(2)) if pages and out else 1
    return out, n


def _int(s: str) -> int | None:
    m = re.search(r"\d+", s or "")
    return int(m.group()) if m else None


FIELDS = {"prueba": "name", "liga": "league", "lugar": "place", "organizadores": "org", "fecha": "date",
          "numero de dias": "days", "numero de pruebas": "stages_n", "fecha inscripcion": "reg", "observaciones": "obs",
          "web": "site", "email": "email", "modalidad": "modality"}


def _fold(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip(" :")


def parse_event(content: bytes) -> dict:
    """An event's page -> its fields, its stages [{name, league, day}], its announcement, its entries counted by stage and
    category (the names are not kept: the start lists come later, from the organisers)."""
    s = content.decode("utf-8", "replace")
    doc = lhtml.fromstring(content)
    out: dict = {}
    # « <span class='font-weight-bold'>Prueba: </span> value</br> … »: each label, then the text up to the next label
    for span in doc.xpath("//span[contains(@class,'font-weight-bold')]"):
        key = FIELDS.get(_fold(_text(span)))
        if not key:
            continue
        parts, node = [], span
        while True:
            tail = node.tail or ""
            parts.append(tail)
            node = node.getnext()
            if node is None or node.tag == "br" or (node.tag == "span" and "font-weight-bold" in (node.get("class") or "")):
                break
            if node.tag == "a" and key == "email":
                parts.append(node.text_content())
            elif key == "site":
                a = node.xpath(".//a/@href") or ([node.get("href")] if node.tag == "a" else [])
                parts.append(a[0] if a else node.text_content())
            else:
                parts.append(node.text_content())
        out[key] = re.sub(r"\s+", " ", htmllib.unescape("".join(parts))).strip().strip(",").strip()
    if "date" in out:
        out["date"] = _day(out["date"])
    if "reg" in out:                                   # « 21/07/2026 Hasta 19/10/2026 »
        days = re.findall(r"\d{1,2}/\d{1,2}/\d{4}", out.pop("reg"))
        out["reg_open"], out["reg_close"] = (_day(days[0]) if days else None), (_day(days[1]) if len(days) > 1 else None)
    for k in ("days", "stages_n"):
        if k in out:
            out[k] = _int(out[k])
    tables = doc.xpath("//table")
    stages = []
    for t in tables:
        heads = [_fold(_text(th)) for th in t.xpath(".//thead//th")]
        if heads[:3] == ["nombre", "prueba/actividad", "dia"]:
            for tr in t.xpath(".//tbody/tr"):
                tds = [_text(td) for td in tr.xpath("./td")]
                if len(tds) >= 3:
                    stages.append({"name": tds[0].strip("'\" "), "league": tds[1], "day": _int(tds[2]) or 1})
        elif heads[:2] == ["nombre", "sportident"] and "categoria" in heads:
            ip, ic = heads.index("prueba") if "prueba" in heads else None, heads.index("categoria")
            count: dict[tuple, int] = {}
            for tr in t.xpath(".//tbody/tr"):
                tds = [_text(td) for td in tr.xpath("./td")]
                if len(tds) <= ic or not tds[0]:
                    continue
                k = ((tds[ip].strip("'\" ") if ip is not None else ""), tds[ic])
                count[k] = count.get(k, 0) + 1
            out["entries"] = [[st, cat, n] for (st, cat), n in sorted(count.items())]
    out["stages"] = stages
    doc_link = re.search(r'href="(docs/[^"]+\.pdf)"', s)
    if doc_link:
        out["invitation"] = f"{BASE}/{doc_link.group(1)}"
    out["open"] = "Plazo agotado" not in s and "Inscripci" in s and "disabled" not in s.split("Listado de Inscritos", 1)[-1][:400]
    return out


def read_calendar(http, months: list[str]) -> list[dict]:
    """The calendar from today on (every page), then the months asked for (« 2026-09 »): the list's rows, by id."""
    rows: dict[str, dict] = {}
    a = http.get(f"{BASE}/index.php")
    if a.status != 200:
        return []
    first, pages = parse_list(a.content)
    for r in first:
        rows[r["id"]] = r
    for p in range(1, pages):
        a = http.get(f"{BASE}/index.php", params={"pag": p})
        if a.status == 200:
            for r in parse_list(a.content)[0]:
                rows[r["id"]] = r
    for m in months:
        a = http.post(f"{BASE}/index.php?_action=filtro", {"id_modalidad": "", "id_fecha": m, "id_provincia": ""})
        if a.status != 200:
            continue
        got, pages = parse_list(a.content)
        for r in got:
            rows[r["id"]] = r
        for p in range(1, pages):
            b = http.get(f"{BASE}/index.php", params={"pag": p})
            if b.status == 200:
                for r in parse_list(b.content)[0]:
                    rows[r["id"]] = r
    # the filter stays in the session: back to the default (the next read of the same client starts clean)
    http.post(f"{BASE}/index.php?_action=filtro", {"id_modalidad": "", "id_fecha": "", "id_provincia": ""})
    return list(rows.values())


def read_event(http, ev_id: str) -> dict | None:
    a = http.get(f"{BASE}/carrera.php", params={"id": ev_id})
    return parse_event(a.content) if a.status == 200 and b"font-weight-bold" in a.content else None


def event_url(ev_id: str) -> str:
    return f"{BASE}/carrera.php?id={ev_id}"

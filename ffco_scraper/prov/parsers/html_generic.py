"""Fallback parser for any HTML results table (club web pages, hand-made lists), and the HTML helpers the
other HTML parsers (oe_html, meos_html) share.

A table qualifies when one of its rows is a header with a name column (Nom, Name, Coureur…) and a time column
(Temps, Time…). Classes come, in this order, from rows holding a single cell (a class title inside the table),
from a circuit/category column when the table has one, or else from the heading just before the table.
This parser is tried last: the dedicated parsers know their format better.
"""

from __future__ import annotations

import re

import lxml.html

from .. import model

KIND = "html_generic"

# ---------------------------------------------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------------------------------------------

_META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-]+)""", re.I)


def decode_html(content: bytes) -> str:
    """The page as text: BOM first, then the <meta> charset, then utf-8, then cp1252 (old OE files)."""
    if content.startswith(b"\xef\xbb\xbf"):
        return content[3:].decode("utf-8", "replace")
    if content[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return content.decode("utf-16", "replace")
    m = _META_CHARSET.search(content[:4096])
    declared = m.group(1).decode("ascii", "ignore").lower() if m else ""
    # latin-1 declarations are really cp1252 in practice (Windows software): cp1252 is a superset
    if declared in ("windows-1252", "cp1252", "iso-8859-1", "iso8859-1", "latin1", "latin-1", "iso-8859-15"):
        return content.decode("cp1252", "replace")
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("cp1252", "replace")


def parse_html(content: bytes):
    """(lxml root, decoded text), or (None, text) when lxml cannot make sense of it."""
    text = decode_html(content)
    try:
        # lxml refuses a str that still carries an XML encoding declaration
        root = lxml.html.document_fromstring(re.sub(r"^\s*<\?xml[^>]*\?>", "", text))
    except Exception:
        return None, text
    return root, text


def text_of(el) -> str:
    """An element's visible text, spaces (incl. &nbsp;) collapsed."""
    if el is None:
        return ""
    try:
        t = el.text_content()
    except Exception:
        t = str(el)
    return re.sub(r"\s+", " ", t.replace("\xa0", " ").replace("&nbsp", " ")).strip()


def cells_of(tr) -> list:
    """The td/th cells of a row, each repeated over its colspan so that columns line up between rows."""
    out = []
    for c in tr.xpath("./td|./th"):
        try:
            span = max(1, min(int(c.get("colspan") or 1), 50))
        except ValueError:
            span = 1
        out.append(c)
        out.extend([None] * (span - 1))
    return out


_MONTHS = {"jan": 1, "fev": 2, "feb": 2, "mar": 3, "avr": 4, "apr": 4, "mai": 5, "may": 5, "juin": 6, "jun": 6,
           "juil": 7, "jul": 7, "aou": 8, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _ymd(y: int, m: int, d: int) -> str | None:
    if 2000 <= y <= 2099 and 1 <= m <= 12 and 1 <= d <= 31:
        return f"{y:04d}-{m:02d}-{d:02d}"
    return None


def find_date(*texts: str | None) -> str | None:
    """The first date printed in the texts, as YYYY-MM-DD: 2026-10-03, 03/10/2026, 27 09 2026, 13 sept. 2026,
    20261003_..., ..._130926 (ddmmyy, only as a whole token)."""
    for raw in texts:
        t = model.plain(raw)
        if not t:
            continue
        for rx, order in ((r"(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)", "ymd"),
                          (r"(?<!\d)(\d{1,2})[ /.\-_](\d{1,2})[ /.\-_](\d{4})(?!\d)", "dmy")):
            for m in re.finditer(rx, t):
                a, b, c = (int(x) for x in m.groups())
                d = _ymd(a, b, c) if order == "ymd" else _ymd(c, b, a)
                if d:
                    return d
        m = re.search(r"(?<!\d)(\d{1,2})(?:er)? ([a-z]{3,9})\.? (\d{4})(?!\d)", t)
        if m:
            mon = next((v for k, v in _MONTHS.items() if m.group(2).startswith(k)), None)
            if mon and _ymd(int(m.group(3)), mon, int(m.group(1))):
                return _ymd(int(m.group(3)), mon, int(m.group(1)))
        m = re.search(r"(?<![\d])(20\d{2})(\d{2})(\d{2})(?![\d])", t)
        if m and _ymd(*(int(x) for x in m.groups())):
            return _ymd(*(int(x) for x in m.groups()))
        m = re.search(r"(?:^|[_ ])(\d{2})(\d{2})(\d{2})(?:$|[_ .])", t)
        if m:
            d, mo, y = (int(x) for x in m.groups())
            if 10 <= y <= 40:
                r = _ymd(2000 + y, mo, d)
                if r:
                    return r
    return None


_COUNT_SUFFIX = re.compile(r"\s*\(\s*\d+\s*(?:/\s*\d+\s*)?\)\s*$")


def clean_class_name(text: str | None) -> str:
    """'H14  (8)', 'homme (19/19)' -> 'H14', 'homme'."""
    return _COUNT_SUFFIX.sub("", re.sub(r"\s+", " ", str(text or ""))).strip()


def length_climb(text: str | None) -> tuple[int | None, int | None]:
    """'2,5 km  0 m' -> (2500, 0); '1,9 km' -> (1900, None); '4.2 km 120 m 18 P' -> (4200, 120)."""
    t = str(text or "").replace("\xa0", " ")
    length = climb = None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*km\b", t, re.I)
    if m:
        length = int(round(float(m.group(1).replace(",", ".")) * 1000))
    m = re.search(r"(?<![\d.,k])(\d+)\s*m\b", t[m.end():] if m else t)
    if m:
        climb = int(m.group(1))
    return length, climb


def place_of(text: str | None) -> int | None:
    """'1', '1.', '12e', '1er', '=3' -> int; anything else None."""
    m = re.fullmatch(r"\s*=?\s*(\d{1,4})\s*(?:\.|e|er|ere|eme|°)?\s*", model.plain(text))
    return int(m.group(1)) if m else None


# Spellings seen in lists beyond model.STATUS_WORDS ("H. Délai" in OE12, "Dépassement" in MeOS), by prefix
_STATUS_PREFIXES = (("h. delai", "ot"), ("h.delai", "ot"), ("hors del", "ot"), ("depassement", "ot"),
                    ("temps depasse", "ot"), ("max", "ot"), ("aband", "dnf"), ("disq", "dsq"), ("non part", "dns"),
                    ("pas parti", "dns"), ("forfait", "dns"), ("hors conc", "nc"), ("hors cours", "nc"),
                    ("non class", "nc"), ("poinc", "mp"), ("p.m", "mp"))


def status_word(text: str | None) -> str | None:
    """model.status_of, plus the few longer spellings organisers' software prints."""
    st = model.status_of(text)
    if st:
        return st
    t = model.plain(text)
    return next((s for p, s in _STATUS_PREFIXES if t.startswith(p)), None)


def time_status(text: str | None) -> tuple[float | None, str | None]:
    """A result cell -> (seconds, status): ('14:47' -> (887.0, 'ok')), ('PM' -> (None, 'mp')), (junk -> (None, None))."""
    t = str(text or "").strip()
    st = status_word(t)
    if st:
        return None, st
    s = model.parse_time(t)
    if s is not None:
        return s, "ok"
    return None, None


def split_time(text: str | None) -> float | None:
    """A cumulative split cell -> seconds; '-----', '-', '0.00', '' -> None."""
    t = str(text or "").strip()
    if not t or set(t) <= set("-–—*. 0:"):
        return None
    return model.parse_time(t)


def by_of(class_names: list[str], hint: str | None = None) -> str:
    """'category' when the class names are (mostly) FFCO categories, else 'circuit' (organisers' other lists are by
    course); a 'par circuit' wording in the hint (title, heading, URL) wins."""
    h = model.plain(hint)
    if re.search(r"par (circuit|parcours)|parcircuit|par_circuit|circuits?\b", h) and "categ" not in h:
        return "circuit"
    names = [n for n in class_names if n]
    if not names:
        return "unknown"
    # "H21", "D16", but also MeOS/OE classes spanning categories ("H21/35", "H21 H35", "H21-35 WRE")
    cats = sum(1 for n in names if re.match(r"[HD]\s?\d{2}(?!\d)", n.strip(), re.I))
    if cats >= 0.6 * len(names):
        return "category"
    if re.search(r"par categ|parcateg|par_categ", h):
        return "category"
    return "circuit"


def finish_classes(classes: list[dict], by: str) -> None:
    """Common last touches: in a by-category list the class is every runner's category; a runner with a time but
    no place, in a class where others are placed, is not competing (OE/MeOS list them after the ranked ones)."""
    for c in classes:
        cat = model.category(c["name"]) if by == "category" else None
        placed = any(r["place"] is not None for r in c["runners"])
        for r in c["runners"]:
            if cat and not r["category"]:
                r["category"] = cat
            if placed and r["place"] is None and r["status"] == "ok" and r["time_s"] is not None:
                r["status"] = "nc"


def check_splits(splits: list, n: int) -> list | None:
    """Splits padded/cut to the number of controls; None when the runner has no split at all."""
    s = (list(splits) + [None] * n)[:n]
    return s if any(v is not None for v in s) else None


# ---------------------------------------------------------------------------------------------------------------
# The generic table parser
# ---------------------------------------------------------------------------------------------------------------

# Header words (plain(): lower-case, no accents) -> field. Order matters: first match wins.
_HEADERS = (
    ("place", ("pl", "pl.", "place", "rang", "rg", "clt", "clt.", "clas.", "classement", "#", "pos", "pos.",
               "position", "class.")),
    ("first", ("prenom", "first name", "firstname", "given")),
    ("last", ("nom de famille", "last name", "family")),
    ("name", ("nom", "name", "nom prenom", "nom - prenom", "nom, prenom", "prenom nom", "concurrent", "coureur",
              "participant", "athlete", "runner", "competiteur", "nom et prenom", "identite")),
    ("club", ("club", "clubs", "equipe", "organisation", "club/ville", "ville/club", "structure", "asso")),
    ("category", ("cat", "cat.", "categ", "categ.", "categorie", "catg", "catg.", "class", "classe")),
    ("circuit", ("circuit", "parcours", "course")),
    ("birth", ("ne", "ne(e)", "nee", "annee", "an", "year", "yb", "naissance", "annee de naissance")),
    ("bib", ("doss", "doss.", "dossard", "bib", "no", "n°", "no.", "num", "numero", "puce", "si")),
    ("time", ("temps", "time", "chrono", "temps total", "resultat", "result", "temps final", "tps")),
)


def _field(label: str) -> str | None:
    t = model.plain(label).strip(" :")
    for field, words in _HEADERS:
        if t in words:
            return field
    return None


def _header_map(cells) -> dict | None:
    """Column index of each field, when the row is a results header (a name and a time column)."""
    fields = {}
    for i, c in enumerate(cells):
        if c is None:
            continue
        f = _field(text_of(c))
        if f and f not in fields:
            fields[f] = i
    has_name = "name" in fields or ("last" in fields)
    return fields if has_name and "time" in fields else None


def _heading_before(table) -> str | None:
    """The text of the closest heading (h1-h6, caption, strong paragraph) before a table."""
    cap = table.find("caption")
    if cap is not None and text_of(cap):
        return text_of(cap)
    for el in table.itersiblings(preceding=True):
        if el.tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "b", "div"):
            t = text_of(el)
            if t and len(t) <= 80:
                return t
            if el.tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                break
    return None


def parse(content: bytes, url: str) -> dict | None:
    try:
        return _parse(content, url)
    except Exception:
        return None


def _parse(content: bytes, url: str) -> dict | None:
    root, _text = parse_html(content)
    if root is None:
        return None
    title = text_of(root.find(".//title")) or None
    classes: list[dict] = []
    for table in root.iter("table"):
        rows = table.xpath("./tr|./thead/tr|./tbody/tr|./tfoot/tr")
        hdr = None
        current = None
        by_col: dict[str, dict] = {}
        default_name = _heading_before(table) or title or "Résultats"
        for tr in rows:
            cells = cells_of(tr)
            # a medal picture stands for the place on some pages: its alt text ("1er") is the place
            texts = [(text_of(c) or " ".join(c.xpath(".//img/@alt"))) if c is not None else "" for c in cells]
            if hdr is None:
                hdr = _header_map(cells)
                continue
            filled = [t for t in texts if t]
            if not filled:
                continue
            if len(filled) == 1 and len(cells) > 2 and place_of(filled[0]) is None:
                if len(filled[0]) > 60 or re.search(r"\d:\d\d", filled[0]):
                    continue                # a detail row (splits, comment) under a runner, not a class title
                # a class title spanning the table
                current = model.klass(clean_class_name(filled[0]))
                current["length_m"], current["climb_m"] = length_climb(filled[0])
                classes.append(current)
                continue
            if _header_map(cells):          # repeated header (one per class)
                hdr = _header_map(cells)
                continue

            def get(field):
                i = hdr.get(field)
                return texts[i] if i is not None and i < len(texts) else ""

            name = get("name")
            if "first" in hdr or "last" in hdr:
                name = " ".join(x for x in (get("last") or name, get("first")) if x)
            if not name or not re.search(r"[A-Za-zÀ-ÿ]", name):
                continue
            time_s, status = time_status(get("time"))
            if status is None or (status == "ok" and status_word(get("place"))):
                # a status word may stand in the place column ("PM", "NC") while the time cell is empty or not
                status = status_word(get("place")) or ("dns" if set(get("time")) <= set("-–— ") else None)
                if status is None:
                    continue
            r = model.runner(name, place=place_of(get("place")), club=get("club") or None,
                             category=model.category(get("category")), birth=model.birth_year(get("birth")),
                             bib=get("bib") or None, time_s=time_s, status=status)
            if current is None and "circuit" in hdr and get("circuit"):
                key = get("circuit")
                if key not in by_col:
                    by_col[key] = model.klass(key)
                    classes.append(by_col[key])
                by_col[key]["runners"].append(r)
                continue
            if current is None:
                current = model.klass(clean_class_name(default_name))
                classes.append(current)
            current["runners"].append(r)
    classes = [c for c in classes if c["runners"]]
    runners = [r for c in classes for r in c["runners"]]
    # a contact list or an entry list also has names: insist on a few rows, some of them with a time
    if len(runners) < 3 or not any(r["time_s"] for r in runners):
        return None
    by = by_of([c["name"] for c in classes], (title or "") + " " + url)
    finish_classes(classes, by)
    return model.doc(KIND, classes, by=by, title=title, date=find_date(title, url))

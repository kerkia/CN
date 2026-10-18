"""Start lists (« horaires de départ », « liste de départ »): the runners of a coming race with their start times, as
organisers publish them on their sites a few days before. Read apart from the results parsers on purpose: a start time
must never pass for a race time. Each runner gets status "start" and start_s (seconds after midnight); the document's
kind is "startlist".

  * IOF XML StartList (data standard 3.0, and 2.0.3's PersonStart/StartTime/Clock)
  * HTML tables (OE, MeOS and hand-made exports): a column of clock times and a column of names — named by the header
    row when there is one (« Heure », « Départ », « Nom », « Club », « Cat. »…), else the first time column and the
    first column of words after it; a class is the title just before its table, or a row of one cell.
  * PDF (OE12 and MeOS exports): the clock times in one column; the name, club and category columns are the left edges
    the rows share (each column left-aligned), the circuit the words after the time; a club's or a circuit's section
    line (« 2801 ENTENTE SPORTIVE DES POMPIERS (6) », « A ») gives the rows below it their club or class.
"""

from __future__ import annotations

import html as htmllib
import io
import csv
import re
from collections import Counter

from lxml import etree

from .. import model
from .iofxml import _child, _children, _clock, _date, _ln, _txt

KIND = "startlist"
_CLOCK = re.compile(r"^\s*([01]?\d|2[0-3])[:hH]([0-5]\d)(?::([0-5]\d))?\s*$")


def parse(content: bytes, url: str) -> dict | None:
    try:
        head = content[:2048].lstrip(b"\xef\xbb\xbf \t\r\n")
        if head.startswith(b"<?xml") or b"<StartList" in head:
            return _xml(content)
        if content[:5] == b"%PDF-":
            return _pdf(content)
        if is_csv(content, url):
            return _csv(content)
        if b"<table" in content[:2_000_000].lower():
            return _html(content.decode("utf-8", "replace") if b"charset=iso" not in content[:3000].lower()
                         else content.decode("latin-1", "replace"))
    except Exception:
        return None
    return None


def clock(text: str) -> float | None:
    """'10:42', '10:42:30', '10h42' -> seconds after midnight (a plausible start: 6:00 to 23:59), else None."""
    m = _CLOCK.match(text or "")
    if not m:
        return None
    s = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3) or 0)
    return s if s >= 6 * 3600 else None


def _finish(classes: list[dict], title: str | None, date: str | None) -> dict | None:
    classes = [k for k in classes if len([r for r in k["runners"] if r["start_s"] is not None]) >= 1]
    if not classes or sum(len(k["runners"]) for k in classes) < 3:
        return None
    names = [k["name"] for k in classes]
    by = "category" if sum(1 for n in names if model.category(n)) >= 0.6 * len(names) else "circuit"
    for k in classes:
        cat = model.category(k["name"]) if by == "category" else None
        for r in k["runners"]:
            r["category"] = r["category"] or cat
    d = model.doc(KIND, classes, by=by, title=title, date=date)
    d["kind"] = KIND
    return d


# ---- IOF XML ------------------------------------------------------------------------------------------------------
def _xml(content: bytes) -> dict | None:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=True)
    root = etree.fromstring(content, parser)
    if root is None or _ln(root) != "StartList":
        return None
    event = _child(root, "Event")
    classes = []
    for cs in _children(root, "ClassStart"):
        k = model.klass(_txt(cs, "Class", "Name") or _txt(cs, "ClassShortName") or _txt(cs, "Class", "ClassShortName") or "?")
        course = _child(cs, "Course")
        length = _txt(course, "Length") if course is not None else ""
        k["length_m"] = int(float(length)) if re.fullmatch(r"\d+(?:\.\d+)?", length) else None
        for ps in _children(cs, "PersonStart"):
            person = _child(ps, "Person")
            if person is None:
                continue
            name = " ".join(x for x in (_txt(person, "Name", "Given") or _txt(person, "PersonName", "Given"),
                                        _txt(person, "Name", "Family") or _txt(person, "PersonName", "Family")) if x)
            if not name:
                continue
            org = _child(ps, "Organisation")
            if org is None:
                org = _child(ps, "Club")
            club = (_txt(org, "Name") or _txt(org, "ShortName")) if org is not None else ""
            st = _child(ps, "Start")
            start = _clock(_txt(st, "StartTime") or _txt(st, "StartTime", "Clock")) if st is not None else None
            k["runners"].append(model.runner(name, club=club or None, category=model.category(_txt(ps, "Class", "Name")),
                                             status="start", start_s=start))
        classes.append(k)
    return _finish(classes, _txt(event, "Name") or None, _date(event))


# ---- HTML ---------------------------------------------------------------------------------------------------------------
def _cells(tr: str) -> list[str]:
    """A row's cells; a cell merged over several columns (colspan) holds its text in the first and blanks in the others,
    so that the columns of every row line up (a spreadsheet's circuit title over its name and club columns)."""
    out = []
    for attrs, c in re.findall(r"(?is)<t[hd]([^>]*)>(.*?)</t[hd]>", tr):
        out.append(re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"(?s)<[^>]+>", " ", c))).strip())
        span = re.search(r"(?i)colspan\s*=\s*[\"']?(\d+)", attrs)
        out += [""] * (min(int(span.group(1)), 50) - 1 if span else 0)
    return out


_HEAD = {
    "time": ("heure", "depart", "start", "h dep", "hdep", "horaire", "hour", "time"),
    "first": ("prenom", "first name", "firstname", "given"),
    "name": ("nom", "name", "coureur", "concurrent", "surname", "family", "last name", "lastname"),
    "club": ("club", "equipe", "organisation", "ligue", "n club", "no club", "num club", "numero club", "numero de club",
             "code club", "city", "ville", "cl name"),
    "course": ("circuit", "parcours", "course"),
    "cat": ("cat", "categorie", "class", "classe"),
}
_EXACT = {"short": "cat", "long": "cat"}       # OE's class names (« Short », « Long »): never « Longueur »


def _key(h: str) -> str | None:
    """What a heading names: "time", "first", "name" (a full name, or the family name beside a "first"), "club",
    "course" (the circuit) or "cat" (the class or category); None for anything else (bib, chip, birth year…)."""
    p = re.sub(r"[._\-/:]+", " ", model.plain(h)).strip()
    if not p:
        return None
    if re.search(r"\bnom\b", p) and "prenom" in p or p in ("name", "full name"):
        return "name"                                     # « Nom prénom », « Prénom Nom »: the whole name
    if p in _EXACT:
        return _EXACT[p]
    if p.startswith("classif"):
        return None                                       # OE's « Classifier »: a status, not the class
    for key, words in _HEAD.items():
        if any(p == w or p.startswith(w + " ") or (p.startswith(w) and len(w) >= 4) for w in words):
            if key == "time" and re.search(r"\b(no|n|nr|num|numero|bib|dossard)\b", p):
                return None                               # « Start no. »: the bib, not the time
            return key
    return None


def _grid(head: list[str], above: list[list[str]]) -> dict | None:
    """A start list laid out as a grid (2026-10-17, organisers' Google Sheets): a « name, club » pair per circuit, with one
    time column for all (O'Bugey) or a time column of its own before each pair (SpOC); the circuits' names in a row above,
    over each circuit's own columns. -> {"groups": [(time col, name col, first-name col | None, club col | None, label)]}."""
    keys = [_key(h) for h in head]
    names = [i for i, k in enumerate(keys) if k == "name"]
    times = [i for i, k in enumerate(keys) if k == "time"]
    if len(names) < 2 or not times or times[0] > names[0]:
        return None
    # the circuits' row: the last row above with several word cells (row numbers and blanks aside)
    labels = next((r for r in reversed(above) if len([x for x in r if x and _wordy(x)]) >= 2), [])
    starts = []
    for k, ni in enumerate(names):
        ti = max(t for t in times if t < ni)
        starts.append(ti if k == 0 or ti > names[k - 1] else ni)     # a time column of its own opens the circuit
    groups = []
    for k, ni in enumerate(names):
        ti = max(t for t in times if t < ni)
        stop = starts[k + 1] if k + 1 < len(starts) else len(head)
        fi = next((j for j in range(ni + 1, stop) if keys[j] == "first"), None)
        ci = next((j for j in range(ni + 1, stop) if keys[j] == "club"), None)
        label = next((labels[j] for j in range(starts[k], min(stop, len(labels))) if labels[j] and _wordy(labels[j])), "")
        groups.append((ti, ni, fi, ci, label or f"Circuit {k + 1}"))
    return {"groups": groups}


def _columns(head: list[str]) -> dict:
    cols = {}
    for i, h in enumerate(head):
        k = _key(h)
        if k and k not in cols:
            cols[k] = i
    return cols if "time" in cols and "name" in cols else {}


def _wordy(s: str) -> bool:
    return bool(re.search(r"[A-Za-zÀ-ÿ]{2,}", s)) and clock(s) is None


def _club(s: str | None) -> str | None:
    """A club as printed; an FFCO number that lost its leading zero (« 703 », « 111 ») gets it back."""
    s = (s or "").strip()
    return (s.zfill(4) if re.fullmatch(r"\d{3}", s) else s) or None


def _cell(c: list[str], i: int | None) -> str:
    return c[i] if i is not None and i < len(c) else ""


def _read_table(rows: list[list[str]], label: str, lead: list[str]) -> list[dict]:
    """One table's rows (cells, merged ones expanded): its classes. A header row names the columns (« Heure, Nom, Prénom,
    Club, Circuit »: a list, grouped by its circuit or class column), or a grid of circuits side by side; without a header,
    a row's first clock time, the first word cell after it (the name) and the next (the club). A row of one word cell
    before the runners is the next class's name. `lead` gathers the text above the header (title, format, day)."""
    cur = model.klass(label or "?")
    out, groups = [], {}
    cols, grid, above = {}, None, []
    for c in rows:
        if not any(c):
            continue
        if not cols and not grid and not any(clock(x) for x in c):
            grid = _grid(c, above)
            if grid:
                groups = {lab: model.klass(lab) for *_, lab in grid["groups"]}     # the sheet's column order
                continue
            cols = _columns(c) or cols
            if cols:
                continue
            above.append(c)
            if len(lead) < 6:
                lead += [x for x in c if x and _wordy(x)][:3]
        if grid:
            # a grid: each row a start time, and a runner (or none) in each circuit's columns
            for ti, ni, fi, ci, lab in grid["groups"]:
                start, name = clock(_cell(c, ti)), _cell(c, ni)
                if fi is not None and _cell(c, fi):
                    name = f"{_cell(c, fi)} {name}".strip()
                if start is None or not name or not _wordy(name) or len(name) > 60:
                    continue
                groups.setdefault(lab, model.klass(lab))["runners"].append(
                    model.runner(name, club=_club(_cell(c, ci)), status="start", start_s=start))
            continue
        if len([x for x in c if x]) == 1 and _wordy(next(x for x in c if x)):
            # a row of one cell: the next class
            if cur["runners"]:
                out.append(cur)
            cur = model.klass(re.sub(r"\s*\(\d+\)\s*$", "", next(x for x in c if x)))
            continue
        group = None
        if cols:
            start, name = clock(_cell(c, cols["time"])), _cell(c, cols["name"])
            if _cell(c, cols.get("first")):
                name = f"{_cell(c, cols['first'])} {name}".strip()
            club, cat = _cell(c, cols.get("club")), _cell(c, cols.get("cat"))
            # a list of every runner: grouped by its circuit column, else by its class column
            group = _cell(c, cols.get("course")) or (cat if "course" not in cols else "") or None
        else:
            # no header: the first clock time, the first wordy cell after it (the name), the next one (the club)
            ti = next((i for i, x in enumerate(c) if clock(x) is not None), None)
            if ti is None:
                continue
            wordy = [i for i in range(len(c)) if i != ti and _wordy(c[i])]
            after = [i for i in wordy if i > ti] or wordy
            if not after:
                continue
            start, name = clock(c[ti]), c[after[0]]
            club = c[after[1]] if len(after) > 1 else None
            cat = None
        if start is None or not _wordy(name) or len(name) > 60:
            continue
        r = model.runner(name, club=_club(club), category=model.category((cat or "").split(" ")[0]), status="start", start_s=start)
        (groups.setdefault(group, model.klass(group)) if group else cur)["runners"].append(r)
    if cur["runners"]:
        out.append(cur)
    return out + [k for k in groups.values() if k["runners"]]


def _merge(classes: list[dict]) -> list[dict]:
    """Classes of the same name (a page of many little tables without titles; a list in several parts) as one."""
    merged: dict[str, dict] = {}
    for k in classes:
        if k["name"] in merged:
            merged[k["name"]]["runners"] += k["runners"]
        else:
            merged[k["name"]] = k
    return list(merged.values())


def _html(page: str) -> dict | None:
    page = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", page)
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    title = re.sub(r"\s+", " ", htmllib.unescape(title.group(1))).strip() if title else None
    classes: list[dict] = []
    lead: list[str] = []          # the text above the first list's header (a sheet's title: race, format, day)
    # every table, with the title just before it (a class's name: « H21 », « Circuit A (12) »)
    pos = 0
    for m in re.finditer(r"(?is)<table[^>]*>(.*?)</table>", page):
        before = page[pos:m.start()]
        pos = m.end()
        heads = re.findall(r"(?is)<(?:h[1-6]|caption|b|strong)[^>]*>(.*?)</(?:h[1-6]|caption|b|strong)>", before)
        label = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"(?s)<[^>]+>", " ", heads[-1]))).strip() if heads else ""
        label = re.sub(r"\s*\(\d+\)\s*$", "", label)
        classes += _read_table([_cells(tr) for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", m.group(1))], label, lead)
    d = _finish(_merge(classes), title, None)
    if d:
        d["head"] = " ".join([title or "", *lead])[:300].strip()     # what race and day it is about (run.site_start_lists)
    return d


# ---- CSV (2026-10-18: an organiser's start list deposited on « Organisation › Horaires », a Google Sheets export, OE's or
# MeOS' CSV): the same tables as HTML, one row a line
def _csv(content: bytes) -> dict | None:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252", "replace")              # OE and Excel on Windows
    sample = text[:8000]
    delim = max(";,\t", key=sample.count)
    rows = [[x.strip() for x in r] for r in csv.reader(io.StringIO(text), delimiter=delim)]
    lead: list[str] = []
    d = _finish(_merge(_read_table(rows, "", lead)), lead[0][:120] if lead else None, None)
    if d:
        d["head"] = " ".join(lead)[:300].strip()
    return d


def is_csv(content: bytes, url: str) -> bool:
    """A CSV file: by its name, else a text with no tag and many separators."""
    if re.search(r"(?i)\.(csv|txt)$", url or ""):
        return True
    head = content[:4000]
    return not head.startswith(b"%PDF") and b"<" not in head and sum(head.count(x) for x in (b";", b",", b"\t")) >= 6 \
        and head.count(b"\n") >= 2


# ---- PDF ----------------------------------------------------------------------------------------------------------------
_CHIP = re.compile(r"^\d{5,9}$")
_BANNER = re.compile(r"(?i)^(meos|oe\d*|oe12|page\b|horaires? de d|liste de d|start ?list|n[o°] ?puce|nom\b|doss|d[ée]part\b)")
_CLUB_HEAD = re.compile(r"^(\d{4})[A-Z]{0,3}\s+(.+?)\s*\((\d+)\)$")
_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_MONTHS.update({"fev": 2, "avr": 4, "mai": 5, "juin": 6, "juil": 7, "aou": 8, "dec": 12})


def _edges(rows, words_of, lo: float, hi: float, share: float) -> list[float]:
    """Left edges (columns) between x lo and hi that at least `share` of the rows have a word starting on."""
    count = Counter()
    for l in rows:
        for x in {round(w.x0) for w in words_of(l) if lo <= w.x0 < hi}:
            count[x] += 1
    groups: list[list[int]] = []
    for x in sorted(count):
        if groups and x - groups[-1][-1] <= 2:
            groups[-1].append(x)
        else:
            groups.append([x])
    out = []
    for g in groups:
        if g[-1] - g[0] > 2:                        # varied starts (the family names) chained together: not a column
            continue
        n = sum(1 for l in rows if any(g[0] - 0.6 <= w.x0 <= g[-1] + 0.6 for w in words_of(l)))
        if n >= share * len(rows):
            out.append(g[0] - 0.8)
    return out


def first_lines(content: bytes) -> str:
    """The first lines of a PDF (or an HTML page's title): what race and day a file is about, read or not."""
    try:
        if content[:5] == b"%PDF-":
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                return " ".join((pdf.pages[0].extract_text() or "").splitlines()[:6])[:300] if pdf.pages else ""
        m = re.search(rb"(?is)<title[^>]*>(.*?)</title>", content[:20000])
        return htmllib.unescape(m.group(1).decode("utf-8", "replace")).strip()[:300] if m else ""
    except Exception:
        return ""


def pdf_date(text: str) -> str | None:
    return _pdf_date(text)


def all_dates(text: str) -> set[str]:
    """Every date the text prints, ISO."""
    return set(_dates(text))


def _pdf_date(text: str) -> str | None:
    """The latest date the text prints (« 10-10-2026 », « 10-Oct-26 »): a start list is printed before its race."""
    found = _dates(text)
    return max(found) if found else None


def _dates(text: str) -> list[str]:
    found = []
    for m in re.finditer(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", text):
        found.append(f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}")
    for m in re.finditer(r"\b(\d{1,2})[- ]([A-Za-zéû]{3,9})\.?[- ](\d{2}|\d{4})\b", text):
        mon = _MONTHS.get(model.plain(m.group(2))[:4]) or _MONTHS.get(model.plain(m.group(2))[:3])
        if mon:
            y = int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)
            found.append(f"{y}-{mon:02d}-{int(m.group(1)):02d}")
    for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", text):
        found.append(m.group(0))
    return found


def _pdf(content: bytes) -> dict | None:
    import pdfplumber
    from .pdf import _lines
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        if not pdf.pages or len(pdf.pages) > 80:
            return None
        pages = [_lines(p, i) for i, p in enumerate(pdf.pages)]
    lines = [l for pg in pages for l in pg]
    is_clock = lambda w: clock(w.text) is not None
    rows = [l for l in lines if any(is_clock(w) for w in l.words)]
    if len(rows) < 3:
        return None
    tx = Counter(round(next(w.x0 for w in l.words if is_clock(w))) for l in rows).most_common(1)[0][0]
    rows = [l for l in rows if any(is_clock(w) and abs(w.x0 - tx) <= 4 for w in l.words)]
    if len(rows) < 3:
        return None
    textw = lambda l: [w for w in l.words if not is_clock(w) and not _CHIP.match(w.text)]
    # every column of the rows (left edges they share), told apart by what it holds: categories (« H21 »), a value
    # repeated over many rows (the circuit: OE's « Orange D », MeOS' « Orange Long »), figures (« 2,9 km », « 16 P »),
    # else text — the first text column the name, the second the club
    cols = _edges(rows, textw, 0, 1e6, 0.6)
    if not cols:
        return None
    bounds = cols + [1e6]

    def col(l, a, b):
        return " ".join(w.text for w in sorted(textw(l), key=lambda w: w.x0) if a <= w.x0 < b).strip()
    kinds, texts = [], 0
    for i in range(len(cols)):
        vals = [v for v in (col(l, bounds[i], bounds[i + 1]) for l in rows) if v]
        if not vals:
            kinds.append(None)
        elif sum(1 for v in vals if model.category(v.split()[0])) >= 0.6 * len(vals):
            kinds.append("cat")
        elif sum(1 for v in vals if re.match(r"^\d", v)) >= 0.6 * len(vals) or all(len(v) <= 2 for v in vals):
            kinds.append(None)                       # figures, units (« 16 P »)
        elif len(vals) >= 6 and len(set(vals)) <= max(3, len(vals) // 8):
            kinds.append("class")
        else:
            kinds.append(("name", "club")[texts] if texts < 2 else None)
            texts += 1
    # a short column right after the circuit, varying (OE's « Orange D » / « Orange H »), is the circuit's too; a
    # constant one (« P ») is not
    for i in range(1, len(kinds)):
        if kinds[i] is None and kinds[i - 1] == "class":
            vals = [v for v in (col(l, bounds[i], bounds[i + 1]) for l in rows) if v]
            if vals and all(len(v) <= 2 and not v[0].isdigit() for v in vals) and len(set(vals)) > 1:
                kinds[i] = "class"
    if "name" not in kinds:
        return None
    row_ids = {id(l) for l in rows}
    head_text = " ".join(l.text for l in lines[:6])
    classes: dict[str, dict] = {}
    cur_class, cur_club = None, None
    for l in lines:
        if id(l) not in row_ids:
            t = l.text.strip()
            m = _CLUB_HEAD.match(t)
            if m:
                cur_club = m.group(2)
            elif t and len(l.words) <= 7 and len(t) <= 50 and not _BANNER.match(t) and not _pdf_date(t) and                     not re.search(r"\d{1,2}:\d{2}", t):
                # « D16 3180 mètres Départ 1 », « H21 (12) »: the class's name only
                cur_class = re.sub(r"\s+\d+\s*m(?:[eè]tres)?\b.*$|\s*\(\d+\)\s*$", "", t).strip() or t
            continue
        vals = {k: col(l, bounds[i], bounds[i + 1]) for i, k in enumerate(kinds) if k and k != "class"}
        # the circuit's words, over its adjacent columns (« Orange » and « Long » both aligned)
        vals["class"] = " ".join(x for x in (col(l, bounds[i], bounds[i + 1]) for i, k in enumerate(kinds) if k == "class") if x)
        name = vals.get("name", "")
        if not _wordy(name) or len(name) > 60:
            continue
        start = clock(next(w.text for w in l.words if is_clock(w) and abs(w.x0 - tx) <= 4))
        cls = vals.get("class") or cur_class or "?"
        k = classes.setdefault(cls, model.klass(cls))
        k["runners"].append(model.runner(name, club=vals.get("club") or cur_club, category=model.category((vals.get("cat") or "").split(" ")[0]),
                                         status="start", start_s=start))
    title = next((l.text for l in lines[:4] if not _BANNER.match(l.text) and not _pdf_date(l.text)), None)
    d = _finish(list(classes.values()), title, _pdf_date(head_text))
    if d:
        d["head"] = head_text[:300]                 # the first lines: which race (and day) the file is for
    return d

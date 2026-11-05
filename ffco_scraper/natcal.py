"""FFCO's national calendars (« Calendrier national », owner 2026-11-05): the federation's one-page PDF tables of the national
competitions (sub-groups B1 and C1) of the current season and of the next ones, the coming seasons « provisoire ».

They list championships and nationales a year or two ahead, long before their organisers put them on FFCO's agenda
(api.ffcorientation.fr's list, read by agenda.py). Each row FFCO's agenda does not list yet becomes an agenda event of its
own (`natcal`: the calendar's year, provisional or not, the date as printed, the PDF); once the agenda lists it, the row is
dropped (`_same`).

Source: www.ffcorientation.fr/les-pratiques/pratiquer-la-co/calendrier-national/ — the page's links « Calendrier National
2027 Provisoire » to /document/<id>/ (a PDF). A PDF is read once per address: a new version is a new document (`prev`).
"""

from __future__ import annotations

import io
import re
import unicodedata
from datetime import date

PAGE = "https://www.ffcorientation.fr/les-pratiques/pratiquer-la-co/calendrier-national/"
VERSION = 1             # what is read from a calendar; bump to read every PDF again
MAX_PDF = 8_000_000

SPECS = {"pied": "Pédestre", "vtt": "VTT", "ski": "Ski", "raid": "Raid Orientation", "precision": "Précision"}
MONTHS = {"janv": 1, "jan": 1, "fevr": 2, "fev": 2, "mars": 3, "mar": 3, "avril": 4, "avr": 4, "mai": 5, "juin": 6,
          "juil": 7, "juillet": 7, "aout": 8, "sept": 9, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_LINK = re.compile(r'<a[^>]+href="(https://www\.ffcorientation\.fr/document/[^"]+)"[^>]*>\s*Calendrier\s+National\s+(\d{4})'
                   r'(\s+Provisoire)?\s*</a>', re.I)
_STOP = {"de", "du", "des", "la", "le", "les", "et", "d", "l", "co", "a", "france", "championnat", "wre", "nationale",
         "nationales", "en", "au", "aux"}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def links(page_html: str) -> list[dict]:
    """The page's national calendars: [{url, year, provisional}], one per year (the first link of a year)."""
    out, seen = [], set()
    for m in _LINK.finditer(page_html):
        y = int(m.group(2))
        if y not in seen:
            seen.add(y)
            out.append({"url": m.group(1), "year": y, "provisional": bool(m.group(3))})
    return out


def _month(word: str) -> int | None:
    w = fold(word).strip(".")
    for k in sorted(MONTHS, key=len, reverse=True):
        if w.startswith(k):
            return MONTHS[k]
    return None


def parse_dates(text: str, year: int) -> list[tuple[str, str]]:
    """The printed dates as [(first day, last day)], one pair per alternative (« 18 ou 25-août » gives two):
    « 23-janv. », « 13/14-mars », « 21/22 mars », « 8, 9 et 10 octobre », « 8 au 14 juillet », « 27 juillet au 1er août »."""
    out = []
    for alt in re.split(r"\s+ou\s+", fold(text)):
        toks = re.findall(r"\d{1,2}(?=er\b)|\d{1,2}|[a-z]+", alt.replace("1er", "1"))
        days, pending = [], []
        for tok in toks:
            if tok.isdigit():
                pending.append(int(tok))
            elif (mo := _month(tok)) and pending:
                days += [(mo, d) for d in pending]
                pending = []
        if pending:
            out.append(pending)                     # a day whose month comes with the next alternative
            continue
        if days:
            out.append(days)
    pairs, month_of_last = [], None
    for item in reversed(out):                       # « 18 ou 25-août »: the 18th takes August from the alternative after
        if item and isinstance(item[0], int):
            if month_of_last is None:
                continue
            item = [(month_of_last, d) for d in item]
        month_of_last = item[-1][0]
        try:
            ds = sorted(date(year, mo, d) for mo, d in item)
        except ValueError:
            continue
        pairs.append((ds[0].isoformat(), ds[-1].isoformat()))
    return list(reversed(pairs))


def _discipline(label: str) -> str:
    f = fold(label)
    for k, v in SPECS.items():
        if k in f:
            return v
    return ""


def read_pdf(data: bytes) -> dict:
    """{title, printed, rows: [{spec, name, when, org, star, pending}]} from a calendar's PDF (its tables; the discipline
    of a row from the block of the first column it lies in: that column's merged cells are not always seen as one)."""
    import pdfplumber
    rows, printed, title = [], "", ""
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            title = title or " ".join(text.splitlines()[:2])
            m = re.search(r"\b(\d{2})/(\d{2})/(\d{4})\b", text)
            if m and not printed:
                printed = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
            pending_titles = [w for w in page.extract_words() if fold(w["text"]) == "attente"]
            for tbl in page.find_tables():
                cells = tbl.extract()
                if not cells or fold(cells[0][1] or "") != "manifestations":
                    continue
                x0, top, x1, bottom = tbl.bbox
                col1 = tbl.rows[0].cells[1][0] if tbl.rows[0].cells[1] else x0 + 80
                # the first column's blocks: the rules drawn across it (thin rectangles or lines; a coloured cell's
                # fill has edges too, which are no rule)
                rules = [r for r in page.rects if r["bottom"] - r["top"] <= 2.5] +                         [ln for ln in page.lines if abs(ln["bottom"] - ln["top"]) <= 0.5]
                cuts = sorted({round(r["top"]) for r in rules if r["x0"] <= x0 + 5 and r["x1"] >= col1 - 5
                               and top - 1 <= r["top"] <= bottom + 1} | {round(top), round(bottom)})
                words = [w for w in page.extract_words() if w["x1"] <= col1 and top <= w["top"] <= bottom]
                block = []
                for a, b in zip(cuts, cuts[1:]):
                    block.append((a, b, _discipline(" ".join(w["text"] for w in words if a <= (w["top"] + w["bottom"]) / 2 <= b))))
                pending = any(w["bottom"] <= top and top - w["bottom"] < 40 for w in pending_titles)
                org = ""
                for r, row in zip(cells[1:], tbl.rows[1:]):
                    name = re.sub(r"\s+", " ", r[1] or "").strip()
                    if not name:
                        continue
                    if r[3] is not None:
                        org = re.sub(r"\s+", " ", r[3]).strip()
                    mid = (row.bbox[1] + row.bbox[3]) / 2
                    spec = next((s for a, b, s in block if a <= mid <= b), "")
                    rows.append({"spec": spec, "name": name.replace("*", "").strip(), "when": re.sub(r"\s+", " ", r[2] or "").strip(),
                                 "org": org, "star": "*" in name, "pending": pending})
    return {"title": title, "printed": printed, "rows": rows}


# ---- the organisers: « 5703GE », « CD73 », « Ligue AR », « COSMA EVENTS/0504PZ », « 8813GE / CD70 » ---------------------
def organiser(text: str, clubs: dict[str, str], depts: dict[str, str], ligues: dict[str, str]) -> dict:
    """{org, dep} of the calendar's organisation cell: the agenda's « 5703 - TOUT AZIMUT FAMECK » form where it can."""
    names, dep = [], ""
    for part in re.split(r"\s*/\s*", text or ""):
        if m := re.fullmatch(r"(\d{4})\s*([A-Z]{2})", part.strip()):
            code = m.group(1)
            names.append(f"{code} - {clubs[code]}" if code in clubs else code)
            dep = dep or code[:2]
        elif m := re.fullmatch(r"CD\s*(\d{2}|2[AB])", part.strip(), re.I):
            d = m.group(1).upper()
            names.append(f"{d} - {depts[d]}" if d in depts else f"CD{d}")
            dep = dep or d
        elif m := re.fullmatch(r"Ligue\s+([A-Z]{2})", part.strip()):
            names.append(f"{m.group(1)} - {ligues[m.group(1)]}" if m.group(1) in ligues else part.strip())
            dep = dep or m.group(1)                      # a ligue: agenda.locate turns it into its region
        elif part.strip():
            names.append(part.strip())
            if m := re.search(r"\((\d{2})\)", part):
                dep = dep or m.group(1)
    return {"org": " / ".join(names), "dep": dep}


def format_of(name: str) -> str:
    """The agenda's format (« epr ») a name says, when it says one: relays, night, sprint, middle, long."""
    f = fold(name)
    if "relais" in f:
        return "Relais"
    if "nuit" in f:
        return "Nuit"
    hits = [v for k, v in (("sprint", "Sprint"), ("moyenne distance", "MD"), ("longue distance", "LD")) if k in f]
    return hits[0] if len(hits) == 1 else ""


def _words(s: str) -> set[str]:
    f = re.sub(r"\bmd\b", "moyenne distance", re.sub(r"\bld\b", "longue distance", fold(s)))
    return {w for w in re.findall(r"[a-z0-9]+", f) if w not in _STOP and len(w) > 1}


def _org_codes(s: str) -> set[str]:
    return set(re.findall(r"\b(\d{4})\b", s or "")) | {m for m in re.findall(r"\bCD\s?(\d{2})\b", s or "")}


def _same(row: dict, e: dict, first: str, last: str) -> bool:
    """Does the agenda's course `e` stand for the calendar's row (its days, its discipline, its organiser or its name)?"""
    if e.get("kind") != "c" or not (first <= e.get("date", "") <= last):
        return False
    if row["spec"] and e.get("spec") and row["spec"] != e["spec"]:
        return False
    codes = _org_codes(row["org"])
    ecode = (e.get("org") or "").split(" - ")[0].strip()
    if codes and ecode in codes:
        return True
    a, b = _words(row["name"]), _words(f"{e.get('name', '')} {e.get('manif', '')}")
    return bool(a) and len(a & b) >= max(1, (len(a) + 1) // 2)


def events(cals: list[dict], agenda: list[dict], today: str, clubs: dict[str, str], depts: dict[str, str],
           ligues: dict[str, str]) -> list[dict]:
    """The calendars' rows the agenda does not list, as agenda events (kind "c", no id: never a course of « Résultats »)."""
    out = []
    for cal in cals:
        for i, row in enumerate(cal.get("rows", [])):
            spans = parse_dates(row["when"], cal["year"])
            if not spans:
                continue                                     # « en attente de candidatures » without a date
            first, last = spans[0][0], spans[-1][1]
            if last < today or any(_same(row, e, a, b) for a, b in spans for e in agenda):
                continue
            o = organiser(row["org"], clubs, depts, ligues)
            e = {"kind": "c", "date": spans[0][0], "name": row["name"], "spec": row["spec"], "epr": format_of(row["name"]), "org": o["org"],
                 "dep": o["dep"], "natcal": {"year": cal["year"], "prov": cal["provisional"], "url": cal["url"],
                                             "when": row["when"], "printed": cal.get("printed", "")}}
            if spans[0][1] != spans[0][0]:
                e["end"] = spans[0][1]
            if len(spans) > 1:
                e["natcal"]["alt"] = [a for a, _ in spans[1:]]
            if row["star"]:
                e["natcal"]["expertise"] = True              # « *Sous réserve du retour d'expertise »
            if row["pending"] or not row["org"]:
                e["natcal"]["pending"] = True                # « En attente de candidatures »
            out.append({k: v for k, v in e.items() if v not in ("", None)})
    return out


def calendars(get, get_bytes, prev: list[dict], errors: list[str] | None = None) -> list[dict]:
    """The national calendars as read: [{url, year, provisional, printed, rows, v}]; a PDF whose address was read before
    is not fetched again. A page or PDF that fails keeps the previous reading of that year, and says why in `errors`
    (agenda.json `natcal_err`: the CI's logs are not at hand, the file is)."""
    errors = errors if errors is not None else []
    old = {c["url"]: c for c in prev or [] if c.get("v") == VERSION}
    by_year = {c["year"]: c for c in prev or []}
    try:
        page = get(PAGE)
    except Exception as e:
        errors.append(f"page: {type(e).__name__}: {e}"[:300])
        return list(prev or [])
    found = links(page)
    if not found:
        errors.append(f"page: no calendar link in {len(page)} characters")
        return list(prev or [])
    out = []
    for ln in found:
        if ln["url"] in old:
            out.append({**old[ln["url"]], **ln})
            continue
        try:
            data = get_bytes(ln["url"])
            if not data.startswith(b"%PDF") or len(data) > MAX_PDF:
                raise RuntimeError("not a PDF")
            cal = read_pdf(data)
            if not cal["rows"]:                             # a layout no longer read: never an empty year
                raise RuntimeError("no row read")
            out.append({**ln, "printed": cal["printed"], "rows": cal["rows"], "v": VERSION})
        except Exception as e:                              # unreadable: the year's previous reading, if any
            errors.append(f"{ln['year']}: {type(e).__name__}: {e}"[:300])
            if ln["year"] in by_year:
                out.append(by_year[ln["year"]])
    return out

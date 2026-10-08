"""SportSoftware (Stephan Krämer) OE2010 / OE12 HTML exports: results and split times, by circuit or by category.

Every OE list has the same skeleton, whatever the version:
  * a class header row whose first cell is td#c00 ("H21  (19/19)", "Bleu (5/5)"), then the length, climb and
    number of controls ("2,5 km  0 m", "20 P") in the next cells;
  * a <thead> row naming the columns (Pl, Doss., NOM, Né, Club, Catg., Temps, Diff.);
  * one row per runner (results), or, in split lists, a control header row ("1(55)", "2(31)", … "Arr") and two
    rows per runner: cumulative times (with place, name, time) then leg times (with the club in the name column).
    Long courses wrap: the control header takes several rows, and each runner two more rows per extra line.
    Cells after the finish column and extra row pairs hold additional punches (shown as "*61"): ignored.
OE12 leaves its <td> unclosed; lxml copes with that.
"""

from __future__ import annotations

import re

from .. import model
from .html_generic import (by_of, cells_of, check_splits, clean_class_name, find_date, finish_classes, length_climb,
                           parse_html, place_of, split_time, status_word, text_of, time_status)

KIND = "oe_html"

_SIGNS = ("sportsoftware", "stephan kr", "oe2010", "oe12", "oe2003", "oe11", "oe2013")
_CONTROL = re.compile(r"^(\d+)\s*\(\s*(\w+)\s*\)$")
_FINISH = ("arr", "arr.", "arrivee", "ziel", "finish", "f")

# OE column titles (plain()) -> field; French, English and German installs
_COLS = {
    "pl": "place", "pl.": "place", "place": "place", "rang": "place", "platz": "place",
    "nom": "name", "name": "name", "nom prenom": "name",
    "doss.": "bib", "doss": "bib", "stno": "bib", "bib": "bib", "startnr": "bib",
    "ne": "birth", "yb": "birth", "jg": "birth", "an": "birth",
    "club": "club", "verein": "club",
    "catg.": "category", "cat.": "category", "class": "category", "kat.": "category",
    "temps": "time", "time": "time", "zeit": "time",
}


def parse(content: bytes, url: str) -> dict | None:
    try:
        return _parse(content, url)
    except Exception:
        return None


def _parse(content: bytes, url: str) -> dict | None:
    head = content[:6000].lower()
    if not any(s.encode() in head for s in _SIGNS) and b"sportsoftware" not in content.lower():
        return None
    root, _text = parse_html(content)
    if root is None or not root.xpath("//td[@id='c00']"):
        # the generator's words without its class headers: a page merely mentioning OE (an export link…)
        return None
    title = text_of(root.find(".//title")) or None
    # the report top: event name, list name ("Résultats provisoires", "Résultats temps intermédiaires")
    top = [text_of(td) for td in root.xpath("//div[@id='reporttop']//td")]
    event = top[0] if top else (title or "")

    classes: list[dict] = []
    state = None                     # parsing state of the current class
    for tr in root.iter("tr"):
        if tr.xpath("./td[@id='c00']"):
            state = _new_class(tr)
            classes.append(state["klass"])
            continue
        if state is None:
            continue
        cells = cells_of(tr)
        texts = [text_of(c) if c is not None else "" for c in cells]
        if tr.xpath("./th"):
            state["cols"] = {_COLS[k]: i for i, t in enumerate(texts) if (k := model.plain(t)) in _COLS}
            continue
        if _control_row(texts):
            _add_control_line(state, texts)
            continue
        if not any(texts):
            continue
        if state["lines"]:
            _split_row(state, texts)
        else:
            _result_row(state, texts)
    classes = [c for c in classes if c["runners"]]
    if not classes:
        return None
    for c in classes:
        if c["controls"] is not None:
            n = len(c["controls"])
            for r in c["runners"]:
                if r["splits"] is not None:
                    r["splits"] = check_splits(r["splits"], n)
    by = by_of([c["name"] for c in classes], " ".join(filter(None, [title, url])))
    finish_classes(classes, by)
    return model.doc(KIND, classes, by=by, title=title, date=find_date(event, title))


def _new_class(tr) -> dict:
    cells = [text_of(td) for td in tr.xpath("./td")]
    k = model.klass(clean_class_name(cells[0]))
    k["length_m"], k["climb_m"] = length_climb(" ".join(cells[1:]))
    return {"klass": k, "cols": {}, "lines": [], "block": None}


def _control_row(texts: list[str]) -> bool:
    return sum(1 for t in texts if _CONTROL.match(t)) >= 1 and \
        sum(1 for t in texts if _CONTROL.match(t) or model.plain(t) in _FINISH) >= 2


def _add_control_line(state: dict, texts: list[str]) -> None:
    """One line of the control header: (column, code) of each control on it; the finish column ends the course."""
    line = []
    k = state["klass"]
    if k["controls"] is None:
        k["controls"] = []
    for i, t in enumerate(texts):
        m = _CONTROL.match(t)
        if m:
            line.append((i, len(k["controls"])))
            k["controls"].append(m.group(2))
        elif model.plain(t) in _FINISH:
            break
    state["lines"].append(line)


def _get(state: dict, texts: list[str], field: str) -> str:
    i = state["cols"].get(field)
    return texts[i] if i is not None and i < len(texts) else ""


def _make_runner(state: dict, texts: list[str]):
    name = _get(state, texts, "name")
    if not name or not re.search(r"[^\W\d_]", name):
        return None
    time_text = _get(state, texts, "time")
    time_s, status = time_status(time_text)
    place_text = _get(state, texts, "place")
    if status is None or (status == "ok" and status_word(place_text)):
        # OE writes the status in the place column on some lists ("nc" with a time, "pm" without)
        status = status_word(place_text) or ("dns" if not time_text else None)
        if status is None:
            return None
    return model.runner(name, place=place_of(place_text), club=_get(state, texts, "club") or None,
                        category=model.category(_get(state, texts, "category")),
                        birth=model.birth_year(_get(state, texts, "birth")), bib=_get(state, texts, "bib") or None,
                        time_s=time_s, status=status)


def _result_row(state: dict, texts: list[str]) -> None:
    r = _make_runner(state, texts)
    if r:
        state["klass"]["runners"].append(r)


def _fixed_end(state: dict) -> int:
    """Index of the first control column: the cells before it are place, bib, name, category, time."""
    return min((i for line in state["lines"] for i, _ in line), default=len(state["cols"]) + 1)


def _split_row(state: dict, texts: list[str]) -> None:
    """Rows of a split list come as (cumulative, leg) pairs per header line; the first pair carries the runner."""
    end = _fixed_end(state)
    name_i = state["cols"].get("name")
    fixed = [t for i, t in enumerate(texts[:end]) if i != name_i and t]
    block = state["block"]
    named = name_i is not None and name_i < len(texts) and texts[name_i]
    if fixed or (named and (block is None or len(block["rows"]) % 2 == 0)):
        r = _make_runner(state, texts)
        if r is None:
            state["block"] = None
            return
        state["klass"]["runners"].append(r)
        state["block"] = {"runner": r, "rows": [texts]}
        _fill_splits(state)
        return
    if block is None:
        return
    block["rows"].append(texts)
    if len(block["rows"]) == 2 and name_i is not None and name_i < len(texts) and texts[name_i]:
        block["runner"]["club"] = texts[name_i]
        block["runner"]["club_code"] = model.club_code(texts[name_i])
    _fill_splits(state)


def _fill_splits(state: dict) -> None:
    """Cumulative time of each control from the block's rows: the first row of each pair, or the second one when
    only that one is increasing (a list printed with legs first)."""
    block = state["block"]
    rows = block["rows"]
    n = len(state["klass"]["controls"] or [])
    splits = [None] * n
    for li, line in enumerate(state["lines"]):
        pair = rows[2 * li: 2 * li + 2]
        if not pair:
            break
        cands = [[split_time(row[i]) if i < len(row) else None for i, _ in line] for row in pair]
        vals = cands[0]
        if len(cands) == 2 and not _increasing(cands[0]) and _increasing(cands[1]):
            vals = cands[1]
        for (_, ci), v in zip(line, vals):
            splits[ci] = v
    block["runner"]["splits"] = splits if any(v is not None for v in splits) else None


def _increasing(vals: list) -> bool:
    v = [x for x in vals if x is not None]
    return len(v) >= 2 and all(a <= b for a, b in zip(v, v[1:]))

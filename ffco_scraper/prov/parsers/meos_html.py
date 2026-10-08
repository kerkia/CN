"""MeOS HTML exports, and the "Orientation Data" class pages built on MeOS data (per-class results with splits).

MeOS writes its lists in two HTML flavours, neither with column titles for the runner rows:
  * a table: a bold row per class (td.header, <b>name</b>), then one row per runner (place "1.", name, [class],
    club, time; the place cell of unranked runners is merged into the spacer by a colspan);
  * absolutely positioned <div>s ("print layout"): one line per `top`, columns by `left`; the class line is bold
    and also carries the column titles ("Temps", "Retard") at the columns' positions.
Both are turned into lines of (column position, text, bold) and read the same way; the columns are recognised
from their content. "Créé par MeOS" sits in the footer.
Orientation Data (heyries' MeOS-based site) pages hold one class: table#resultsTable, one row per runner, each
followed by a hidden row of split cells ("1-238" = control 1, code 238; cumulative then leg time).
"""

from __future__ import annotations

import re
from collections import Counter

from .. import model
from .html_generic import (by_of, cells_of, check_splits, clean_class_name, find_date, finish_classes, parse_html,
                           place_of, split_time, text_of, time_status)

KIND = "meos_html"

_POS = re.compile(r"(left|top)\s*:\s*(-?\d+(?:\.\d+)?)px", re.I)
_TIME_TITLES = ("temps", "time", "tid", "zeit", "resultat")


def parse(content: bytes, url: str) -> dict | None:
    try:
        return _parse(content, url)
    except Exception:
        return None


def _parse(content: bytes, url: str) -> dict | None:
    low = content.lower()
    # MeOS signs its lists with a link to its site; a page merely talking about MeOS is not a list
    if b"melin.nu/meos" not in low and not re.search(rb"<meta[^>]+generator[^>]+meos", low):
        return None
    root, _text = parse_html(content)
    if root is None:
        return None
    title = text_of(root.find(".//title")) or None
    if root.xpath("//table[@id='resultsTable']"):
        return _orientation_data(root, title, url)
    heading = " ".join(text_of(h) for h in root.xpath("//h1|//h2|//h3")[:2])
    if root.xpath("//div[contains(translate(@style,'ABSOLUTE','absolute'),'absolute')]"):
        lines = _div_lines(root)
    else:
        lines = _table_lines(root)
    classes = _read_lines(lines)
    if not classes:
        return None
    by = by_of([c["name"] for c in classes], " ".join(filter(None, [heading, url])))
    finish_classes(classes, by)
    early = [t for line in lines[:4] for _, t, _ in line]
    return model.doc(KIND, classes, by=by, title=title or heading or None,
                     date=find_date(*early, heading, title))


# --- the two list flavours -> lines of (x, text, bold) ----------------------------------------------------------

def _bold(el) -> bool:
    if el is None:
        return False
    style = (el.get("style") or "").replace(" ", "").lower()
    return "font-weight:bold" in style or "header" in (el.get("class") or "").split() or \
        bool(el.xpath(".//b|.//strong")) and text_of(el) == " ".join(text_of(b) for b in el.xpath(".//b|.//strong"))


def _table_lines(root) -> list[list[tuple]]:
    lines = []
    for tr in root.iter("tr"):
        if tr.xpath(".//h1|.//h2|.//h3"):
            continue                                    # the list title
        line = [(i, text_of(c), _bold(c)) for i, c in enumerate(cells_of(tr)) if c is not None and text_of(c)]
        if line:
            lines.append(line)
    return lines


def _div_lines(root) -> list[list[tuple]]:
    by_top: dict[float, list[tuple]] = {}
    for el in root.xpath("//div|//p"):
        pos = {k.lower(): float(v) for k, v in _POS.findall(el.get("style") or "")}
        if "left" not in pos or "top" not in pos or el.xpath(".//h1|.//h2|.//h3"):
            continue
        t = text_of(el)
        if t:
            by_top.setdefault(pos["top"], []).append((pos["left"], t, _bold(el)))
    return [sorted(by_top[k]) for k in sorted(by_top)]


# --- reading the lines ------------------------------------------------------------------------------------------

def _read_lines(lines: list[list[tuple]]) -> list[dict]:
    """Classes from the lines: a bold line opens a class (its other cells are column titles), the next lines are
    its runners."""
    groups = []                                         # [klass, {x: title}, [line…]]
    for line in lines:
        if all(b for _, _, b in line):
            k = model.klass(clean_class_name(line[0][1]))
            titles = {x: model.plain(t) for x, t, _ in line[1:]}
            groups.append([k, titles, []])
        elif groups:
            groups[-1][2].append({x: t for x, t, _ in line})
    classes = []
    for k, titles, rows in groups:
        cols = _columns(titles, rows)
        if cols is None:
            continue
        for row in rows:
            r = _runner(row, cols)
            if r:
                k["runners"].append(r)
        if k["runners"]:
            classes.append(k)
    return classes


def _columns(titles: dict, rows: list[dict]) -> dict | None:
    """Which position holds what, from the column titles when there are some, else from the content."""
    xs = sorted({x for row in rows for x in row})
    vals = {x: [row[x] for row in rows if row.get(x)] for x in xs}
    if not xs:
        return None

    def share(x, test):
        v = vals[x]
        return sum(1 for t in v if test(t)) / len(v) if v else 0.0

    def timeish(t):
        return not t.startswith("+") and (time_status(t)[1] is not None or model.plain(t) == "ok")

    time_x = next((x for x, t in titles.items() if t in _TIME_TITLES and x in vals), None)
    if time_x is None:
        scored = [(share(x, timeish) * len(vals[x]), -x, x) for x in xs]
        best = max(scored)
        if best[0] <= 0:
            return None
        time_x = best[2]
    left = [x for x in xs if x < time_x]
    place_x = next((x for x in left if share(x, lambda t: re.fullmatch(r"\d+\.", t) is not None) >= 0.5), None)
    rest = [x for x in left if place_x is None or x > place_x]
    name_x = next((x for x in rest if share(x, lambda t: re.search(r"[^\W\d_]{2}", t) is not None) >= 0.5
                   and share(x, timeish) < 0.5), None)
    if name_x is None:
        return None
    birth_x = club_x = class_x = None
    texts = []
    for x in rest:
        if x <= name_x:
            continue
        if share(x, lambda t: re.fullmatch(r"(19|20)?\d{2}", t) is not None) >= 0.8:
            birth_x = birth_x if birth_x is not None else x
        elif share(x, lambda t: re.search(r"[^\W\d_]", t) is not None) >= 0.5:
            texts.append(x)
    if len(texts) == 1:
        club_x = texts[0]
    elif len(texts) >= 2:
        # the club column: FFCO club numbers ("1905NA BLCO"); else the more varied one (a class column repeats)
        ranked = sorted(texts, key=lambda x: (share(x, lambda t: model.club_code(t) is not None),
                                              len(set(vals[x])) / max(1, len(vals[x]))), reverse=True)
        club_x, class_x = ranked[0], ranked[1]
    return {"time": time_x, "place": place_x, "name": name_x, "club": club_x, "class": class_x, "birth": birth_x}


def _runner(row: dict, cols: dict):
    name = row.get(cols["name"], "")
    if not name or not re.search(r"[^\W\d_]", name):
        return None
    tt = row.get(cols["time"], "")
    time_s, status = time_status(tt)
    if status is None:
        if model.plain(tt) == "ok":
            status = "nc"                               # "OK" without a time: a course that is not timed
        elif not tt or set(tt) <= set("-–—"):
            status = "dns"                              # "–": no result (not started, or not read out yet)
        else:
            return None
    cls_text = row.get(cols["class"], "") if cols["class"] is not None else ""
    return model.runner(name, place=place_of(row.get(cols["place"], "")) if cols["place"] is not None else None,
                        club=row.get(cols["club"]) if cols["club"] is not None else None,
                        category=model.category(cls_text),
                        birth=model.birth_year(row.get(cols["birth"], "")) if cols["birth"] is not None else None,
                        time_s=time_s, status=status)


# --- Orientation Data -------------------------------------------------------------------------------------------

def _orientation_data(root, title: str | None, url: str) -> dict | None:
    table = root.xpath("//table[@id='resultsTable']")[0]
    name = ""
    for h in root.xpath("//div[contains(@class,'co-card-header')]"):
        m = re.search(r"Classement\s*[—–-]\s*(.+)", text_of(h))
        if m:
            name = m.group(1)
            date_badge = text_of(h)
            break
    else:
        date_badge = ""
        m = re.search(r"R[ée]sultats\s*[—–-]\s*([^—–]+)", title or "")
        name = m.group(1).strip() if m else (title or "?")
    name = re.sub(r"\s*\d{2}/\d{2}/\d{4}\s*$", "", name).strip()
    k = model.klass(name)
    splits_by_runner = []
    for tr in table.xpath("./tbody/tr|./tr"):
        cls = (tr.get("class") or "").split()
        if "splits-row" in cls:
            if k["runners"]:
                splits_by_runner[-1] = _od_splits(tr)
            continue
        if "result-row" not in cls:
            continue
        tds = tr.xpath("./td")
        if len(tds) < 4:
            continue
        place_text = text_of(tds[0]) or (tds[0].xpath(".//img/@alt") or [""])[0]
        nm = text_of(next(iter(tr.xpath("./td[contains(@class,'runner-name')]")), tds[1]))
        club = text_of(next(iter(tr.xpath("./td[contains(@class,'club-name')]")), tds[2]))
        tt = text_of(next(iter(tr.xpath("./td[contains(@class,'time-col')]")), tds[3]))
        time_s, status = time_status(tt)
        if status is None:
            status = "dns" if not tt else None
        if not nm or status is None:
            continue
        k["runners"].append(model.runner(nm, place=place_of(place_text), club=club or None, time_s=time_s,
                                         status=status))
        splits_by_runner.append(None)
    if not k["runners"]:
        return None
    # the course: the control sequence most runners show
    seqs = Counter(tuple(c for c, _ in s) for s in splits_by_runner if s)
    if seqs:
        controls = list(seqs.most_common(1)[0][0])
        k["controls"] = [c.split("-", 1)[1] if "-" in c else c for c in controls]
        for r, s in zip(k["runners"], splits_by_runner):
            if s and tuple(c for c, _ in s) == tuple(controls):
                r["splits"] = check_splits([v for _, v in s], len(controls))
    by = by_of([k["name"]], " ".join(filter(None, [title, url])))
    finish_classes([k], by)
    return model.doc(KIND, [k], by=by, title=title, date=find_date(date_badge, title))


def _od_splits(tr) -> list[tuple[str, float | None]]:
    """(control label "1-238", cumulative seconds) for each control cell of a runner's split row."""
    out = []
    for cell in tr.xpath(".//div[contains(@class,'split-cell')]"):
        cls = (cell.get("class") or "").split()
        if "split-start" in cls or "split-finish" in cls:
            continue
        label = text_of(next(iter(cell.xpath(".//*[contains(@class,'split-ctrl-name')]")), None))
        abs_el = next(iter(cell.xpath(".//*[contains(@class,'split-time-abs')]")), None)
        # the cumulative time is the cell's own text; the nested span is the rank at that control
        t = (abs_el.text or "").strip() if abs_el is not None else ""
        if label:
            out.append((label, split_time(t)))
    return out

"""IOF XML result lists: data standard 3.0 (OE12, MeOS, Helga, liveresultat exports) and the older 2.0.3 (OE2010).

Tags are read by local name, so the 3.0 namespace (or a missing one) does not matter. Individual results only:
relay lists (TeamResult) are skipped. The controls of a class are the most common sequence of punched codes among
its runners (IOF 3.0 has no course description in a result list); a runner on another variation (forked course,
wrong class) keeps no splits rather than splits matched to the wrong controls.
"""

from __future__ import annotations

import re
from collections import Counter

from lxml import etree

from .. import model

KIND = "iofxml"

# IOF 3.0 and 2.0.3 status values -> ours; None: not a result (entry not started, cancelled…), the runner is dropped
_STATUS = {
    "ok": "ok", "finished": "ok",
    "missingpunch": "mp", "mispunch": "mp",
    "didnotfinish": "dnf", "sportingwithdrawal": "dnf", "sportwithdr": "dnf",
    "disqualified": "dsq",
    "overtime": "ot",
    "didnotstart": "dns",
    "notcompeting": "nc",
    "inactive": None, "didnotenter": None, "cancelled": None, "active": None,
}


def parse(content: bytes, url: str) -> dict | None:
    try:
        return _parse(content)
    except Exception:
        return None


def _ln(el) -> str:
    """Local tag name (no namespace); '' for comments and processing instructions."""
    return etree.QName(el).localname if isinstance(el.tag, str) else ""


def _child(el, *path):
    """The first descendant along a path of local names (child, grandchild…), or None."""
    for name in path:
        if el is None:
            return None
        el = next((c for c in el if _ln(c) == name), None)
    return el


def _children(el, name):
    return [c for c in el if _ln(c) == name] if el is not None else []


def _txt(el, *path) -> str:
    e = _child(el, *path) if path else el
    return re.sub(r"\s+", " ", e.text or "").strip() if e is not None and e.text else ""


def _parse(content: bytes) -> dict | None:
    head = content[:2048].lstrip(b"\xef\xbb\xbf \t\r\n")
    if not (head.startswith(b"<?xml") or head.startswith(b"<ResultList") or b"<ResultList" in head):
        return None
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=True)
    root = etree.fromstring(content, parser)
    if root is None or _ln(root) != "ResultList":
        return None
    event = _child(root, "Event")
    title = _txt(event, "Name") or None
    date = _date(event)
    classes = []
    for cr in _children(root, "ClassResult"):
        k = _class(cr)
        if k and k["runners"]:
            classes.append(k)
    if not classes:
        return None
    names = [c["name"] for c in classes]
    by = "category" if sum(1 for n in names if model.category(n)) >= 0.6 * len(names) else "circuit"
    if by == "category":
        for c in classes:
            cat = model.category(c["name"])
            for r in c["runners"]:
                r["category"] = r["category"] or cat
    return model.doc(KIND, classes, by=by, title=title, date=date)


def _date(event) -> str | None:
    if event is None:
        return None
    for path in (("StartTime", "Date"), ("StartDate", "Date"), ("Race", "StartTime", "Date")):
        m = re.match(r"(\d{4}-\d{2}-\d{2})", _txt(event, *path))
        if m:
            return m.group(1)
    return None


def _seconds(text: str) -> float | None:
    """3.0 times are seconds ('1845', '1845.5'); 2.0.3 ones are clock strings ('31:05', '00:31:05')."""
    t = (text or "").strip()
    if not t:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", t):
        return float(t)
    return model.parse_time(t)


def _class(cr) -> dict | None:
    name = _txt(cr, "Class", "Name") or _txt(cr, "ClassShortName") or _txt(cr, "Class", "ClassShortName")
    course = _child(cr, "Course")
    k = model.klass(name or "?")
    length = _txt(course, "Length") if course is not None else ""
    climb = _txt(course, "Climb") if course is not None else ""
    k["length_m"] = int(float(length)) if re.fullmatch(r"\d+(?:\.\d+)?", length) else None
    k["climb_m"] = int(float(climb)) if re.fullmatch(r"\d+(?:\.\d+)?", climb) else None
    raw = []                                # (runner, [(code, seconds | None)])
    for pr in _children(cr, "PersonResult"):
        got = _person(pr, k)
        if got:
            raw.append(got)
    # the class's controls: the commonest punched sequence, finishers first
    seqs = Counter(tuple(c for c, _ in s) for r, s in raw if s and r["status"] == "ok") \
        or Counter(tuple(c for c, _ in s) for r, s in raw if s)
    controls = list(seqs.most_common(1)[0][0]) if seqs else None
    k["controls"] = controls
    for r, s in raw:
        if controls and s:
            r["splits"] = _align(controls, s)
        k["runners"].append(r)
    return k


def _align(controls: list[str], punches: list[tuple[str, float | None]]) -> list | None:
    """The runner's time at each control, matching codes in order (skipping extra punches); None when the
    runner's sequence is not the class's (another variation)."""
    out, j = [], 0
    for code in controls:
        while j < len(punches) and punches[j][0] != code:
            j += 1
        if j >= len(punches):
            return None
        out.append(punches[j][1])
        j += 1
    return out if any(v is not None for v in out) else None


def _person(pr, k: dict):
    person = _child(pr, "Person")
    if person is None:
        return None
    family = _txt(person, "Name", "Family") or _txt(person, "PersonName", "Family")
    given = _txt(person, "Name", "Given") or _txt(person, "PersonName", "Given")
    name = " ".join(x for x in (given, family) if x)
    if not name:
        return None
    birth = None
    bd = _txt(person, "BirthDate", "Date") or _txt(person, "BirthDate")
    if re.match(r"\d{4}", bd):
        birth = model.birth_year(bd[:4])
    org = _child(pr, "Organisation")
    if org is None:
        org = _child(pr, "Club")
    club = (_txt(org, "Name") or _txt(org, "ShortName")) if org is not None else ""
    res = _child(pr, "Result")
    if res is None:
        return None
    if _child(res, "Status") is not None:
        st_raw = _txt(res, "Status")
    else:
        cs = _child(res, "CompetitorStatus")
        st_raw = cs.get("value", "") if cs is not None else ""
    key = re.sub(r"[^a-z]", "", st_raw.lower())
    status = _STATUS.get(key, "ok" if not key else "nc")
    if status is None:
        return None
    time_s = _seconds(_txt(res, "Time"))
    pos = _txt(res, "Position") or _txt(res, "ResultPosition")
    place = int(pos) if pos.isdigit() and int(pos) > 0 and status == "ok" else None
    if status == "ok" and time_s is None:
        status = "dnf"
    if k["length_m"] is None:
        cl = _txt(res, "CourseLength")
        if cl.isdigit():
            k["length_m"] = int(cl)
    cat = model.category(_txt(pr, "Class", "Name"))
    punches = []
    for st in _children(res, "SplitTime"):
        if (st.get("status") or "").lower() == "additional":
            continue
        code = _txt(st, "ControlCode")
        if not code:
            continue
        punches.append((code, None if (st.get("status") or "").lower() == "missing"
                        else _seconds(_txt(st, "Time"))))
    r = model.runner(name, place=place, club=club or None, category=cat, birth=birth,
                     bib=_txt(res, "BibNumber") or None, time_s=time_s, status=status)
    return r, punches

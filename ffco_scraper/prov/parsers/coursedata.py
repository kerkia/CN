"""A course setter's course data: IOF XML CourseData, 3.0 (Purple Pen's « Export IOF XML », OCAD, Condes, Ozimut's own
« Organisation › Tracer ») or the older 2.0.3 — each course's name, length, climb and controls in order. Not a results
list: read as {"kind": "coursedata", "classes": [{name, length_m, climb_m, controls, runners: []}], "assign": {class:
course}}, it gives the race's results lists the circuits' values their own files lack (run.fill_courses, 2026-10-15).

Controls are the punched ones in order: the start, the finish, crossing points and map exchanges are left out; a score
course (« randomOrder ») has no order, hence no controls. A forked course's variations are courses of their own
(« A AB »), and their family (« A ») one more, with the length and climb all its variations share.
"""

from __future__ import annotations

import re

from lxml import etree

from .. import model

KIND = "coursedata"


def parse(content: bytes, url: str = "") -> dict | None:
    try:
        return _parse(content)
    except Exception:
        return None


def _ln(el) -> str:
    return etree.QName(el).localname if isinstance(el.tag, str) else ""


def _children(el, name):
    return [c for c in el if _ln(c) == name] if el is not None else []


def _child(el, *path):
    for name in path:
        if el is None:
            return None
        el = next((c for c in el if _ln(c) == name), None)
    return el


def _txt(el, *path) -> str:
    e = _child(el, *path) if path else el
    return re.sub(r"\s+", " ", e.text or "").strip() if e is not None and e.text else ""


def _metres(text: str) -> int | None:
    return int(round(float(text))) if re.fullmatch(r"\d+(?:\.\d+)?", text or "") and float(text) > 0 else None


def _parse(content: bytes) -> dict | None:
    head = content[:4096].lstrip(b"\xef\xbb\xbf \t\r\n")
    if b"CourseData" not in head:
        return None
    parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True, huge_tree=True)
    root = etree.fromstring(content, parser)
    if root is None or _ln(root) != "CourseData":
        return None
    title = _txt(_child(root, "Event"), "Name") or None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", _txt(_child(root, "Event"), "StartTime", "Date"))
    races = _children(root, "RaceCourseData")
    courses, assign = (_v3(races) if races else _v2(root))
    if not courses:
        return None
    # a forked course's family: one more course, with what its variations share
    families: dict[str, list] = {}
    for c in courses:
        fam = c.pop("family", None)
        if fam:
            families.setdefault(fam, []).append(c)
    names = {c["name"] for c in courses}
    for fam, vs in families.items():
        if fam in names:
            continue
        lengths, climbs = {v["length_m"] for v in vs}, {v["climb_m"] for v in vs}
        courses.append(model.klass(fam, [], length_m=lengths.pop() if len(lengths) == 1 else None,
                                   climb_m=climbs.pop() if len(climbs) == 1 else None))
    return {"kind": KIND, "by": "circuit", "title": title, "date": m.group(1) if m else None,
            "classes": courses, "assign": assign}


def _v3(races) -> tuple[list, dict]:
    courses, assign = [], {}
    for rcd in races[:1]:                          # one race (a multi-race file: its first)
        for co in _children(rcd, "Course"):
            name = _txt(co, "Name")
            if not name:
                continue
            controls, scored = [], False
            for cc in _children(co, "CourseControl"):
                if (cc.get("type") or "Control") != "Control":
                    continue                       # Start, Finish, CrossingPoint, EndOfMarkedRoute
                scored = scored or (cc.get("randomOrder") or "").lower() == "true"
                code = _txt(cc, "Control")
                if code:
                    controls.append(code)
            fam = _txt(co, "CourseFamily")
            c = model.klass(name, [], length_m=_metres(_txt(co, "Length")), climb_m=_metres(_txt(co, "Climb")),
                            controls=None if scored or not controls else controls)
            c["family"] = fam if fam and fam != name else None
            courses.append(c)
        for a in _children(rcd, "ClassCourseAssignment"):
            cls, course = _txt(a, "ClassName"), _txt(a, "CourseName") or _txt(a, "CourseFamily")
            if cls and course:
                assign.setdefault(cls, course)
    return courses, assign


def _v2(root) -> tuple[list, dict]:
    courses, assign = [], {}
    for co in _children(root, "Course"):
        name = _txt(co, "CourseName")
        if not name:
            continue
        variations = _children(co, "CourseVariation")
        for i, cv in enumerate(variations):
            seq = sorted(_children(cv, "CourseControl"), key=lambda cc: int(s) if (s := _txt(cc, "Sequence")).isdigit() else 0)
            controls = [code for cc in seq if (code := _txt(cc, "ControlCode"))]
            scored = any(_child(cc, "ScoreOPoints") is not None for cc in seq)
            vname = name if len(variations) == 1 else f"{name} {_txt(cv, 'Name') or i}"
            c = model.klass(vname, [], length_m=_metres(_txt(cv, "CourseLength")), climb_m=_metres(_txt(cv, "CourseClimb")),
                            controls=None if scored or not controls else controls)
            c["family"] = name if len(variations) > 1 else None
            courses.append(c)
        for cls in _children(co, "ClassShortName"):
            if _txt(cls):
                assign.setdefault(_txt(cls), name)
    return courses, assign


# ---- matching a results class to a course ----------------------------------------------------------------------
def course_key(name: str | None) -> str:
    """A circuit's name as compared: case, accents, spaces and punctuation, a leading « Circuit » / « Parcours » and
    leading zeros ignored (« Circuit A » = « A » = « circuit-a »; « Circuit n°3 » = « 03 »)."""
    s = model.plain(name)
    s = re.sub(r"^(?:circuit|circ\.?|parcours)\s*(?:no?\s*\.?\s*(?=\d))?", "", s).strip() or s
    s = re.sub(r"[^a-z0-9]+", "", s)
    return re.sub(r"^0+(?=\d)", "", s)


def seq_key(controls) -> tuple:
    """A control sequence as compared: codes stripped of spaces and leading zeros."""
    return tuple(re.sub(r"^0+(?=\d)", "", str(c).strip().upper()) for c in controls or [])

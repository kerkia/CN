"""A course announcement (« annonce de course »): the table of its circuits and the categories on each, when it has one
(« A  H20, H21 et H35  Violet  1/10 000  6.9 km », « F bis  D60+ et H70+  Orange … »). FFCO's template often gives only the
number of circuits; many organisers add the table. Read as {"kind": "announcement", "classes": [], "circuits":
[[label, categories text, None]]} — the same shape as FFCO's registration list, to place a list by category's
categories in their circuits (run.category_circuits).
"""

from __future__ import annotations

import io
import re

from .. import model

KIND = "announcement"
_CAT = r"(?:H\s*/\s*D|D\s*/\s*H|HD|DH|H|D)\s?\d{2}[A-Z]?(?:\s*[/-]\s*\d{2})?\s*(?:\+|et\s*\+|et plus)?"
_LIST = re.compile(rf"(?<![\w/]){_CAT}(?:\s*(?:,|;|/|et|&)\s*{_CAT})*")
_LABEL = re.compile(r"^(?:circuit|parcours)?\s*([A-Z0-9][\w'’.-]*(?:\s+(?:bis|ter|long|court|moyen|tr[eè]s court|[A-Z0-9]{1,2}))?)\s*[:\-–]?\s*$", re.I)
MAX_PAGES = 8


def parse(content: bytes, url: str = "") -> dict | None:
    try:
        return _parse(content)
    except Exception:
        return None


def circuits_from_text(text: str) -> list[list]:
    """[[label, categories text, None]] from the lines « <label> <categories> … » (three at least, else nothing)."""
    out, seen = [], set()
    for line in text.splitlines():
        m = _LIST.search(line)
        if not m or len(re.findall(r"[HD]\s?\d{2}", m.group(0))) < 1:
            continue
        label = _LABEL.match(line[:m.start()].strip())
        if not label or not line[:m.start()].strip():
            continue
        name = label.group(1).strip()
        cats = m.group(0).strip()
        if name in seen or not cats:
            continue
        seen.add(name)
        out.append([name, cats, None])
    # a table: several circuits, each with categories — a line or two quoting a category is not one
    return out if len(out) >= 3 else []


def _parse(content: bytes) -> dict | None:
    if content[:5] != b"%PDF-":
        return None
    import pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages[:MAX_PAGES])
    circuits = circuits_from_text(text)
    if not circuits:
        return None
    title = next((l.strip() for l in text.splitlines() if l.strip()), None)
    return {"kind": KIND, "by": "circuit", "title": title, "date": None, "classes": [], "circuits": circuits,
            "head": " ".join(text.splitlines()[:6])[:300]}

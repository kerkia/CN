"""Provisional results: the common shape every source and parser produces, and the small helpers they share.

A parsed document (one results or split-times file, one liveresultat competition, one WinSplits event) is:

    {
      "kind":  "oe_html" | "meos_html" | "iofxml" | "pdf_oe" | "pdf_meos" | "liveresultat" | "winsplits" | ...,
      "by":    "circuit" | "category" | "unknown",       # what the classes are
      "title": str | None,                              # the document's own title, if any
      "date":  "YYYY-MM-DD" | None,                     # the race date printed in it, if any
      "classes": [{
          "name":     str,                              # "H21", "Violet long", "Circuit A"…
          "length_m": int | None, "climb_m": int | None,
          "controls": [str, …] | None,                  # control codes in order (finish excluded), when known
          "runners": [{
              "place":     int | None,
              "name":      str,                         # as printed ("Jeanne DUPONT", "DUPONT Jeanne")
              "club":      str | None,                  # as printed
              "club_code": str | None,                  # FFCO club number, 4 digits ("1905"), when printed
              "category":  str | None,                  # "H21", "D16"…
              "birth":     int | None,                  # year of birth (4 digits)
              "bib":       str | None,
              "time_s":    float | None,                # total time in seconds (None when not classified)
              "status":    "ok" | "mp" | "dnf" | "dsq" | "ot" | "dns" | "nc",
              "splits":    [float | None, …] | None,    # cumulative seconds at each control of `controls`
          }, …],
      }, …],
    }

`splits` has one entry per control in `controls` (None for a missing punch); the finish is `time_s`.
Parsers return None when the content is not theirs, and never raise on odd input.
"""

from __future__ import annotations

import re
import unicodedata

STATUSES = ("ok", "mp", "dnf", "dsq", "ot", "dns", "nc")

# Words organisers print instead of a time, by status (lower-case, accents stripped)
STATUS_WORDS = {
    "mp": ("pm", "p.m.", "mp", "poincon manquant", "poinc. manquant", "missing punch", "mispunch", "manquant"),
    "dnf": ("ab", "abandon", "abd", "dnf", "abandonne", "aband", "forfait"),
    "dsq": ("disq", "disq.", "dsq", "disqualifie", "disqualifiee", "dq"),
    "ot": ("hd", "hors delai", "hors-delai", "h.d.", "h. delai", "ot", "over time", "temps max", "depassement"),
    "dns": ("np", "non partant", "dns", "absent", "abs"),
    "nc": ("nc", "n.c.", "hc", "hors concours", "hors course", "non classe", "nl"),
}


def plain(s: str | None) -> str:
    """Lower-case, accents stripped, spaces collapsed."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def status_of(text: str | None) -> str | None:
    """The status a cell's text stands for ("PM" -> "mp"), or None if it is not a status word."""
    t = plain(text).strip(" .")
    if not t:
        return None
    for st, words in STATUS_WORDS.items():
        if t in (w.strip(" .") for w in words):
            return st
    return None


_TIME = re.compile(r"^\s*(?:(\d+)\s*[:hH]\s*)?(\d{1,3})\s*[:'m]\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:s|\")?\s*$")


def parse_time(text: str | None) -> float | None:
    """'1:02:03', '62:03', '1h02:03', "62'03", '5:07.4' -> seconds; None if not a time."""
    if text is None:
        return None
    m = _TIME.match(str(text).replace(" ", " "))
    if not m:
        return None
    h, mi, s, frac = m.groups()
    if int(s) >= 60:
        return None
    t = int(h or 0) * 3600 + int(mi) * 60 + int(s)
    if frac:
        t += int(frac) / (10 ** len(frac))
    return float(t)


_CLUB_CODE = re.compile(r"\b(\d{4})(?:[A-Z]{2})?\b")


def club_code(text: str | None) -> str | None:
    """The FFCO club number in '1905NA BLCO', '6804GE', '7807 GO78'; None if there is none."""
    m = _CLUB_CODE.search(str(text or ""))
    return m.group(1) if m else None


def birth_year(text: str | None) -> int | None:
    """'85' -> 1985, '08' -> 2008, '1985' -> 1985 (two-digit years: the last 100 years)."""
    t = str(text or "").strip()
    if re.fullmatch(r"\d{4}", t):
        y = int(t)
        return y if 1900 < y < 2100 else None
    if re.fullmatch(r"\d{2}", t):
        y = int(t)
        return 2000 + y if y <= 30 else 1900 + y
    return None


_CAT = re.compile(r"^([HD])\s?(\d{2})([A-Z]{0,2})$")


def category(text: str | None) -> str | None:
    """'H21', 'D16', 'H55H' -> 'H21' / 'D16' / 'H55'; None if not an FFCO category."""
    m = _CAT.match(str(text or "").strip().upper())
    return f"{m.group(1)}{m.group(2)}" if m else None


def runner(name: str, **kw) -> dict:
    """A runner row with every key present."""
    r = {"place": None, "name": re.sub(r"\s+", " ", str(name or "")).strip(), "club": None, "club_code": None,
         "category": None, "birth": None, "bib": None, "time_s": None, "status": "ok", "splits": None}
    r.update({k: v for k, v in kw.items() if k in r})
    if r["club"] and not r["club_code"]:
        r["club_code"] = club_code(r["club"])
    if r["status"] == "ok" and r["time_s"] is None:
        r["status"] = "dnf"
    return r


def klass(name: str, runners: list[dict] | None = None, **kw) -> dict:
    c = {"name": re.sub(r"\s+", " ", str(name or "")).strip(), "length_m": None, "climb_m": None, "controls": None,
         "runners": runners or []}
    c.update({k: v for k, v in kw.items() if k in c})
    return c


def doc(kind: str, classes: list[dict], by: str = "unknown", title: str | None = None, date: str | None = None) -> dict:
    return {"kind": kind, "by": by, "title": title, "date": date, "classes": [c for c in classes if c["runners"]]}

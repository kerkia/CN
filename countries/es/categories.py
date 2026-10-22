"""Spanish categories -> the engine's (FFCO's: sex H/D and an age, « H21 », « D16 »), which the junior fade, the age
pyramid and the categories' pages read. The label as the organiser printed it is kept beside (`cat_src`).

FEDO's: « F-E » / « M-E » (elite), « F-21A », « M-21B », « F-16 », « M-35 »… (sex F/M, then the age, A/B levels), « U-10 »
and « U-12 » (mixed, the runner's own sex), « OPEN … » (no category); and the older names: Alevín (12), Infantil (14),
Cadete (16), Juvenil (18), Júnior (20), Sénior (21), Veteranos A/B/C/D (35/45/55/65).
"""
from __future__ import annotations

import re
import unicodedata

WORDS = {"benjamin": 10, "alevin": 12, "infantil": 14, "cadete": 16, "juvenil": 18, "junior": 20, "senior": 21, "elite": 21,
         "absoluto": 21, "absoluta": 21}
VETERAN = {"a": 35, "b": 45, "c": 55, "d": 65, "e": 75}
SUFFIX = re.compile(r"\s+(o-pie|mtbo|mtb-o|btt|trail-o|ski-o)$", re.I)


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def _sex(word: str | None) -> str | None:
    w = (word or "").lower()
    return "D" if w in ("f", "d", "w", "fem", "femenino", "femenina", "mujeres", "damas") else \
        "H" if w in ("m", "h", "masc", "masculino", "masculina", "hombres") else None


def normalise(label: str | None, sex: str | None = None) -> str | None:
    """« M-21A O-Pie » -> "H21", « F-E » -> "D21", « U-12 » with a girl -> "D12", « Cadete Masculino » -> "H16"; None when the
    label names no category (« OPEN ROJO », a course's colour)."""
    s = SUFFIX.sub("", _fold(label or ""))
    if not s or s.startswith("open") or "open" in s.split():
        return None
    runner_sex = _sex(sex)
    # « F-21A », « M-E », « F16 », « H-35 », « M21B »
    m = re.match(r"^([fmhdw])\s*-?\s*(e|elite|\d{2})\s*([ab])?\b", s)
    if m:
        age = 21 if m.group(2) in ("e", "elite") else int(m.group(2))
        sx = _sex(m.group(1))
        return f"{sx}{age:02d}" if sx and 8 <= age <= 95 else None
    # « U-10 », « U12 »: mixed, the runner's sex
    m = re.match(r"^u\s*-?\s*(\d{2})\b", s)
    if m:
        return f"{runner_sex}{int(m.group(1)):02d}" if runner_sex else None
    # the older names, the sex after them (« Cadete Masculino », « Veteranos B Femenino »)
    words = s.replace("-", " ").split()
    sx = next((_sex(w) for w in words if _sex(w)), None) or runner_sex
    for w, age in WORDS.items():
        if w in words:
            return f"{sx}{age:02d}" if sx else None
    if any(w.startswith("veteran") for w in words):
        lvl = next((VETERAN[w] for w in words if w in VETERAN), 35)
        return f"{sx}{lvl:02d}" if sx else None
    return None

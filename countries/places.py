"""Where a place a calendar names lies: its region and its finer unit (a Bezirk, a county, a province…), for the agendas of
the countries whose calendar gives a town, a forest or a park rather than a region (owner, 2026-10-24).

The tables are countries/places/<cc>.json.gz, made from GeoNames by tools/gazetteer.py (which says what each country's two
levels are); nothing is asked of a geocoding service at run time.

    region, dept = places.locate("AT", "Graz-Mantscha-Mitterriegel")      # ("Steiermark", "Graz")

A place is read part by part (« Belvedere, Wien », « Pokljuvani (Bjelovar) »): every part and every run of its words
that names a place votes for that place's region, the weightier places (an administrative unit, a town, a bigger town)
more, a whole part more than a word inside it; the region needs half the votes, the finer unit the region's best.
"""
from __future__ import annotations

import gzip
import json
import re
import unicodedata
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "places"
CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
SPLIT = re.compile(r"[,;/()\[\]|\n:«»\"]|\s[-–—]\s|、|，|（|）")
# words that never name a place on their own (a calendar's « Park », « Wald », « TBC »)
STOP = {"park", "wald", "forest", "lake", "see", "centre", "center", "school", "golf", "club", "sport", "sports", "hall",
        "beach", "city", "stadt", "online", "tbc", "tba", "tbd", "nord", "sud", "north", "south", "east", "west", "ost",
        "mitte", "centrum", "stadion", "arena", "camp", "area", "zone", "les", "the", "and", "und", "der", "die", "das",
        "del", "della", "san", "saint", "sankt", "bad", "new", "old", "neu", "alt", "gora", "mont", "monte", "lago",
        "parco", "bosco", "skola", "les", "park", "puszcza", "vrch", "hora", "potok", "dolina", "jezero", "suma",
        "planina", "hill", "hills", "wood", "woods", "common", "moor", "estate", "country", "university", "college",
        "high", "upper", "lower", "great", "little", "mount", "orienteering", "start", "parking", "parkplatz", "halle",
        "turnhalle", "schule", "sportplatz", "sportzentrum", "zentrum", "altstadt", "dorf", "oberdorf", "unterdorf",
        "markt", "station", "bahnhof", "kirche", "schloss", "castle", "hotel", "region", "gemeinde"}


def fold(s: str | None) -> str:
    """Lower case, without accents, punctuation as spaces (the tables' keys are written so)."""
    s = unicodedata.normalize("NFKD", unicodedata.normalize("NFKC", s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("ß", "ss").replace("ł", "l").replace("đ", "d").replace("ı", "i").replace("ø", "o").replace("æ", "ae")
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+|_", " ", s)).strip()


@lru_cache(maxsize=None)
def table(cc: str) -> dict | None:
    p = DIR / f"{cc.lower()}.json.gz"
    if not p.exists():
        return None
    return json.loads(gzip.decompress(p.read_bytes()).decode("utf-8"))


def dept_names(cc: str) -> dict:
    """{dept code: name} of a country's table."""
    t = table(cc) or {}
    return {d[0]: d[1] for d in t.get("depts", [])}


def dept_region(cc: str) -> dict:
    """{dept code: region} of a country's table (none for a country whose region is the calendar's own)."""
    t = table(cc) or {}
    return {d[0]: t["regions"][d[2]] for d in t.get("depts", []) if d[2] >= 0}


# abbreviations written out as the tables write the words (« Минская обл. », « Брестский р-н »)
ABBR = [(re.compile(r"\bобл\b\.?", re.I), "область"), (re.compile(r"\bр-н\b\.?", re.I), "район"),
        (re.compile(r"\bSt\. ?(?=[A-ZÄÖÜ])"), "Sankt "), (re.compile(r"\bokr\. ", re.I), "okres ")]


def _segments(text: str):
    """The parts of a place, an address's street left out: « Ursulinenhof, Landstraße 31, 4020 Linz » -> Ursulinenhof, Linz."""
    for rx, word in ABBR:
        text = rx.sub(word, text or "")
    for seg in SPLIT.split(text or ""):
        seg = seg.strip()
        m = re.match(r"^(?:[A-Z]{1,2}-)?\d{4,5}\s+(\D+)$", seg)       # a postcode and its town
        if m:
            yield m.group(1)
        elif re.search(r"\d", seg):
            if not re.search(r"\d+[a-z]?\s*$|\d+\s*[,.]", seg, re.I):    # a street and its number: not a place
                yield re.sub(r"\d+\.?", " ", seg)
        else:
            yield seg


def _hits(keys: dict, text: str):
    for seg in _segments(text):
        fs = fold(seg)
        if not fs:
            continue
        if fs in keys and fs not in STOP:
            yield 3.0, 9, keys[fs]
            continue
        toks = fs.split()
        used = [False] * len(toks)
        for n in range(min(len(toks) - 1, 5), 0, -1):
            for i in range(len(toks) - n + 1):
                if any(used[i:i + n]):
                    continue
                k = " ".join(toks[i:i + n])
                if n == 1 and (k in STOP or k.isdigit() or (len(k) < 3 and not CJK.search(k))):
                    continue
                c = keys.get(k)
                # a word inside a longer part names a place only when it is a town of some size
                need = 2.4 if n > 1 else 3.5 if len(k) >= 4 or CJK.search(k) else 4.3
                if c and max(x[2] for x in c) >= need:
                    used[i:i + n] = [True] * n
                    yield float(n), n, c                 # (« Märkisch Buchholz » over « Köthen » in « Märkisch Buchholz-Köthen »)
        # a run of Chinese, Japanese or Korean characters: its longest names, without overlap
        for i, tok in enumerate(toks):
            if used[i] or not CJK.search(tok):
                continue
            j = 0
            while j < len(tok):
                for L in range(min(12, len(tok) - j), 1, -1):
                    c = keys.get(tok[j:j + L])
                    if c and (L >= 3 or max(x[2] for x in c) >= 3.0):
                        yield (1.5 if L >= 3 else 1.0), L, c
                        j += L
                        break
                else:
                    j += 1


def locate(cc: str, text: str | None, *, region_only: bool = False, expect=None) -> tuple[str | None, str | None]:
    """The region and the finer unit's code of a place named by a calendar, (None, None) when unknown or ambiguous.
    `region_only`: a text that only hints at the area (a club's town): no finer unit. `expect`: the region the calendar
    gives (Switzerland's association), or the regions it may be (a set): a name met in several regions is taken in that one,
    and a place found elsewhere counts only when a whole part of the text names a town there (« Davos Dorf » organised by a
    club of Romandy)."""
    t = table(cc)
    if not t or not text:
        return None, None
    hits = list(_hits(t["keys"], text))
    if not hits:
        return None, None
    exp = {expect} if isinstance(expect, str) else set(expect or ())
    want = {i for i, r in enumerate(t["regions"]) if r in exp} or None
    if want:
        hits = [(f, n, [c for c in cands if c[0] in want] if any(c[0] in want for c in cands) else cands)
                for f, n, cands in hits]
    votes, total = defaultdict(float), 0.0
    for f, _, cands in hits:
        ws = [10 ** c[2] for c in cands]
        s = sum(ws)
        for c, w in zip(cands, ws):
            v = f * (w / s) * cands[0][2]
            key = c[0] if c[0] >= 0 else ("d", c[1])
            votes[key] += v
        total += f * cands[0][2]
    best = max(votes, key=votes.get)
    if votes[best] < 0.5 * total:
        return None, None
    if isinstance(best, tuple):                    # (a table without regions: the dept alone)
        return None, (None if region_only else t["depts"][best[1]][0])
    region = t["regions"][best]
    if want and best not in want and not any(f >= 3 and n >= 9 and any(c[0] == best and c[2] >= 2.4 for c in cands)
                                                      for f, n, cands in hits):
        return None, None
    if region_only:
        return region, None
    dv = defaultdict(float)
    for f, _, cands in hits:
        s = sum(10 ** c[2] for c in cands)            # (a name of many places counts for little)
        for c in cands:
            if c[0] == best and c[1] >= 0:
                dv[c[1]] += f * (10 ** c[2] / s) * c[2]
    if not dv:
        return region, None
    d = max(dv, key=dv.get)
    if dv[d] < 0.5 * sum(dv.values()):
        return region, None
    return region, t["depts"][d][0]

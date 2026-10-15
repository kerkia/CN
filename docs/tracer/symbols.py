"""Purple Pen's control description symbols (symbols.xml) as the JSON the Tracer reads in the browser.

Purple Pen (https://github.com/petergolde/PurplePen, src/PurplePenCore/symbols.xml) is BSD-licensed: its copyright
notice and licence travel with the data (site/assets/tracer/LICENSE-PurplePen.txt). Run once when that file changes:

    python docs/tracer/symbols.py <path to symbols.xml>

Writes site/assets/tracer/symbols.json (the drawings, the languages, the names and texts in French and English) and
site/assets/tracer/symbol-texts.json (the names and texts in every language, loaded when an event describes its
controls in another one). Coordinates stay Purple Pen's: a box of 200 x 200 units centred on 0, y up; instruction
lines (kinds W to Z) are 1600 units wide.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "assets" / "tracer"
MAIN_LANGS = ("fr", "en")


def num(v):
    f = float(v)
    return int(f) if f == int(f) else round(f, 3)


def points(el):
    out = []
    for p in el.findall("point"):
        out += [num(p.get("x")), num(p.get("y"))]
    return out


def drawing(el):
    """One drawing element as a compact list: [kind, ...parameters, points]."""
    tag = el.tag
    th = num(el.get("thickness", "0"))
    ends = "f" if el.get("ends") == "flat" else "r"
    corners = "s" if el.get("corners") == "sharp" else "r"
    if tag == "lines":
        return ["l", th, ends, corners, points(el)]
    if tag == "polygon":
        return ["p", th, corners, points(el)]
    if tag == "filled-polygon":
        return ["fp", points(el)]
    if tag == "circle":
        return ["c", th, num(el.get("radius")), points(el)]
    if tag == "filled-circle":
        return ["fc", num(el.get("radius")), points(el)]
    if tag == "beziers":
        return ["b", th, ends, points(el)]
    if tag == "filled-beziers":
        return ["fb", points(el)]
    return None


def text_entry(el):
    e = {"t": (el.text or "").strip()}
    if el.get("plural") == "true":
        e["p"] = 1
    for attr, key in (("gender", "g"), ("case", "c"), ("modified-case", "mc"), ("modifier-case", "mc")):
        if el.get(attr):
            e[key] = el.get(attr)
    return e


def main(src):
    root = ET.parse(src).getroot()
    languages = {}
    for el in root.findall("language"):
        lang = {"name": (el.text or "").strip()}
        for attr, key in (("plural-nouns", "pluralNouns"), ("plural-modifiers", "pluralModifiers"),
                          ("gender-modifiers", "genderModifiers"), ("cased-nouns", "casedNouns")):
            if el.get(attr) == "true":
                lang[key] = True
        if el.get("genders"):
            lang["genders"] = el.get("genders").split(",")
        if el.get("cases"):
            lang["cases"] = el.get("cases").split(",")
        languages[el.get("lang")] = lang

    symbols, texts = {}, {}
    for el in root.findall("symbol"):
        sid = el.get("id")
        s = {"id": sid, "k": el.get("kind")}
        if el.get("standard"):
            s["std"] = el.get("standard").split(",")
        if el.get("replacement-id"):
            s["repl"] = el.get("replacement-id")
        if el.get("size-is-depth") == "true":
            s["depth"] = 1
        g = [d for d in (drawing(c) for c in el) if d]
        if g:
            s["g"] = g
        names, tx = {}, {}
        for c in el:
            lang = c.get("lang")
            if c.tag == "name":
                names[lang] = (c.text or "").strip()
            elif c.tag == "text":
                tx.setdefault(lang, []).append(text_entry(c))
        s["n"] = {k: v for k, v in names.items() if k in MAIN_LANGS}
        s["t"] = {k: v for k, v in tx.items() if k in MAIN_LANGS}
        # the same symbol id can be listed twice (once per standard): keep both under distinct keys
        key = sid if sid not in symbols else f"{sid}@{','.join(s.get('std', []))}"
        symbols[key] = s
        texts[key] = {"n": names, "t": tx}

    head = ("Control description symbols from Purple Pen (https://github.com/petergolde/PurplePen), "
            "Copyright (c) 2006-2007, Peter Golde. BSD licence: see LICENSE-PurplePen.txt.")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "symbols.json").write_text(json.dumps({"notice": head, "languages": languages, "symbols": symbols},
                                                 ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "symbol-texts.json").write_text(json.dumps({"notice": head, "symbols": texts}, ensure_ascii=False,
                                                      separators=(",", ":")), encoding="utf-8")
    print(len(symbols), "symbols,", len(languages), "languages")


if __name__ == "__main__":
    main(sys.argv[1])

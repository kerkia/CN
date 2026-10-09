"""O'Cap's public data, from O'CN's built site data: what anyone may see without an account — no CN, no licence, no
score, no contact person. Run after O'CN's build (update.deploy does it before publishing O'Cap):

    python ocap/export.py --src site/data --out ocap/site/data

- soon.json: the agenda's competitions from today on (date, name, place, département, region, discipline, format,
  level, organiser, its website, the online registration's deadline and link, the announcement, the GPS point). Not
  the contacts, e-mails, phones, officials or free remarks.
- recent/index.json and recent/<race>.json: the last 60 days' races of « Récemment » and the results their organisers
  published: places, names, clubs, categories, times, statuses, split and start times. Not the licences, the matched
  runners, the provisional scores or CNs, FFCO's published figures, the years of birth or the bibs.
- recent/names.json: the runners' names of each race, normalised (« dupont marie »), to find a runner's races.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import unicodedata
from datetime import date
from pathlib import Path

SOON_KEYS = ("date", "name", "place", "dep", "region", "spec", "epr", "manif", "groupe", "org", "site", "invitation", "gps", "cancelled")
RACE_KEYS = ("key", "date_iso", "name", "place", "org", "terrain", "epreuve", "region", "site")
RUNNER_KEYS = ("place", "name", "club", "category", "time_s", "status", "splits", "start_s")
SOURCES = ("liveresultat", "winsplits", "heyries", "helga", "site", "upload")


def write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def name_key(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(sorted(w for w in re.split(r"[^a-z0-9]+", s) if w))


def soon(src: Path, out: Path) -> int:
    a = json.loads((src / "agenda.json").read_text(encoding="utf-8"))
    today = date.today().isoformat()
    events = []
    for e in a["events"]:
        if e.get("kind") != "c" or e.get("date", "") < today:
            continue
        x = {k: e[k] for k in SOON_KEYS if e.get(k) not in (None, "", [], False)}
        r = e.get("reg")
        if r:
            x["reg"] = {k: r[k] for k in ("url", "close", "closed", "count") if r.get(k) is not None}
        events.append(x)
    write(out / "soon.json", {"generated": a.get("generated"), "regions": a.get("regions", []), "depts": a.get("depts", {}),
                              "events": events})
    return len(events)


def recent(src: Path, out: Path) -> int:
    idx = json.loads((src / "prov" / "index.json").read_text(encoding="utf-8"))
    d = out / "recent"
    if d.exists():
        shutil.rmtree(d)
    races, names = [], {}
    for r in idx["races"]:
        x = {k: r[k] for k in RACE_KEYS if r.get(k) is not None}
        x.update({"runners": r.get("runners", 0), "splits": bool(r.get("splits")), "docs": r.get("docs", 0),
                  "sources": [s for s in r.get("sources", []) if s in SOURCES]})
        races.append(x)
        f = src / "prov" / f"{r['key']}.json"
        if not r.get("docs") or not f.exists():
            continue
        full = json.loads(f.read_text(encoding="utf-8"))
        docs, seen = [], set()
        for doc in full.get("docs", []):
            if not doc.get("classes"):
                continue
            classes = [{"name": k["name"], "length_m": k.get("length_m"), "climb_m": k.get("climb_m"), "controls": k.get("controls"),
                        "runners": [{f: p.get(f) for f in RUNNER_KEYS} for p in k["runners"]]} for k in doc["classes"]]
            for k in classes:
                for p in k["runners"]:
                    seen.add(name_key(p["name"]))
            docs.append({"source": doc.get("source"), "title": doc.get("title"), "kind": doc.get("kind"), "by": doc.get("by"),
                         "url": None if doc.get("source") == "upload" else doc.get("url"), "classes": classes})
        write(d / f"{r['key']}.json", {**{k: full.get(k) for k in RACE_KEYS if full.get(k) is not None}, "docs": docs})
        names[r["key"]] = sorted(seen)
    write(d / "index.json", {"generated": idx.get("generated"), "races": races})
    write(d / "names.json", names)
    return len(races)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="site/data")
    ap.add_argument("--out", default="ocap/site/data")
    a = ap.parse_args(argv)
    src, out = Path(a.src), Path(a.out)
    n1 = soon(src, out)
    n2 = recent(src, out)
    print(f"ocap export: {n1} upcoming races, {n2} recent races -> {out}")


if __name__ == "__main__":
    main()

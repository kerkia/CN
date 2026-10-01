"""The FFCO agenda of upcoming events, as one JSON file for the site (site/data/agenda.json).

Sources (all public, no login):
  * api.ffcorientation.fr/iframe/agenda/liste/      the courses, with the id of each one
  * api.ffcorientation.fr/iframe/courses/<id>/       one detail page per course (flèchage,
                                                     invitation, officials, link to the registration)
  * api.ffcorientation.fr/iframe/agenda/export/      the CSV export: every event incl. the
                                                     "entraînements/stages" and "formations/séminaires"
  * licences.ffcorientation.fr/inscriptions/         one page: closing dates and number of
                                                     registrants of every event open for registration

Run it by hand:   py -3 -m ffco_scraper.agenda --out site/data/agenda.json
update.py calls refresh() once a day (06:00 Paris time on GitHub).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html as htmllib
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

API = "https://api.ffcorientation.fr"
LICENCES = "https://licences.ffcorientation.fr"
UA = "ocn-agenda/1.0 (+https://ocn.kerkia.com; reads the public FFCO agenda once a day)"
WORKERS = 4
PAUSE = 0.15            # seconds each worker waits after a request: polite to a small federation server

# Regions (current ones) by department code; FFCO's own "ligues" mix old and new regions.
REGIONS = {
    "Auvergne-Rhône-Alpes": "01 03 07 15 26 38 42 43 63 69 73 74",
    "Bourgogne-Franche-Comté": "21 25 39 58 70 71 89 90",
    "Bretagne": "22 29 35 56",
    "Centre-Val de Loire": "18 28 36 37 41 45",
    "Corse": "20",
    "Grand Est": "08 10 51 52 54 55 57 67 68 88",
    "Hauts-de-France": "02 59 60 62 80",
    "Île-de-France": "75 77 78 91 92 93 94 95",
    "Normandie": "14 27 50 61 76",
    "Nouvelle-Aquitaine": "16 17 19 23 24 33 40 47 64 79 86 87",
    "Occitanie": "09 11 12 30 31 32 34 46 48 65 66 81 82",
    "Pays de la Loire": "44 49 53 72 85",
    "Provence-Alpes-Côte d'Azur": "04 05 06 13 83 84",
}
OUTRE_MER = "Outre-mer"
SPEC_ORDER = ["Pédestre", "VTT", "Ski", "Précision", "Raid Orientation", "Raid Multisport", "Pédestre + VTT"]   # as on FFCO


def _decode(b: bytes) -> str:
    try:
        return b.decode("utf-8-sig")
    except UnicodeDecodeError:
        return b.decode("cp1252")


def get(url: str, retries: int = 3) -> str:
    err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = _decode(r.read())
            time.sleep(PAUSE)
            return body
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url}: {err}")


def _clean(s: str | None) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", htmllib.unescape(s or "")).replace(" ", " ").strip()


def _iso(d: str) -> str | None:
    """dd/mm/yy or dd/mm/yyyy -> yyyy-mm-dd."""
    m = re.fullmatch(r"(\d\d)/(\d\d)/(\d{2}|\d{4})", d.strip())
    if not m:
        return None
    y = m.group(3)
    return f"{y if len(y) == 4 else '20' + y}-{m.group(2)}-{m.group(1)}"


def dept_of(place_with_dept: str) -> str:
    """'Lambesc (13)' -> '13'; Corsica's 2A/2B -> '20'."""
    m = re.search(r"\((\d{2,3}|2[AB])\)\s*$", place_with_dept or "")
    d = m.group(1) if m else ""
    return "20" if d in ("2A", "2B") else d


# ---- the courses: list pages -----------------------------------------------------------------------
def list_courses(du: str) -> list[dict]:
    out, page, last = [], 1, 1
    while page <= last:
        h = get(f"{API}/iframe/agenda/liste/?du={du}&page={page}")
        m = re.search(r"Page\s+(\d+)\s*/\s*(\d+)", h)
        last = int(m.group(2)) if m else 1
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", h, re.S):
            link = re.search(r'href="/iframe/courses/(\d+)/">(.*?)</a>', tr, re.S)
            tds = re.findall(r"<td>(.*?)</td>", tr, re.S)
            if not link or len(tds) < 6:
                continue
            date_s, cn, _name, place, spec, epr = (_clean(re.sub(r"<[^>]+>", "", x)) for x in tds[:6])
            place_txt = re.sub(r"\s*\([^)]*\)\s*$", "", place)
            out.append({"id": int(link.group(1)), "date": _iso(date_s), "cn": cn.lower() == "oui",
                        "name": _clean(link.group(2)), "place": place_txt, "dep": dept_of(place),
                        "spec": spec, "epr": epr})
        page += 1
    return out


# ---- one course: detail page ---------------------------------------------------------------------------
_LABELS = [  # (prefix of the accent-stripped lower-case label, key)
    ("manifestation", "manif"), ("groupe", "groupe"), ("organisateur", "org"), ("classement national", "cn_txt"),
    ("arbitre titulaire", "referee"), ("arbitre stagiaire", "referee2"), ("controleur", "controller"),
    ("delegu", "delegate"), ("flechage", "flechage"), ("site web", "site"), ("contact", "contact"),
    ("telephone", "phone"), ("invitation", "invitation"),
]


def _plain(label: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", label.lower()) if not unicodedata.combining(c)).strip()


def parse_detail(h: str) -> dict:
    body = h[h.find('<div id="body">'):]
    d: dict = {}
    # the e-mail is written by a script: take the text of the link it creates
    m = re.search(r"document\.write\('<a href=' \+ '\"mailto:' \+ x \+ '\">([^<]+)</a>'", body)
    if m:
        d["email"] = _clean(m.group(1))
    body = re.sub(r"<script.*?</script>", "", body, flags=re.S | re.I)
    # the registration button
    m = re.search(r'href="(https://licences\.ffcorientation\.fr/inscriptions/(\d+)/)"[^>]*>\s*Inscriptions', body)
    if m:
        d["reg_id"] = int(m.group(2))
    m = re.search(r"Observations\s*(?:&nbsp;| |\s)*:(.*?)</p>", body, re.S)
    if m:
        d["obs"] = "\n".join(_clean(x) for x in re.split(r"<br\s*/?>", m.group(1)) if _clean(re.sub(r"<[^>]+>", "", x)))
        d["obs"] = _clean_lines(d["obs"])
    for m in re.finditer(r"<p>\s*([^<:]{2,40}?)(?:&nbsp;| |\s)*:\s*(.*?)</p>", body, re.S):
        label = _plain(htmllib.unescape(m.group(1)))
        raw = m.group(2)
        href = re.search(r'href="([^"]+)"', raw)
        value = _clean(re.sub(r"<[^>]+>", "", raw))
        for prefix, key in _LABELS:
            if label.startswith(prefix):
                if key == "invitation" and href:
                    value = urllib.parse.urljoin(API, htmllib.unescape(href.group(1)))
                elif key == "site" and href:
                    value = htmllib.unescape(href.group(1))
                if value:
                    d.setdefault(key, value)
                break
    d.pop("cn_txt", None)
    return d


def _clean_lines(s: str) -> str:
    return "\n".join(l for l in (x.strip() for x in s.splitlines()) if l)


# ---- registrations ------------------------------------------------------------------------------------------
def registrations() -> dict[int, dict]:
    """Registration id -> closing date, modification deadline, number of registrants."""
    h = get(f"{LICENCES}/inscriptions/")
    out = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", h, re.S):
        link = re.search(r'href="/inscriptions/(\d+)/"', tr)
        cells = re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", tr, re.S)
        if not link or len(cells) < 7:
            continue
        txt = [_clean(re.sub(r"<[^>]+>", "", c[1])) for c in cells]
        closed = "red" in cells[4][0]
        n = re.sub(r"\D", "", txt[6])
        out[int(link.group(1))] = {
            "url": f"{LICENCES}/inscriptions/{link.group(1)}/",
            "close": _iso(txt[4]), "mods": _iso(txt[5]), "count": int(n) if n else None, "closed": closed,
        }
    return out


# ---- CSV export: trainings and training courses (no id there), and the cancelled courses ------------------------
def read_csv(types: str, du: str) -> list[dict]:
    s = get(f"{API}/iframe/agenda/export/?du={du}&types={types}")
    rows = list(csv.reader(io.StringIO(s), delimiter=";"))
    head = [_plain(x) for x in rows[0]]
    out = []
    for r in rows[1:]:
        if len(r) < len(head):
            continue
        x = dict(zip(head, r))
        out.append(x)
    return out


def _csv_event(x: dict, kind: str) -> dict:
    org = f"{x['code organisateur']} - {x['nom organisateur']}".strip(" -") if x.get("nom organisateur") else ""
    e = {
        "kind": kind, "date": _iso(x["date"]), "cn": x["cn"].strip().lower() == "oui", "name": _clean(x["nom"]),
        "place": _clean(x["lieu"]), "dep": x["departement"].strip(), "spec": _clean(x["specialite"]),
        "epr": _clean(x["epreuve"]), "groupe": _clean(x["groupe"]), "manif": _clean(x["manifestation"]), "org": _clean(org),
        "referee": _clean(x["arbitre"]), "referee2": _clean(x["arbitre stagiaire"]), "controller": _clean(x["controleur"]),
        "delegate": _clean(x["delegue"]), "contact": _clean(x["contact"]), "phone": _clean(x["tel"]),
        "email": _clean(x["e-mail"]), "site": _clean(x["site web"]), "obs": _clean_lines(x["observations"].replace("\r", "")),
        "cancelled": "annul" in x["validation"].lower(),
    }
    return {k: v for k, v in e.items() if v not in ("", None, False)} | {"cn": e["cn"]}


# ---- department names (from the search form) ----------------------------------------------------------------
def dept_names() -> dict[str, str]:
    h = get(f"{API}/iframe/agenda/chercher/")
    sel = re.search(r'<select name="comite".*?</select>', h, re.S)
    out = {}
    for m in re.finditer(r"<option value=\"\d+\">\s*([0-9AB]{2,3}) - (.*?)</option>", sel.group(0) if sel else "", re.S):
        out[m.group(1)] = _clean(m.group(2))
    return out


# Some trainings/formations are filed under a ligue (a region), not a department.
LIGUES = {"AR": "Auvergne-Rhône-Alpes", "GE": "Grand Est", "PZ": "Provence-Alpes-Côte d'Azur"}


def _fold(name: str) -> str:
    return _plain(name)


def locate(events: list[dict], names: dict[str, str]) -> tuple[dict[str, str], list[dict]]:
    """Give each event its `region`, drop non-department codes from `dep`, and list the
    departments and regions that actually have events (for the page's filters)."""
    by_dept = {d: region for region, ds in REGIONS.items() for d in ds.split()}
    used: dict[str, set[str]] = {}
    for e in events:
        dep = e.get("dep", "")
        if dep in LIGUES:
            region, dep = LIGUES[dep], ""
        elif dep in by_dept:
            region = by_dept[dep]
        elif dep.isdigit() and int(dep) >= 96:
            region = OUTRE_MER
        else:
            region, dep = "", ""
        e.pop("dep", None)
        if dep:
            e["dep"] = dep
        if region:
            e["region"] = region
            used.setdefault(region, set())
            if dep:
                used[region].add(dep)
    depts = {d: names.get(d, d) for ds in used.values() for d in ds}
    regions = [{"name": n, "depts": sorted(ds)} for n, ds in
               sorted(used.items(), key=lambda kv: (kv[0] == OUTRE_MER, _fold(kv[0])))]
    return depts, regions


# ---- assemble --------------------------------------------------------------------------------------------------------
def build(du: str | None = None) -> dict:
    du = du or date.today().isoformat()
    courses = list_courses(du)
    cancelled = {(_iso(x["date"]), _clean(x["nom"])) for x in read_csv("cou", du) if "annul" in x["validation"].lower()}
    regs = registrations()

    def one(c: dict) -> dict:
        try:
            det = parse_detail(get(f"{API}/iframe/courses/{c['id']}/"))
        except RuntimeError:
            det = {}
        return det

    with ThreadPoolExecutor(WORKERS) as pool:
        details = list(pool.map(one, courses))
    events = []
    for c, det in zip(courses, details):
        e = {"kind": "c", **c, **{k: v for k, v in det.items() if k != "reg_id"}}
        if (c["date"], c["name"]) in cancelled:
            e["cancelled"] = True
        reg = regs.get(det.get("reg_id"))
        if det.get("reg_id"):
            e["reg"] = reg or {"url": f"{LICENCES}/inscriptions/{det['reg_id']}/"}
        events.append(e)
    for types, kind in (("ent", "e"), ("for", "f")):
        events += [_csv_event(x, kind) for x in read_csv(types, du)]
    events = [e for e in events if e.get("date")]
    events.sort(key=lambda e: (e["date"], e["name"].lower()))
    depts, regions = locate(events, dept_names())
    return {
        "from": du,
        "specs": [x for x in SPEC_ORDER if any(e.get("spec") == x for e in events)]
                 + sorted({e["spec"] for e in events if e.get("spec") and e["spec"] not in SPEC_ORDER}),
        "depts": depts,
        "regions": regions,
        "events": events,
    }


def _digest(a: dict) -> str:
    """Hash of everything but the generation time."""
    return hashlib.sha256(json.dumps({k: v for k, v in a.items() if k != "generated"}, sort_keys=True,
                                     ensure_ascii=False).encode()).hexdigest()


def refresh(out: Path, du: str | None = None) -> bool:
    """Rebuild the agenda; write it only if its content changed. True when it did."""
    new = build(du)
    old = None
    try:
        old = json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if old and _digest(old) == _digest(new):
        return False
    new["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path("site/data/agenda.json"))
    ap.add_argument("--from", dest="du", default=None, help="first day (yyyy-mm-dd), default today")
    args = ap.parse_args()
    t0 = time.monotonic()
    changed = refresh(args.out, args.du)
    a = json.loads(args.out.read_text(encoding="utf-8"))
    kinds = {k: sum(1 for e in a["events"] if e["kind"] == k) for k in "cef"}
    print(f"agenda: {len(a['events'])} events (courses {kinds['c']}, trainings {kinds['e']}, formations {kinds['f']}); "
          f"{'written' if changed else 'unchanged'} in {time.monotonic() - t0:.0f}s -> {args.out}")


if __name__ == "__main__":
    main()

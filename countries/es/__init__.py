"""Spain: the Spanish federation's (FEDO) calendar and every public source of results.

Sources (studied 2026-10-20/22):
- SICO (sico.fedo.org, countries/es/sico.py): the federation's calendar and registrations — events, stages, places,
  organisers, registration windows, announcements, the public entry lists;
- O-Replay (oreplay.es, ffco_scraper/prov/sources/oreplay.py): results and split times by API, regional and national
  races since 2024;
- fedo.org: the Liga Española's results (OE12 HTML) and ranking files; the regional federations' sites; liveresultat and
  WinSplits as for France.

Every Spanish result is public, so is what Ozimut computes from them: Spain's data is open to every account (owner,
2026-10-22). A runner is es + a number of Ozimut's (no licence in the results lists).
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

import paths
from countries.base import Country

COUNTRY = Country(
    code="ES", federation="FEDO", access="all", db=paths.DATA_DIR / "es.sqlite3",
    time_zones=("Europe/Madrid", "Atlantic/Canary"), official="fedo_leo",
    # tuned on Spain's races (owner, 2026-10-22; scratch es_eval.py / es_cmp.py, July 2025 - October 2026, the same runners):
    # forest circuits valued on the fastest two-thirds (+0.41 [0.26, 0.55] point of duels over 90 %); 2 races for an index
    # (sprint +0.67 [0.26, 1.03], forest level), France's rule too since 2026-10-23. A 24-month window lost 1.1-1.6.
    method_params={"by_terrain": {"Forêt": {"sample_fraction": 2 / 3}}},
)
# the agenda's version: a new one rebuilds it whole (2: O-Replay's multi-day totals, « Overall » stages, left out, 2026-10-22)
AGENDA_VERSION = 2
BACK_DAYS = 65            # the races of the last weeks stay in the agenda's file: the provisional results look for their results
FRESH_DAYS = 3            # an event older than this is not read again (its page no longer changes)

# SICO's « Modalidad » -> the agenda's discipline (FFCO's words, which the site shows in the reader's language) and kind
SPEC = {"o-pie": "Pédestre", "mbto": "VTT", "mtbo": "VTT", "trail-o": "Trail-O", "o-sky": "Ski",
        "raid aventura": "Raid Multisport"}
KIND = {"curso": "f", "concentracion": "e"}
# the formats a name says (Spanish, Catalan, Galician): the agenda's « epreuve »
# (the distances before « city »: « Larga (City Race) » is a long distance)
FORMATS = [("Relais", r"\brelevos?\b|\brelleus?\b|\bremudas?\b"), ("Nuit", r"\bnoche\b|\bnocturn[oa]\b|\bnit\b|\bnoite\b"),
           ("MD", r"\bmedia\b|\bmitjana\b|\bmd\b|\bmiddle\b"), ("LD", r"\blarga\b|\bllarga\b|\blonga\b|\bld\b|\blong\b"),
           ("Sprint", r"\bsprint\b|\bk\.?o\.?\b|\bcity\b|\burban[oa]?\b")]
# a stage's name as SICO lists it once per league (« FEMADO: E1 - Media distancia / solo Madrid », « NACIONAL: E1 - Media
# distancia »): the league before the colon, who may enter after the slash
STAGE_LEAGUE = re.compile(r"^\s*[A-ZÁÉÍÓÚÑ0-9 .'-]{2,}:\s*")
STAGE_WHO = re.compile(r"\s*/\s*solo\b.*$", re.I)
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[0-9A-Z]{4}){4,7}\b")


def agenda_path(root: Path) -> Path:
    return COUNTRY.data_dir(root) / "agenda.json"


def _fold(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def modality(text: str, *words: str) -> tuple[str, str]:
    """SICO's « Modalidad » (« O-Pie », « o-pie,trail-o », « Concentración ») -> (the agenda's discipline, its kind). A
    rogaine (its league or name says so) is not a race against the clock: its own discipline."""
    parts = [_fold(x) for x in (text or "").split(",") if x.strip()]
    kind = next((KIND[p] for p in parts if p in KIND), "c")
    spec = next((SPEC[p] for p in parts if p in SPEC), parts[0].title() if parts and kind == "c" else "")
    if re.search(r"\brogain", _fold(" ".join(w or "" for w in words))):
        spec = "Rogaining"
    return spec, kind


def fmt_of(*names: str) -> str:
    """The format the first of the names that says one says (a stage's own name before its event's: Segovia's « City
    Race » has a « Media distancia » stage)."""
    for n in names:
        low = _fold(n or "")
        got = next((f for f, rx in FORMATS if re.search(rx, low)), "")
        if got:
            return got
    return ""


def terrain(spec: str, epr: str) -> str | None:
    if spec == "VTT":
        return "VTT"
    if spec == "Ski":
        return "Ski"
    if spec == "Pédestre":
        return "Sprint" if epr == "Sprint" else "Forêt"
    return None


# words that never tell two Spanish events apart
GENERIC = {"de", "del", "la", "el", "los", "las", "y", "e", "en", "a", "al", "trofeo", "liga", "orientacion", "carrera",
           "campeonato", "prueba", "distancia", "media", "larga", "sprint", "o", "pie", "club", "i", "ii", "iii", "iv", "v",
           "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx", "2025", "2026",
           "2027", "regional", "nacional", "espana", "espanola", "ciudad", "city", "race", "jornada", "etapa", "dia"}


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", _fold(s)) if w not in GENERIC and len(w) > 1}


def similar(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / max(1, min(len(wa), len(wb))) if wa and wb else 0.0


def _place(s: str) -> tuple[str, str | None]:
    """« Málaga (Málaga) » -> ("Málaga", "29")."""
    from .places import province
    m = re.match(r"^(.*?)\s*\(([^()]+)\)\s*$", s or "")
    return (m.group(1).strip(), province(m.group(2))) if m else ((s or "").strip(), None)


def _sico_rows(ev_list: dict, ev: dict | None) -> list[dict]:
    """A SICO event -> its agenda rows: one per stage (« Pruebas »), the event's own when it has one stage."""
    from . import sico
    from .places import community
    ev = ev or {}
    spec, kind = modality(ev_list.get("modality") or ev.get("modality") or "", ev_list.get("league"), ev_list.get("name"))
    place, dep = _place(ev_list.get("place") or "")
    start = ev.get("date") or ev_list.get("date")
    if not start:
        return []
    stages = merge_stages(ev.get("stages") or [{"name": ev_list.get("name"), "league": ev_list.get("league"), "day": 1}],
                          ev_list.get("name") or "")
    entries = ev.get("entries") or []
    base = {
        "kind": kind, "country": "ES", "place": place or ev.get("place"), "dep": dep, "region": community(dep),
        "spec": spec, "league": ev_list.get("league") or ev.get("league") or None, "org": ev_list.get("org") or ev.get("org"),
        "site": ev.get("site") or None, "email": ev.get("email") or None, "invitation": ev.get("invitation"),
        "obs": IBAN.sub("…", ev.get("obs") or "") or None, "src": {"sico": sico.event_url(ev_list["id"])}, "cn": False,
    }
    rows = []
    for i, st in enumerate(stages):
        day = (date.fromisoformat(start) + timedelta(days=max(0, (st.get("day") or 1) - 1))).isoformat()
        name = ev_list.get("name") or ev.get("name") or ""
        if len(stages) > 1 and st.get("name") and _fold(st["name"]) != _fold(name):
            name = f"{name} — {st['name'].title() if st['name'].isupper() else st['name']}"
        epr = fmt_of(st.get("name"), ev_list.get("name"))
        names = {_fold(x) for x in st.get("names") or [st.get("name") or ""]}
        count: dict[str, int] = {}
        for s_, c, n in entries:
            if not s_ or len(stages) == 1 or _fold(s_) in names:
                count[c] = count.get(c, 0) + n
        mine = [[c, n] for c, n in sorted(count.items())]
        reg = {"url": sico.event_url(ev_list["id"]), "close": ev.get("reg_close"), "closed": not ev.get("open", True),
               "count": sum(n for _, n in mine) if mine else None, "circuits": mine or None} if kind == "c" else None
        rows.append({**base, "id": f"es{ev_list['id']}" + (f"-{i + 1}" if len(stages) > 1 else ""), "date": day, "name": name,
                     "epr": epr, "terrain": terrain(spec, epr), "reg": reg})
    return rows


def merge_stages(stages: list[dict], event: str) -> list[dict]:
    """SICO's stages, one per race: a race listed once per league (the same day, the same format) is one stage, its name
    without the league nor who may enter; the names it was listed under kept (`names`: its entries are counted under them)."""
    out: list[dict] = []
    for st in stages:
        raw = st.get("name") or ""
        clean = STAGE_WHO.sub("", STAGE_LEAGUE.sub("", raw)).strip(" -") or raw
        fmt = fmt_of(clean, event)
        twin = next((o for o in out if o["day"] == (st.get("day") or 1) and o["fmt"] == fmt and fmt), None)
        if twin:
            twin["names"].append(raw)
            continue
        out.append({**st, "name": clean, "names": [raw], "fmt": fmt, "day": st.get("day") or 1})
    return out


def _oreplay_row(st: dict) -> dict:
    from .places import REGION_CODES
    ev = st["event"]
    org = ev.get("organizer") or {}
    low = _fold(st["name"])
    spec = "VTT" if re.search(r"\bmtb-?o\b|\bbtt\b|\bmtbo\b", low) else "Trail-O" if "trail" in low else "Pédestre"
    epr = fmt_of(st.get("stage"), ev.get("description"))
    return {"kind": "c", "id": "eso" + st["id"].split("/")[-1].replace("-", "")[:12], "country": "ES", "date": st["date"],
            "name": st["name"], "place": None, "dep": None,
            "region": REGION_CODES.get(org.get("region_code") or "") or org.get("region"), "spec": spec, "epr": epr,
            "terrain": terrain(spec, epr), "org": org.get("name"), "site": ev.get("website") or None, "cn": False,
            "src": {"oreplay": st["id"]}}


def build(http, today: date, prev: dict | None = None) -> dict:
    """Spain's agenda: SICO's events (stage by stage) with O-Replay's merged into them, O-Replay's own after; the
    events of the last BACK_DAYS days kept. `prev`: the last build (its older events are not read again)."""
    from . import sico
    from .places import depts, regions
    from ffco_scraper.prov.sources.oreplay import OReplay
    since = (today - timedelta(days=BACK_DAYS)).isoformat()
    fresh = (today - timedelta(days=FRESH_DAYS)).isoformat()
    old = {e["id"]: e for e in (prev or {}).get("events", []) if e.get("date", "") >= since}
    # the calendar: from today on, and the past months (all of them the first time; else the last days' month)
    m0 = date.fromisoformat(since if not old else fresh)
    months = sorted({(m0 + timedelta(days=d)).strftime("%Y-%m") for d in range((today - m0).days + 1)})
    rows: list[dict] = []
    seen_old: set[str] = set()
    for r in sico.read_calendar(http, months):
        if not r.get("date") or r["date"] < since:
            continue
        mine = [e for k, e in old.items() if k == f"es{r['id']}" or k.startswith(f"es{r['id']}-")]
        if mine and r["date"] < fresh:                 # past and known: as it was
            rows += mine
            seen_old.update(e["id"] for e in mine)
            continue
        rows += _sico_rows(r, sico.read_event(http, r["id"]))
    # O-Replay: its events of Spain (a few say no country; their time zone does), stage by stage
    o = OReplay(http)
    stages = []
    for ev in o.events(since):
        if (ev.get("country_code") or ("ES" if (ev.get("timezone") or "") in COUNTRY.time_zones else None)) != "ES":
            continue
        known = [e for e in old.values() if (e.get("src") or {}).get("oreplay", "").startswith(ev["id"] + "/")]
        if known and (ev.get("final_date") or ev.get("initial_date") or "") < fresh:
            stages += [{"id": e["src"]["oreplay"], "name": e["name"], "date": e["date"], "event": ev, "stage": "", "_row": e}
                       for e in known]
            continue
        stages += o.stages(ev)
    for st in stages:
        twin = max((r for r in rows if r["date"] == st["date"] and r["kind"] == "c"),
                   key=lambda r: similar(r["name"], st["name"]) + 0.5 * similar(r.get("org") or "", st.get("organizer") or ""),
                   default=None)
        if twin and (similar(twin["name"], st["name"]) >= 0.34 or similar(twin.get("org") or "", st.get("organizer") or "") >= 0.5):
            twin["src"] = {**twin.get("src", {}), "oreplay": st["id"]}
            twin["site"] = twin.get("site") or st["event"].get("website") or None
        elif st.get("_row"):
            rows.append(st["_row"])
        else:
            rows.append(_oreplay_row(st))
    rows.sort(key=lambda e: (e["date"], e.get("name") or ""))
    clean = [{k: v for k, v in e.items() if v not in (None, "", [], {})} for e in rows]
    for e in clean:
        e.setdefault("cn", False)
    return {"v": AGENDA_VERSION, "country": "ES", "from": since, "generated": _now(),
            "specs": sorted({e["spec"] for e in clean if e.get("spec")}), "depts": depts(), "regions": regions(),
            "events": clean}


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def refresh_agenda(root: Path, today: date | None = None) -> bool:
    """SICO and O-Replay -> site/data/es/agenda.json; True when it changed (its build time apart)."""
    from countries.http import Http
    path = agenda_path(root)
    try:
        prev = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prev = None
    if prev and prev.get("v") != AGENDA_VERSION:
        prev = None
    with Http(pause=0.8) as http:
        new = build(http, today or date.today(), prev)
    if not new["events"] and prev and prev.get("events"):
        print("agenda ES: nothing read (a source down?) — the last one kept")
        return False
    same = prev and {k: v for k, v in prev.items() if k != "generated"} == {k: v for k, v in new.items() if k != "generated"}
    if same:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"agenda ES: {len(new['events'])} events, {http.requests} requests")
    return True


def agenda_current(root: Path) -> bool:
    try:
        return json.loads(agenda_path(root).read_text(encoding="utf-8")).get("v") == AGENDA_VERSION
    except (OSError, ValueError):
        return False

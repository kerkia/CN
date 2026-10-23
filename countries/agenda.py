"""The agenda of a country whose calendar is all Ozimut reads of it (2026-10-23: the IOF's member countries with a clean
source — a public API, an export or a plain list —, after France's FFCO and Spain's SICO).

A country module of that kind holds its `COUNTRY`, its `AGENDA_VERSION`, a `read(http, today) -> list[dict]` that returns
its events in the agenda's shape (`event` below), and the three hooks update.py calls, made here:

    refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={...})

The file is site/data/<cc>/agenda.json, the shape France's and Spain's have (pages/agenda.js reads all three alike):
{ v, country, from, generated, specs, depts, regions, sources, events }. `sources` names the sites an event's `src` links
to (« Voir sur Eventor »). The races of the last BACK_DAYS days stay, as Spain's.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BACK_DAYS = 65

# the agenda's disciplines (FFCO's words; the page shows them in the reader's language)
FOOT, MTBO, SKI, TRAIL = "Pédestre", "VTT", "Ski", "Trail-O"
# the formats (the agenda's « epreuve »)
SPRINT, MIDDLE, LONG, NIGHT, RELAY = "Sprint", "MD", "LD", "Nuit", "Relais"


def fold(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c)).lower()).strip()


# words naming a format or a discipline in the languages met (English, German, the Nordic languages, Czech, Italian…);
# `fmt_of` / `spec_of` read a name with them when a source gives no field of its own
FORMATS = [
    (RELAY, r"\brela(?:y|is)\b|\bstaffel|\baflossing|\bestafet|\bstafet|\bщафет|\bэстафет|\bестафет|\bviesti\b|\bstafeta\b|\bstafety\b|\bstaffetta\b|\bsztafeta\b|\bváltó\b|\bteatevõistlus\b|リレー|接力|שליחים"),
    (NIGHT, r"\bnight\b|\bnacht\b|\bnatt\b|\bnat\b|\byö\b|\bnoční\b|\bnočn|\bnotturn|\bnocn|\béjszakai\b|\böö\b|ナイト|夜間|\bнощ|\bночн|\bнічн"),
    (SPRINT, r"\bsprint|\bknock-?out\b|\bk\.?o\.?\b|\bcity race\b|スプリント|短距離|\bспринт|ספרינט"),
    (MIDDLE, r"\bmiddle\b|\bmiddel\b|\bmitteldistanz|\bmedel\b|\bmellom|\bkeskimatka\b|\bkrátk|\bmittel\b|\bmedia\b|\bmd\b|\bsrednj|\bśredni|\bstredn|ミドル|中距離|\bсредн|\bсередн"),
    (LONG, r"\blong\b|\blangdistanz|\blång\b|\blang\b|\bpitkä|\bklasick|\bdlouh|\blunga\b|\bld\b|\bdolg|\bdług|\bdlh|ロング|長距離|\bдълг|свръхдълг|\bдлинн|\bудлин|\bдовг|\bклассик"),
]
SPECS = [
    (MTBO, r"\bmtb-?o\b|\bmtbo\b|\bbike-?o\b|\bcykel-?o|\bsykkel-?o|\bmtb\b|\bpp-?o\b|\brasteilysuunnistus\b|\bmountain ?bike\b|\bbtt\b|\bмт[бв]о\b|\bвело"),
    (SKI, r"\bski-?o\b|\bskio\b|\bski\b|\bskid-?o|\bhiihtosuunnistus\b|\blyž|\bsci-?o\b|\bski orienteering\b|\bски\b|\bлыж"),
    (TRAIL, r"\btrail-?o\b|\bprecision\b|\bpre-?o\b|\btempo-?o\b|沿徑|トレイルo"),
]


def fmt_of(*texts: str | None) -> str:
    for s in texts:
        low = f"{fold(s)} {unicodedata.normalize('NFKC', s or '').lower()}"     # (fold takes Japanese kana's marks off)
        got = next((f for f, rx in FORMATS if re.search(rx, low)), "")
        if got:
            return got
    return ""


def spec_of(*texts: str | None, default: str = FOOT) -> str:
    for s in texts:
        low = f"{fold(s)} {unicodedata.normalize('NFKC', s or '').lower()}"
        got = next((f for f, rx in SPECS if re.search(rx, low)), "")
        if got:
            return got
    return default


def terrain(spec: str, epr: str) -> str | None:
    """The ranking's discipline (cn_engine's terrains) of an agenda row, as Spain's."""
    if spec in (MTBO, SKI):
        return spec
    if spec == FOOT:
        return "Sprint" if epr == SPRINT else "Forêt"
    return None


# a name that says the event is off (« ***ABGESAGT*** 74. Baselbieter Team-OL », « ANNULÉ - … »): the word is taken out
OFF = re.compile(r"^\W*(?:abgesagt|annul[ée]e?|annullat[ao]|cancel+ed|zru[sš]en[oýa]?|odwo[lł]an[eya]?|afgelast|aflyst|"
                 r"inst[äa]llt|avlyst|peruttu|odpovedan[éeý]|odpovedané|otkazan[oa]?|anulat[aă]?|отмен[её]н[оа]?|скасован[оа]?)"
                 r"\b\W*", re.I)


def event(cc: str, id_, day: str, name: str, *, kind: str = "c", end: str | None = None, place: str | None = None,
          region: str | None = None, dep: str | None = None, org: str | None = None, spec: str | None = None,
          epr: str | None = None, site: str | None = None, level: str | None = None, src: dict | None = None,
          reg: dict | None = None, invitation: str | None = None, cancelled: bool = False, **more) -> dict:
    """One agenda row; the discipline and the format read from the name when not given. `id_`: the source's own id (the
    row's is the country's code then it: « se12345 »); `end`: the last day of a multi-day event given as one row;
    `level`: the source's own level or series (« Landesmeisterschaft », « Regional »), in its words."""
    name = re.sub(r"\s+", " ", name or "").strip()
    if OFF.match(name):
        cancelled, name = True, OFF.sub("", name).strip() or name
    spec = spec or spec_of(name, level)
    epr = epr if epr is not None else fmt_of(name)
    row = {"kind": kind, "id": f"{cc.lower()}{id_}", "country": cc.upper(), "date": day, "end": end if end and end > day else None,
           "name": name, "place": place, "region": region, "dep": dep, "org": org,
           "spec": spec, "epr": epr, "terrain": terrain(spec, epr), "level": level, "site": site, "src": src or None,
           "reg": reg, "invitation": invitation, "cancelled": cancelled or None, "cn": False, **more}
    return {k: v for k, v in row.items() if v not in (None, "", [], {})} | {"cn": False}


def hooks(country, read, version: int, *, sources: dict | None = None, regions: list | None = None, depts: dict | None = None):
    """The three functions update.py calls on a country's module: refresh_agenda(root), agenda_path(root),
    agenda_current(root). `read(http, today, prev)` returns the events (`prev`: the last file, or None; `read` may take
    `(http, today)` only); `regions`: [{name, depts: [...]}] and `depts` {code: name} when the source places its events."""
    import inspect
    wants_prev = len(inspect.signature(read).parameters) >= 3

    def agenda_path(root: Path) -> Path:
        return country.data_dir(root) / "agenda.json"

    def agenda_current(root: Path) -> bool:
        try:
            return json.loads(agenda_path(root).read_text(encoding="utf-8")).get("v") == version
        except (OSError, ValueError):
            return False

    def refresh_agenda(root: Path, today: date | None = None) -> bool:
        from countries.http import Http
        today = today or date.today()
        path = agenda_path(root)
        try:
            prev = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prev = None
        if prev and prev.get("v") != version:
            prev = None
        with Http(pause=1.0, lang=country.lang) as http:
            events = read(http, today, prev) if wants_prev else read(http, today)
            n = http.requests
        since = (today - timedelta(days=BACK_DAYS)).isoformat()
        events = [e for e in events if (e.get("end") or e["date"]) >= since]
        if not events and prev and prev.get("events"):
            print(f"agenda {country.code}: nothing read (its source down?) — the last one kept")
            return False
        seen, uniq = set(), []
        for e in sorted(events, key=lambda e: (e["date"], e.get("name") or "")):
            if e["id"] not in seen:
                seen.add(e["id"])
                uniq.append(e)
        new = {"v": version, "country": country.code, "from": since, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "specs": sorted({e["spec"] for e in uniq if e.get("spec")}), "depts": depts or {},
               # the source's regions, else those its events name (each without a finer level)
               "regions": regions or [{"name": r, "depts": []} for r in sorted({e["region"] for e in uniq if e.get("region")})],
               "sources": sources or {}, "events": uniq}
        if prev and {k: v for k, v in prev.items() if k != "generated"} == {k: v for k, v in new.items() if k != "generated"}:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"agenda {country.code}: {len(uniq)} events, {n} requests")
        return True

    return refresh_agenda, agenda_path, agenda_current


def ics(text: str) -> list[dict]:
    """An iCalendar file's events: {uid, start, end (the last day), summary, location, description, url}, all-day or not
    (a time in UTC is read as its day there)."""
    text = re.sub(r"\r?\n[ \t]", "", text)                          # folded lines
    out = []
    for block in re.findall(r"BEGIN:VEVENT\r?\n(.*?)END:VEVENT", text, re.S):
        ev = {}
        for line in block.splitlines():
            m = re.match(r"([A-Z-]+)((?:;[^:]*)?):(.*)", line)
            if m:
                ev[m.group(1)] = (m.group(2), m.group(3))

        def day(key):
            if key not in ev:
                return None
            v = ev[key][1]
            return f"{v[:4]}-{v[4:6]}-{v[6:8]}" if re.match(r"\d{8}", v) else None

        def txt(key):
            v = ev.get(key, ("", ""))[1]
            v = re.sub(r"\\[nN]", "\n", v)
            return re.sub(r"\\([,;\\])", r"\1", v).strip() or None

        start, end = day("DTSTART"), day("DTEND")
        if not start:
            continue
        if end and "VALUE=DATE" in ev["DTEND"][0] and end > start:   # an all-day event's end is the day after it
            end = (date.fromisoformat(end) - timedelta(days=1)).isoformat()
        out.append({"uid": txt("UID"), "start": start, "end": end if end and end > start else None,
                    "summary": txt("SUMMARY") or "", "location": txt("LOCATION"), "description": txt("DESCRIPTION"),
                    "url": txt("URL"), "status": txt("STATUS")})
    return out


# the IOF's member countries and a few others, in English: a place naming one is abroad (a federation's calendar also
# lists its runners' races abroad)
COUNTRY_NAMES = {
    "argentina", "australia", "austria", "azerbaijan", "belarus", "belgium", "bosnia", "brazil", "bulgaria", "canada", "chile",
    "china", "colombia", "croatia", "cyprus", "czechia", "czech republic", "denmark", "ecuador", "estonia", "finland",
    "france", "georgia", "germany", "great britain", "united kingdom", "scotland", "wales", "england", "greece", "hong kong",
    "hungary", "iceland", "india", "ireland", "israel", "italy", "japan", "kazakhstan", "korea", "latvia", "lithuania",
    "luxembourg", "macedonia", "north macedonia", "malta", "mexico", "moldova", "montenegro", "netherlands", "new zealand",
    "norway", "poland", "portugal", "romania", "russia", "serbia", "slovakia", "slovenia", "south africa", "spain", "sweden",
    "switzerland", "taiwan", "thailand", "turkey", "türkiye", "ukraine", "united states", "usa", "uruguay"}


def abroad(place: str | None, home: str) -> bool:
    """Does a place name another country than `home` (English, lower case)? « Veszprém, Hungary », « Sweden »."""
    low = fold(place)
    return any(re.search(rf"(?:^|[\s,(]){re.escape(c)}(?:$|[\s,)])", low) for c in COUNTRY_NAMES if c != home and fold(c) != home)

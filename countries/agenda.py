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
    (LONG, r"\blong\b|\blangdistanz|\blång\b|\blang\b|\bpitkä|\bklasick|\bdlouh|\blunga\b|\bld\b|\bdolg|\bdług|\bdlh|\bduge? staz|\bдолг|ロング|長距離|\bдълг|свръхдълг|\bдлинн|\bудлин|\bдовг|\bклассик"),
]
SPECS = [
    (MTBO, r"\bmtb-?o\b|\bmtbo\b|\bbike-?o\b|\bcykel-?o|\bsykkel-?o|\bmtb\b|\bpp-?o\b|\brasteilysuunnistus\b|\bmountain ?bike\b|\bbtt\b|\bмт[бв]о\b|\bвело"),
    (SKI, r"\bski-?o\b|\bskio\b|\bski\b|\bskid-?o|\bhiihtosuunnistus\b|\blyž|\bsci-?o\b|\bski orienteering\b|\bски\b|\bлыж"),
    (TRAIL, r"\btrail-?o\b|\bprecision\b|\bpre-?o\b|\btempo-?o\b|\btemp-o\b|沿徑|トレイルo"),
]


def _low(s: str | None) -> str:
    # (fold takes Japanese kana's marks off: both spellings; « open_sprint »: the underscore a space)
    return f"{fold(s)} {unicodedata.normalize('NFKC', s or '').lower()}".replace("_", " ")


def fmt_of(*texts: str | None) -> str:
    for s in texts:
        low = _low(s)
        got = next((f for f, rx in FORMATS if re.search(rx, low)), "")
        if got:
            return got
    return ""


def spec_of(*texts: str | None, default: str = FOOT) -> str:
    for s in texts:
        if re.search(r"\bTempO\b", s or ""):          # (written so: « tempo » alone is a word in Italian, Spanish…)
            return TRAIL
        low = _low(s)
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


def locate(cc: str, e: dict, *texts, keep_region: bool = False, expect=None, region_only: bool = False) -> dict:
    """Place an agenda row in its country's regions (countries/places.py): its `region` and `dep` from the first of
    `texts` (its `place` by default) that names a known place. `keep_region`: the row's region is the calendar's own
    (Switzerland's associations, Britain's): only the finer unit is added; `expect`: the region(s) the calendar's own
    region allows."""
    from countries import places
    for text in texts or (e.get("place"),):
        if not text or abroad_of(cc, text):
            continue
        r, d = places.locate(cc, text, expect=expect, region_only=region_only)
        if r or d:
            if r and not keep_region:
                e["region"] = r
            if d:
                e["dep"] = d
            return e
    return e


def _by_org(events: list[dict]) -> None:
    """A row the calendar does not place takes the region where its organiser's other rows all are (a club races at
    home): at least two of them, and no other region."""
    import collections
    seen = collections.defaultdict(collections.Counter)
    for e in events:
        if e.get("region") and e.get("org"):
            seen[e["org"]][e["region"]] += 1
    for e in events:
        c = seen.get(e.get("org")) if not e.get("region") else None
        if c and len(c) == 1 and sum(c.values()) >= 2:
            e["region"] = next(iter(c))


def places_of(cc: str, events: list[dict], order: list | None = None) -> tuple[list, dict]:
    """The file's `regions` [{name, depts}] and `depts` {code: name} from its rows: the regions they name, each with the
    finer units met in it (a unit under the region most of its rows give), sorted by name (or `order`)."""
    import collections
    from countries import places
    names = places.dept_names(cc)
    of = collections.defaultdict(collections.Counter)
    regs = set()
    for e in events:
        if e.get("region"):
            regs.add(e["region"])
            if e.get("dep"):
                of[e["dep"]][e["region"]] += 1
    by_region = collections.defaultdict(list)
    for d, c in of.items():
        by_region[c.most_common(1)[0][0]].append(d)
    rank = {r: i for i, r in enumerate(order or [])}
    regions = [{"name": r, "depts": sorted(by_region.get(r, []), key=lambda d: fold(names.get(d, d)))}
               for r in sorted(regs, key=lambda r: (rank.get(r, len(rank)), fold(r)))]
    return regions, {d: names.get(d, d) for d in of}


def hooks(country, read, version: int, *, sources: dict | None = None, regions: list | None = None, depts: dict | None = None,
          pause: float = 1.0, place=None, order: list | None = None):
    """The three functions update.py calls on a country's module: refresh_agenda(root), agenda_path(root),
    agenda_current(root). `read(http, today, prev)` returns the events (`prev`: the last file, or None; `read` may take
    `(http, today)` only); `regions`: [{name, depts: [...]}] and `depts` {code: name} when the source places its events;
    `pause`: the seconds between two requests to one host (a robots.txt's Crawl-delay). `place(e)`: sets an event's
    `region` and `dep` (by default `locate` on its place when the country has a table of places: countries/places);
    every row is placed again at each run, the rows kept from the last file too, so that a better table reaches them;
    `order`: the regions' order (else by name)."""
    import inspect
    from countries import places
    wants_prev = len(inspect.signature(read).parameters) >= 3
    if place is None and (places.DIR / f"{country.key}.json.gz").exists():     # (the table is read only when placing)
        def place(e):
            locate(country.code, e)

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
        with Http(pause=pause, lang=country.lang) as http:
            # (an earlier version's file still gives the past rows a calendar of coming events no longer lists)
            events = read(http, today, prev) if wants_prev else read(http, today)
            n = http.requests
        if prev and prev.get("v") != version:
            prev = None
        since = (today - timedelta(days=BACK_DAYS)).isoformat()
        events = [e for e in events if (e.get("end") or e["date"]) >= since]
        if place:
            for e in events:
                place(e)
            _by_org(events)
        if not events and prev and prev.get("events"):
            print(f"agenda {country.code}: nothing read (its source down?) — the last one kept")
            return False
        seen, uniq = set(), []
        for e in sorted(events, key=lambda e: (e["date"], e.get("name") or "")):
            if e["id"] not in seen:
                seen.add(e["id"])
                uniq.append(e)
        # the source's regions, else those its events name, each with the finer units met in it
        found_regions, found_depts = places_of(country.code, uniq, order)
        new = {"v": version, "country": country.code, "from": since, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "specs": sorted({e["spec"] for e in uniq if e.get("spec")}), "depts": depts or found_depts,
               "regions": regions or found_regions, "sources": sources or {}, "events": uniq}
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


# the countries' names in the calendars' own languages (German, Czech, Russian…) and their IOF codes, by country: a place
# naming another country's is not placed in the calendar's (« Godby (Finnland/Åland) », « Sopron (HUN) », « Швеция »)
NAMES_OF = {
    "AT": "österreich rakousko австрия AUT", "BE": "belgien belgique belgië BEL", "BG": "bulgarien българия BUL",
    "BY": "weißrussland беларусь белоруссия BLR", "CH": "schweiz suisse svizzera švýcarsko SUI",
    "CZ": "tschechien česko česká republika чехия CZE CZ", "DE": "deutschland německo niemcy германия GER",
    "DK": "dänemark danmark DEN", "EE": "estland eesti эстония EST", "FI": "finnland suomi финляндия FIN",
    "FR": "frankreich francie francja франция FRA", "HR": "kroatien hrvatska chorvatsko CRO",
    "HU": "ungarn magyarország maďarsko węgry венгрия HUN", "IT": "italien italia itálie włochy италия ITA",
    "LT": "litauen lietuva литва LTU", "LV": "lettland latvija латвия LAT", "NL": "niederlande nederland NED",
    "NO": "norwegen norge норвегия NOR", "PL": "polen polska polsko польша POL", "RU": "russland россия RUS",
    "SE": "schweden sverige švédsko szwecja швеция SWE", "SI": "slowenien slovenija slovinsko SLO",
    "SK": "slowakei slovensko słowacja словакия SVK SK", "UA": "ukraine україна украина UKR",
    "ES": "spanien españa испания ESP", "GB": "großbritannien britain GBR", "PT": "portugal POR",
    "RO": "rumänien românia румыния ROU", "RS": "serbien srbija сербия SRB"}
HOME = {"AT": "austria", "BE": "belgium", "BG": "bulgaria", "BY": "belarus", "CH": "switzerland", "CZ": "czechia",
        "DE": "germany", "DK": "denmark", "EE": "estonia", "GB": "united kingdom", "GE": "georgia", "HK": "hong kong",
        "HR": "croatia", "IE": "ireland", "IL": "israel", "IT": "italy", "JP": "japan", "KR": "korea", "LT": "lithuania",
        "MK": "north macedonia", "PL": "poland", "RO": "romania", "RS": "serbia", "SI": "slovenia", "SK": "slovakia",
        "TR": "türkiye", "UA": "ukraine", "ZA": "south africa"}
HOME_ALSO = {"GB": {"great britain", "scotland", "wales", "england"}, "CZ": {"czech republic"}, "TR": {"turkey"},
             "MK": {"macedonia"}}


def abroad_of(cc: str, place: str | None) -> bool:
    """Does a place of country `cc`'s calendar name another country (in English, in the calendar's language, by its code)?"""
    home = HOME.get(cc, "")
    if any(c != home and c not in HOME_ALSO.get(cc, ()) and re.search(rf"(?:^|[\s,(]){re.escape(c)}(?:$|[\s,)])", fold(place))
           for c in COUNTRY_NAMES):
        return True
    words = set(re.findall(r"\b[A-Z]{2,3}\b", place or ""))
    low = f" {fold(place)} "
    for other, names in NAMES_OF.items():
        if other == cc:
            continue
        for n in names.split():
            if (n.isupper() and n in words and re.search(rf"[(/,]\s*{n}\s*(?:[)/,]|$)", place or "")) or \
                    (not n.isupper() and f" {fold(n)} " in low):
                return True
    return False

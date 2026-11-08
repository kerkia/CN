"""« IOF WRE »: the IOF's World Ranking Events, every country's, as one more agenda (owner, 2026-11-04).

Not a country but listed as one (code XW, ISO 3166's user-assigned range): the site's country menu offers it first after the
account's own countries, and its agenda lists every WRE of the IOF's calendar. The source: the IOF World Ranking site's
calendar (ranking.orienteering.org/Calendar, a server-rendered list by year and discipline — forest, sprint, MTBO, ski-O,
trail-O —; studied 2026-11-04: no bot challenge, no robots.txt, unlike IOF Eventor), which gives each event's date, host
(the IOC's three-letter code), name, World Cup badge and status, nothing more. ~10 requests a day (this year and the next,
the last one too in its first months).

Each WRE is matched to its host country's own agenda row when Ozimut reads that country's calendar (the same day, the same
discipline, the name's words): the row's id (`same`), its place, organiser, website and registration are copied, so the
WRE list shows them, and the Agenda page tags that row « WRE » in the host country's list (pages/agenda.js); a WRE with no
match is added to the host country's list as a row of its own — a country whose calendar Ozimut cannot read (Sweden,
Norway, Finland…) gets an agenda of its WREs alone. This module runs after every other country's agenda
(countries.modules: last), so the matches read the day's files; it writes its own file only.
"""
from __future__ import annotations

import html as H
import re
from datetime import date
from pathlib import Path

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="XW", federation="IOF", access="all", db=paths.DATA_DIR / "xw.sqlite3", lang="en", results=False)
AGENDA_VERSION = 5                       # 2: the WREs placed on the maps (a town of their name, else their country's centre);
                                         # 3: France's centre was Clipperton Island's (worldplaces), none off its map any more;
                                         # 4: each WRE's page on IOF Eventor (`src.eventor`);
                                         # 5: IOF Eventor's list as copied by the owner (wre_eventor.tsv) adds what the
                                         #    ranking calendar lacks (2026-11-08)
SOURCE = "https://ranking.orienteering.org"
# a WRE's page on IOF Eventor, where its organiser gives the venue, website, entries and documents (owner, 2026-11-04: « POM 27
# has its own site »): the ranking site numbers its events as Eventor does, an event ranked in two lists (men's and women's)
# as 1 000 000 and 2 000 000 + its number. Eventor screens robots (a Cloudflare challenge): the link is for the reader's
# browser; Ozimut reads nothing there.
EVENTOR = "https://eventor.orienteering.sport/Events/Show/{}"
LIST = f"{SOURCE}/Calendar"
# the calendar's disciplines -> the agenda's discipline and format
DISCIPLINES = {"F": (agenda.FOOT, None), "FS": (agenda.FOOT, agenda.SPRINT), "M": (agenda.MTBO, None),
               "S": (agenda.SKI, None), "T": (agenda.TRAIL, None)}
# the IOC's codes the calendar uses -> ISO 3166-1 alpha-2 (the IOF's members and a few more)
IOC = {
    "ALG": "DZ", "ARG": "AR", "ARM": "AM", "AUS": "AU", "AUT": "AT", "AZE": "AZ", "BAR": "BB", "BEL": "BE", "BIH": "BA",
    "BLR": "BY", "BOL": "BO", "BRA": "BR", "BUL": "BG", "CAN": "CA", "CHI": "CL", "CHN": "CN", "COL": "CO", "CRC": "CR",
    "CRO": "HR", "CUB": "CU", "CYP": "CY", "CZE": "CZ", "DEN": "DK", "ECU": "EC", "EGY": "EG", "ESP": "ES", "EST": "EE",
    "FIN": "FI", "FRA": "FR", "GBR": "GB", "GEO": "GE", "GER": "DE", "GRE": "GR", "GUA": "GT", "HKG": "HK", "HUN": "HU",
    "INA": "ID", "IND": "IN", "IRI": "IR", "IRL": "IE", "ISL": "IS", "ISR": "IL", "ITA": "IT", "JPN": "JP", "KAZ": "KZ",
    "KEN": "KE", "KGZ": "KG", "KOR": "KR", "KOS": "XK", "LAT": "LV", "LTU": "LT", "LUX": "LU", "MAR": "MA", "MAS": "MY",
    "MDA": "MD", "MEX": "MX", "MGL": "MN", "MKD": "MK", "MLT": "MT", "MNE": "ME", "NED": "NL", "NOR": "NO", "NZL": "NZ",
    "PAK": "PK", "PER": "PE", "PHI": "PH", "POL": "PL", "POR": "PT", "PRK": "KP", "PUR": "PR", "ROU": "RO", "RSA": "ZA",
    "RUS": "RU", "SGP": "SG", "SLO": "SI", "SRB": "RS", "SRI": "LK", "SUI": "CH", "SVK": "SK", "SWE": "SE", "THA": "TH",
    "TPE": "TW", "TUN": "TN", "TUR": "TR", "UKR": "UA", "URU": "UY", "USA": "US", "UZB": "UZ", "VEN": "VE", "VIE": "VN"}
# IOF Eventor's list of the IOF's events, copied by hand from the owner's browser (owner, 2026-11-08: Eventor has the WREs a
# year and more ahead, the championships and the World Cup rounds, which the ranking calendar lists only later):
# countries/wre_eventor.tsv, Eventor's columns as pasted. Its events the ranking calendar already lists give that row
# Eventor's level (« Gold WRE ») and entry deadline; the others are added. Ozimut never reads Eventor itself.
EVENTOR_FILE = Path(__file__).resolve().parent / "wre_eventor.tsv"
EVENTOR_LIST = "https://eventor.orienteering.sport/events?mode=List"
# Eventor's organisers (a country in English, sometimes a body) -> ISO 3166-1 alpha-2; a body of no country: none
EVENTOR_HOST = {
    "argentina": "AR", "armenia": "AM", "australia": "AU", "austria": "AT", "azerbaijan": "AZ", "belarus": "BY",
    "belgium": "BE", "bosnia and herzegovina": "BA", "brazil": "BR", "bulgaria": "BG", "canada": "CA", "chile": "CL",
    "china": "CN", "chinese taipei": "TW", "colombia": "CO", "croatia": "HR", "cuba": "CU", "cyprus": "CY", "czechia": "CZ",
    "czech republic": "CZ", "denmark": "DK", "ecuador": "EC", "estonia": "EE", "finland": "FI", "france": "FR",
    "georgia": "GE", "germany": "DE", "great britain": "GB", "scottish orienteering association": "GB", "greece": "GR",
    "hong kong china": "HK", "hong kong": "HK", "hungary": "HU", "iceland": "IS", "india": "IN", "indonesia": "ID",
    "iran": "IR", "ireland": "IE", "israel": "IL", "italy": "IT", "japan": "JP", "kazakhstan": "KZ", "kenya": "KE",
    "korea": "KR", "korea, republic of": "KR", "kosovo": "XK", "kyrgyzstan": "KG", "latvia": "LV", "lithuania": "LT",
    "luxembourg": "LU", "malaysia": "MY", "malta": "MT", "mexico": "MX", "moldova": "MD",
    "moldova, republic of": "MD", "mongolia": "MN", "montenegro": "ME", "morocco": "MA", "netherlands": "NL",
    "new zealand": "NZ", "north macedonia": "MK", "norway": "NO", "pakistan": "PK", "philippines": "PH", "poland": "PL",
    "portugal": "PT", "romania": "RO", "russia": "RU", "russian federation": "RU", "serbia": "RS", "singapore": "SG",
    "slovakia": "SK", "slovenia": "SI", "south africa": "ZA", "spain": "ES", "sri lanka": "LK", "sweden": "SE",
    "switzerland": "CH", "thailand": "TH", "tunisia": "TN", "turkiye": "TR", "turkey": "TR", "ukraine": "UA",
    "united states": "US", "usa": "US", "uruguay": "UY", "uzbekistan": "UZ", "vietnam": "VN"}
# Eventor's « CF » (the format) -> the agenda's format (the sprint, middle, long; trail-O's and the mass start: none)
EVENTOR_CF = {"S": agenda.SPRINT, "KS": agenda.SPRINT, "M": agenda.MIDDLE, "L": agenda.LONG, "U": agenda.LONG}
EVENTOR_D = {"F": agenda.FOOT, "M": agenda.MTBO, "S": agenda.SKI, "T": agenda.TRAIL}
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
DAY = re.compile(r"^(\d{1,2}) ([A-Za-z]{3})(?: - (\d{1,2}) ([A-Za-z]{3}))?\t")
PRELIM = re.compile(r"^\(preliminary dates\)\s*-?\s*", re.I)

ROW = re.compile(r'datetime="(\d{4}-\d{2}-\d{2})".*?flag-([A-Z]{3}).*?ResultsView\?event=(\d+)">([^<]*)</a>(.*?)$', re.S)
# a matched row's fields the WRE list shows as its own
COPY = ("place", "org", "site", "reg", "invitation", "gps", "pos", "cancelled")
# words that say nothing of which event it is (« Orienteering », « WRE », a year, a format…)
STOP = set("""orienteering orientering orientierungslauf orientamento orientacion orientacao orientation suunnistus
    o wre world ranking event events iof the and und und der des les de la le el di del day stage etape etapa tag
    middle long sprint distance mtbo ski trail relay knock out knockout open race cup""".split())
ROOT: Path | None = None              # the site data's root, set by refresh_agenda (the other countries' agendas there)


def years(today: date) -> list[int]:
    """This year and the next, the last too while its events can still be within the agenda's BACK_DAYS."""
    return ([today.year - 1] if today.month <= 3 else []) + [today.year, today.year + 1]


def parse(text: str, disc: str) -> list[dict]:
    """The calendar page's rows: {date, ioc, id, name, wc, status}."""
    out = []
    for tr in re.findall(r"<tr>(.*?)</tr>", text, re.S):
        m = ROW.search(tr)
        if not m:
            continue
        badges = re.findall(r'badge[^"]*">([^<]+)<', m.group(5))
        out.append({"date": m.group(1), "ioc": m.group(2), "id": m.group(3), "name": H.unescape(m.group(4)).strip(),
                    "wc": "WCup" in badges, "status": next((b for b in badges if b != "WCup"), None), "disc": disc})
    return out


def words(s: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", agenda.fold(s)) if len(w) >= 3 and w not in STOP and not re.fullmatch(r"(19|20)\d\d", w)}


def host_events(cc: str) -> list[dict]:
    """The host country's own agenda rows (its calendar as Ozimut read it today), or none."""
    import json
    if ROOT is None:
        return []
    try:
        return json.loads((ROOT / cc.lower() / "agenda.json").read_text(encoding="utf-8")).get("events") or []
    except (OSError, ValueError):
        return []


MARK = re.compile(r"\bwre\b|world ranking|\biof\b", re.I)


def match(w: dict, events: list[dict]) -> dict | None:
    """The host country's agenda row of a WRE: a competition of that day (or one spanning it), the same discipline, the
    sprint apart from the forest (a multi-day row's format is its first stage's: not compared); among several, the one
    whose name shares the most words with the WRE's, a name saying « WRE » counting two. With no word shared, the only
    competition of the day, unless its format is known and another (2026-11-04: Brașov's national night race the day
    before its WRE; a name in the country's language often shares no word: « Eesti MV tavarada », « DM Ultralang »)."""
    cands = []
    for e in events:
        if e.get("kind", "c") != "c" or not e.get("id") or not (e["date"] <= w["date"] <= (e.get("end") or e["date"])):
            continue
        if e.get("spec") and e["spec"] != w["spec"]:
            continue
        if w["spec"] == agenda.FOOT and e.get("epr") and not e.get("end") and (e["epr"] == agenda.SPRINT) != (w.get("epr") == agenda.SPRINT):
            continue
        cands.append((len(words(e.get("name")) & words(w["name"])) + (2 if MARK.search(e.get("name") or "") else 0), e))
    if not cands:
        return None
    best = max(cands, key=lambda c: c[0])
    if best[0] > 0:
        return best[1]
    e = cands[0][1]
    return e if len(cands) == 1 and (e.get("end") or not e.get("epr") or e["epr"] == w.get("epr")) else None


# the world's towns and the countries' centres (tools/worldplaces.py), read once
_WORLD: dict | None = None
# words of a WRE's name that are towns somewhere but never its place
NOT_TOWN = set("""championship championships national nationals cup league open games meeting trophy festival tour week camp
    days sprint middle long night relay final finals masters junior juniors youth senior elite international""".split())


def world() -> dict:
    global _WORLD
    if _WORLD is None:
        import gzip
        import json
        f = Path(__file__).resolve().parent / "places" / "world.json.gz"
        try:
            _WORLD = json.loads(gzip.decompress(f.read_bytes()).decode("utf-8")).get("countries") or {}
        except (OSError, ValueError):
            _WORLD = {}
    return _WORLD


def position(cc: str, name: str) -> list | None:
    """Where a WRE with no place of its own is drawn on the Agenda's maps: a town its name gives — by the country's own table
    of places when Ozimut has one (countries/places), else among the world's towns of 5 000 people or more —, else its
    country's centre, an approximate place ([lat, lon, 1]); None for a country neither knows."""
    from countries import places
    # (the name without its generic words: « JK Day 2 - Middle » found a « Middle… » in Britain's table)
    bare = " ".join(w for w in re.split(r"[\s,;:()/–—-]+", name or "") if w and agenda.fold(w) not in STOP | NOT_TOWN and not w.isdigit())
    got = places.position(cc, bare) if bare and (places.DIR / f"{cc.lower()}.json.gz").exists() else None
    if got and got[2] == "town" and inside(cc, got[0], got[1]):
        return [got[0], got[1]]
    w = world().get(cc) or {}
    towns = w.get("t") or {}
    toks = [x for x in re.findall(r"[a-z0-9]+", agenda.fold(name))]
    best = None
    for n in (3, 2, 1):                              # « la clusaz », « hong kong » before a single word
        for i in range(len(toks) - n + 1):
            g = toks[i:i + n]
            if n == 1 and (len(g[0]) < 4 or g[0] in STOP or g[0] in NOT_TOWN or g[0].isdigit()):
                continue
            hit = towns.get(" ".join(g))
            if hit and (best is None or (n, hit[2]) > best[0]):
                best = ((n, hit[2]), hit)
    if best and inside(cc, best[1][0] / 100, best[1][1] / 100):
        return [best[1][0] / 100, best[1][1] / 100]
    c = w.get("c")
    if c and inside(cc, c[0] / 100, c[1] / 100):
        return [c[0] / 100, c[1] / 100, 1]
    box = frame(cc)                              # (a centre off the country's map: the map's own centre)
    return [round((box[1] + box[3]) / 2, 2), round((box[0] + box[2]) / 2, 2), 1] if box else None


_FRAMES: dict = {}


def frame(cc: str) -> list | None:
    """The country's map frame on the Agenda ([west, south, east, north], site/assets/geo/<cc>.json): its main land, overseas
    lands left out."""
    if cc not in _FRAMES:
        import json
        try:
            _FRAMES[cc] = json.loads((Path(__file__).resolve().parent.parent / "site" / "assets" / "geo" / f"{cc.lower()}.json")
                                     .read_text(encoding="utf-8"))["box"]
        except (OSError, ValueError, KeyError):
            _FRAMES[cc] = None
    return _FRAMES[cc]


def inside(cc: str, lat: float, lon: float) -> bool:
    """Is a position on the country's map (a place overseas is not: the map would leave it out)? True without a map."""
    b = frame(cc)
    return not b or (b[0] <= lon <= b[2] and b[1] <= lat <= b[3])


def eventor_rows(text: str | None = None) -> list[dict]:
    """The events of Eventor's list as pasted: {date, end, name, host, spec, epr, wre, wc, level, close}. Eventor writes
    « 10 Oct » with no year: the first row's year is the one that puts it nearest the day the list was copied (« # copied: »),
    each row then in the year of the row before, the next one when its month falls back by more than two (the list is in
    date order, a day out of it here and there). A cell of several lines (« World Ranking Event » then « Gold WRE ») comes as
    its lines, the row's other cells after the last."""
    from datetime import timedelta
    if text is None:
        try:
            text = EVENTOR_FILE.read_text(encoding="utf-8")
        except OSError:
            return []
    m = re.search(r"^# copied: (\d{4}-\d{2}-\d{2})", text, re.M)
    copied = date.fromisoformat(m.group(1)) if m else date.today()
    rows, cur = [], None
    for line in text.splitlines():
        if line.startswith("#") or line.startswith("Date\t"):
            continue
        if DAY.match(line):
            cur = [line]
            rows.append(cur)
        elif cur is not None and line.strip():
            cur.append(line)
    out, year, month = [], None, None
    for lines in rows:
        cells = "\n".join(lines).split("\t") + [""] * 9
        d1, m1, d2, m2 = DAY.match(lines[0]).groups()
        mo = MONTHS.get(m1.lower())
        if not mo:
            continue
        if year is None:
            year = min((copied.year - 1, copied.year, copied.year + 1),
                       key=lambda y: abs((date(y, mo, min(int(d1), 28)) - copied).days))
        elif mo < month - 2:
            year += 1
        month = mo
        try:
            day = date(year, mo, int(d1))
            end = None
            if d2:
                me = MONTHS[m2.lower()]
                end = date(year + (1 if me < mo else 0), me, int(d2))
        except (ValueError, KeyError):
            continue
        name, org, disc, kind, cf, ed = (c.strip() for c in (cells[1], cells[2], cells[4], cells[5], cells[6], cells[7]))
        types = [t.strip() for t in kind.split("\n") if t.strip()]
        level = [t for t in types if t not in ("World Ranking Event", "World Cup")]
        prelim = bool(PRELIM.match(name))         # (dates to be confirmed: a tag on the page, in the reader's language)
        name = PRELIM.sub("", name)
        spec = EVENTOR_D.get(disc) or agenda.spec_of(name)
        epr = EVENTOR_CF.get(cf) if spec != agenda.TRAIL else None
        close = None
        mm = re.match(r"(\d{1,2})/(\d{1,2})", ed)
        if mm:                                    # the entry deadline: the last such day before the event
            dd, dm = int(mm.group(1)), int(mm.group(2))
            for y in (day.year, day.year - 1):
                try:
                    c = date(y, dm, dd)
                except ValueError:
                    continue
                if c <= day and day - c < timedelta(days=366):
                    close = c.isoformat()
                    break
        out.append({"date": day.isoformat(), "end": end.isoformat() if end else None, "name": name,
                    "host": EVENTOR_HOST.get(agenda.fold(org)), "spec": spec, "epr": epr or None,
                    "wre": "World Ranking Event" in types, "wc": "World Cup" in types,
                    "level": " · ".join(level) or None, "close": close, "prelim": prelim})
    return out


def pair(ev: list[dict], cal: list[dict]) -> list[tuple[dict, dict | None]]:
    """Each Eventor event and the ranking calendar's row of it, or None: a row of the same host and discipline on that day
    (for an event of several days, any of its days); among several, the one whose name shares the most words, then the
    same format; one row to one event, except an event of several days, which covers every row of its days whose name
    shares a word with it (a championship's races are rows of their own on the calendar)."""
    used, out = set(), []
    for e in sorted(ev, key=lambda e: (e["end"] is not None, e["date"])):
        last = e["end"] or e["date"]
        cands = []
        for i, w in enumerate(cal):
            if w.get("host") != e["host"] or w.get("spec") != e["spec"] or not (e["date"] <= w["date"] <= last):
                continue
            n = len(words(w["name"]) & words(e["name"]))
            if e["end"]:
                if n:
                    cands.append((n, 0, -i))
            elif i not in used:
                cands.append((n, int(bool(e["epr"]) and w.get("epr") == e["epr"]), -i))
        if not cands:
            out.append((e, None))
            continue
        best = -max(cands)[2]
        if not e["end"]:
            used.add(best)
        out.append((e, cal[best]))
    return out


def read(http, today: date) -> list[dict]:
    rows, failed = [], 0
    for y in years(today):
        for disc in DISCIPLINES:
            a = http.get(LIST, params={"year": y, "discipline": disc})
            if a.status != 200:
                failed += 1
                continue
            rows += parse(a.text(), disc)
    if failed and not rows:
        return []
    seen, out, hosts = set(), [], {}
    for r in sorted(rows, key=lambda r: int(r["id"])):
        cc = IOC.get(r["ioc"])
        # the calendar lists an event once per ranking list (men's, women's): one row
        k = (r["disc"], r["date"], r["ioc"], agenda.fold(r["name"]))
        if k in seen:
            continue
        seen.add(k)
        spec, epr = DISCIPLINES[r["disc"]]
        e = agenda.event("XW", r["id"], r["date"], r["name"], spec=spec, epr=epr if epr is not None else (agenda.fmt_of(r["name"]) or None),
                         src={"iof": f"{SOURCE}/ResultsView?event={r['id']}", "eventor": EVENTOR.format(int(r["id"]) % 1_000_000)}, wre=True, wc=r["wc"] or None,
                         calculated=(r["status"] == "Calculated") or None, host=cc, ioc=r["ioc"] if not cc else None)
        out.append(settle(e, cc, hosts))
    # what Eventor's list adds: its level and entry deadline to the rows the calendar has, its other events as rows
    import hashlib
    for ev, w in pair(eventor_rows(), out):
        if w is not None:
            if ev["level"] and not w.get("level"):
                w["level"] = ev["level"]
            if ev["close"] and not w.get("reg"):
                w["reg"] = {"close": ev["close"]}
            continue
        key = hashlib.sha1(f"{ev['date']}|{ev['host']}|{ev['name']}".encode("utf-8")).hexdigest()[:10]
        e = agenda.event("XW", f"e{key}", ev["date"], ev["name"], end=ev["end"], spec=ev["spec"],
                         epr=ev["epr"] or (agenda.fmt_of(ev["name"]) or None), level=ev["level"],
                         src={"eventor": EVENTOR_LIST}, reg={"close": ev["close"]} if ev["close"] else None,
                         wre=ev["wre"] or None, wc=ev["wc"] or None, prelim=ev["prelim"] or None, host=ev["host"])
        out.append(settle(e, ev["host"], hosts))
    return out


def settle(e: dict, cc: str | None, hosts: dict) -> dict:
    """A WRE row matched to its host country's agenda row (its place, organiser, website… copied) and placed on the map."""
    if cc:
        hit = match(e, hosts.setdefault(cc, host_events(cc)))
        if hit:
            e["same"] = hit["id"]
            for f in COPY:
                if hit.get(f) not in (None, "", [], {}):
                    e[f] = hit[f]
    if cc and not e.get("pos") and not e.get("gps"):
        pos = position(cc, e["name"])
        if pos:
            e["pos"] = pos
    POS[e["id"]] = e.get("pos")
    return e


# each row's position as the last read gave it (its match's, a town of its name, its country's centre): the file's change
# check leaves positions out (countries/agenda.py `comparable`), so they are written after it, as the other agendas' are
POS: dict[str, list | None] = {}


def place_all(path: Path) -> bool:
    import json
    try:
        a = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    changed = False
    for e in a.get("events") or []:
        if e["id"] not in POS or e.get("pos") == POS[e["id"]]:
            continue
        changed = True
        if POS[e["id"]]:
            e["pos"] = POS[e["id"]]
        else:
            e.pop("pos", None)
    if changed:
        path.write_text(json.dumps(a, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        ev = a.get("events") or []
        print(f"agenda XW: placed on the map — {sum(1 for e in ev if e.get('pos') and len(e['pos']) == 2)} at a place, "
              f"{sum(1 for e in ev if e.get('pos') and len(e['pos']) == 3)} at their country's centre, of {len(ev)}")
    return changed


_refresh, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"iof": "IOF World Ranking", "eventor": "IOF Eventor"},
                                                      place=lambda e: None)


def refresh_agenda(root: Path, today: date | None = None) -> bool:
    global ROOT
    ROOT = root
    POS.clear()
    got = _refresh(root, today)
    return place_all(agenda_path(root)) or got

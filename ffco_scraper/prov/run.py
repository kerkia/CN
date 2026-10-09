"""One run of the provisional-results pilot: look at the races due, keep what was found, rebuild the admin's files.

    python -m ffco_scraper.prov --db <db> --out site/data [--days 31] [--budget 600]

update.py calls run() at each hourly run (a few minutes at most). The output, site/data/prov/ (index.json and
one <race key>.json per race), is served to administrators only (functions/_middleware.js).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import logging
import re
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from ..agenda import LIGUES, OUTRE_MER, REGIONS
from . import races, store
from .compute import Scorer
from .fetch import Fetcher
from .match import Matcher
from .model import plain
from .sources.clubsite import ClubSite, address_other_day, download_url, other_day, other_year, uploaded_before
from .sources.heyries import BASE as HY_BASE, Heyries
from .sources.helga import BASE as HG_BASE, Helga
from .sources import upload
from .sources.liveresultat import API as LR_API, LiveResultat
from .parsers import VERSION as PARSER_VERSION
from .sources.winsplits import BASE as WS_BASE, WinSplits

log = logging.getLogger(__name__)
KEEP_DAYS = 65                  # races kept and matched to the platforms' competitions: a few days beyond the list
SHOW_DAYS = 60                  # races listed on « Récemment » (its text says so; 30 until 2026-10-08)
MATCHED = "rapproché automatiquement (date, nom, organisateur)"
CATCH_UP = 4                    # budget multiplier while catching up


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- reading any document ----------------------------------------------------------------------------------
def parse_any(content: bytes, url: str, ctype: str = "") -> dict | None:
    """The first parser that reads it: PDFs, IOF XML, then HTML exports (OE, MeOS), then any HTML table."""
    head = content[:400].lstrip().lower()
    order = (["pdf"] if content[:5] == b"%PDF-" else
             ["iofxml"] if head.startswith(b"<?xml") or b"<resultlist" in head else
             ["oe_html", "meos_html", "html_generic"])
    for name in order:
        try:
            mod = __import__(f"ffco_scraper.prov.parsers.{name}", fromlist=["parse"])
        except ImportError:
            continue
        try:
            d = mod.parse(content, url)
        except Exception:                                     # a parser must never stop the run
            log.exception("parser %s failed on %s", name, url)
            d = None
        if d and d.get("classes"):
            return d
    return None


def save(con, race_key: str, url: str, source: str, parsed: dict | None, kind: str | None = None,
         sha: str | None = None, note: str | None = None) -> bool:
    """Record a document; True when it is new or changed."""
    now = _now()
    blob = json.dumps(parsed, ensure_ascii=False) if parsed else None
    sha = sha or (hashlib.sha1(blob.encode()).hexdigest() if blob else None)
    prev = con.execute("SELECT sha FROM prov_docs WHERE race_key = ? AND url = ?", (race_key, url)).fetchone()
    kind = kind or (parsed or {}).get("kind") or "unparsed"
    title = (parsed or {}).get("title")
    if prev and prev["sha"] == sha:
        con.execute("UPDATE prov_docs SET note = COALESCE(?, note) WHERE race_key = ? AND url = ?", (note, race_key, url))
        return False
    if prev:
        con.execute("UPDATE prov_docs SET kind=?, title=?, sha=?, parsed=?, changed_at=?, note=? WHERE race_key=? AND url=?",
                    (kind, title, sha, blob, now, note, race_key, url))
    else:
        con.execute("""INSERT INTO prov_docs (race_key, url, source, kind, title, sha, parsed, found_at, changed_at, note)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""", (race_key, url, source, kind, title, sha, blob, now, now, note))
    return True


def date_ok(parsed: dict | None, race) -> bool:
    """A document that prints another date is someone else's (an old edition, an earlier day of the weekend) — but a
    file is often exported the evening after, and prints that day (Larmor-Plage, 26/09, printed 27/09): up to 2 days
    later is the race's."""
    d = (parsed or {}).get("date")
    if not d:
        return True
    try:
        gap = (date.fromisoformat(d) - date.fromisoformat(race["date_iso"])).days
    except ValueError:
        return True
    return 0 <= gap <= 2


WEEKDAYS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


def not_this_race(race, text: str) -> bool:
    """A file whose name or printed title gives another format or another day of the week than the race's: the same
    organiser's other race (the Championnats de France week: « Chpt France LD » is not the « D88 MD »; « MD VTT » not a
    foot race; « Vertaco 2026 Samedi » not Sunday's)."""
    low = plain(text)
    says = {k for k, pat in (("vtt", r"\b(vtt|mtbo)\b"), ("ski", r"\bski\b"), ("Sprint", r"\bsprint"),
                             ("MD", r"\bmd\b|moyenne"), ("LD", r"\bld\b|longue")) if re.search(pat, low)}
    if "vtt" in says and race["terrain"] != "VTT" or "ski" in says and race["terrain"] != "Ski":
        return True
    formats = says & {"Sprint", "MD", "LD"}
    if formats and race["terrain"] not in ("VTT", "Ski") and race["epreuve"] in ("Sprint", "MD", "LD") \
            and race["epreuve"] not in formats:
        return True
    days = {w for w in WEEKDAYS if re.search(rf"\b{w}\b", low)}
    return bool(days) and WEEKDAYS[date.fromisoformat(race["date_iso"]).weekday()] not in days


# ---- one race ------------------------------------------------------------------------------------------------
def look(con, race, f: Fetcher, lr: LiveResultat, ws: WinSplits, hy: Heyries, cs: ClubSite, links: dict, reread: bool = False,
         hg: Helga | None = None) -> int:
    """links: the platform competitions assigned to this race ({'liveresultat': id, 'winsplits': id, …})."""
    changed = site_docs(con, race, f, lr, ws, hy, cs, reread, hg)
    matched = []
    # liveresultat and WinSplits: the competition of that day assigned to this race (races.assign)
    if links.get("liveresultat") and not f.out_of_time() and (lr.info(links["liveresultat"]).get("timezone") or "Europe/Paris") == "Europe/Paris":
        url = f"https://liveresultat.orientering.se/followfull.php?comp={links['liveresultat']}"
        matched.append(url)                   # kept even if emptied since: live results are cleared after the event
        d = lr.read(links["liveresultat"])
        if d and d["classes"]:
            changed += save(con, race["key"], url, "liveresultat", d, note=MATCHED)
        elif not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone():
            save(con, race["key"], url, "liveresultat", None, kind="empty", note=MATCHED)     # matched, nothing (left) to read
    if links.get("winsplits") and not f.out_of_time():
        url = f"{WS_BASE}/classes.asp?databaseId={links['winsplits']}"
        matched.append(url)
        fp = ws.fingerprint(links["winsplits"])
        prev = con.execute("SELECT sha FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone()
        unchanged = fp and prev and prev["sha"] == fp and not reread
        d = None if unchanged else ws.read(links["winsplits"])
        if d and d["classes"]:
            changed += save(con, race["key"], url, "winsplits", d, note=MATCHED, sha=fp)
        elif not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone():
            save(con, race["key"], url, "winsplits", None, kind="empty", note=MATCHED)     # matched, nothing (left) to read
    if links.get("heyries") and not f.out_of_time():
        url = f"{HY_BASE}/competition/{links['heyries']}/"
        matched.append(url)
        d = hy.read(links["heyries"])
        if d and d["classes"]:
            changed += save(con, race["key"], url, "heyries", d, note=MATCHED)
        elif not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone():
            save(con, race["key"], url, "heyries", None, kind="empty", note=MATCHED)     # matched, nothing (left) to read
    if links.get("helga") and hg and not f.out_of_time():
        url = f"{HG_BASE}/splitsbrowser.php?lauf={links['helga']}"
        matched.append(url)
        d = hg.read(links["helga"])
        if d and d["classes"]:
            changed += save(con, race["key"], url, "helga", d, note=MATCHED)
        elif not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone():
            save(con, race["key"], url, "helga", None, kind="empty", note=MATCHED)     # created, no results (yet)
    # an earlier match no longer chosen (a better race took it) is dropped
    con.execute(f"""DELETE FROM prov_docs WHERE race_key = ? AND note = ? AND url NOT IN ({",".join("?" * len(matched)) or "''"})""",
                (race["key"], MATCHED, *matched))
    return changed


_PARSED: dict = {}          # file content hash -> its parse, within one run


def place_words(race) -> set[str]:
    """The words naming a race's place (« Luxeuil (70) » -> luxeuil; « Le Pouldu Clohars Carnoet » -> pouldu…)."""
    return {w for w in re.findall(r"[a-z]{4,}", plain(re.sub(r"\(.*?\)", " ", race["place"] or "")))
            if w not in ("foret", "bois", "parc", "saint", "sainte", "sur", "les", "plage", "ville", "centre")}


def adopt(con, found_by, d: dict, url: str, text: str, sha: str | None) -> str | None:
    """A results file met while looking for one race but about another one of the fortnight (an organiser's site
    posting the week's results together: terres-do.fr's « MD - Luxeuil-les-Bains » found looking for the D88 races):
    it goes to the race whose place it names, whose day and format it fits — the VTT race if it says VTT, else the
    foot race. Returns that race's key, or None when no single race fits."""
    if not d or not d.get("classes"):
        return None
    label = f"{urllib.parse.unquote(url.rsplit('/', 1)[-1])} {text} {d.get('title') or ''}"
    low = plain(label)
    day = date.fromisoformat(found_by["date_iso"])
    near = con.execute("SELECT * FROM prov_races WHERE date_iso BETWEEN ? AND ? AND key != ?",
                       ((day - timedelta(days=7)).isoformat(), (day + timedelta(days=7)).isoformat(), found_by["key"])).fetchall()
    fits = [r for r in near if (not d.get("date") or d["date"] == r["date_iso"]) and date_ok(d, r)
            and any(w in low for w in place_words(r)) and not not_this_race(r, label)
            and not address_other_day(url, date.fromisoformat(r["date_iso"]))]
    bike = bool(re.search(r"\b(vtt|mtbo)\b", low))
    fits = [r for r in fits if (r["terrain"] == "VTT") == bike] or fits
    if len(fits) > 1:
        mine = races.owners(fits, label, False)
        fits = [r for r in fits if r["key"] in mine]
    if len(fits) != 1:
        return None
    to = fits[0]
    if not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (to["key"], url)).fetchone():
        save(con, to["key"], url, "site", d, sha=sha, note=text or None)
    return to["key"]


def site_docs(con, race, f: Fetcher, lr: LiveResultat, ws: WinSplits, hy: Heyries, cs: ClubSite, reread: bool, hg) -> int:
    """The organiser's website: its result files, and the platform competitions it links to."""
    changed = 0
    sites = [s for s in dict.fromkeys([race["site"], races.club_site(con, race["org_code"])]) if s]
    # files a looser search took earlier that name another day or season (a club's « all our races » page): not this race's
    day = date.fromisoformat(race["date_iso"])
    for row in con.execute("SELECT url, note FROM prov_docs WHERE race_key = ? AND source = 'site'", (race["key"],)).fetchall():
        name = urllib.parse.unquote(urllib.parse.urlsplit(row["url"]).path.rsplit("/", 1)[-1])
        if other_day(urllib.parse.unquote(row["url"]), day) or uploaded_before(row["url"], day) or \
                address_other_day(row["url"], day) or \
                other_year(f"{name} {row['note'] or ''}", day):
            con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], row["url"]))
            changed += 1
    if sites and not f.out_of_time():
        found = cs.find(race, sites)
        # unreadable files a looser search took earlier (a club's pages taken for results lists): gone once a full
        # look no longer finds them
        if not f.out_of_time():
            for row in con.execute("SELECT url FROM prov_docs WHERE race_key = ? AND source = 'site' AND kind = 'unparsed'",
                                   (race["key"],)).fetchall():
                if row["url"] not in {u for u, _, _ in found["docs"]}:
                    con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], row["url"]))
                    changed += 1
        # the organiser's other races of the day (« Championnat de Ligue » and « Challenge urbain »): a document goes
        # to the race(s) it is about (races.owners); one about another race is not this race's (dropped if saved before)
        # (a weekend's races too: a club posts Saturday's and Sunday's lists together)
        day = date.fromisoformat(race["date_iso"])
        rivals = con.execute("SELECT * FROM prov_races WHERE date_iso BETWEEN ? AND ? AND org_code = ? AND key != ?",
                             ((day - timedelta(days=1)).isoformat(), (day + timedelta(days=1)).isoformat(),
                              race["org_code"], race["key"])).fetchall()
        if rivals:
            label = lambda url, text: f"{urllib.parse.unquote(url.rsplit('/', 1)[-1])} {text}"
            theirs = [u for u, t, _ in found["docs"] if race["key"] not in races.owners([race, *rivals], label(u, t), False)]
            found["docs"] = [d for d in found["docs"] if d[0] not in theirs]
            for u in theirs:
                con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ? AND source = 'site'", (race["key"], u))
        for url, text, via in found["docs"]:
            if f.out_of_time():
                break
            # a conditional request only for a file this race has already: one first found for another race is read
            has = con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (race["key"], url)).fetchone()
            # (and not when the weekend has other races: the file read again says whose it is)
            a = f.get(download_url(url), conditional=bool(has) and not reread and not rivals)
            if a.status == 304:
                continue
            if a.status == -1:
                changed += save(con, race["key"], url, "site", None, kind="refused", note="refusé aux robots (robots.txt ou filtrage)")
                continue
            if a.status != 200:
                continue
            # a file already read for another race (a weekend's races share their organiser's files): its parse, not
            # another one (a split-time PDF can take a minute)
            memo = a.sha or a.url
            if memo not in _PARSED:
                known = None if reread or not a.sha else con.execute(
                    "SELECT parsed FROM prov_docs WHERE sha = ? AND parsed IS NOT NULL LIMIT 1", (a.sha,)).fetchone()
                _PARSED[memo] = json.loads(known["parsed"]) if known else parse_any(a.content, a.url, a.ctype)
            d = copy.deepcopy(_PARSED[memo])
            # another day's or (by the title it prints: « Championnat 2018 GE de sprint - Vittel ») another season's
            # (or another format or weekday, by its name, link and title)
            if d is not None and (not date_ok(d, race) or other_year(d.get("title") or "", day) or
                                  not_this_race(race, f"{urllib.parse.unquote(url.rsplit('/', 1)[-1])} {text} {d.get('title') or ''}")):
                con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ? AND source = 'site'", (race["key"], url))
                if not other_year(d.get("title") or "", day):
                    changed += bool(adopt(con, race, d, url, text, a.sha))      # another race's: given to it
                continue
            # one of the weekend's other races (Le Mans: « 20261003 E1 sprint savigne - result.pdf » is the
            # « SOT2026-E1-Chpt ligue sprint SAVIGNE », the Championnat de Ligue, not the night sprint): the date and
            # title it prints decide, with its address and link
            if d is not None and rivals and (
                    (d.get("date") and d["date"] != race["date_iso"] and any(r["date_iso"] == d["date"] for r in rivals))
                    or race["key"] not in races.owners([race, *[r for r in rivals if not d.get("date") or r["date_iso"] == d["date"]]],
                                                       f"{label(url, text)} {d.get('title') or ''}")):
                con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ? AND source = 'site'", (race["key"], url))
                changed += bool(adopt(con, race, d, url, text, a.sha))
                continue
            changed += save(con, race["key"], url, "site", d, kind=None if d else "unparsed", sha=a.sha, note=text or None)
        # platforms the club links to: read liveresultat and WinSplits ids directly, note the others
        for url, kind in found["platforms"]:
            m = re.search({"liveresultat": r"comp=(\d+)", "winsplits": r"databaseId=(\d+)", "heyries": r"/competition/(\d+)",
                           "helga": r"helga-o\.live/splits/\w+\.php\?lauf=(\d+)"}.get(kind, r"^$"), url)
            if m and not f.out_of_time() and (kind != "helga" or hg):
                reader = {"liveresultat": lr, "winsplits": ws, "heyries": hy, "helga": hg}[kind]
                d = reader.read(int(m.group(1)))
                if d and d["classes"] and date_ok(d, race):
                    changed += save(con, race["key"], url, kind, d)
            elif kind in ("livelox", "helga", "olive", "routegadget"):
                if kind in ("livelox", "helga"):
                    f.note(url, "refused")
                changed += save(con, race["key"], url, kind, None, kind="platform",
                                note={"livelox": "Livelox : résultats non ouverts aux robots", "helga": "Helga : pages de résultats fermées aux robots",
                                      "olive": "O'Live : résultats en direct", "routegadget": "RouteGadget"}[kind])
    return changed


# ---- the admin's files -----------------------------------------------------------------------------------------
# The shape of index.json; a new one is published at once (a deploy), not with the next result found.
# 2 (2026-10-08): each race's region and its runners' licences, for the list's filters.
# 3 (2026-10-08): the last runs, and whether each race's organiser has a known website.
INDEX_VERSION = 3
# The collection itself: bump it when finding results improves (a source, the club-site search…) — every race of the
# window is looked at once more, the finished ones too (documents already read are not downloaded again).
# 1 (2026-10-09): Helga, the club-site fixes and the 60-day window came after many races' last look.
# 2 (2026-10-09): robots.txt no longer obeyed, the crawl best-first, sibling WordPress sites, a weekend's files told
#   apart by the title they print.
# 3 (2026-10-09): a file about another race of the fortnight goes to that race (the CF week's site posting Luxeuil's).
COLLECT_VERSION = 3
_BY_DEPT = {d: region for region, ds in REGIONS.items() for d in ds.split()}


def region_of(org_code: str | None) -> str | None:
    """The organiser's region: a club number starts with its département ('6804' -> 68), a committee is one ('13')."""
    code = (org_code or "").upper()
    if code in LIGUES:
        return LIGUES[code]
    dep = code[:2]
    if dep in ("2A", "2B"):
        dep = "20"
    if dep in _BY_DEPT:
        return _BY_DEPT[dep]
    return OUTRE_MER if dep.isdigit() and int(dep) >= 96 else None


def build(con, out: Path, today: date) -> int:
    """site/data/prov/: index.json and one file per race of the last SHOW_DAYS days."""
    d = out / "prov"
    d.mkdir(parents=True, exist_ok=True)
    lo = (today - timedelta(days=SHOW_DAYS)).isoformat()
    matcher, scorer = Matcher(con, today), Scorer(con)
    index, written = [], 0
    for race in con.execute("SELECT * FROM prov_races WHERE date_iso >= ? AND date_iso <= ? ORDER BY date_iso DESC, name",
                            (lo, today.isoformat())).fetchall():
        docs = con.execute("SELECT * FROM prov_docs WHERE race_key = ? ORDER BY source, found_at", (race["key"],)).fetchall()
        ffco = scorer.ffco_figures(race["ffco_id"]) if race["ffco_id"] else {}
        out_docs, n_run, n_lic, splits, lics = [], 0, 0, False, set()
        for doc in docs:
            parsed = json.loads(doc["parsed"]) if doc["parsed"] else None
            entry = {"url": doc["url"], "source": doc["source"], "kind": doc["kind"], "title": doc["title"],
                     "found": doc["found_at"], "changed": doc["changed_at"], "note": doc["note"]}
            if parsed:
                entry["by"] = parsed.get("by")
                for k in parsed["classes"]:
                    for r in k["runners"]:
                        r["lic"] = matcher.match(r)
                        if r["lic"] and not r.get("category"):       # lists by circuit rarely print it: the CN data's
                            r["catCn"] = matcher.info[r["lic"]]["cat"]
                        if r["lic"] and r["lic"] in ffco:
                            r["ffco"] = ffco[r["lic"]]
                    if parsed.get("by") != "category":
                        k["values"] = scorer.score_class(k, race, race["ffco_id"])
                    if any(r.get("splits") for r in k["runners"]):
                        splits = True
                entry["classes"] = parsed["classes"]
                runners = [r for k in parsed["classes"] for r in k["runners"]]
                n_run = max(n_run, len(runners))
                n_lic = max(n_lic, sum(1 for r in runners if r["lic"]))
                lics.update(r["lic"] for r in runners if r["lic"])
            out_docs.append(entry)
        body = {k: race[k] for k in ("key", "date_iso", "name", "place", "org", "org_code", "terrain", "epreuve", "cn", "site",
                                      "agenda_id", "ffco_id", "first_seen", "last_check", "next_check", "done")}
        body["docs"] = out_docs
        (d / f"{race['key']}.json").write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written += 1
        index.append({k: race[k] for k in ("key", "date_iso", "name", "place", "org", "terrain", "epreuve", "cn", "ffco_id",
                                           "last_check", "next_check", "done")} |
                     {"docs": len([x for x in out_docs if x.get("classes")]), "refused": len([x for x in out_docs if x["kind"] in ("refused", "platform")]),
                      "runners": n_run, "matched": n_lic, "splits": splits, "region": region_of(race["org_code"]),
                      "site": bool(race["site"] or races.club_site(con, race["org_code"])),
                      "lics": sorted(lics),
                      "sources": sorted({x["source"] for x in out_docs if x.get("classes")})})
    names = {r["key"]: {"key": r["key"], "name": r["name"], "date": r["date_iso"]} for r in index}
    blocked = [{"host": b["host"], "kind": b["kind"], "example": b["example"], "first": b["first_seen"], "last": b["last_seen"],
                "hits": b["hits"], "races": [names.get(k) or {"key": k} for k in json.loads(b["races"] or "[]")]}
               for b in con.execute("SELECT * FROM prov_blocked ORDER BY last_seen DESC").fetchall()]
    (d / "blocked.json").write_text(json.dumps({"generated": _now(), "sites": blocked}, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
    (d / "index.json").write_text(json.dumps({"generated": _now(), "races": index, "runs": store.meta_get(con, "runs", [])[-12:],
                                              "due": len(races.due(con, today, _now()))}, ensure_ascii=False, separators=(",", ":")),
                                  encoding="utf-8")
    keep = {f"{r['key']}.json" for r in index} | {"index.json", "blocked.json"}
    for old in d.glob("*.json"):
        if old.name not in keep:
            old.unlink()
    return written


def run(db: Path, out: Path, agenda: Path | None = None, days: int = KEEP_DAYS - 4, budget_s: float = 240,
        today: date | None = None) -> dict:
    t0 = time.monotonic()
    today = today or date.today()
    con = store.connect(db)
    # catching up (the first runs: the WinSplits backlog, races never looked at): a larger budget until done
    if WinSplits(None, con).catching_up() or con.execute("SELECT COUNT(*) FROM prov_races WHERE last_check IS NULL").fetchone()[0] > 10:
        budget_s *= CATCH_UP
    f = Fetcher(con, budget_s=budget_s)
    try:
        races.refresh_clubs(con, agenda or (out / "agenda.json"))
        try:
            stats["club_dir"] = races.read_directory(con, f)
        except Exception:
            log.exception("provisional: club directory failed")
        stats = races.sync(con, agenda or (out / "agenda.json"), today, days)
        # the races already past when the pilot started, or before a longer window (the agenda drops a race once
        # run), from FFCO's agenda export — one request each time the window reaches further back than the last one
        # (agreed with the owner: the first month, 2026-10-08; back to early August when the list went to 60 days)
        lo_bf = (today - timedelta(days=days)).isoformat()
        covered = store.meta_get(con, "agenda_backfill_from", None)
        if covered is None or lo_bf < covered:
            try:
                from .. import agenda as ffco_agenda
                rows = [ffco_agenda._csv_event(x, "c") for x in ffco_agenda.read_csv("cou", lo_bf)]
                stats["backfilled"] = races.backfill(con, rows, lo_bf, today.isoformat())
                store.meta_set(con, "agenda_backfill_from", lo_bf)
            except Exception:
                log.exception("provisional: agenda backfill failed")
        # the files organisers uploaded on « Récemment » (sources.upload): read first, they are the freshest news
        uploaded = upload.apply(con, Path(db).parent / "uploads", save, parse_any,
                                reread=store.meta_get(con, "parser_version") != PARSER_VERSION)
        stats["uploads"] = uploaded
        ws = WinSplits(f, con)
        # a share of the budget only (2-3 s per WinSplits page): a long catch-up never leaves the races unlooked at
        stats["winsplits_new"] = len(ws.discover(limit=max(30, int(budget_s / 6))))
        lr, cs, hy, hg = LiveResultat(f), ClubSite(f), Heyries(f), Helga(f, con)
        stats["helga_new"] = hg.discover(limit=max(20, int(budget_s / 4)))
        looked = failed = 0
        changed = uploaded
        # a new parser version reads again the documents already seen (an unchanged file is otherwise skipped)
        reread = store.meta_get(con, "parser_version") != PARSER_VERSION
        recollect = store.meta_get(con, "collect_version", None) != COLLECT_VERSION
        if reread or recollect:             # including the races already finished with, of the period shown
            con.execute("UPDATE prov_races SET done = 0, next_check = ? WHERE date_iso >= ?",
                        (_now(), (today - timedelta(days=KEEP_DAYS)).isoformat()))
            store.meta_set(con, "collect_version", COLLECT_VERSION)
        # the platforms' competitions, assigned to the races of the period one-to-one (races.assign)
        period = con.execute("SELECT * FROM prov_races WHERE date_iso >= ? AND date_iso <= ?",
                             ((today - timedelta(days=KEEP_DAYS)).isoformat(), today.isoformat())).fetchall()
        lo = (today - timedelta(days=KEEP_DAYS)).isoformat()
        lr_map = races.assign(period, [(c["id"], c["name"], c["organizer"], c["date"]) for c in lr.competitions() if c["date"] >= lo])
        ws_events = store.meta_get(con, "winsplits", {"events": {}})["events"]
        ws_map = races.assign(period, [(int(k), e["name"], e["organiser"], e["date"]) for k, e in ws_events.items() if e["date"] >= lo])
        hy_map = races.assign(period, [(c["id"], c["name"], c["organizer"], c["date"]) for c in hy.competitions() if c["date"] >= lo])
        hg_map = races.assign(period, [(int(k), e["name"], "", e["date"]) for k, e in hg.events().items() if e["date"] >= lo])
        # a race comes back at once when a platform competition is newly matched to it (a WinSplits event found later
        # by the backward fill, a Helga event, an Orientation Data competition published after the last look) — a race
        # still watched too, rather than at its next daily look
        urls = {"liveresultat": "https://liveresultat.orientering.se/followfull.php?comp={}", "winsplits": WS_BASE + "/classes.asp?databaseId={}",
                "heyries": HY_BASE + "/competition/{}/", "helga": HG_BASE + "/splitsbrowser.php?lauf={}"}
        for kind, mp in (("liveresultat", lr_map), ("winsplits", ws_map), ("heyries", hy_map), ("helga", hg_map)):
            for key, pid in mp.items():
                if not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ? AND url = ?", (key, urls[kind].format(pid))).fetchone():
                    con.execute("UPDATE prov_races SET done = 0, next_check = ? WHERE key = ? AND (done = 1 OR next_check > ?)",
                                (_now(), key, _now()))
        due = races.due(con, today, _now())
        cut = False
        for race in due:
            if f.out_of_time():
                cut = True
                break
            f.race = race["key"]
            try:
                links = {"liveresultat": lr_map.get(race["key"]), "winsplits": ws_map.get(race["key"]), "heyries": hy_map.get(race["key"]),
                         "helga": hg_map.get(race["key"])}
                changed += look(con, race, f, lr, ws, hy, cs, links, reread, hg)
            except Exception:                         # one race's odd page must not stop the others
                log.exception("provisional: %s failed", race["key"])
                failed += 1
            if f.out_of_time() and looked:            # cut short by the budget: first in the next run (unless it had it all)
                cut = True
                break
            races.schedule(con, race, today)
            con.commit()
            looked += 1
        stats.update(looked=looked, changed=changed, failed=failed, requests=f.requests)
        log_runs = store.meta_get(con, "runs", []) + [{"at": _now(), "due": len(due), "looked": looked, "changed": changed,
                                                        "failed": failed, "requests": f.requests, "cut": cut,
                                                        "seconds": round(time.monotonic() - t0), "budget": round(budget_s)}]
        store.meta_set(con, "runs", log_runs[-48:])
        if reread and not f.out_of_time():
            store.meta_set(con, "parser_version", PARSER_VERSION)
        stats["built"] = build(con, out, today)
        if store.meta_get(con, "index_version", None) != INDEX_VERSION:
            store.meta_set(con, "index_version", INDEX_VERSION)
            stats["reshaped"] = True
        con.commit()
    finally:
        f.close()
        con.close()
    stats["seconds"] = round(time.monotonic() - t0)
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("site/data"))
    ap.add_argument("--days", type=int, default=KEEP_DAYS - 4, help="races of the last N days taken in (each looked at, then watched 14 days)")
    ap.add_argument("--budget", type=float, default=240, help="seconds of fetching, at most")
    ap.add_argument("--build-only", action="store_true", help="rebuild the files from what is stored, fetch nothing")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if a.build_only:
        con = store.connect(a.db)
        print("built", build(con, a.out, date.today()))
        return
    print(run(a.db, a.out, days=a.days, budget_s=a.budget))

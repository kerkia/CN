"""The organiser's own website: where clubs post their result and split-time files after a race.

Every club does it differently (WordPress uploads, a Joomla article, Blogger + Google Drive, the federation's
CMS, Wix, a static page…), so this looks in three ways and keeps what points to this race:
 1. WordPress: the files uploaded since the race (wp-json media) and the posts published since (their links);
 2. Blogger: the posts published since the race (JSON feed);
 3. any site: the race's page (the agenda's link) and the home page, then up to a few pages they link to that
    look like results or this event, collecting links to documents (PDF, HTML, XML, spreadsheets). A site on a
    subdomain (a race's own site, 'ocastor.go78.org') brings in its club's main site ('www.go78.org') too, and a
    home page that only redirects (<meta http-equiv="refresh">) is followed.
A document link is kept when its address or text says results / split times AND names this race (its date,
its place or words of its name), or when it was uploaded after the race on a WordPress site and names nothing
else. Links to platforms (liveresultat, WinSplits, Livelox, Helga) are reported too: WinSplits and
liveresultat ids found here are read directly, and so are Helga's SplitsBrowser links (sources.helga); Livelox and
Helga's results pages are only noted (they are not open to robots).
"""

from __future__ import annotations

import html as htmllib
import json
import re
import urllib.parse
from datetime import date, timedelta

from ..model import plain

DOC_EXT = (".pdf", ".htm", ".html", ".xml", ".xls", ".xlsx", ".csv", ".txt")
RESULT_WORDS = ("resultat", "result", "classement", "temps", "inter", "split", "provisoire", "circuit", "categorie", "si_", "-si")
NOT_RESULTS = ("relais", "relay", "depart", "horaire", "startlist", "start list", "inscrit", "inscription", "annonce", "invitation", "convocation",
               "reglement", "fleche", "plan d acces")
PAGE_WORDS = ("resultat", "result", "organisation", "competition", "course", "evenement", "event", "actualite", "news",
              "archive", "saison", "orga", "programme")
STOP = {"de", "la", "le", "du", "des", "et", "co", "course", "orientation", "club", "d", "l", "les", "en", "a", "au",
        "regionale", "departementale", "nationale", "championnat", "ligue", "dep", "sprint", "md", "ld", "nuit"}
MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
MAX_PAGES = 14                  # pages read per race and run, at most
NOT_PAGES = ("iccaldate", "calendrier", "calendar", "/agenda", "ical", "?date=", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".zip", "albumphoto", "/photos", "photo-", "galerie",
             "gallery", "whatsappimage", "/wp-content/uploads/", "/media/uploaded/", "login", "connexion", "inscription")
# shared hosts: a site on one of their subdomains has nothing to do with the parent domain
SHARED_HOSTS = ("blogspot.", "wixsite.com", "wordpress.com", "e-monsite.com", "over-blog.com", "jimdofree.com", "jimdo.com",
                "free.fr", "webnode.", "sportsregions.fr", "clubeo.com", "kalisport.com", "github.io", "netlify.app",
                "pagesperso-orange.fr", "alwaysdata.net", "assoconnect.com", "helloasso.com", "google.com")
PLATFORMS = {"liveresultat.orientering.se": "liveresultat", "obasen.orientering.se": "winsplits", "livelox.com": "livelox",
             "helga-o.com": "helga", "helga-o.live": "helga", "co-live.fr": "olive", "routegadget": "routegadget", "heyries.alwaysdata.net": "heyries"}


def _links(page: str, base: str) -> list[tuple[str, str]]:
    """(absolute url, link text) of every <a href> of a page."""
    out = []
    for href, text in re.findall(r'(?is)<a\b[^>]*?href\s*=\s*["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', page):
        href = htmllib.unescape(href.strip())
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        out.append((urllib.parse.urljoin(base, href), re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", text))).strip()))
    return out


def _host(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc.lower().removeprefix("www.")


def _root(url: str) -> str:
    u = urllib.parse.urlsplit(url)
    return f"{u.scheme}://{u.netloc}"


def parent_site(url: str) -> str | None:
    """The main site of a subdomain's domain: 'https://ocastor.go78.org/x' -> 'https://www.go78.org/'."""
    u = urllib.parse.urlsplit(url)
    host = u.netloc.lower().split(":")[0]
    labels = host.split(".")
    if len(labels) < 3 or labels[0] == "www" or any(h in host for h in SHARED_HOSTS) or labels[-1].isdigit():
        return None
    return f"{u.scheme or 'https'}://www.{'.'.join(labels[-2:])}/"


def date_tokens(d: date) -> list[str]:
    """How a race date shows in file names and titles: 2026-10-04, 20261004, 04102026, 04-10-2026, 4 octobre…"""
    y, m, dd = d.year, d.month, d.day
    return [f"{y}-{m:02d}-{dd:02d}", f"{y}{m:02d}{dd:02d}", f"{dd:02d}{m:02d}{y}", f"{dd:02d}-{m:02d}-{y}", f"{dd:02d}_{m:02d}_{y}",
            f"{dd:02d}.{m:02d}.{y}", f"{dd:02d}/{m:02d}/{y}", f"{dd:02d}-{m:02d}-{str(y)[2:]}", f"{dd} {MONTHS[m - 1]}",
            f"{dd:02d} {MONTHS[m - 1]}", f"{dd:02d}{m:02d}{str(y)[2:]}"]


def names_day(text: str, d: date) -> bool:
    """The race's day written in a page's text: « 4 octobre », « 04 oct. 2026 », « 04/10/2026 », « dimanche 4 octobre »…"""
    month = MONTHS[d.month - 1]
    return bool(re.search(rf"(?<!\d)0?{d.day}(?:er)?\s+{month[:3]}", text) or any(t in text for t in date_tokens(d)[:8]))


def other_day(text: str, d: date) -> bool:
    """A file named for another day (« 20250309_CRMD… », « 2026-04-11 », « 11-04-2026 ») is another race's."""
    for m in re.finditer(r"(?<!\d)(20\d\d)[-_.]?([01]\d)[-_.]?([0-3]\d)(?!\d)|(?<!\d)([0-3]\d)[-_.]([01]\d)[-_.](20\d\d)(?!\d)", text):
        y, mo, dd = (m.group(1), m.group(2), m.group(3)) if m.group(1) else (m.group(6), m.group(5), m.group(4))
        try:
            other = date(int(y), int(mo), int(dd))
        except ValueError:
            continue
        if abs((other - d).days) > 1:
            return True
    return False


def other_year(name: str, d: date) -> bool:
    """A file named for another year (« 2025-challenge-poitiers-co… » on a page listing every season's results) is
    another season's race. Only the file's own name and its link's text: a WordPress folder (/uploads/2025/12/) says
    when it was uploaded, not which race it is."""
    years = {int(y) for y in re.findall(r"(?<![0-9a-z])(20\d\d)(?![0-9])", name.lower())}
    return bool(years) and d.year not in years


def headline(page: str) -> str:
    """A page's own title and the lines under it (« Résultats Sprint et KO Sprint — Publiée le 04 oct. 2026 … »), not
    its menus and margins, which list the club's other events."""
    m = re.search(r"(?is)<h1\b.*?</h1>", page) or re.search(r"(?is)<title\b.*?</title>", page)
    if not m:
        return ""
    rest = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page[m.start():m.start() + 6000])
    return plain(re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", rest))))[:700]


def race_words(race) -> set[str]:
    words = set(re.findall(r"[a-z0-9]+", plain(f"{race['name']} {race['place'] or ''}")))
    return {w for w in words - STOP if len(w) >= 4 and not w.isdigit()}


class ClubSite:
    def __init__(self, fetcher):
        self.f = fetcher
        self.pages: dict[str, str | None] = {}            # url -> html, within one run
        self.bases: dict[str, str] = {}                   # url -> where its html came from (a refresh's target)

    def page(self, url: str) -> str | None:
        if url not in self.pages:
            a = self.f.get(url, conditional=False)
            ok = a.status == 200 and ("html" in a.ctype or a.content[:200].lstrip().lower().startswith((b"<!doctype", b"<html")))
            text = a.content.decode("utf-8", "replace") if ok else None
            # a page that only redirects ('www.go78.org' -> '/joomla3'): its target, one hop
            m = text and len(text) < 3000 and re.search(r'(?is)<meta[^>]+http-equiv=["\']?refresh["\']?[^>]+content=["\'][^"\']*url=([^"\'>]+)', text)
            if m:
                target = urllib.parse.urljoin(url, htmllib.unescape(m.group(1).strip()))
                if target != url and _host(target) == _host(url):
                    b = self.f.get(target, conditional=False)
                    if b.status == 200:
                        text = b.content.decode("utf-8", "replace")
                        self.bases[url] = target
            self.pages[url] = text
        return self.pages[url]

    def find(self, race, sites: list[str]) -> dict:
        """{'docs': [(url, text, via)], 'platforms': [(kind, url)]} for this race."""
        sites = list(dict.fromkeys(sites + [p for p in map(parent_site, sites) if p]))
        d = date.fromisoformat(race["date_iso"])
        dt = date_tokens(d)
        # a word of the club's own address names every page of its site (« poitiers » on poitiersco.org): it says
        # nothing of the race
        hosts = [_host(s).replace(".", " ") for s in sites]
        words = {w for w in race_words(race) if not any(w in h for h in hosts)}
        found: dict[str, tuple[str, str]] = {}
        platforms: dict[str, str] = {}

        def consider(url: str, text: str, via: str, posted_after: bool = False, on_race_page: bool = False):
            low = plain(urllib.parse.unquote(url)) + " " + plain(text)
            host = _host(url)
            names_race = any(t in low for t in dt) or any(w in low for w in words) or on_race_page
            for h, kind in PLATFORMS.items():
                if h in host or h in url:
                    # a club page lists its whole season's links: only those naming this race (or posted after it)
                    if names_race or posted_after:
                        platforms[url] = kind
                    return
            if other_day(urllib.parse.unquote(url), d) or \
                    other_year(urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]) + " " + text, d):
                return                                          # a file of another day's (or season's) race
            path = urllib.parse.urlsplit(url).path.lower()
            is_doc = path.endswith(DOC_EXT) or "drive.google.com/file" in url or "document-download" in url or "/ugd/" in url
            if not is_doc:
                return
            if path.endswith((".htm", ".html")) and not any(w in low for w in RESULT_WORDS):
                return                                          # an ordinary page, not an exported list
            if any(w in low for w in NOT_RESULTS):
                return                                          # start lists, entries, invitations: their times are not results
            says_result = any(w in low for w in RESULT_WORDS)
            names_race = any(t in low for t in dt) or any(w in low for w in words) or on_race_page
            if (says_result and names_race) or (posted_after and (says_result or names_race)):
                found.setdefault(url, (text, via))

        # 1. WordPress: uploads and posts since the race
        for site in sites:
            root = _root(site)
            after = (d - timedelta(days=1)).isoformat() + "T00:00:00"
            before = (d + timedelta(days=21)).isoformat() + "T00:00:00"
            a = self.f.get(f"{root}/wp-json/wp/v2/media", conditional=False,
                           params={"after": after, "before": before, "per_page": 100})
            if a.status == 200 and a.content[:1] in (b"[", b"{"):
                try:
                    for m in json.loads(a.content.decode("utf-8", "replace")):
                        if isinstance(m, dict) and m.get("source_url"):
                            consider(m["source_url"], htmllib.unescape(str((m.get("title") or {}).get("rendered", ""))), "wordpress media", True)
                except ValueError:
                    pass
                p = self.f.get(f"{root}/wp-json/wp/v2/posts", conditional=False, params={"after": after, "before": before, "per_page": 30})
                if p.status == 200 and p.content[:1] == b"[":
                    try:
                        for post in json.loads(p.content.decode("utf-8", "replace")):
                            content = str((post.get("content") or {}).get("rendered", ""))
                            for u, t in _links(content, post.get("link") or root):
                                consider(u, t, "wordpress post", True)
                    except ValueError:
                        pass
            # 2. Blogger
            if "blogspot." in root or (self.page(site) or "").find("blogger.com") >= 0:
                b = self.f.get(f"{root}/feeds/posts/default", conditional=False,
                               params={"alt": "json", "published-min": after + "+00:00", "max-results": 25})
                if b.status == 200:
                    try:
                        for e in json.loads(b.content.decode("utf-8", "replace")).get("feed", {}).get("entry", []):
                            for u, t in _links((e.get("content") or {}).get("$t", ""), root):
                                consider(u, t, "blogger", True)
                    except ValueError:
                        pass

        # 3. the site's pages: the race's page and the home page, then pages that look like results or this race
        queue = []
        for s in sites:
            queue += [s, _root(s) + "/"]
        seen, n = set(), 0
        while queue and n < MAX_PAGES and not self.f.out_of_time():
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            page = self.page(url)
            n += 1
            if not page:
                continue
            # a page about this race's results (« Les résultats du sprint … à Rouen », the race's own page): its
            # result files need not name the race themselves
            about = plain(urllib.parse.unquote(url)) + " " + headline(page)
            # (its address or title says results and the title's lines give the race's day: a mention of the town or
            # of the day in a menu or a margin listing the club's events is not enough)
            on_race_page = url in sites or (any(w in about for w in RESULT_WORDS[:3]) and names_day(about, d))
            ranked = []
            for u, t in _links(page, self.bases.get(url, url)):
                consider(u, t, f"page {url}", on_race_page=on_race_page and url not in [_root(s) + "/" for s in sites])
                low = plain(urllib.parse.unquote(u)) + " " + plain(t)
                same_site = any(_host(u) == _host(s) for s in sites)
                path = urllib.parse.urlsplit(u).path.lower()
                if not same_site or u in seen or path.endswith(DOC_EXT) or any(x in low for x in NOT_PAGES):
                    continue
                race_named = any(t2 in low for t2 in dt) or any(w in low for w in words)
                results = any(w in low for w in RESULT_WORDS[:3])
                if race_named or results or any(w in low for w in PAGE_WORDS):
                    # the most specific pages first: results naming this race, then results, then the race's pages
                    ranked.append((0 if race_named and results else 1 if results else 2 if race_named else 3, u))
            for rank, u in sorted(ranked, reverse=True):
                if rank <= 2:
                    queue.insert(0, u)
                else:
                    queue.append(u)
        return {"docs": [(u, t, v) for u, (t, v) in found.items()], "platforms": sorted(platforms.items(), key=lambda x: x[1])}


def download_url(url: str) -> str:
    """A shared file's direct download address (Google Drive's viewer pages are not the file)."""
    m = re.search(r"drive\.google\.com/file/d/([\w-]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    return url

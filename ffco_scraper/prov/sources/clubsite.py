"""The organiser's own website: where clubs post their result and split-time files after a race.

Every club does it differently (WordPress uploads, a Joomla article, Blogger + Google Drive, the federation's
CMS, Wix, a static page…), so this looks in three ways and keeps what points to this race:
 1. WordPress: the files uploaded since the race (wp-json media) and the posts published since (their links);
 2. Blogger: the posts published since the race (JSON feed);
 3. any site: the race's page (the agenda's link) and the home page, then up to a few pages they link to that
    look like results or this event, collecting links to documents (PDF, HTML, XML, spreadsheets).
A document link is kept when its address or text says results / split times AND names this race (its date,
its place or words of its name), or when it was uploaded after the race on a WordPress site and names nothing
else. Links to platforms (liveresultat, WinSplits, Livelox, Helga) are reported too: WinSplits and
liveresultat ids found here are read directly; Livelox and Helga are only noted (their results pages are not
open to robots).
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
NOT_RESULTS = ("depart", "horaire", "startlist", "start list", "inscrit", "inscription", "annonce", "invitation", "convocation",
               "reglement", "fleche", "plan d acces")
PAGE_WORDS = ("resultat", "result", "organisation", "competition", "course", "evenement", "event", "actualite", "news",
              "archive", "saison", "orga", "programme")
STOP = {"de", "la", "le", "du", "des", "et", "co", "course", "orientation", "club", "d", "l", "les", "en", "a", "au",
        "regionale", "departementale", "nationale", "championnat", "ligue", "dep", "sprint", "md", "ld", "nuit"}
MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
MAX_PAGES = 10                  # pages read per race and run, at most
PLATFORMS = {"liveresultat.orientering.se": "liveresultat", "obasen.orientering.se": "winsplits", "livelox.com": "livelox",
             "helga-o.com": "helga", "co-live.fr": "olive", "routegadget": "routegadget", "heyries.alwaysdata.net": "heyries"}


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


def date_tokens(d: date) -> list[str]:
    """How a race date shows in file names and titles: 2026-10-04, 20261004, 04102026, 04-10-2026, 4 octobre…"""
    y, m, dd = d.year, d.month, d.day
    return [f"{y}-{m:02d}-{dd:02d}", f"{y}{m:02d}{dd:02d}", f"{dd:02d}{m:02d}{y}", f"{dd:02d}-{m:02d}-{y}", f"{dd:02d}_{m:02d}_{y}",
            f"{dd:02d}.{m:02d}.{y}", f"{dd:02d}/{m:02d}/{y}", f"{dd:02d}-{m:02d}-{str(y)[2:]}", f"{dd} {MONTHS[m - 1]}",
            f"{dd:02d} {MONTHS[m - 1]}", f"{dd:02d}{m:02d}{str(y)[2:]}"]


def race_words(race) -> set[str]:
    words = set(re.findall(r"[a-z0-9]+", plain(f"{race['name']} {race['place'] or ''}")))
    return {w for w in words - STOP if len(w) >= 4 and not w.isdigit()}


class ClubSite:
    def __init__(self, fetcher):
        self.f = fetcher
        self.pages: dict[str, str | None] = {}            # url -> html, within one run

    def page(self, url: str) -> str | None:
        if url not in self.pages:
            a = self.f.get(url, conditional=False)
            ok = a.status == 200 and ("html" in a.ctype or a.content[:200].lstrip().lower().startswith((b"<!doctype", b"<html")))
            self.pages[url] = a.content.decode("utf-8", "replace") if ok else None
        return self.pages[url]

    def find(self, race, sites: list[str]) -> dict:
        """{'docs': [(url, text, via)], 'platforms': [(kind, url)]} for this race."""
        d = date.fromisoformat(race["date_iso"])
        dt = date_tokens(d)
        words = race_words(race)
        found: dict[str, tuple[str, str]] = {}
        platforms: dict[str, str] = {}

        def consider(url: str, text: str, via: str, posted_after: bool = False):
            low = plain(urllib.parse.unquote(url)) + " " + plain(text)
            host = _host(url)
            names_race = any(t in low for t in dt) or any(w in low for w in words)
            for h, kind in PLATFORMS.items():
                if h in host or h in url:
                    # a club page lists its whole season's links: only those naming this race (or posted after it)
                    if names_race or posted_after:
                        platforms[url] = kind
                    return
            path = urllib.parse.urlsplit(url).path.lower()
            is_doc = path.endswith(DOC_EXT) or "drive.google.com/file" in url or "document-download" in url or "/ugd/" in url
            if not is_doc:
                return
            if path.endswith((".htm", ".html")) and not any(w in low for w in RESULT_WORDS):
                return                                          # an ordinary page, not an exported list
            if any(w in low for w in NOT_RESULTS):
                return                                          # start lists, entries, invitations: their times are not results
            says_result = any(w in low for w in RESULT_WORDS)
            names_race = any(t in low for t in dt) or any(w in low for w in words)
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
            for u, t in _links(page, url):
                consider(u, t, f"page {url}")
                low = plain(urllib.parse.unquote(u)) + " " + plain(t)
                same_site = any(_host(u) == _host(s) for s in sites)
                if (same_site and u not in seen and not urllib.parse.urlsplit(u).path.lower().endswith(DOC_EXT)
                        and (any(w in low for w in PAGE_WORDS) or any(t2 in low for t2 in dt) or any(w in low for w in words))):
                    # the most specific pages first: those naming this race
                    if any(t2 in low for t2 in dt) or any(w in low for w in words):
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

"""Polite HTTP for the provisional-results pilot.

Every request: says who we are (user agent with the site's address), waits a little between two requests to the
same host, sends conditional headers (ETag / Last-Modified) so an unchanged page costs nothing, and gives up on files
larger than MAX_BYTES. robots.txt is read but no longer obeyed (the owner's decision, 2026-10-09: a few requests per
race, only around competitions): a URL it forbids is fetched all the same and its site goes on the owner's list
(prov_blocked, kind 'robots'), to follow up with the site's owner. Sites that actively screen robots (401/403/429, an
HTTP 200 with an empty or 3-byte body for non-browsers) are never worked around — no disguised user agent: the
answer is recorded as refused, and the site goes on the list too (kind 'refused').
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

UA = "ocn-resultats/1.0 (+https://ocn.kerkia.com; reads results organisers publish, a few times after each race)"
MAX_BYTES = 32 * 1024 * 1024    # a club's « all our results » page can be 17 MB (Poitiers, 2026-10-09); uploads are 30 MB
PAUSE = 0.6                     # seconds between two requests to the same host
TIMEOUT = 25.0


@dataclass
class Answer:
    url: str                    # after redirects
    status: int                 # HTTP status; 304 = unchanged; 0 = network error; -1 = refused (robots / screening)
    content: bytes = b""
    ctype: str = ""
    changed: bool = False       # new content since the last fetch (by hash)
    sha: str | None = None


class Fetcher:
    def __init__(self, con, budget_s: float | None = None):
        self.con = con
        self.client = httpx.Client(headers={"User-Agent": UA, "Accept-Language": "fr,en;q=0.5"},
                                   follow_redirects=True, timeout=TIMEOUT)
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.last_hit: dict[str, float] = {}
        self.deadline = time.monotonic() + budget_s if budget_s else None
        self.requests = 0
        self.race: str | None = None            # the race being looked at, for the owner's list of sites

    def close(self):
        self.client.close()

    def out_of_time(self) -> bool:
        return self.deadline is not None and time.monotonic() > self.deadline

    # ---- robots.txt -------------------------------------------------------------------------------------
    def allowed(self, url: str) -> bool:
        host = urllib.parse.urlsplit(url)
        base = f"{host.scheme}://{host.netloc}"
        if base not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._wait(host.netloc)
                r = self.client.get(f"{base}/robots.txt")
                self.requests += 1
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except httpx.HTTPError:
                rp.parse([])
            self.robots[base] = rp
        rp = self.robots[base]
        return rp.can_fetch(UA, url) and rp.can_fetch("*", url)

    def _wait(self, netloc: str):
        last = self.last_hit.get(netloc)
        if last is not None:
            gap = time.monotonic() - last
            if gap < PAUSE:
                time.sleep(PAUSE - gap)
        self.last_hit[netloc] = time.monotonic()

    # ---- one request -----------------------------------------------------------------------------------
    def get(self, url: str, conditional: bool = True, params: dict | None = None) -> Answer:
        full = url if not params else f"{url}{'&' if '?' in url else '?'}{urllib.parse.urlencode(params)}"
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if not self.allowed(full):
            self.note(full, "robots")           # read all the same; on the owner's list
        prev = self.con.execute("SELECT * FROM prov_fetch WHERE url = ?", (full,)).fetchone()
        headers = {}
        if conditional and prev and prev["status"] == 200:
            if prev["etag"]:
                headers["If-None-Match"] = prev["etag"]
            if prev["modified"]:
                headers["If-Modified-Since"] = prev["modified"]
        self._wait(urllib.parse.urlsplit(full).netloc)
        self.requests += 1
        try:
            with self.client.stream("GET", full, headers=headers) as r:
                if r.status_code == 304:
                    self._record(full, now, 200, prev["etag"], prev["modified"], prev["sha"], prev["ctype"])
                    return Answer(str(r.url), 304, sha=prev["sha"])
                size = int(r.headers.get("content-length") or 0)
                if size > MAX_BYTES:
                    self._record(full, now, 413, None, None, None, r.headers.get("content-type"))
                    return Answer(str(r.url), 413)
                body = b""
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        self._record(full, now, 413, None, None, None, r.headers.get("content-type"))
                        return Answer(str(r.url), 413)
                status, ctype = r.status_code, r.headers.get("content-type", "")
                etag, modified = r.headers.get("etag"), r.headers.get("last-modified")
                final = str(r.url)
        except httpx.HTTPError:
            self._record(full, now, 0, None, None, None, None)
            return Answer(full, 0)
        if status in (401, 403, 429) or (status == 200 and len(body) < 16 and b"<" not in body):
            # a robot screen (or a login wall): recorded as refused, never worked around
            self._record(full, now, -1, None, None, None, ctype)
            self.note(full, "refused")
            return Answer(final, -1)
        sha = hashlib.sha1(body).hexdigest() if status == 200 else None
        changed = status == 200 and (not prev or prev["sha"] != sha)
        self._record(full, now, status, etag, modified, sha, ctype)
        return Answer(final, status, body if status == 200 else b"", ctype, changed, sha)

    def note(self, url: str, kind: str) -> None:
        """A site for the owner's list (prov_blocked): kind 'robots' (read though robots.txt forbids) or 'refused'.
        Not the APIs probed on the way (WordPress, Blogger): a 401 there says no API, not a site refusing robots."""
        if "/wp-json/" in url or "public-api.wordpress.com" in url or "/feeds/posts" in url:
            return
        host = urllib.parse.urlsplit(url).netloc.lower().removeprefix("www.")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        row = self.con.execute("SELECT races FROM prov_blocked WHERE host = ? AND kind = ?", (host, kind)).fetchone()
        races = json.loads(row["races"] or "[]") if row else []
        if self.race and self.race not in races:
            races = (races + [self.race])[-30:]
        self.con.execute("""INSERT INTO prov_blocked (host, kind, example, races, first_seen, last_seen, hits) VALUES (?,?,?,?,?,?,1)
            ON CONFLICT (host, kind) DO UPDATE SET example = excluded.example, races = excluded.races, last_seen = excluded.last_seen,
            hits = hits + 1""", (host, kind, url[:500], json.dumps(races), now, now))

    def _record(self, url, now, status, etag, modified, sha, ctype):
        self.con.execute(
            "INSERT OR REPLACE INTO prov_fetch (url, checked_at, status, etag, modified, sha, ctype) VALUES (?,?,?,?,?,?,?)",
            (url, now, status, etag, modified, sha, ctype))

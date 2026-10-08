"""Polite HTTP for the provisional-results pilot.

Every request: says who we are (user agent with the site's address), obeys robots.txt (a refused URL is
recorded, never fetched), waits a little between two requests to the same host, sends conditional headers
(ETag / Last-Modified) so an unchanged page costs nothing, and gives up on files larger than MAX_BYTES.
Sites that screen robots (an HTTP 200 with an empty or 3-byte body, 403 to non-browsers) are not worked
around: the answer is recorded as refused.
"""

from __future__ import annotations

import hashlib
import time
import urllib.parse
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

UA = "ocn-resultats/1.0 (+https://ocn.kerkia.com; reads results organisers publish, a few times after each race)"
MAX_BYTES = 12 * 1024 * 1024
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
            self._record(full, now, -1, None, None, None, None)
            return Answer(full, -1)
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
            return Answer(final, -1)
        sha = hashlib.sha1(body).hexdigest() if status == 200 else None
        changed = status == 200 and (not prev or prev["sha"] != sha)
        self._record(full, now, status, etag, modified, sha, ctype)
        return Answer(final, status, body if status == 200 else b"", ctype, changed, sha)

    def _record(self, url, now, status, etag, modified, sha, ctype):
        self.con.execute(
            "INSERT OR REPLACE INTO prov_fetch (url, checked_at, status, etag, modified, sha, ctype) VALUES (?,?,?,?,?,?,?)",
            (url, now, status, etag, modified, sha, ctype))

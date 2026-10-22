"""A small polite HTTP client for a country's own sources (its agenda, its federation's lists): our user agent, a pause
between two requests to the same host, a session's cookies kept (a form's filters live in it). The provisional results
have their own (ffco_scraper/prov/fetch.py: conditional requests, robots.txt noted, the sites refusing robots listed);
this one answers in the same shape (`status`, `content`), so a source written for those reads through either."""
from __future__ import annotations

import time
import urllib.parse
from dataclasses import dataclass

import httpx

from ffco_scraper.prov.fetch import UA


@dataclass
class Answer:
    url: str
    status: int                 # 0: a network error
    content: bytes = b""

    def text(self) -> str:
        return self.content.decode("utf-8", "replace")


class Http:
    def __init__(self, pause: float = 0.8, timeout: float = 40.0, lang: str = "es,en;q=0.5"):
        self.client = httpx.Client(headers={"User-Agent": UA, "Accept-Language": lang}, follow_redirects=True, timeout=timeout)
        self.pause = pause
        self.last: dict[str, float] = {}
        self.requests = 0

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def _wait(self, url: str):
        host = urllib.parse.urlsplit(url).netloc
        dt = time.monotonic() - self.last.get(host, 0)
        if dt < self.pause:
            time.sleep(self.pause - dt)
        self.last[host] = time.monotonic()

    def get(self, url: str, conditional: bool = False, params: dict | None = None) -> Answer:
        return self._send("GET", url, params=params)

    def post(self, url: str, data: dict) -> Answer:
        return self._send("POST", url, data=data)

    def _send(self, method: str, url: str, **kw) -> Answer:
        self._wait(url)
        self.requests += 1
        try:
            r = self.client.request(method, url, **kw)
            return Answer(str(r.url), r.status_code, r.content)
        except httpx.HTTPError:
            return Answer(url, 0)

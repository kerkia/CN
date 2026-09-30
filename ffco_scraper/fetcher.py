"""Async HTTP fetcher with bounded concurrency, retries, and an on-disk cache.

The cache is what makes repeated runs (e.g. iterating over 16 seasons, or
re-running after a crash) cheap: a page already on disk is never
re-requested. Concurrency is capped with a semaphore, and a minimum
inter-request interval is enforced across the whole client so the crawler
stays polite to a small federation server even when concurrency is high.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

logger = logging.getLogger("ffco_scraper.fetcher")

DEFAULT_USER_AGENT = (
    "ffco-cn-scraper/1.0 (personal archival tool; contact via ffcorientation.fr account)"
)

# The site occasionally serves an anonymous-visitor "please log in" teaser
# page (HTTP 200) instead of the real content, even for pages that are
# normally public — retrying the same URL almost always gets the real page
# next time, so this must never be cached as if it were valid data.
_LOGIN_WALL_MARKER = "réservée aux licenciés"


class LoginWallError(Exception):
    pass


def _cache_path(cache_dir: Path, url_path: str) -> Path:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", url_path).strip("_") or "root"
    digest = hashlib.sha1(url_path.encode("utf-8")).hexdigest()[:10]
    return cache_dir / f"{slug}_{digest}.html"


@dataclass
class FetchStats:
    cache_hits: int = 0
    network_requests: int = 0
    retries: int = 0
    errors: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def incr(self, name: str) -> None:
        async with self.lock:
            setattr(self, name, getattr(self, name) + 1)


class Fetcher:
    def __init__(
        self,
        base_url: str,
        cache_dir: Path,
        concurrency: int = 8,
        min_interval: float = 0.05,
        timeout: float = 20.0,
        max_retries: int = 4,
        user_agent: str = DEFAULT_USER_AGENT,
        session_cookie: str | None = None,
    ) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        # An FFCO member sessionid unlocks archived seasons, which are
        # otherwise served as the "réservée aux licenciés" page.
        cookies = {"sessionid": session_cookie} if session_cookie else None
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            headers={"User-Agent": user_agent},
            follow_redirects=True,
            cookies=cookies,
        )
        self._sem = asyncio.Semaphore(concurrency)
        self._min_interval = min_interval
        self._max_retries = max_retries
        self._pace_lock = asyncio.Lock()
        self._last_request_at = 0.0
        self.stats = FetchStats()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "Fetcher":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def _pace(self) -> None:
        if self._min_interval <= 0:
            return
        async with self._pace_lock:
            now = time.monotonic()
            wait = self._last_request_at + self._min_interval - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request_at = time.monotonic()

    async def head_header(self, url_path: str, name: str) -> str | None:
        """One response header from a HEAD request (never cached), or None."""
        async with self._sem:
            await self._pace()
            for attempt in range(1, self._max_retries + 1):
                try:
                    await self.stats.incr("network_requests")
                    resp = await self._client.head(url_path)
                    if resp.status_code == 404:
                        return None
                    resp.raise_for_status()
                    return resp.headers.get(name)
                except (httpx.HTTPError, httpx.TransportError) as exc:
                    await self.stats.incr("retries")
                    if attempt == self._max_retries:
                        await self.stats.incr("errors")
                        raise
                    await asyncio.sleep(min(2 ** attempt * 0.5, 10.0))
        return None

    async def get_text(self, url_path: str, *, use_cache: bool = True,
                       login_retries: int | None = None) -> str:
        """GET url_path (relative to base_url) and return decoded text.

        Cached to disk keyed by url_path; set use_cache=False to force a
        fresh network fetch (the result still overwrites the cache entry).
        `login_retries` caps how many times a login-wall page is retried:
        a page that is genuinely members-only would otherwise burn the full
        retry budget with backoff before failing.
        """
        cache_file = _cache_path(self.cache_dir, url_path)
        if use_cache and cache_file.exists():
            await self.stats.incr("cache_hits")
            return cache_file.read_text(encoding="utf-8")

        async with self._sem:
            await self._pace()
            last_exc: Exception | None = None
            for attempt in range(1, self._max_retries + 1):
                try:
                    await self.stats.incr("network_requests")
                    resp = await self._client.get(url_path)
                    if resp.status_code == 404:
                        # Real 404s are stable; cache them as empty so we
                        # do not hammer a URL that will never exist.
                        cache_file.write_text("", encoding="utf-8")
                        return ""
                    resp.raise_for_status()
                    text = resp.text
                    if _LOGIN_WALL_MARKER in text:
                        raise LoginWallError(url_path)
                    cache_file.write_text(text, encoding="utf-8")
                    return text
                except (httpx.HTTPError, httpx.TransportError, LoginWallError) as exc:
                    last_exc = exc
                    if isinstance(exc, LoginWallError) and login_retries is not None and attempt > login_retries:
                        await self.stats.incr("errors")
                        raise
                    await self.stats.incr("retries")
                    backoff = min(2 ** attempt * 0.5, 10.0)
                    logger.warning(
                        "fetch failed (%s/%s) for %s: %s — retrying in %.1fs",
                        attempt,
                        self._max_retries,
                        url_path,
                        exc,
                        backoff,
                    )
                    await asyncio.sleep(backoff)
            await self.stats.incr("errors")
            assert last_exc is not None
            raise last_exc

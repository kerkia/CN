"""Orientation Data (heyries.alwaysdata.net): a MeOSDjango site (sources.meosdjango) fed by MeOS, used in
Provence-Alpes-Côte d'Azur — read as any other, under its own source name.

Until 2026-10-22 its pages were read here one by one, categories' and courses' alike (every runner twice); a course's
JSON now gives each circuit once, with start times.
"""

from __future__ import annotations

from .meosdjango import Site

BASE = "https://heyries.alwaysdata.net"


class Heyries(Site):
    def __init__(self, fetcher):
        super().__init__(fetcher, BASE, kind="heyries")

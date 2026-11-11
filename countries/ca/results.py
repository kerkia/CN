"""The clubs' own results pages (studied 2026-11-11), each read once a run (one request):
- Orienteering Ottawa (ottawaoc.ca/events/past-results): one MeOS file per event day, « /Results/<yyyymmdd>_results.html »,
  from January 2023 — split lists with every runner's split times and SportIdent card (parsers/meos_html `_split_list`); its
  summer series (score-O) in other files. Its robots.txt lists /Results/ as closed to robots: read all the same at a light
  pace (the owner's rule, 2026-10-09), and the site goes on the owner's list (the provisional fetcher notes it);
- Ramblers (Montreal, ramblersoc.ca/en_GB/resultats/): MeOS lists uploaded to WordPress, named by their day
  (« 2026-10-04-results.html », « 2026-11-07-ResultsScore.html »).
"""
from __future__ import annotations

import re
from collections import defaultdict

OTTAWA = "https://ottawaoc.ca/events/past-results"
OTTAWA_FILE = re.compile(r'href="((?:https?://(?:www\.)?ottawaoc\.ca)?/Results/(20\d{6})_results\.html)"', re.I)
RAMBLERS = "https://ramblersoc.ca/en_GB/resultats/"
RAMBLERS_FILE = re.compile(r'href="(https?://ramblersoc\.ca/wp-content/uploads/\d{4}/\d{2}/(20\d\d-\d\d-\d\d)[^"]*\.html?)"', re.I)


def club_files(http) -> dict[str, dict[str, list[str]]]:
    """{club's short name: {day: [results file, …]}} from the clubs' results pages."""
    out: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    a = http.get(OTTAWA)
    if a.status == 200:
        for href, d in OTTAWA_FILE.findall(a.content.decode("utf-8", "replace")):
            url = href if href.startswith("http") else f"https://ottawaoc.ca{href}"
            day = f"{d[:4]}-{d[4:6]}-{d[6:]}"
            if url not in out["OOC"][day]:
                out["OOC"][day].append(url)
    a = http.get(RAMBLERS)
    if a.status == 200:
        for url, day in RAMBLERS_FILE.findall(a.content.decode("utf-8", "replace")):
            if url not in out["ROC"][day]:
                out["ROC"][day].append(url)
    return {k: dict(v) for k, v in out.items()}

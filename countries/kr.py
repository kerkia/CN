"""South Korea: the Korea Orienteering Federation's competitions (KOF, kof.or.kr/competition), its agenda only.

The federation's board of sanctioned competitions, server-rendered, ten a page (studied 2026-10-23): its first pages
each day — date (or dates), title, venue, entry deadline. A dozen national competitions a year; the format and trail-O in
the title.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="KR", federation="KOF", access="all", db=paths.DATA_DIR / "kr.sqlite3",
                  time_zones=("Asia/Seoul",), lang="ko,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://kof.or.kr/competition"
PAGES = 3
DAYS = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*[-~]\s*(?:(\d{1,2})-)?(\d{1,2}))?")
NOTICE = re.compile(r"\s*(요강|공지|\(공지\)|\(요강\))+\s*$")          # « guidelines », « notice »


def read(http, today: date) -> list[dict]:
    from lxml import html as lh
    lo = today - timedelta(days=agenda.BACK_DAYS)
    out = []
    for page in range(1, PAGES + 1):
        a = http.get(LIST, params={"page": str(page)})
        if a.status != 200:
            break
        items = lh.fromstring(a.content).cssselect("li.xe-list-board-list--item")
        older = 0
        for li in items:
            when = li.cssselect(".xe-list-board-list__dynamic-field-date")
            title = li.cssselect(".xe-list-board-list__title-text")
            link = li.cssselect("a[href*='/competition/num/']")
            if not when or not title or not link:
                continue
            m = DAYS.search(when[0].text_content())
            if not m:
                continue
            try:
                start = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                end = start.replace(month=int(m.group(4) or start.month), day=int(m.group(5))) if m.group(5) else None
            except ValueError:
                continue
            if start < lo:
                older += 1
                continue
            name = NOTICE.sub("", re.sub(r"\s+", " ", title[0].text_content())).strip()
            cancelled = "취소" in name
            venue = li.cssselect(".xe-list-board-list__dynamic-field-venue")
            apply = li.cssselect(".xe-list-board-list__dynamic-field-apply")
            close = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", apply[0].text_content()) if apply else None
            num = re.search(r"/num/(\d+)", link[0].get("href")).group(1)
            url = f"{LIST}/num/{num}"
            place = re.sub(r"^\s*개최지\s*", "", venue[0].text_content()).strip() if venue else None
            out.append(agenda.event(
                "KR", num, start.isoformat(), name, end=end.isoformat() if end and end > start else None,
                place=place or None, org="KOF", cancelled=cancelled,
                spec=agenda.TRAIL if "트레일" in name else None,
                reg={"url": url, "close": f"{close.group(1)}-{int(close.group(2)):02d}-{int(close.group(3)):02d}"} if close else None,
                src={"kof": url}))
        if items and older == len(items):
            break
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"kof": "KOF"})

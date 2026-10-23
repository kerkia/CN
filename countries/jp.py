"""Japan: Japan-O-entrY (japan-o-entry.com), where Japan's orienteering events take their entries, the JOA's
sanctioned races included; its agenda only.

The coming events' list, server-rendered, 100 a page (studied 2026-10-23): two or three requests a day — dates,
prefecture and venue, kind (OL, ski-O, rogaine, course), tags (« 公認大会 » sanctioned, « ランキング対象 » ranking event).
Past events are not in it: the agenda keeps the last weeks' from its own earlier runs. The format is in the name
(« スプリント », « ミドル »…).
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import paths
from countries import agenda
from countries.base import Country

COUNTRY = Country(code="JP", federation="JOA", access="all", db=paths.DATA_DIR / "jp.sqlite3",
                  time_zones=("Asia/Tokyo",), lang="ja,en;q=0.5", results=False)
AGENDA_VERSION = 1
LIST = "https://japan-o-entry.com/event/index/event"
SPEC = {"OL": agenda.FOOT, "SKI": agenda.SKI, "ロゲ": "Rogaining"}
COURSE = "講習"                                  # courses, notices
PREFECTURE = re.compile(r"^(\S+?[都道府県])\s*(.*)$")
TAGS = {"公認大会": "公認大会", "ランキング対象": "ランキング対象"}


def dates(text: str, today: date) -> tuple[str | None, str | None]:
    """« 10/24 (土) », « 10/24 - 25 », « 11/10 - 2027/ 1/19 », « 2026/ 3/19 - 2027/ 3/31 » -> (first day, last day). A
    day without its year is of the coming twelve months."""
    parts = [p.strip() for p in re.sub(r"\([^)]*\)", "", text).split(" - ")]

    def one(p, ref):
        m = re.fullmatch(r"(?:(\d{4})/\s*)?(\d{1,2})/\s*(\d{1,2})|(\d{1,2})", p)
        if not m:
            return None
        if m.group(4):                           # the day alone: the start's month
            return ref.replace(day=int(m.group(4))) if ref else None
        y = int(m.group(1)) if m.group(1) else (ref.year if ref else today.year)
        d = date(y, int(m.group(2)), int(m.group(3)))
        if not m.group(1) and not ref and d < today - timedelta(days=agenda.BACK_DAYS + 30):
            d = d.replace(year=y + 1)
        return d
    try:
        start = one(parts[0], None)
        end = one(parts[1], start) if len(parts) > 1 and start else None
    except ValueError:
        return None, None
    if start and end and end < start:
        end = end.replace(year=end.year + 1)
    return (start.isoformat() if start else None), (end.isoformat() if end and end != start else None)


def read(http, today: date, prev: dict | None) -> list[dict]:
    from lxml import html as lh
    out = []
    for page in range(1, 8):
        a = http.get(LIST, params={"page": str(page)})
        if a.status != 200:
            break
        rows = lh.fromstring(a.content).cssselect("tr[id^=shop_]")
        if not rows:
            break
        for tr in rows:
            tds = tr.cssselect("td")
            link = tr.cssselect("a[href*='/event/view/']")
            if len(tds) < 2 or not link:
                continue
            start, end = dates(tds[0].text_content().strip(), today)
            icon = " ".join(x.text_content().strip() for x in tr.cssselect(".event_icon"))
            if not start or (icon == COURSE and end and (date.fromisoformat(end) - date.fromisoformat(start)).days > 31):
                continue                         # a notice open for months, not an event
            eid = re.search(r"/event/view/(\d+)", link[0].get("href")).group(1)
            name = link[0].text_content().strip()
            # after the name: « 長野県「富士見高原リゾート」 » (prefecture, venue), else « (その他) »
            after = (link[0].tail or "").strip()
            m = PREFECTURE.match(after)
            region = m.group(1) if m else None
            venue = re.sub(r"[「」]", "", m.group(2)).strip() if m else None
            tags = [x.text_content().strip() for x in tr.cssselect(".tag")]
            out.append(agenda.event(
                "JP", eid, start, name, kind="f" if icon == COURSE else "c", end=end, place=venue or region,
                region=region, spec=SPEC.get(icon) or agenda.spec_of(name),
                level=" · ".join(TAGS[x] for x in tags if x in TAGS) or None,
                src={"joe": f"https://japan-o-entry.com/event/view/{eid}"}))
    first = min((e["date"] for e in out), default=today.isoformat())
    out += [e for e in (prev or {}).get("events", []) if e["date"] < min(first, today.isoformat())]
    return out


refresh_agenda, agenda_path, agenda_current = agenda.hooks(COUNTRY, read, AGENDA_VERSION, sources={"joe": "Japan-O-entrY"})

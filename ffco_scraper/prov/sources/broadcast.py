"""The organisers' live broadcasts (« Organisation › Direct »; 2026-10-23): a broadcast tied to a competition — MeOS posting
its online results to Ozimut (functions/api/live/mop.js), or the page re-reading the timing software's export — is saved
by its object on the live relay (live/src/index.js, `snapshot`) to R2 as broadcasts/<number>.json, every couple of minutes
while it changes and when the organiser asks (« Publier maintenant »):

    {format: 1, id, race (the competition's key, or null once untied), info {name, organizer, date}, saved (ms),
     order [class names], classes [{name, controls [[code, name], …], rows [[place, name, club, result, status, timeplus,
     progress, start, splits [[time, place, timeplus] | null, …] | null, prel?], …]}]}

in liveresultat's compact form: times in hundredths of a second, the start in hundredths after midnight, liveresultat's
status codes (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 OT, 9 running, 10 not started, 12 NC; MeOS's runners not started yet
may have none). The workflow copies broadcasts/ to CN_DATA_DIR/broadcasts before the run; here each becomes a document of
its competition (source "direct", ranked with the organiser's own files: it is the organiser's timing):

- the results (url « direct:<number> ») once someone has finished — the runners still out are left out and counted in
  the document's `live` mark (model.live_state), so « Résultats » shows the race under way (run.ongoing);
- before that, its start list (« direct:<number>/start », kind "startlist": the runners with their start times, the
  start-time alerts follow), unless the organiser deposited one (run.build keeps theirs alone, « Organisation › Horaires »).

A broadcast untied, or tied to another competition, takes its documents away from the former one. A competition not in
prov_races yet (a race of the agenda the run has not synced) is tried again at the next run.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ..model import category, club_code, doc, klass, live_state, runner
from .liveresultat import STATUS

log = logging.getLogger(__name__)
SOURCE = "direct"
MIN_CONTROLS = 4                 # split times kept for a class whose controls are the course's (a radio control or two: not)
NOTE = "transmis en direct à Ozimut par l'organisateur"
OUT = (9, 10, None)              # running, not started yet, or not started (MeOS gives no status before the start)


def snapshots(folder: Path) -> list[dict]:
    """The broadcasts copied from R2, each with its number."""
    out = []
    for f in sorted(folder.glob("*.json")) if folder.exists() else []:
        try:
            s = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(s, dict) and s.get("format") == 1 and str(s.get("id") or "").isdigit():
            out.append(s)
    return out


def _secs(h) -> float | None:
    return h / 100 if isinstance(h, (int, float)) and h > 0 else None


def documents(snap: dict) -> tuple[dict | None, dict | None]:
    """The broadcast's list of results (None before anyone has finished) and its start list (None once results exist)."""
    info = snap.get("info") or {}
    title = " ".join(x for x in (info.get("name"), f"({info['organizer']})" if info.get("organizer") else None) if x) or None
    date = info.get("date")
    results, starts = [], []
    out, nxt, last, finished = 0, None, None, 0
    for k in snap.get("classes") or []:
        name, rows = str(k.get("name") or "").strip(), k.get("rows") or []
        if not name or not isinstance(rows, list):
            continue
        codes = [str(c[0]) for c in (k.get("controls") or []) if isinstance(c, list) and c]
        full = len(codes) >= MIN_CONTROLS
        rs, ss = [], []
        for r in rows:
            if not isinstance(r, list) or len(r) < 9 or not r[1]:
                continue
            st_code = r[4] if isinstance(r[4], int) else None
            start, t = _secs(r[7]), _secs(r[3])
            st = None if st_code in OUT else STATUS.get(st_code)
            if st == "ok" and t is None:              # (a finish without its time: still out, as far as a list can tell)
                st = None
            common = dict(club=r[2] or None, club_code=club_code(r[2]), category=category(name), start_s=start)
            if start is not None:
                ss.append(runner(r[1], status=st or "start", time_s=t if st == "ok" else None, **common))
            if st is None:
                out += 1
                if st_code != 9 and start is not None and (nxt is None or start < nxt):
                    nxt = start
                continue
            splits = None
            if full and isinstance(r[8], list):
                splits = [_secs(x[0]) if isinstance(x, list) and x else None for x in r[8][:len(codes)]]
                splits += [None] * (len(codes) - len(splits))
                if not any(splits):
                    splits = None
            if st == "ok":
                finished += 1
                if start is not None:
                    last = max(last or 0, start + t)
            rs.append(runner(r[1], place=r[0] if isinstance(r[0], int) and r[0] > 0 and st == "ok" else None,
                             time_s=t if st == "ok" else None, status=st, splits=splits, **common))
        if rs:
            results.append(klass(name, rs, controls=codes if full else None))
        if ss:
            starts.append(klass(name, ss))
    names = [k["name"] for k in results or starts]
    by = "category" if names and sum(1 for n in names if category(n)) >= 0.6 * len(names) else "circuit"
    if finished:
        d = doc("direct", results, by=by, title=title, date=date)
        if live := live_state(out, nxt, last):
            d["live"] = live
        return d, None
    if starts:
        d = doc("direct", starts, by=by, title=title, date=date)
        d["kind"] = "startlist"
        return None, d
    return None, None


def apply(con, folder: Path, save) -> int:
    """Brings the broadcasts' documents in line with their latest saves; the number of documents added, changed or removed."""
    changed = 0
    for snap in snapshots(folder):
        bid = int(snap["id"])
        urls = (f"direct:{bid}", f"direct:{bid}/start")
        key = snap.get("race")
        try:
            if key and not con.execute("SELECT 1 FROM prov_races WHERE key = ?", (key,)).fetchone():
                log.info("broadcast %s: competition %s not known yet, tried again next time", bid, key)
                continue
            # what it gave another competition (it was tied to it), or every competition once untied
            changed += con.execute("DELETE FROM prov_docs WHERE url IN (?, ?) AND race_key IS NOT ?", (*urls, key)).rowcount
            if not key:
                continue
            res, start = documents(snap)
            for url, d in zip(urls, (res, start)):
                if d is None:
                    changed += con.execute("DELETE FROM prov_docs WHERE race_key = ? AND url = ?", (key, url)).rowcount
                else:
                    changed += save(con, key, url, SOURCE, d, note=NOTE)
        except Exception:                                  # one odd broadcast must not stop the run
            log.exception("broadcast %s failed", bid)
    con.commit()
    return changed

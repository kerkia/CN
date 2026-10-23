"""Digest e-mails for subscribed accounts: "a competition you ran is now online".

update.py calls remember() after each fetch (it notes the new competitions) and
run() after a successful deploy (the links in the e-mails must work). run() asks
the site which licences are subscribed (GET /api/notify), finds which of the new
competitions each of them ran in the local database, and posts one item per
licence; the site mails one digest per account and sends what fits in the day's
quota, the rest waiting for a later run (an empty post just drains that backlog).

The first results count wherever they appear (owner, 2026-10-17): an organiser's list
read by the provisional results (« Résultats »: the club's site, liveresultat, WinSplits…)
or FFCO's. The races of the last PROV_DAYS days with a list of results naming a
subscribed runner are posted at every run; one race travels with every id it is known by
(FFCO's competition id, its key on « Résultats »: `alias`), and the site mails it once.

Push notifications (2026-10-18): every alert goes by e-mail, by push, or both, as each account chose; the site decides
(this side only says who ran what). The pushes wait in the site's queue and go a few per call: _drain_push calls again
while some are left. run_push() sends the start times of the coming races' published start lists (the provisional
results' files) for the licences whose account wants them by push; the site notifies each once, and again when the time
changes.

The shared secret NOTIFY_SECRET comes from the environment or from
<data dir>/notify.secret; it must equal the Pages project's NOTIFY_SECRET.
Failures never break an update: the pending list is kept and retried next run.
"""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import paths

PENDING = paths.DATA_DIR / "notify.pending.json"        # competitions not yet announced
SITE = os.environ.get("CN_SITE_URL", "https://ozimut.com").rstrip("/")
RECENT_DAYS = 60            # a revised result for an old race must not mail anyone
PROV_DAYS = 4               # the organisers' results of the last days only (a new subscriber is not told about old races)
CHUNK = 50                  # licences per request (the Functions have a small budget per call)


def _secret() -> str | None:
    s = os.environ.get("NOTIFY_SECRET")
    f = paths.DATA_DIR / "notify.secret"
    if not s and f.exists():
        s = f.read_text(encoding="utf-8").strip()
    return s or None


def _call(method: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{SITE}/api/notify", method=method, data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {_secret()}", "Content-Type": "application/json", "User-Agent": "ocn-update/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def remember(changes) -> None:
    """Note the competitions of this fetch that are new, or just got results, and are recent."""
    limit = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    ids = {int(c.course_id) for c in changes if c.kind in ("new", "results") and (c.date_iso or "") >= limit}
    if not ids:
        return
    old = set(json.loads(PENDING.read_text())) if PENDING.exists() else set()
    PENDING.write_text(json.dumps(sorted(old | ids)))


def _norm(lic) -> str:
    return str(lic).strip().lstrip("0") or "0"


def _prov_races(out: Path | None) -> list[dict]:
    """The provisional results' index (site/data/prov/index.json), [] when there is none."""
    try:
        return json.loads((out / "prov" / "index.json").read_text(encoding="utf-8")).get("races", []) if out else []
    except (OSError, ValueError):
        return []


def _prov_by_licence(races: list[dict], licences: set[str]) -> dict[str, list[dict]]:
    """The races of the last PROV_DAYS days whose organiser's list of results names a subscribed runner. A race FFCO has
    published goes by its competition id (the same as FFCO's digest), its key as an alias; the link opens « Résultats »."""
    today = date.today()
    first = (today - timedelta(days=PROV_DAYS)).isoformat()
    out: dict[str, list[dict]] = {}
    for r in races:
        # (a race still under way waits until it is over: its lists are partial — run.build's `ongoing`)
        if not r.get("results") or r.get("soon") or r.get("ongoing") or not first <= (r.get("date_iso") or "") <= today.isoformat():
            continue
        fid = r.get("ffco_id")
        item = {"id": str(fid) if fid else r["key"], "alias": [r["key"]] if fid else [], "prov": r["key"],
                "title": r.get("name") or "", "date": r["date_iso"], "location": r.get("place") or ""}
        for lic in (r["rlics"] if r.get("rlics") is not None else r.get("lics")) or []:   # rlics only when they differ
            k = _norm(lic)
            if k in licences:
                out.setdefault(k, []).append(item)
    return out


def _races_by_licence(db: Path, ids: list[int], licences: set[str], alias: dict[str, str] | None = None) -> dict[str, list[dict]]:
    con = sqlite3.connect(db)
    try:
        marks = ",".join("?" * len(ids))
        rows = con.execute(
            f"""SELECT DISTINCT r.licence, c.course_id, c.title, c.date_iso, c.location
                FROM results r JOIN circuits ci ON ci.circuit_id = r.circuit_id
                JOIN competitions c ON c.course_id = ci.course_id
                WHERE c.course_id IN ({marks}) AND r.licence IS NOT NULL AND r.licence != ''""", ids).fetchall()
    finally:
        con.close()
    out: dict[str, list[dict]] = {}
    for lic, cid, title, d, loc in rows:
        key = _norm(lic)
        if key in licences:
            a = (alias or {}).get(str(cid))
            out.setdefault(key, []).append({"id": str(cid), "alias": [a] if a else [], "title": title, "date": d, "location": loc})
    return out


CATCHUP = paths.DATA_DIR / "notify.catchup"     # (once: see run)
CATCHUP_DAYS = 21


def _catch_up(db: Path) -> None:
    """Once: the competitions of the last CATCHUP_DAYS days go back to the pending list. Until 2026-10-12 the update
    runs' secret did not match the site's and the pending list was not kept between runs: no digest was ever sent.
    (The site never mails a competition twice to one account: « notified ».)"""
    if CATCHUP.exists():
        return
    con = sqlite3.connect(db)
    try:
        ids = {r[0] for r in con.execute("SELECT course_id FROM competitions WHERE date_iso >= ?",
                                         ((date.today() - timedelta(days=CATCHUP_DAYS)).isoformat(),))}
    finally:
        con.close()
    old = set(json.loads(PENDING.read_text())) if PENDING.exists() else set()
    PENDING.write_text(json.dumps(sorted(old | {int(i) for i in ids})))


def run(db: Path, out: Path | None = None) -> None:
    """Announce the pending competitions and the organisers' new results, then drain the mail queue. Never raises."""
    if not _secret():
        print("5. notify: no NOTIFY_SECRET — skipped")
        return
    try:
        _catch_up(db)
        ids = sorted(json.loads(PENDING.read_text())) if PENDING.exists() else []
        items: list[dict] = []
        prov = _prov_races(out)
        first = (date.today() - timedelta(days=PROV_DAYS)).isoformat()
        recent = [r for r in prov if r.get("results") and not r.get("soon") and not r.get("ongoing") and (r.get("date_iso") or "") >= first]
        n_prov = 0
        if ids or recent:
            got = _call("GET")
            licences = {_norm(x) for x in got["licences"]}
            if got.get("v", 1) < 2:            # a site that does not know `alias` and `prov` yet: FFCO's competitions only
                recent = []
            alias = {str(r["ffco_id"]): r["key"] for r in prov if r.get("ffco_id")}
            races = _races_by_licence(db, ids, licences, alias) if licences and ids else {}
            # FFCO's first, then the organisers' races it does not already give (the same id: FFCO's link wins)
            for lic, rs in (_prov_by_licence(recent, licences) if licences else {}).items():
                have = {r["id"] for r in races.get(lic, [])}
                extra = [r for r in rs if r["id"] not in have]
                n_prov += len(extra)
                races.setdefault(lic, []).extend(extra)
            items = [{"lic": lic, "races": r[:30]} for lic, r in races.items() if r]
        queued = sent = 0
        batches = [items[i:i + CHUNK] for i in range(0, len(items), CHUNK)] or [[]]
        for batch in batches:
            res = _call("POST", {"items": batch})
            queued += res["queued"]; sent += res["sent"]
        # more backlog than one call can send: keep going while the quota allows
        while res["remaining"] and res["budget"] and res["sent"]:
            res = _call("POST", {"items": []})
            sent += res["sent"]
        pushed, push_left = _drain_push(res)
        PENDING.unlink(missing_ok=True)
        CATCHUP.write_text(date.today().isoformat())
        if ids or queued or sent or res["remaining"] or pushed:
            print(f"5. notify: {len(ids)} competitions, {n_prov} organisers' results, {len(items)} subscribed runners, "
                  f"{queued} digests queued (e-mail or push), {sent} e-mails sent, {res['remaining']} waiting, "
                  f"{pushed} notifications sent{f', {push_left} waiting' if push_left else ''}")
    except urllib.error.HTTPError as e:
        print(f"5. notify: the site refused ({e.code}{' — NOTIFY_SECRET differs from the Pages one' if e.code == 403 else ''}) — will retry at the next run")
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"5. notify: failed ({e}) — will retry at the next run")
    run_push(out)


def _drain_push(res: dict) -> tuple[int, int]:
    """Send the site's queued notifications, a few per call, while some are left and the calls make progress.
    -> (sent, left). (Each call drains the e-mail queue too, within its quota.)"""
    sent, left, before = res.get("pushSent", 0), res.get("pushLeft", 0), None
    for _ in range(80):
        if not left or (before is not None and left >= before):
            break
        before = left
        res = _call("POST", {"items": []})
        sent += res.get("pushSent", 0)
        left = res.get("pushLeft", 0)
    return sent, left


def _starts(out: Path, licences: set[str]) -> list[dict]:
    """The start times of the coming races (today included) for these licences: one per runner and race, from the
    race's first start list (its documents come best first: the organiser's own, « Organisation › Horaires »)."""
    today = date.today().isoformat()
    items: dict[tuple[str, str], dict] = {}
    for r in _prov_races(out):
        if not r.get("startlist") or (r.get("date_iso") or "") < today:
            continue
        try:
            race = json.loads((out / "prov" / f"{r['key']}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for doc in race.get("docs", []):
            if doc.get("kind") != "startlist" or not doc.get("classes"):
                continue
            for k in doc["classes"]:
                for runner in k.get("runners", []):
                    lic, s = runner.get("lic"), runner.get("start_s")
                    if not lic or s is None or _norm(lic) not in licences or (_norm(lic), r["key"]) in items:
                        continue
                    items[(_norm(lic), r["key"])] = {"lic": _norm(lic), "key": r["key"], "name": r.get("name") or "",
                                                     "date": r["date_iso"], "place": r.get("place") or "",
                                                     "start_s": int(s), "cls": k.get("name") or ""}
            break                                   # the race's first start list only
    return list(items.values())


def run_push(out: Path | None) -> None:
    """Send the published start times to the site, which notifies the runners with push on. Never raises."""
    if not _secret() or not out or not any(r.get("startlist") for r in _prov_races(out)):
        return
    try:
        got = _call("GET")
        licences = {_norm(x) for x in got.get("push") or []}
        starts = _starts(out, licences) if got.get("v", 1) >= 3 and licences else []
        if not starts:
            return
        queued = sent = 0
        for i in range(0, len(starts), 300):
            res = _call("POST", {"starts": starts[i:i + 300]})
            queued += res.get("startsQueued", 0)
            sent += res.get("pushSent", 0)
        more, left = _drain_push(res)
        if queued or sent or more:
            print(f"5b. push: {len(starts)} start times of {len(licences)} runners with notifications, {queued} new or changed, "
                  f"{sent + more} notifications sent{f', {left} waiting' if left else ''}")
    except urllib.error.HTTPError as e:
        print(f"5b. push: the site refused ({e.code}) — will retry at the next run")
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"5b. push: failed ({e}) — will retry at the next run")


def type_label(e: dict) -> str:
    """Same wording as the Agenda page: Forêt MD, Forêt LD, Sprint, VTT MD, Ski…"""
    sp, ep = e.get("spec", ""), e.get("epr", "")
    if sp == "Pédestre":
        return f"Forêt {ep}" if ep in ("MD", "LD") else ep or "Pédestre"
    if sp in ("VTT", "Ski"):
        return f"{sp} {ep}".strip()
    if sp.startswith("Raid"):
        return sp
    return f"{sp} {ep}".strip() or "—"


def run_agenda(agenda_json: Path) -> None:
    """Send the upcoming courses to the site: it alerts the accounts that follow their region about the
    ones it has not announced yet (the first call only records them). Never raises."""
    if not _secret():
        print("6. agenda alert: no NOTIFY_SECRET — skipped")
        return
    try:
        today = date.today().isoformat()
        a = json.loads(agenda_json.read_text(encoding="utf-8"))
        depts = a.get("depts", {})
        keep = ("name", "date", "place", "dep", "region", "groupe", "manif", "org", "referee", "referee2", "controller",
                "delegate", "monitor", "contact", "phone", "email", "site", "flechage", "invitation", "access", "gps",
                "mapUrl", "obs", "cn")
        events = []
        for e in a["events"]:
            if e["kind"] != "c" or e.get("id") is None or e["date"] < today or e.get("cancelled"):
                continue
            ev = {k: e[k] for k in keep if k in e} | {"id": e["id"], "type": type_label(e), "depName": depts.get(e.get("dep", ""), "")}
            if e.get("reg"):
                ev["reg"] = {k: e["reg"].get(k) for k in ("url", "close", "mods", "count", "teams")}
            events.append(ev)
        res = _call("POST", {"agenda": events})
        pushed, push_left = _drain_push(res)
        print(f"6. agenda alert: {len(events)} upcoming courses checked, {res.get('agendaQueued', 0)} new-course and "
              f"{res.get('deadlineQueued', 0)} closing-registration alerts queued (e-mail or push), {res['sent']} e-mails sent, "
              f"{res['remaining']} waiting, {pushed} notifications sent{f', {push_left} waiting' if push_left else ''}")
    except urllib.error.HTTPError as e:
        print(f"6. agenda alert: the site refused ({e.code}{' — NOTIFY_SECRET differs from the Pages one' if e.code == 403 else ''}) — will retry at the next run")
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"6. agenda alert: failed ({e}) — will retry at the next run")

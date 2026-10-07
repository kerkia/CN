"""Digest e-mails for subscribed accounts: "a competition you ran is now online".

update.py calls remember() after each fetch (it notes the new competitions) and
run() after a successful deploy (the links in the e-mails must work). run() asks
the site which licences are subscribed (GET /api/notify), finds which of the new
competitions each of them ran in the local database, and posts one item per
licence; the site mails one digest per account and sends what fits in the day's
quota, the rest waiting for a later run (an empty post just drains that backlog).

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
SITE = os.environ.get("CN_SITE_URL", "https://ocn.kerkia.com").rstrip("/")
RECENT_DAYS = 60            # a revised result for an old race must not mail anyone
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


def _races_by_licence(db: Path, ids: list[int], licences: set[str]) -> dict[str, list[dict]]:
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
        key = str(lic).strip().lstrip("0") or "0"
        if key in licences:
            out.setdefault(key, []).append({"id": cid, "title": title, "date": d, "location": loc})
    return out


def run(db: Path) -> None:
    """Announce the pending competitions, then drain the mail queue. Never raises."""
    if not _secret():
        print("5. notify: no NOTIFY_SECRET — skipped")
        return
    try:
        ids = sorted(json.loads(PENDING.read_text())) if PENDING.exists() else []
        items: list[dict] = []
        if ids:
            licences = {str(x) for x in _call("GET")["licences"]}
            races = _races_by_licence(db, ids, licences) if licences else {}
            items = [{"lic": lic, "races": r[:30]} for lic, r in races.items()]
        queued = sent = 0
        batches = [items[i:i + CHUNK] for i in range(0, len(items), CHUNK)] or [[]]
        for batch in batches:
            res = _call("POST", {"items": batch})
            queued += res["queued"]; sent += res["sent"]
        # more backlog than one call can send: keep going while the quota allows
        while res["remaining"] and res["budget"] and res["sent"]:
            res = _call("POST", {"items": []})
            sent += res["sent"]
        PENDING.unlink(missing_ok=True)
        if ids or sent or res["remaining"]:
            print(f"5. notify: {len(ids)} competitions, {len(items)} subscribed runners, {queued} digests queued, "
                  f"{sent} e-mails sent, {res['remaining']} waiting")
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"5. notify: failed ({e}) — will retry at the next run")


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
        print(f"6. agenda alert: {len(events)} upcoming courses checked, {res.get('agendaQueued', 0)} new-course and "
              f"{res.get('deadlineQueued', 0)} closing-registration e-mails queued, {res['sent']} sent, {res['remaining']} waiting")
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print(f"6. agenda alert: failed ({e}) — will retry at the next run")

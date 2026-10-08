"""Files organisers upload on « Récemment » (functions/api/upload.js): a results or split-times export for a race of
the list, or for a race the site does not know yet (added with it).

The Function keeps each upload in R2 under uploads/<id>/: the file as sent, and meta.json — {id, created, user,
race (the race's key) or new_race {name, date, place, org, org_code, terrain, epreuve, cn}, filename, size, status
("active", or "removed" by the administrator)}. The workflow copies uploads/ to CN_DATA_DIR/uploads before the run;
here each new or changed upload becomes a document of its race (source "upload"), read by the usual parsers — a .zip
or .gz is opened first. A new upload by the same account for the same race replaces the previous one; a removed one
takes its documents (and the race it added, if nothing else came of it) away. Uploads already read are remembered in
prov_meta 'uploads' (id -> [file size, status]); a new parser version reads them all again. R2 drops the files after
60 days (the Function's clean-up); their documents stay.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import zipfile
from pathlib import Path

from .. import races, store

log = logging.getLogger(__name__)
READABLE = (".xml", ".html", ".htm", ".pdf", ".csv", ".txt")
MAX_MEMBER = 60 * 1024 * 1024          # a member of an archive, unpacked


def uploads(folder: Path) -> list[dict]:
    """The uploads copied from R2, oldest first: meta.json + 'path' (the file, if still there)."""
    out = []
    for meta in sorted(folder.glob("*/meta.json")) if folder.exists() else []:
        try:
            m = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        f = meta.parent / str(m.get("stored") or m.get("filename") or "")
        m["path"] = f if f.is_file() else None
        out.append(m)
    return sorted(out, key=lambda m: int(m.get("id") or 0))


def files_in(name: str, content: bytes) -> list[tuple[str, bytes]]:
    """The readable files of an upload: itself, or what a .zip / .gz holds."""
    low = name.lower()
    if low.endswith(".zip") or content[:4] == b"PK\x03\x04":
        out = []
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            for i in z.infolist():
                if not i.is_dir() and i.filename.lower().endswith(READABLE) and i.file_size <= MAX_MEMBER \
                        and not i.filename.startswith("__MACOSX"):
                    out.append((i.filename.rsplit("/", 1)[-1], z.read(i)))
        return out
    if low.endswith(".gz") or content[:2] == b"\x1f\x8b":
        return [(name[:-3] if low.endswith(".gz") else name, gzip.decompress(content)[:MAX_MEMBER])]
    return [(name, content)]


def race_for(con, m: dict) -> str | None:
    """The race's key: the one chosen, or a race added for this upload ('u<id>')."""
    if m.get("race"):
        return m["race"] if con.execute("SELECT 1 FROM prov_races WHERE key = ?", (m["race"],)).fetchone() else None
    r = m.get("new_race") or {}
    if not (r.get("name") and r.get("date")):
        return None
    key = f"u{m['id']}"
    if not con.execute("SELECT 1 FROM prov_races WHERE key = ?", (key,)).fetchone():
        code = races.org_code(r.get("org")) or (r.get("org_code") or None)
        now = races.now_iso()
        # agenda_id 0: FFCO's results of the same race, when they come, are linked to it rather than added twice
        con.execute("""INSERT INTO prov_races (key, date_iso, name, place, org, org_code, terrain, epreuve, cn, site, agenda_id,
            first_seen, next_check) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (key, r["date"], r["name"], r.get("place") or None, r.get("org") or None, code, r.get("terrain") or None,
                     r.get("epreuve") or None, int(bool(r.get("cn"))), races.club_site(con, code), 0, now, now))
    return key


def apply(con, folder: Path, save, parse_any, reread: bool = False) -> int:
    """Turns the new uploads into documents; the number of documents added, changed or removed."""
    done = store.meta_get(con, "uploads", {}) or {}
    ups = uploads(folder)
    changed = 0
    # the latest upload of an account for a race replaces its earlier ones
    latest: dict = {}
    for m in ups:
        if m.get("status") == "active" and m.get("race"):
            latest[(m.get("user"), m["race"])] = m["id"]
    for m in ups:
        uid, state = str(m.get("id")), [m.get("size"), m.get("status")]
        superseded = m.get("race") and latest.get((m.get("user"), m["race"])) not in (None, m["id"])
        if done.get(uid) == state + [bool(superseded)] and not reread:
            continue
        prefix = f"upload:{uid}/"
        try:
            if m.get("status") != "active" or superseded:
                n = con.execute("DELETE FROM prov_docs WHERE url LIKE ?", (prefix + "%",)).rowcount
                changed += n
                if m.get("status") != "active" and not m.get("race"):       # the race it added goes with it
                    key = f"u{uid}"
                    if not con.execute("SELECT 1 FROM prov_docs WHERE race_key = ?", (key,)).fetchone():
                        con.execute("DELETE FROM prov_races WHERE key = ?", (key,))
            elif m.get("path"):
                key = race_for(con, m)
                if key is None:
                    log.warning("upload %s: unknown race %s", uid, m.get("race"))
                else:
                    when = str(m.get("created") or "")[:10]
                    note = f"déposé sur O'CN le {when[8:10]}/{when[5:7]}/{when[:4]}" if len(when) == 10 else "déposé sur O'CN"
                    for name, content in files_in(m.get("filename") or m["path"].name, m["path"].read_bytes()):
                        d = parse_any(content, name)
                        if d is not None:
                            d["title"] = d.get("title") or name
                        changed += save(con, key, prefix + name, "upload", d, kind=None if d else "unparsed", note=note)
                    # the race is looked at again soon (its scores, the platforms): the upload may be its first news
                    con.execute("UPDATE prov_races SET done = 0, next_check = NULL WHERE key = ?", (key,))
            else:
                continue                                   # the file is gone (after 60 days): its documents stay
        except Exception:                                  # one odd file must not stop the run
            log.exception("upload %s failed", uid)
        done[uid] = state + [bool(superseded)]
    store.meta_set(con, "uploads", done)
    con.commit()
    return changed

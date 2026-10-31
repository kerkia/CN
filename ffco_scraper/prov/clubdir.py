"""The directory of France's clubs, committees and ligues with their websites (Stats › Clubs › « Annuaire », owner
2026-10-31): FFCO's structure pages on api.ffcorientation.fr — the list of ligues and committees (`/iframe/structures/`),
each ligue's page (`/iframe/ligues/<id>/`: its number, website and committees, and the clubs it holds directly) and each
committee's (`/iframe/comites/<id>/`: its département number, ligue, website and clubs). Only numbers, names and websites
are kept, never the officers' names, the postal addresses, phones or e-mails the pages also print. A few pages a run, the
oldest first, each read again every week: a new website, a changed one or a new club shows within a week. A club found on
a committee's page that the club directory (races.read_directory) has not read yet is queued there at once, so its own
website comes at the next runs. The site's file is France's `clubdir.json`, written by `build` when it changed."""

from __future__ import annotations

import html as htmlmod
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .races import DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS prov_struct (
  kind       TEXT NOT NULL,              -- 'ligue' | 'comite'
  id         INTEGER NOT NULL,           -- FFCO's own id (/iframe/ligues/<id>/)
  code       TEXT,                       -- 'AR' for a ligue, the département '01' for a committee
  name       TEXT,
  parent     INTEGER,                    -- a committee's ligue (its id)
  site       TEXT,                       -- the website the page gives ('' none)
  site_at    TEXT,                       -- when that website was first seen (a change resets it)
  read_at    TEXT NOT NULL,              -- '' = never read
  seen_at    TEXT,                       -- last listed by FFCO (the structures' list or a ligue's page)
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS prov_struct_club (
  id         INTEGER PRIMARY KEY,        -- the club directory's id (prov_club_dir.id)
  code       TEXT,                       -- FFCO club number '0109'
  name       TEXT,
  comite     INTEGER,                    -- the committee whose page lists it
  ligue      INTEGER,                    -- the ligue whose page lists it (directly, or through the committee)
  seen_at    TEXT NOT NULL
);
"""

EVERY_DAYS = 7          # a structure's page is read again after a week
FORGET_DAYS = 45        # a structure or club FFCO no longer lists leaves the directory after this


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", htmlmod.unescape(re.sub(r"<[^>]+>", " ", s)).replace("\xa0", " ")).strip()


def _site(page: str) -> str:
    m = re.search(r"Site web(?:&nbsp;|\s)*:\s*<a href=\"([^\"]+)\"", page)
    return htmlmod.unescape(m.group(1)).strip() if m else ""


def _number(page: str) -> str | None:
    m = re.search(r"Num[ée]ro FFCO(?:&nbsp;|\s)*:\s*([0-9A-Za-z]{1,4})", page)
    return m.group(1).upper() if m else None


def _links(page: str, kind: str) -> list[tuple[int, str]]:
    """(id, text) of the page's links to /iframe/<kind>/<id>/."""
    return [(int(i), _text(t)) for i, t in re.findall(rf'<a href="/iframe/{kind}/(\d+)/">(.*?)</a>', page, re.S)]


def _split(text: str) -> tuple[str | None, str]:
    """'0109 - O'BUGEY' -> ('0109', "O'BUGEY")."""
    m = re.match(r"\s*([0-9A-Za-z]{1,4})\s*-\s*(.*)", text)
    return (m.group(1).upper(), m.group(2).strip()) if m else (None, text.strip())


def parse_list(page: str) -> list[tuple[str, int, str | None, str]]:
    """The structures' page: [(kind, id, code, name)] from its two selects (committees with clubs, every ligue)."""
    out = []
    for name, kind in (("comite", "comite"), ("ligue", "ligue")):
        m = re.search(rf'<select name="{name}".*?</select>', page, re.S)
        for i, t in re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>', m.group(0) if m else "", re.S):
            code, nm = _split(_text(t))
            out.append((kind, int(i), code, nm))
    return out


def parse_page(page: str) -> dict:
    """A ligue's or a committee's page: its name, number, website, ligue (a committee's), committees (a ligue's) and clubs."""
    h1 = re.search(r"<h1>(.*?)</h1>", page, re.S)
    lig = _links(page, "ligues")
    return {"name": _text(h1.group(1)) if h1 else None, "code": _number(page), "site": _site(page),
            "ligue": lig[0][0] if lig else None,
            "comites": [(i, *_split(t)) for i, t in _links(page, "comites")],
            "clubs": [(i, *_split(t)) for i, t in _links(page, "clubs")]}


def connect(con) -> None:
    con.executescript(SCHEMA)


def _set_site(con, kind: str, sid: int, site: str, stamp: str) -> bool:
    """Stores a structure's website; True when it changed (a new one, or another address)."""
    row = con.execute("SELECT site FROM prov_struct WHERE kind = ? AND id = ?", (kind, sid)).fetchone()
    old = row[0] if row else None
    if old == site:
        return False
    con.execute("UPDATE prov_struct SET site = ?, site_at = ? WHERE kind = ? AND id = ?", (site, stamp, kind, sid))
    return old is not None


def _club(con, cid: int, code: str | None, name: str, comite: int | None, ligue: int | None, stamp: str) -> None:
    con.execute("""INSERT INTO prov_struct_club (id, code, name, comite, ligue, seen_at) VALUES (?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name,
                     comite = COALESCE(excluded.comite, prov_struct_club.comite), ligue = excluded.ligue,
                     seen_at = excluded.seen_at""",
                (cid, code.zfill(4) if code and code.isdigit() else code, name, comite, ligue, stamp))
    # a club the club directory has not read: its popup (and website) at the next runs
    con.execute("INSERT OR IGNORE INTO prov_club_dir (id, read_at) VALUES (?, '')", (cid,))


def read(con, f, per_run: int = 12) -> dict:
    """Reads FFCO's structure pages due (the list once a week, then a few pages a run, the oldest first).
    Returns {"read": pages read, "changed": websites changed or new}."""
    connect(con)
    stamp = _now()
    old = (datetime.now(timezone.utc) - timedelta(days=EVERY_DAYS)).isoformat()
    last = con.execute("SELECT v FROM prov_meta WHERE k = 'struct_list'").fetchone()
    got = {"read": 0, "changed": 0}
    if not last or last[0] < old:
        a = f.get(f"{DIR}/structures/", conditional=False)
        if a.status == 200:
            for kind, sid, code, name in parse_list(a.content.decode("utf-8", "replace")):
                con.execute("""INSERT INTO prov_struct (kind, id, code, name, read_at, seen_at) VALUES (?,?,?,?,'',?)
                               ON CONFLICT(kind, id) DO UPDATE SET seen_at = excluded.seen_at""",
                            (kind, sid, code, name, stamp))
            con.execute("INSERT OR REPLACE INTO prov_meta (k, v) VALUES ('struct_list', ?)", (stamp,))
            got["read"] += 1
    # the ligues first (their pages name the committees), then the committees; the first time (pages never read) all of
    # them at once, ~110 pages: the directory is only published complete (build)
    if con.execute("SELECT 1 FROM prov_struct WHERE read_at = '' LIMIT 1").fetchone():
        per_run = max(per_run, 150)
    due = con.execute("""SELECT kind, id FROM prov_struct WHERE read_at < ?
                         ORDER BY kind = 'comite', read_at LIMIT ?""", (old, per_run)).fetchall()
    for kind, sid in due:
        if f.out_of_time():
            break
        a = f.get(f"{DIR}/{'ligues' if kind == 'ligue' else 'comites'}/{sid}/", conditional=False)
        if a.status == 404:            # gone: read again next week, forgotten once unlisted for FORGET_DAYS
            con.execute("UPDATE prov_struct SET read_at = ? WHERE kind = ? AND id = ?", (stamp, kind, sid))
            continue
        if a.status != 200:
            continue
        p = parse_page(a.content.decode("utf-8", "replace"))
        got["read"] += 1
        con.execute("UPDATE prov_struct SET code = COALESCE(?, code), name = COALESCE(?, name), parent = ?, read_at = ? "
                    "WHERE kind = ? AND id = ?", (p["code"], p["name"], p["ligue"] if kind == "comite" else None,
                                                  stamp, kind, sid))
        got["changed"] += _set_site(con, kind, sid, p["site"], stamp)
        if kind == "ligue":
            for cid, code, name in p["comites"]:
                con.execute("""INSERT INTO prov_struct (kind, id, code, name, parent, read_at, seen_at)
                               VALUES ('comite',?,?,?,?,'',?)
                               ON CONFLICT(kind, id) DO UPDATE SET parent = excluded.parent, seen_at = excluded.seen_at""",
                            (cid, code, name, sid, stamp))
            for cid, code, name in p["clubs"]:          # clubs a ligue holds directly (no committee)
                _club(con, cid, code, name, None, sid, stamp)
        else:
            con.execute("UPDATE prov_struct SET seen_at = ? WHERE kind = 'comite' AND id = ?", (stamp, sid))
            for cid, code, name in p["clubs"]:
                _club(con, cid, code, name, sid, p["ligue"], stamp)
    con.commit()
    return got


# ---- the site's file -----------------------------------------------------------------------------------------
# today's ligue of each département (as site/assets/js/geo.js): a club FFCO's pages do not place is put by its number
REGION_DEPTS = {
    "AR": "01 03 07 15 26 38 42 43 63 69 73 74", "BF": "21 25 39 58 70 71 89 90", "BR": "22 29 35 56",
    "CE": "18 28 36 37 41 45", "CO": "20", "GE": "08 10 51 52 54 55 57 67 68 88", "HF": "02 59 60 62 80",
    "IF": "75 77 78 91 92 93 94 95", "NM": "14 27 50 61 76", "NA": "16 17 19 23 24 33 40 47 64 79 86 87",
    "OC": "09 11 12 30 31 32 34 46 48 65 66 81 82", "PL": "44 49 53 72 85", "PZ": "04 05 06 13 83 84",
    "OM": "96 97", "NC": "98",
}
DEPT_REGION = {d: r for r, ds in REGION_DEPTS.items() for d in ds.split()}
# hosts that are no club's own site (an event's agenda entry gives them: payments, registrations, the federation)
NOT_A_SITE = re.compile(r"helloasso\.|ffcorientation\.fr/?$|api\.ffcorientation|google\.com/forms|docs\.google|"
                        r"weezevent|billetweb|lien\.ffcorientation", re.I)


def _host(url: str | None) -> str:
    m = re.match(r"https?://(?:www\.)?([^/]+)", url or "", re.I)
    return m.group(1).lower() if m else ""


def _dept_of(code: str | None) -> str | None:
    """A club's département from its number ('0109' -> '01', '2A03' -> '20'), as FFCO numbers them."""
    if not code or len(code) < 4:
        return None
    d = code[:2].upper()
    return "20" if d in ("2A", "2B") else d if d.isdigit() else None


def directory(con, names: dict | None = None, depts: dict | None = None) -> dict:
    """The tree: ligues › départements › clubs, each with its website ('' = none found). `names`: the site's club
    names by number (meta.json), for the clubs FFCO's pages do not name; `depts`: the départements' names."""
    connect(con)
    names, depts = names or {}, depts or {}
    cut = (datetime.now(timezone.utc) - timedelta(days=FORGET_DAYS)).isoformat()
    ligues = {r["id"]: dict(r) for r in con.execute(
        "SELECT * FROM prov_struct WHERE kind = 'ligue' AND seen_at >= ? AND read_at != ''", (cut,))}
    comites = {r["id"]: dict(r) for r in con.execute(
        "SELECT * FROM prov_struct WHERE kind = 'comite' AND seen_at >= ? AND read_at != ''", (cut,))}
    struct_hosts = {_host(s["site"]) for s in [*ligues.values(), *comites.values()] if s["site"]}
    ffco_site = {r[0]: r[1] for r in con.execute("SELECT code, site FROM prov_club_dir WHERE code IS NOT NULL")}
    in_dir = set(ffco_site)
    agenda_site = {r[0]: r[1] for r in con.execute("SELECT code, site FROM prov_clubs WHERE length(code) = 4")}

    def club_site(code):
        s = ffco_site.get(code)
        if s and s.lower().startswith("http"):
            return s, "ffco"
        a = agenda_site.get(code)
        if a and not NOT_A_SITE.search(a) and _host(a) not in struct_hosts:
            return a, "agenda"
        return "", None

    lig_code = {i: (l["code"] or "").upper() for i, l in ligues.items()}
    tree: dict[str, dict] = {}                        # ligue code -> {code, name, site, depts: {dept: {…}}}

    def ligue_node(code):
        if code not in tree:
            l = next((x for x in ligues.values() if (x["code"] or "").upper() == code), None)
            tree[code] = {"code": code, "name": l["name"] if l else code, "site": (l or {}).get("site") or "",
                          "ffco": bool(l), "depts": {}}
        return tree[code]

    def dept_node(lcode, d, comite=None):
        lg = ligue_node(lcode)
        if d not in lg["depts"]:
            lg["depts"][d] = {"code": d, "name": depts.get(d) or (comite or {}).get("name") or d,
                              "cdco": comite is not None, "site": (comite or {}).get("site") or "", "clubs": {}}
        elif comite is not None and not lg["depts"][d]["cdco"]:
            lg["depts"][d].update(cdco=True, site=comite.get("site") or "")
        return lg["depts"][d]

    for l in ligues.values():
        ligue_node((l["code"] or "").upper())
    for c in comites.values():
        d = (c["code"] or "").zfill(2) if (c["code"] or "").isdigit() else (c["code"] or "")
        lcode = lig_code.get(c["parent"]) or DEPT_REGION.get(d)
        if lcode and d != "99":                       # (« CD Virtuel FFCO »: no département)
            dept_node(lcode, d, c)
    placed = set()
    for r in con.execute("SELECT * FROM prov_struct_club WHERE seen_at >= ?", (cut,)):
        code = r["code"]
        if not code or code in placed:
            continue
        c = comites.get(r["comite"]) if r["comite"] else None
        d = ((c["code"] or "").zfill(2) if c and (c["code"] or "").isdigit() else None) or _dept_of(code)
        lcode = lig_code.get(r["ligue"]) or (lig_code.get(c["parent"]) if c else None) or DEPT_REGION.get(d or "")
        if not lcode:
            continue
        site, src = club_site(code)
        node = dept_node(lcode, d or "", None)
        node["clubs"][code] = {"code": code, "name": r["name"] or names.get(code) or code, "site": site,
                               **({"src": src} if src == "agenda" else {})}
        placed.add(code)
    # the club directory's clubs no structure page listed (its map lists clubs the committees' pages may not)
    for code in sorted(in_dir - placed):
        d = _dept_of(code)
        lcode = DEPT_REGION.get(d or "")
        if not lcode or not names.get(code):
            continue
        site, src = club_site(code)
        dept_node(lcode, d, None)["clubs"][code] = {"code": code, "name": names[code], "site": site,
                                                    **({"src": src} if src == "agenda" else {})}
        placed.add(code)

    out = []
    for lg in sorted(tree.values(), key=lambda x: (x["code"] in ("NC", "OM"), x["name"])):
        ds = []
        for d in sorted(lg["depts"].values(), key=lambda x: x["code"]):
            d["clubs"] = sorted(d["clubs"].values(), key=lambda x: x["code"])
            if d["clubs"] or d["cdco"]:
                ds.append(d)
        if ds or lg["ffco"]:
            out.append({k: v for k, v in lg.items() if k != "ffco"} | {"depts": ds})
    clubs = [c for lg in out for d in lg["depts"] for c in d["clubs"]]
    cdcos = [d for lg in out for d in lg["depts"] if d["cdco"]]
    counts = {"ligues": len(out), "liguesSite": sum(1 for x in out if x["site"]),
              "cdco": len(cdcos), "cdcoSite": sum(1 for d in cdcos if d["site"]),
              "clubs": len(clubs), "clubsSite": sum(1 for c in clubs if c["site"]),
              "clubsAgenda": sum(1 for c in clubs if c.get("src") == "agenda")}
    return {"ligues": out, "counts": counts}


def build(con, fr: Path) -> bool:
    """Writes France's clubdir.json (site/data/fr) when its content changed; True then."""
    if not fr.is_dir():
        return False
    try:
        meta = json.loads((fr / "meta.json").read_text(encoding="utf-8")).get("names", {})
    except (OSError, ValueError):
        meta = {}
    # not before every page listed was read once (a committee unread would leave its clubs without it)
    if con.execute("SELECT 1 FROM prov_struct WHERE read_at = '' LIMIT 1").fetchone():
        return False
    d = directory(con, meta.get("clubs"), meta.get("depts"))
    if not d["ligues"]:
        return False
    path = fr / "clubdir.json"
    try:
        before = json.loads(path.read_text(encoding="utf-8"))
        if {k: v for k, v in before.items() if k != "generated"} == d:
            return False
    except (OSError, ValueError):
        pass
    path.write_text(json.dumps({"generated": _now()} | d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True

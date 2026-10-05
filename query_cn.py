"""Query computed CN data: per-runner history and filtered cohorts.

    python query_cn.py runner --name "DUPONT"
    python query_cn.py runner --licence 31905 --terrain Forêt --from 2025-01-01
    python query_cn.py top --season 2026 --terrain Forêt --categorie H21
    python query_cn.py plan          # show that queries hit indexes
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import paths


def connect(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def cmd_runner(conn: sqlite3.Connection, a: argparse.Namespace) -> None:
    licence = a.licence
    if not licence:
        matches = conn.execute(
            "SELECT licence, nom, n_races, last_categorie, last_club FROM runners "
            "WHERE nom LIKE ? ORDER BY n_races DESC LIMIT 15",
            (f"%{a.name}%",),
        ).fetchall()
        if not matches:
            print("no runner matches")
            return
        if len(matches) > 1:
            print("matches:")
            for m in matches:
                print(f"  {m['licence']:>8}  {m['nom']:<28} {m['n_races']:>4} races  "
                      f"{m['last_categorie'] or '':<5} {m['last_club'] or ''}")
            print("\npick one with --licence")
            return
        licence = matches[0]["licence"]

    r = conn.execute("SELECT * FROM runners WHERE licence=?", (licence,)).fetchone()
    if not r:
        print("unknown licence")
        return
    print(f"{r['nom']}  (licence {r['licence']})  {r['sexe'] or '?'} "
          f"{r['last_categorie'] or ''}  {r['last_club'] or ''}")
    print(f"{r['n_races']} races  {r['first_date']} -> {r['last_date']}\n")

    where = ["s.licence = ?", "s.method IN ('official','fair','top6w')"]
    args: list = [licence]
    for col, val in (("s.terrain", a.terrain), ("s.categorie", a.categorie),
                     ("s.season", a.season)):
        if val:
            where.append(f"{col} = ?")
            args.append(val)
    if getattr(a, "from"):
        where.append("s.date_iso >= ?")
        args.append(getattr(a, "from"))
    if a.to:
        where.append("s.date_iso <= ?")
        args.append(a.to)

    rows = conn.execute(
        f"""
        SELECT s.date_iso, s.terrain, s.epreuve, s.groupe, s.categorie, s.status,
               MAX(CASE WHEN s.method='official' THEN s.score END) sc_off,
               MAX(CASE WHEN s.method='fair'    THEN s.score END) sc_fair,
               MAX(CASE WHEN s.method='top6w'    THEN s.score END) sc_t6,
               MAX(CASE WHEN h.method='official' THEN h.cn END) cn_off,
               MAX(CASE WHEN h.method='fair'    THEN h.cn END) cn_fair,
               MAX(CASE WHEN h.method='top6w'    THEN h.cn END) cn_t6
        FROM scores s
        LEFT JOIN cn_history h
               ON h.licence = s.licence AND h.date_iso = s.date_iso
              AND h.terrain = s.terrain
        WHERE {' AND '.join(where)}
        GROUP BY s.date_iso, s.circuit_id
        ORDER BY s.date_iso
        """,
        args,
    ).fetchall()

    def f(v):
        return f"{v:>6}" if v is not None else f"{'':>6}"

    print(f"{'date':<12}{'terr':<7}{'ep':<6}{'grp':<4}{'cat':<5}{'status':<9}"
          f"{'--- score ---':^20}{'---- CN ----':^20}")
    print(f"{'':<43}{'off':>6}{'v26':>7}{'t6w':>7}{'off':>7}{'v26':>7}{'t6w':>7}")
    for x in rows:
        print(f"{x['date_iso']:<12}{(x['terrain'] or '')[:5]:<7}{(x['epreuve'] or ''):<6}"
              f"{(x['groupe'] or ''):<4}{(x['categorie'] or ''):<5}{x['status']:<9}"
              f"{f(x['sc_off'])}{f(x['sc_fair']):>7}{f(x['sc_t6']):>7}"
              f"{f(x['cn_off']):>7}{f(x['cn_fair']):>7}{f(x['cn_t6']):>7}")
    print(f"\n{len(rows)} races")


def cmd_top(conn: sqlite3.Connection, a: argparse.Namespace) -> None:
    where = ["h.terrain = ?", "h.method = ?", "s.method = h.method"]
    args: list = [a.terrain, a.method]
    if a.season:
        where.append("substr(h.date_iso,1,4) = ?")
        args.append(str(a.season))
    if a.categorie:
        where.append("s.categorie = ?")
        args.append(a.categorie)
    if a.club:
        where.append("s.club = ?")
        args.append(a.club)

    rows = conn.execute(
        f"""
        SELECT h.licence, r.nom, s.categorie, s.club, MAX(h.date_iso) d, h.cn
        FROM cn_history h
        JOIN scores s  ON s.licence = h.licence AND s.date_iso = h.date_iso
                      AND s.terrain = h.terrain
        JOIN runners r ON r.licence = h.licence
        WHERE {' AND '.join(where)} AND h.cn IS NOT NULL
        GROUP BY h.licence
        ORDER BY h.cn DESC LIMIT ?
        """,
        (*args, a.limit),
    ).fetchall()
    print(f"{'#':>4}  {'CN':>6}  {'nom':<28}{'cat':<6}{'club':<10}{'as of'}")
    for i, x in enumerate(rows, 1):
        print(f"{i:>4}  {x['cn']:>6}  {(x['nom'] or '')[:27]:<28}"
              f"{(x['categorie'] or ''):<6}{(x['club'] or ''):<10}{x['d']}")


def cmd_plan(conn: sqlite3.Connection, a: argparse.Namespace) -> None:
    queries = {
        "per-runner history": (
            "SELECT * FROM scores WHERE licence=? ORDER BY date_iso", ("1",)),
        "runner, one method": (
            "SELECT * FROM scores WHERE licence=? AND method=? ORDER BY date_iso", ("1", "top6w")),
        "runner CN curve": (
            "SELECT * FROM cn_history WHERE licence=? AND method=? ORDER BY date_iso",
            ("1", "top6w")),
        "cohort by season+category": (
            "SELECT * FROM scores WHERE method=? AND season=? AND categorie=?",
            ("top6w", 2026, "H21")),
        "club season": ("SELECT * FROM scores WHERE method=? AND club=? AND season=?",
                        ("top6w", "7707IF", 2026)),
    }
    for label, (q, args) in queries.items():
        plan = conn.execute("EXPLAIN QUERY PLAN " + q, args).fetchall()
        detail = "; ".join(p["detail"] for p in plan)
        ok = "INDEX" in detail.upper()
        print(f"{'OK ' if ok else '!! '}{label:<28} {detail}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=paths.DB)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("runner")
    r.add_argument("--licence")
    r.add_argument("--name")
    r.add_argument("--terrain")
    r.add_argument("--categorie")
    r.add_argument("--season", type=int)
    r.add_argument("--from", dest="from")
    r.add_argument("--to")
    r.set_defaults(fn=cmd_runner)

    t = sub.add_parser("top")
    t.add_argument("--method", default="top6w", choices=["official", "fair", "top6w"])
    t.add_argument("--terrain", default="Forêt")
    t.add_argument("--season", type=int)
    t.add_argument("--categorie")
    t.add_argument("--club")
    t.add_argument("--limit", type=int, default=20)
    t.set_defaults(fn=cmd_top)

    q = sub.add_parser("plan")
    q.set_defaults(fn=cmd_plan)

    a = p.parse_args()
    conn = connect(a.db)
    a.fn(conn, a)
    conn.close()


if __name__ == "__main__":
    main()

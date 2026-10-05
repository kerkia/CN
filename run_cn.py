"""Build the three CN rankings and report how they compare.

    python run_cn.py --method official
    python run_cn.py --method fair
    python run_cn.py --method top6w
    python run_cn.py --report
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import time
from pathlib import Path

import paths

import dataclasses

from ffco_scraper.cn_engine import CnEngine, build_methods


def spec_for(name: str, norm_mode: str | None):
    spec = build_methods()[name]
    if norm_mode and spec.normalisation:
        spec.normalisation = dataclasses.replace(spec.normalisation, mode=norm_mode)
    return spec


def report(db: Path) -> None:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    print("\n=== rows per method ===")
    for r in conn.execute(
        "SELECT method, COUNT(*) n, COUNT(score) scored FROM scores GROUP BY method"
    ):
        print(f"  {r['method']:<10} {r['n']:>8,} rows  {r['scored']:>8,} scored")

    print("\n=== fair vs official, per-race score ===")
    for r in conn.execute(
        """
        SELECT a.season, COUNT(*) n,
               SUM(CASE WHEN a.score = b.score THEN 1 ELSE 0 END) exact,
               AVG(ABS(a.score - b.score)) mae
        FROM scores a JOIN scores b
          ON b.method='official' AND b.licence=a.licence AND b.circuit_id=a.circuit_id
        WHERE a.method='fair' AND a.score IS NOT NULL AND b.score IS NOT NULL
        GROUP BY a.season ORDER BY a.season
        """
    ):
        print(f"  {r['season']}  {r['exact']:>7,}/{r['n']:>7,} "
              f"({100*r['exact']/max(1,r['n']):5.1f}%)  MAE {r['mae']:.0f}")

    print("\n=== CN level by method (median of ranked runners, by season) ===")
    print(f"  {'season':<8}{'official':>10}{'fair':>10}{'top6w':>10}")
    for season in range(2010, 2027):
        vals = {}
        for m in ("official", "fair", "top6w"):
            row = conn.execute(
                """
                SELECT cn FROM cn_history
                WHERE method=? AND cn IS NOT NULL AND substr(date_iso,1,4)=?
                ORDER BY cn LIMIT 1 OFFSET (
                  SELECT COUNT(*)/2 FROM cn_history
                  WHERE method=? AND cn IS NOT NULL AND substr(date_iso,1,4)=?)
                """,
                (m, str(season), m, str(season)),
            ).fetchone()
            vals[m] = row["cn"] if row else None
        if any(vals.values()):
            print(f"  {season:<8}"
                  + "".join(f"{(vals[m] if vals[m] else '-'):>10}"
                            for m in ("official", "fair", "top6w")))

    print("\n=== method 3 normalisation: is the top held steady? ===")
    rows = conn.execute(
        """SELECT terrain, date_iso, top_mean_raw, factor FROM normalisation
           WHERE method='top6w' ORDER BY terrain, date_iso"""
    ).fetchall()
    for terrain in sorted({r["terrain"] for r in rows}):
        tr = [r for r in rows if r["terrain"] == terrain]
        if not tr:
            continue
        print(f"  {terrain}: {len(tr)} monthly factors, "
              f"raw top {tr[0]['top_mean_raw']:.0f} -> {tr[-1]['top_mean_raw']:.0f}, "
              f"factor {tr[0]['factor']:.3f} -> {tr[-1]['factor']:.3f}")
    conn.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=paths.DB)
    p.add_argument("--method", choices=["official", "fair", "top6w"])
    p.add_argument("--seasons", type=int, nargs="*", default=None)
    p.add_argument("--runners", action="store_true", help="rebuild the runners table")
    p.add_argument(
        "--renormalise",
        action="store_true",
        help="Redo only the normalisation pass for --method (cn_raw and score_raw "
        "are stored, so the anchor can be retuned without recomputing scores).",
    )
    p.add_argument(
        "--norm-mode",
        choices=["monthly_lag", "trailing_monthly", "annual_jan3", "centred_monthly"],
        help="Override method 3's normalisation mode.",
    )
    p.add_argument("--report", action="store_true")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.renormalise:
        if not args.method:
            raise SystemExit("--renormalise needs --method")
        engine = CnEngine(args.db)
        t0 = time.monotonic()
        spec = spec_for(args.method, args.norm_mode)
        if not spec.normalisation:
            raise SystemExit(f"method {args.method} has no normalisation step")
        engine._normalise(spec)
        engine.close()
        print(f"renormalised {args.method} in {time.monotonic()-t0:.1f}s "
              f"(anchor: mean of top {spec.normalisation.anchor_top_fraction or spec.normalisation.anchor_top_k} "
              f"-> {spec.normalisation.target:.0f})")
    elif args.method:
        engine = CnEngine(args.db)
        t0 = time.monotonic()
        if args.method == "official":
            stats = engine.populate_official(args.seasons)
            engine.write_runners()
        else:
            spec = spec_for(args.method, args.norm_mode)
            stats = engine.derive(spec) if spec.derived_from else engine.run_method(spec, args.seasons)
        engine.close()
        print(f"{args.method}: {time.monotonic()-t0:.1f}s  " +
              "  ".join(f"{k}={v:,}" for k, v in stats.items()))
    elif args.runners:
        engine = CnEngine(args.db)
        engine.write_runners()
        engine.close()

    if args.report or not args.method:
        report(args.db)


if __name__ == "__main__":
    main()

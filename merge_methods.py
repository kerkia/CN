"""Merge a method computed in a separate working database back into the main one.

Methods 2 and 3 are independent, so they are computed in parallel against their
own copies of the database (SQLite serialises writers within one file, so
separate files is what actually buys the parallelism). This copies one method's
derived rows back, in bulk.

    python merge_methods.py work_v2026.sqlite3 v2026
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import paths

TABLES = ("scores", "cn_history", "circuit_values", "normalisation")


def merge(main: Path, work: Path, method: str) -> None:
    conn = sqlite3.connect(main)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("ATTACH DATABASE ? AS work", (str(work),))
    for table in TABLES:
        exists = conn.execute(
            "SELECT 1 FROM work.sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            continue
        dst_cols = [r[1] for r in conn.execute(f"PRAGMA main.table_info({table})")]
        src_cols = [r[1] for r in conn.execute(f"PRAGMA work.table_info({table})")]
        missing = [c for c in src_cols if c not in dst_cols]
        if missing:
            # Taking the column list from the destination silently drops any
            # column the destination lacks. That once cost a double-applied
            # normalisation: score_raw was dropped, then backfilled from the
            # already-normalised score. Refuse rather than lose data.
            raise SystemExit(
                f"{table}: destination is missing {missing} — its schema is stale. "
                f"Run the engine once against {main} to migrate it, then re-merge."
            )
        conn.execute(f"DELETE FROM main.{table} WHERE method=?", (method,))
        collist = ", ".join(src_cols)
        n = conn.execute(
            f"INSERT INTO main.{table} ({collist}) "
            f"SELECT {collist} FROM work.{table} WHERE method=?",
            (method,),
        ).rowcount
        print(f"  {table}: {n:,} rows")
    conn.commit()
    conn.execute("DETACH DATABASE work")
    conn.close()


if __name__ == "__main__":
    work = Path(sys.argv[1])
    method = sys.argv[2]
    main = Path(sys.argv[3]) if len(sys.argv) > 3 else paths.DB
    print(f"merging {method} from {work} -> {main}")
    merge(main, work, method)

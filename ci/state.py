"""Pack and unpack the working state kept in Cloudflare R2 between GitHub Actions runs.

    py -3 ci/state.py pack DIR     # writes DIR/db.sqlite3.zst and DIR/site-state.tar.zst
    py -3 ci/state.py unpack DIR   # restores them

db.sqlite3.zst       the database (paths.DB)
site-state.tar.zst   what an incremental rebuild starts from: site/data and
                     site/auth, the club-names cache, and the "deploy pending"
                     marker of a rebuilt site that could not be published yet

Python 3.14's own zstd support is used, so the same script runs on Windows
(the first upload) and on the runner.
"""
from __future__ import annotations

import shutil
import sys
import tarfile
import time
from compression import zstd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import paths  # noqa: E402

DB_FILE = "db.sqlite3.zst"
SITE_FILE = "site-state.tar.zst"
NAMES = paths.CACHE / "reference_names.json"
PENDING = paths.DATA_DIR / "deploy.pending"


def pack(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    with open(paths.DB, "rb") as src, zstd.open(out / DB_FILE, "wb", level=3) as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    with tarfile.open(out / SITE_FILE, "w:zst") as tar:
        tar.add(ROOT / "site" / "data", arcname="site/data")
        tar.add(ROOT / "site" / "auth", arcname="site/auth")
        if NAMES.exists():
            tar.add(NAMES, arcname="cache/reference_names.json")
        if PENDING.exists():
            tar.add(PENDING, arcname="deploy.pending")
    sizes = ", ".join(f"{p.name} {p.stat().st_size / 2**20:.0f} MiB" for p in (out / DB_FILE, out / SITE_FILE))
    print(f"packed in {time.monotonic() - t0:.0f}s: {sizes}")


def unpack(src: Path) -> None:
    t0 = time.monotonic()
    paths.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with zstd.open(src / DB_FILE, "rb") as s, open(paths.DB, "wb") as d:
        shutil.copyfileobj(s, d, 1 << 20)
    with tarfile.open(src / SITE_FILE, "r:zst") as tar:
        for m in tar.getmembers():
            if m.name.startswith("site/"):
                tar.extract(m, ROOT, filter="data")
            else:                                   # cache/…, deploy.pending
                tar.extract(m, paths.DATA_DIR, filter="data")
    print(f"unpacked in {time.monotonic() - t0:.0f}s into {ROOT / 'site'} and {paths.DATA_DIR}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("pack", "unpack"):
        sys.exit(__doc__)
    (pack if sys.argv[1] == "pack" else unpack)(Path(sys.argv[2]))

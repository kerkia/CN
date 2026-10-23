"""Output helpers shared by build_site.py and site_extras.py."""

from __future__ import annotations

import json
from pathlib import Path

WRITES = {"written": 0, "unchanged": 0, "deleted": 0}


def dump(path: Path, obj) -> int:
    """Write JSON, leaving the file alone when its content is already right."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if path.exists() and path.read_text(encoding="utf-8") == data:
        WRITES["unchanged"] += 1
        return len(data)
    path.write_text(data, encoding="utf-8")
    WRITES["written"] += 1
    return len(data)


def runner_bucket(lic, size: int = 10) -> int:
    """The file of r/ and net/ a runner's rows are in: their number // `size` (meta `bucket`: France 10; a country of
    sequential numbers 100, so that its files stay few — Pages takes 20 000 files a deployment)."""
    s = str(lic)
    return int(s) // size if s.isdigit() else 999999


def club_pack(code: str, packs: int) -> int:
    """The file of club/ and club_courses/ a club is in when a country packs them (meta `club_packs`): a hash of its code,
    as data.js clubPack computes it."""
    h = 0
    for ch in code:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % packs


def prune(folder: Path, keep: set[str], pattern: str = "*.json") -> None:
    """Delete files a build no longer produces (a competition removed, …)."""
    for f in folder.glob(pattern):
        if f.name not in keep:
            f.unlink()
            WRITES["deleted"] += 1

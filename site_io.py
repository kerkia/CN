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


def prune(folder: Path, keep: set[str], pattern: str = "*.json") -> None:
    """Delete files a build no longer produces (a competition removed, …)."""
    for f in folder.glob(pattern):
        if f.name not in keep:
            f.unlink()
            WRITES["deleted"] += 1

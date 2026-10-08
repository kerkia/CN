"""One module per format; each exposes parse(content: bytes, url: str) -> dict | None (see ..model)."""

# Bump when a parser reads more or better: the next run reads every known document again (not just the changed ones).
VERSION = 4          # 4 (2026-10-08): start times (WinSplits .spl files, liveresultat, IOF XML)

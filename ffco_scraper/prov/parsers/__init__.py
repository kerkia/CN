"""One module per format; each exposes parse(content: bytes, url: str) -> dict | None (see ..model)."""

# Bump when a parser reads more or better: the next run reads every known document again (not just the changed ones).
VERSION = 5          # 4 (2026-10-08): start times (WinSplits .spl files, liveresultat, IOF XML)
                     # 5 (2026-10-10): WinSplits' empty rows are non-starters, not mispunches

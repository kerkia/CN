"""One module per format; each exposes parse(content: bytes, url: str) -> dict | None (see ..model)."""

# Bump when a parser reads more or better: the next run reads every known document again (not just the changed ones).
VERSION = 10         # 4 (2026-10-08): start times (WinSplits .spl files, liveresultat, IOF XML)
                     # 5 (2026-10-10): WinSplits' empty rows are non-starters, not mispunches
                     # 6 (2026-10-10): MeOS's coded split list in PDF (CF LD 2026); no liveresultat radio splits
                     # 7 (2026-10-11): liveresultat / WinSplits lists by category when most classes are categories
                     # 8 (2026-10-12): OE PDFs whose class lines say « Etat de: 16:53 » (provisional lists)
                     # 9 (2026-10-12): liveresultat's splits again when they cover the course (MeOS: every control)
                     # 10 (2026-10-17): start lists laid out as a grid, a circuit per column pair (organisers' Google Sheets)

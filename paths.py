r"""Where the bulky working data lives: the SQLite database and the HTTP cache.

They are kept out of the project folder because the database is rewritten on
every update (on the PC, both sit under C:\kerkia, outside OneDrive since
2026-10-08). CN_DATA_DIR overrides the location, e.g. on a CI runner."""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("CN_DATA_DIR") or r"C:\kerkia\cn-data")
DB = DATA_DIR / "ffco_results.sqlite3"
CACHE = DATA_DIR / "cache"

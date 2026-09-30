"""Where the bulky working data lives: the SQLite database and the HTTP cache.

They are kept out of the project folder (which OneDrive syncs) because the
database is rewritten on every update. CN_DATA_DIR overrides the location,
e.g. on a CI runner."""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("CN_DATA_DIR") or r"C:\cn-data")
DB = DATA_DIR / "ffco_results.sqlite3"
CACHE = DATA_DIR / "cache"

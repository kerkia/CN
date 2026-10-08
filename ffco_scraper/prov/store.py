"""Where the provisional-results pilot keeps its state, in the main database (so CI carries it between runs).

prov_races   the races watched: one row per race, from the agenda and from FFCO's recent competitions
prov_docs    every document found for a race (a results or split-times file, a liveresultat competition,
             a WinSplits event): where, what, its parse, when it last changed
prov_fetch   what each URL answered last time (conditional requests, robots.txt refusals, failures)
prov_clubs   the FFCO club directory: club number -> website
prov_meta    small values (the last WinSplits event id looked at, when the club directory was read…)
"""

from __future__ import annotations

import json
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS prov_races (
  key         TEXT PRIMARY KEY,          -- 'a<agenda id>' or 'f<FFCO course id>'
  date_iso    TEXT NOT NULL,
  name        TEXT NOT NULL,
  place       TEXT,
  org         TEXT,                      -- '1905 - BRIVE LIMOUSIN…' as in the agenda / FFCO
  org_code    TEXT,                      -- '1905' (a club) or '13' (a département committee)
  terrain     TEXT,                      -- Forêt | Sprint | VTT | Ski | NULL (not a CN race)
  epreuve     TEXT,                      -- Sprint | MD | LD | Nuit | …
  cn          INTEGER NOT NULL DEFAULT 0,
  site        TEXT,                      -- the organiser's website
  agenda_id   INTEGER,
  ffco_id     INTEGER,                   -- the FFCO course id once FFCO has published it
  first_seen  TEXT NOT NULL,
  last_check  TEXT,
  next_check  TEXT,
  done        INTEGER NOT NULL DEFAULT 0 -- 1: no more scanning (FFCO published long ago, or too old)
);
CREATE INDEX IF NOT EXISTS prov_races_date ON prov_races (date_iso);
CREATE TABLE IF NOT EXISTS prov_docs (
  race_key   TEXT NOT NULL,
  url        TEXT NOT NULL,
  source     TEXT NOT NULL,              -- liveresultat | winsplits | site
  kind       TEXT,                       -- parser kind, or 'unreadable' / 'refused' / 'unparsed'
  title      TEXT,
  sha        TEXT,
  parsed     TEXT,                       -- JSON (model.doc) or NULL
  found_at   TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  note       TEXT,
  PRIMARY KEY (race_key, url)
);
CREATE TABLE IF NOT EXISTS prov_fetch (
  url        TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  status     INTEGER,                    -- HTTP status; 0 = network error; -1 = refused by robots.txt
  etag       TEXT,
  modified   TEXT,
  sha        TEXT,
  ctype      TEXT
);
CREATE TABLE IF NOT EXISTS prov_clubs (
  code       TEXT PRIMARY KEY,
  name       TEXT,
  site       TEXT,
  read_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prov_meta (k TEXT PRIMARY KEY, v TEXT);
"""


def connect(db_path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def meta_get(con: sqlite3.Connection, k: str, default=None):
    row = con.execute("SELECT v FROM prov_meta WHERE k = ?", (k,)).fetchone()
    return json.loads(row[0]) if row else default


def meta_set(con: sqlite3.Connection, k: str, v) -> None:
    con.execute("INSERT OR REPLACE INTO prov_meta (k, v) VALUES (?, ?)", (k, json.dumps(v)))

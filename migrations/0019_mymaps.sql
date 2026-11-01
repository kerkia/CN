-- « Mes cartes » (Coach; owner, 2026-11-01): each account's archive of its maps and the routes it ran on them —
-- functions/api/mymaps/[[path]].js, site/assets/js/pages/mymaps.js. The files are in R2 (cn-state): the map as it came,
-- byte for byte (mymaps/<user>/<map>/map), its thumbnail (…/thumb) and each run as drawn on the map (…/runs/<run>.json:
-- positions in the map's pixels and times; heart rate and the like only when the runner chose to keep them).
-- Private: nobody but the account reads them, unless it makes a link (mymap_links) to the whole archive or to one map.
CREATE TABLE mymaps (
  id         TEXT PRIMARY KEY,                 -- random, lower case (the login gate folds paths to lower case)
  user_id    INTEGER NOT NULL,
  sha        TEXT NOT NULL,                    -- the image's SHA-256: a map is kept once per account
  title      TEXT NOT NULL DEFAULT '',
  day        TEXT,                             -- YYYY-MM-DD, its first run's day by default
  place      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL,                    -- image/jpeg, image/png, image/webp
  bytes      INTEGER NOT NULL,
  w          INTEGER NOT NULL,
  h          INTEGER NOT NULL,
  geo        TEXT,                             -- JSON { a, b, c, d, e, f }: (longitude, latitude) -> the image's pixels
  lat        REAL, lon REAL,                   -- the map's centre, when georeferenced
  thumb      INTEGER NOT NULL DEFAULT 0,       -- its thumbnail is stored
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX mymaps_user ON mymaps (user_id, day);
CREATE UNIQUE INDEX mymaps_sha ON mymaps (user_id, sha);

CREATE TABLE mymap_runs (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES mymaps(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  day        TEXT,
  start_ms   INTEGER,                          -- the run's first point
  dur        REAL,                             -- seconds
  dist       REAL,                             -- metres
  source     TEXT NOT NULL DEFAULT '',         -- solo (Analyse solo), quickroute, ozimut (an Ozimut file read back)
  personal   INTEGER NOT NULL DEFAULT 0,       -- heart rate, altitude, cadence… kept (the runner ticked it)
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX mymap_runs_map ON mymap_runs (map_id);
CREATE INDEX mymap_runs_user ON mymap_runs (user_id);

-- the links an account makes to share its maps: one to the whole archive (map_id NULL), one per map; deleted to stop sharing
CREATE TABLE mymap_links (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  map_id     TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX mymap_links_one ON mymap_links (user_id, IFNULL(map_id, ''));

-- Results files uploaded by organisers on « Récemment » (2026-10-08, functions/api/upload.js). The file and its
-- meta.json are in R2 (cn-state, uploads/<id>/), read by the next provisional-results run; this table is the
-- record of who uploaded what, for the administrator (admin page, « Dépôts »). An upload outlives its account.
CREATE TABLE uploads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  race_key   TEXT,                       -- a race of the list (site/data/prov), or NULL for a race added with it
  race       TEXT NOT NULL,              -- the race's name and date as shown then (JSON for an added race)
  filename   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,              -- uploads/<id>/<stored name>
  status     TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'removed' (by the administrator)
  created_at TEXT NOT NULL
);
CREATE INDEX uploads_created ON uploads (created_at);

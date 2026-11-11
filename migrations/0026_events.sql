-- « Orga › Gérer » (owner, 2026-11-11): the events organisers run on Ozimut. One event is one race (or one training), held
-- by a team whose members all have the same rights; nobody else may act as its organiser (functions/_lib/events.js
-- canManage, the body of _lib/club.js organises). A competition of the federation's calendar (France: the agenda's
-- « a<id> ») is held by at most one event, which has then « claimed » it: runners may no longer deposit its results.
-- functions/api/events/[[path]].js.

CREATE TABLE events (
  id          TEXT PRIMARY KEY,                    -- 10 letters and digits, as the declared competitions' (their ids kept)
  type        TEXT NOT NULL DEFAULT 'individual',  -- individual | score | relay | training
  country     TEXT NOT NULL DEFAULT 'FR',
  name        TEXT NOT NULL,
  date        TEXT NOT NULL,                       -- YYYY-MM-DD
  place       TEXT NOT NULL DEFAULT '',
  club        TEXT NOT NULL DEFAULT '',            -- the organising club as the calendar writes it (« 7799 - BALISE EXEMPLE »)
  terrain     TEXT NOT NULL DEFAULT '',            -- Forêt | Sprint | VTT | Ski
  epreuve     TEXT NOT NULL DEFAULT '',            -- Sprint | MD | LD | Nuit | Autre
  site        TEXT NOT NULL DEFAULT '',
  race_key    TEXT,                                -- the competition it holds: « a<id> » once linked, else « d<id> »; NULL for
                                                   -- a training, or while its link waits for an administrator
  link_key    TEXT,                                -- the calendar competition asked for (« a<id> »), linked or waiting
  link_state  TEXT NOT NULL DEFAULT 'none',        -- none | verified (a member of the organising club) | pending | approved
  analysis    TEXT,                                -- its map analysis's id, once opened
  status      TEXT NOT NULL DEFAULT 'active',      -- active | removed
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX events_race ON events (race_key) WHERE race_key IS NOT NULL AND status = 'active';
CREATE INDEX events_date ON events (date, status);
CREATE INDEX events_link ON events (link_key);

-- the team: every member has the same rights on the event
CREATE TABLE event_members (
  event_id    TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TEXT NOT NULL,
  added_by    INTEGER,                             -- the member who accepted the request (NULL: the creator, or a migration)
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_members_user ON event_members (user_id);

-- an account asking to join a team; any member answers
CREATE TABLE event_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | declined | withdrawn
  created_at  TEXT NOT NULL,
  answered_at TEXT,
  answered_by INTEGER
);
CREATE INDEX event_requests_event ON event_requests (event_id, status);
CREATE INDEX event_requests_user ON event_requests (user_id, status);

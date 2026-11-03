-- « Réservation des horaires » (owner, 2026-11-03): the start times a competition's organisers open to booking, as the
-- Google Sheets clubs pass round (« Balise 77 »: a column per circuit, a start every 2 minutes, 4 minutes between two runners
-- of a club). An Ozimut account books for the runners it keeps (itself, its family, anyone, licensed or not, of any club or
-- none); the organisers set the circuits and the rules, follow, change, and the list becomes the race's published start list.
-- functions/api/booking/[[path]].js, functions/_lib/booking.js.

-- one per competition (its race key: « a<agenda id> » or « d<declared id> »), its settings as JSON:
-- { circuits: [{ id, name, first, last, step }] (seconds of the day), gap (seconds between two runners of a club, any
--   circuit; 0 none), close ("YYYY-MM-DDTHH:MM", Paris time), card (ask the card number), max (runners an account books),
--   note (to the runners), blocked: { <circuit id>: [seconds] } }
CREATE TABLE booking_events (
  race_key     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  race_date    TEXT NOT NULL,
  org          TEXT NOT NULL DEFAULT '',
  place        TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT 'FR',
  config       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft (its organisers only) | open | closed
  created_by   INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  changed_at   TEXT,                             -- the bookings' last change
  published_at TEXT                              -- the start list last published from them (functions/api/upload.js's way)
);
CREATE INDEX booking_events_date ON booking_events (race_date, status);

-- a runner's start: one a slot, one a runner and competition
CREATE TABLE bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  race_key     TEXT NOT NULL,
  circuit      TEXT NOT NULL,                    -- the circuit's id in the settings
  start_s      INTEGER NOT NULL,                 -- seconds of the race's day
  user_id      INTEGER NOT NULL,                 -- the account that booked (an organiser's own entries: theirs, by_org 1)
  by_org       INTEGER NOT NULL DEFAULT 0,
  person       TEXT NOT NULL,                    -- who runs, to book them once: « L<licence> », else « N<name>|<club key> »
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  licence      TEXT NOT NULL DEFAULT '',         -- France's, when known
  club_country TEXT NOT NULL DEFAULT '',         -- the club's country (FR, CH…), '' without a club
  club_code    TEXT NOT NULL DEFAULT '',         -- the federation's number (FFCO's four digits, Spain's), when known
  club_name    TEXT NOT NULL DEFAULT '',
  club_key     TEXT NOT NULL DEFAULT '',         -- the club for the gap rule: « FR:0109 », « CH:ol zimmerberg »; '' none
  card         TEXT NOT NULL DEFAULT '',
  reminded     INTEGER NOT NULL DEFAULT 0,       -- the day before's reminder sent
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (race_key, circuit, start_s),
  UNIQUE (race_key, person)
);
CREATE INDEX bookings_user ON bookings (user_id);
CREATE INDEX bookings_club ON bookings (race_key, club_key);

-- « Mes coureurs »: the runners an account books for, kept from one competition to the next
CREATE TABLE booking_runners (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  licence      TEXT NOT NULL DEFAULT '',
  club_country TEXT NOT NULL DEFAULT '',
  club_code    TEXT NOT NULL DEFAULT '',
  club_name    TEXT NOT NULL DEFAULT '',
  card         TEXT NOT NULL DEFAULT '',
  self         INTEGER NOT NULL DEFAULT 0,       -- the account's holder
  created_at   TEXT NOT NULL
);
CREATE INDEX booking_runners_user ON booking_runners (user_id);

-- the alert « Mes horaires réservés » (a start moved or cancelled by the organisers, the day before's reminder): by e-mail
-- (off; the administrator's e-mail right applies, as for every alert) and by push (on)
ALTER TABLE users ADD COLUMN book_mail INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN book_push INTEGER NOT NULL DEFAULT 1;

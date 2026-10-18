-- Push notifications (2026-10-18): every alert of Réglages by e-mail, by push, or both. Push is open to every account; the
-- agenda alerts' e-mails stay a right the administrator grants (users.alerts_allowed).
--   push_starts   a runner's start time as soon as the start list is published (push only; on by default)
--   push_results  « a race you ran is online » (the push twin of users.notify; on by default)
--   push_agenda   new races in the regions followed (users.agenda_regions; off until chosen)
--   push_deadline registrations closing within 8 days in those regions (off until chosen)
-- Each device still has to allow notifications (push_subs).
ALTER TABLE users ADD COLUMN push_starts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN push_results INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN push_agenda INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN push_deadline INTEGER NOT NULL DEFAULT 0;

-- One row per device (browser) that allowed notifications: its push service address and keys (RFC 8291).
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_ok INTEGER,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);

-- The notifications waiting to be sent (a few each call: the Functions' CPU budget), dropped once past `expires`.
CREATE TABLE IF NOT EXISTS push_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  msg TEXT NOT NULL,
  topic TEXT,
  created_at INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_queue_user ON push_queue (user_id);

-- The start time last sent to an account for a race: sent again only when it changes.
CREATE TABLE IF NOT EXISTS push_sent (
  user_id INTEGER NOT NULL,
  race_key TEXT NOT NULL,
  start_s INTEGER,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, race_key)
);

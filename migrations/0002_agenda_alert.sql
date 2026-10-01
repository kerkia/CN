-- Alert when a new course is added to the agenda in the regions the user picked.
ALTER TABLE users ADD COLUMN agenda_alert INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN agenda_regions TEXT NOT NULL DEFAULT '[]';     -- JSON list of region names

-- agenda events already announced (or present when the alert was introduced): each is announced once
CREATE TABLE agenda_announced (
  event_id TEXT PRIMARY KEY,
  seen_at  INTEGER NOT NULL
);

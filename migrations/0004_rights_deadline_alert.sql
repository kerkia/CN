-- Rights granted by the administrator, per account (2026-10-07):
--   analyst        sees the analysis methods ("Juste", linear and quadratic) besides the official one and the Tops;
--   alerts_allowed may subscribe to the agenda e-mail alerts (new courses, registrations closing soon).
-- Administrators have both rights whatever these say.
ALTER TABLE users ADD COLUMN analyst INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN alerts_allowed INTEGER NOT NULL DEFAULT 0;
-- the accounts already alerted about new courses keep their alert
UPDATE users SET alerts_allowed = 1 WHERE agenda_alert = 1;

-- Alert when the registrations of a course close within 8 days, in the regions the user follows (agenda_regions,
-- shared with the new-course alert). Each (account, course) is announced once.
ALTER TABLE users ADD COLUMN deadline_alert INTEGER NOT NULL DEFAULT 0;
CREATE TABLE deadline_announced (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  seen_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);

-- The start time by e-mail too (2026-10-18): users.starts_alert, beside push_starts. Like the agenda's e-mails, a right the
-- administrator grants (users.alerts_allowed); off by default.
ALTER TABLE users ADD COLUMN starts_alert INTEGER NOT NULL DEFAULT 0;

-- Accounts, one-shot tokens, throttling, and the outgoing mail queue.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,            -- lower-case
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  pw_iter       INTEGER NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  licence       TEXT NOT NULL,                   -- checked against the FFCO index at registration
  display_name  TEXT NOT NULL,                   -- name as published by the FFCO
  email_verified INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  notify        INTEGER NOT NULL DEFAULT 0,      -- digest e-mail when a competition they ran is uploaded
  consent_at    TEXT NOT NULL,                   -- they declared being an FFCO licensee
  created_at    TEXT NOT NULL,
  last_login    TEXT
);
CREATE INDEX users_licence ON users (licence);

-- e-mail confirmation and password reset links; only the hash of the token is stored
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                      -- verify | reset
  expires_at INTEGER NOT NULL,                   -- ms since epoch
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tokens_user ON tokens (user_id, kind);

-- fixed-window counters: login attempts, registrations, reset requests
CREATE TABLE rate (
  k      TEXT NOT NULL,
  window INTEGER NOT NULL,
  n      INTEGER NOT NULL,
  PRIMARY KEY (k, window)
);

-- competitions already announced to a user, so a re-upload never mails twice
CREATE TABLE notified (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id)
);

-- e-mails that did not fit in the daily quota (or failed): sent by a later flush
CREATE TABLE mail_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  text       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,         -- 1 = account mails (sent before digests)
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

-- one row per e-mail actually sent: the daily quota counts these
CREATE TABLE mail_log (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX mail_log_ts ON mail_log (ts);

-- An e-mail to the administrator when an account is confirmed (2026-10-07). The column is read for the
-- administrators' accounts only (ADMIN_EMAILS); each one can switch it off on the admin page.
ALTER TABLE users ADD COLUMN signup_alert INTEGER NOT NULL DEFAULT 1;

-- Basic usage, per account: page views per day (Paris time) and per page of the site; page '_visit' counts
-- the visits (a new browser session). Shown to the administrator only; kept 13 months (see api/track.js).
CREATE TABLE usage_daily (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                 -- YYYY-MM-DD, Europe/Paris
  page    TEXT NOT NULL,                 -- route (network views as network:<view>), or '_visit'
  views   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, page)
);
CREATE INDEX usage_daily_day ON usage_daily (day);

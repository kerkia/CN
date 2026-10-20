-- Ozimut open to every orienteer (owner, 2026-10-20): an account joins countries, each with its club and, where the
-- federation has one, its member id (France: the FFCO licence). A country's policy (functions/_lib/countries.js) says how a
-- membership is accepted: France by the licensee index (name + licence), the others as declared. Only an accepted membership
-- ('ok') opens what that country's data holds; a club typed by the user grants nothing by itself.
CREATE TABLE IF NOT EXISTS user_countries (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country    TEXT NOT NULL,                      -- ISO 3166-1 alpha-2, upper case (FR, CH…)
  club       TEXT NOT NULL DEFAULT '',           -- as the user typed it (France: the club comes from the data, not from this)
  member_id  TEXT NOT NULL DEFAULT '',           -- the federation's id (France: the licence), '' when none
  status     TEXT NOT NULL DEFAULT 'ok',         -- ok | pending (a country checked by hand) | refused
  added_at   TEXT NOT NULL,
  checked_at TEXT,                               -- when the federation's check passed (NULL: declared)
  PRIMARY KEY (user_id, country)
);
CREATE INDEX IF NOT EXISTS user_countries_country ON user_countries (country, status);

-- Every account of before: a licensee checked against the index at registration, so a France membership already checked.
-- Demo accounts (no licence) join no country: their access is the administrator's grant (users.demo_until).
INSERT OR IGNORE INTO user_countries (user_id, country, member_id, status, added_at, checked_at)
  SELECT id, 'FR', licence, 'ok', created_at, created_at FROM users WHERE licence != '' AND demo_until IS NULL;

-- Runners an account adds to a club for the relay simulator (2026-10-12): people who race only relays, or abroad, and
-- have no CN of their own. One row per account and club; runners = JSON list of {id, name, sex, age, cn: {For, Spr, …}}.
-- Only the account sees them; deleted with it.
CREATE TABLE relay_runners (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club       TEXT NOT NULL,
  runners    TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, club)
);

-- A right granted by the administrator, per account (2026-10-10): live sees « En direct » (live results relayed by
-- O'Cap's live server, with each runner's CN). Granted at first to the administrator and one tester, by hand.
ALTER TABLE users ADD COLUMN live INTEGER NOT NULL DEFAULT 0;

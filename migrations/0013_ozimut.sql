-- The move to ozimut.com (2026-10-19).
-- The hand-off tokens already used (functions/api/account/handoff.js): a token carries a visitor's session from the old
-- address to the new one, once. Rows older than a day are deleted as new ones come.
CREATE TABLE IF NOT EXISTS handoffs (
  nonce TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);

-- The address a device subscribed to notifications on; NULL = before the move (ocn.kerkia.com). A device that subscribes
-- again on the new address leaves its old subscription (functions/api/push/[[path]].js).
ALTER TABLE push_subs ADD COLUMN origin TEXT;

-- The window about the move (assets/js/moved.js): 0 = still to show. Every account that exists now gets 0, accounts made
-- later the default 1; demo accounts never (read-only: they could not record that it was seen).
ALTER TABLE users ADD COLUMN moved_notice INTEGER NOT NULL DEFAULT 1;
UPDATE users SET moved_notice = 0 WHERE demo_until IS NULL;

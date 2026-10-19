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

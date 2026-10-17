-- The account's language (2026-10-17: the site in French and English): its e-mails are written in it, and a login on a
-- new device takes it. 'fr' or 'en'; French for the accounts made before.
ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr';

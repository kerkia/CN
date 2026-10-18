-- Demo accounts (owner, 2026-10-18): made by an administrator (admin page, « Démo ») for a federation, a league or a club that
-- wants to see the site; tied to no licence, read-only (the login gate refuses any change), valid until the day demo_until
-- (Paris), then refused. NULL for every ordinary account.
ALTER TABLE users ADD COLUMN demo_until TEXT;

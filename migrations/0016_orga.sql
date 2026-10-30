-- The Orga module (owner, 2026-10-30): an account chooses to use it — at registration, in Réglages or on the modules page.
-- 0 for every account of before: the modules page offers to turn it on (_lib/api.js publicUser `orga`).
ALTER TABLE users ADD COLUMN orga INTEGER NOT NULL DEFAULT 0;

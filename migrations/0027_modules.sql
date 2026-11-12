-- The creators' modules shown by need (owner, 2026-11-12): Orga (users.orga, migration 0016) and Carto, which leaves Orga's
-- menu, are shown only to the accounts that use them; the consumers' modules (Arena, Stats, Coach) may be hidden in
-- Réglages. Hidden is never blocked: a module's addresses always open (functions/_lib/modules.js, site app.js).
--   carto            the Carto module (Cartographier) shown in the bar and on the modules page
--   hidden_modules   the consumers' modules the account chose not to see, comma-separated (« arena,coach »)
--   modules_checked  0 until the account's existing work was looked at once (events, analyses, Tracer events, maps): what it
--                    already manages turns its module on (never off). New work turns it on as it is made.
ALTER TABLE users ADD COLUMN carto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN hidden_modules TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN modules_checked INTEGER NOT NULL DEFAULT 0;

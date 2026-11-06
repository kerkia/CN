-- « Mes cartes »: « Carte privée » (owner, 2026-11-06, as Analyse solo's and the Tracer's): a map its owner keeps from anyone
-- else, the administrators included — left out of their view of every map (api/admin/maplib) and not handed over to their
-- collection when the account is deleted (_lib/maplib.js). Off by default.
ALTER TABLE mymaps ADD COLUMN private INTEGER NOT NULL DEFAULT 0;

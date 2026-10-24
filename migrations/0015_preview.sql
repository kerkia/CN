-- Features a few accounts try before everyone (owner, 2026-10-24): the features' names, separated by commas ('' for every
-- other account), set by hand in D1 — _lib/api.js `previewOf`. « live1line »: « En direct », one line per runner.
ALTER TABLE users ADD COLUMN preview TEXT NOT NULL DEFAULT '';

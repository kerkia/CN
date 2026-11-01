-- « Robots » (admin page › Consommation; owner, 2026-11-01): what Cloudflare blocked and let through of the AI crawlers and
-- agents, and the guest passes, kept by Ozimut itself for 13 months (Cloudflare's own analytics go back 31 days).
-- Filled by functions/_lib/robots.js from Cloudflare's GraphQL analytics; nothing about any person: bots' requests counted by
-- day, the latest of them with their page and country (never an address), and the visits without an account counted by day.
CREATE TABLE bot_daily (
  day    TEXT NOT NULL,                 -- YYYY-MM-DD, UTC (Cloudflare's day)
  bot    TEXT NOT NULL,                 -- the AI bot's name (_lib/aibots.js), '' for any other automation Cloudflare stopped
  action TEXT NOT NULL,                 -- Cloudflare's action (block, managed_challenge…), or 'allowed' for an AI bot let through
  source TEXT NOT NULL DEFAULT '',      -- the Cloudflare feature that acted
  n      INTEGER NOT NULL,
  PRIMARY KEY (day, bot, action, source)
);
CREATE TABLE bot_recent (               -- the latest AI bots' requests Cloudflare acted on (the last day's, 100 at most)
  ts      INTEGER NOT NULL,             -- ms
  bot     TEXT NOT NULL,
  action  TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT '',
  path    TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT ''
);
CREATE TABLE guest_daily (              -- the visits without an account (functions/api/guest.js, the login gate)
  day     TEXT PRIMARY KEY,             -- YYYY-MM-DD, UTC
  passes  INTEGER NOT NULL DEFAULT 0,   -- guest passes given
  failed  INTEGER NOT NULL DEFAULT 0,   -- passes refused: Turnstile said no, or too many from one address
  refused INTEGER NOT NULL DEFAULT 0    -- public reads refused for want of a pass
);
CREATE TABLE bot_sync (                 -- the copy's state: one row, k = 'state', v = JSON
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

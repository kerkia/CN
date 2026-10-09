# O'Cap (working name)

A public, phone-first companion to O'CN: « Bientôt » (upcoming races), « En direct » (live results) and
« Récemment » (recent results with the split-time analyses). No login, public data only, no CN. French and English.

- `site/` — the app (Cloudflare Pages, static: free and unlimited). Vanilla JS modules, installable (PWA).
- `functions/` — the only server code the site runs (`site/_routes.json`): `/ws/<race>` hands a phone's live connection
  to the race's Durable Object; `/api/live/list` lists liveresultat's races of the last 3 and next 7 days (edge-cached).
- `worker/` — `ocap-live`: one Durable Object per liveresultat race, awake only while someone watches; it reads
  liveresultat once for everyone (passings every 15 s while runners come in, 30 s otherwise; only the classes that
  moved and are watched, with liveresultat's hash) and pushes each change over WebSockets (hibernation API).
- `dev/lr-mock.mjs` — a local stand-in for liveresultat replaying recorded races faster than real time.

## Running it locally

```
node ocap/dev/lr-mock.mjs <recording.json>… --port 8790 --speed 20
cd ocap/worker && npx wrangler dev --port 8791 --var LR_API:http://localhost:8790/api.php
cd ocap && npx wrangler pages dev --port 8792
```

Then open http://localhost:8792/#/direct. Recordings hold real results: keep them outside the repository. Without the
mock (no `LR_API`), the Worker reads the real liveresultat.

// POST /api/live/push?id=<broadcast> — one update of an organiser's live race (pages/orgdirect.js: the classes that changed
// since its last read of the timing software's export, in liveresultat's compact form). Handed as it is to the race's
// Durable Object on the live server (ocap/worker, « LiveRace », bound here as LIVE_RACE, internal path /push), which
// pushes the changes to the pages watching — O'CN's « En direct » and O'Cap. Administrators only for now (owner,
// 2026-10-15). The body is not parsed here (the free plan's ~10 ms of CPU): the race's object checks it.
import { json, withUser } from "../../_lib/api.js";

const MAX_BODY = 3 * 1024 * 1024;

export const onRequestPost = withUser(async ({ request, env, waitUntil }) => {
  if (!env.LIVE_RACE || !env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^9\d{8}$/.test(id)) return json({ error: "bad broadcast" }, 400);
  const body = await request.text();
  if (body.length > MAX_BODY) return json({ error: "too large" }, 413);
  const race = env.LIVE_RACE.get(env.LIVE_RACE.idFromName(id));
  const r = await race.fetch(`https://ocap-live/push?comp=${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (r.ok) {
    const d = env.LIVE_DIR.get(env.LIVE_DIR.idFromName("directory"));
    waitUntil(d.fetch("https://ocap-live/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "touch", id: Number(id) }) }).catch(() => {}));
  }
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
}, { admin: true });

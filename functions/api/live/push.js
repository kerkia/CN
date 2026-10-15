// POST /api/live/push?id=<broadcast> — one update of an organiser's live race (pages/orgdirect.js: the classes that changed
// since its last read of the timing software's export, in liveresultat's compact form). Handed as it is to the race's
// Durable Object on the live server (ocap/worker, « LiveRace », bound here as LIVE_RACE, internal path /push), which
// pushes the changes to the pages watching — O'CN's « En direct » and O'Cap. Only the account that opened the broadcast,
// or an administrator, feeds it (every account may open one since 2026-10-15, owner). The body is not parsed here (the
// free plan's ~10 ms of CPU): the race's object checks it.
import { isAdmin, json, withUser } from "../../_lib/api.js";
import { broadcasts, liveDir } from "../../_lib/live.js";

const MAX_BODY = 3 * 1024 * 1024;

export const onRequestPost = withUser(async ({ request, env, waitUntil }, user) => {
  if (!env.LIVE_RACE || !env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^9\d{8}$/.test(id)) return json({ error: "bad broadcast" }, 400);
  const b = (await broadcasts(env)).find((x) => x.id === Number(id));
  if (!b) return json({ error: "unknown broadcast" }, 404);
  if (b.by !== user.id && !isAdmin(env, user)) return json({ error: "not your broadcast" }, 403);
  const body = await request.text();
  if (body.length > MAX_BODY) return json({ error: "too large" }, 413);
  const race = env.LIVE_RACE.get(env.LIVE_RACE.idFromName(id));
  const r = await race.fetch(`https://ocap-live/push?comp=${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (r.ok) {
    waitUntil(liveDir(env).fetch("https://ocap-live/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "touch", id: Number(id) }) }).catch(() => {}));
  }
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
});

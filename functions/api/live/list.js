// GET /api/live/list — liveresultat's competitions of the last 3 and next 7 days, from O'CN's live relay (live/, Worker
// « ocn-live », its Durable Object « Directory », bound here as LIVE_DIR). Kept in the
// edge cache for the directory's own lifetime (2 minutes, 30 s while races still lack their country), so that a crowd opening
// « En direct » makes liveresultat read once per place and period; an empty list (liveresultat overloaded) is never kept.
// Signed-in accounts only (the login gate).
import { liveDir } from "../../_lib/live.js";

const JSON_TYPE = "application/json; charset=utf-8";

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.LIVE_DIR) return new Response(JSON.stringify({ comps: [] }), { status: 500, headers: { "Content-Type": JSON_TYPE } });
  const send = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": JSON_TYPE, "Cache-Control": "no-store" } });
  const cache = caches.default;
  const key = new Request(new URL("/api/live/list", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return send(await hit.text());
  const fresh = await liveDir(env).fetch("https://ocn-live/list");
  const body = await fresh.text();
  if (fresh.ok && !/"comps":\[\]/.test(body)) {
    const age = /max-age=(\d+)/.exec(fresh.headers.get("Cache-Control") || "")?.[1] || "120";
    waitUntil(cache.put(key, new Response(body, { headers: { "Content-Type": JSON_TYPE, "Cache-Control": `public, max-age=${age}` } })));
  }
  return send(body, fresh.ok ? 200 : 502);
}

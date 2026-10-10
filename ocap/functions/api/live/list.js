// /api/live/list: liveresultat's competitions of the last 3 and next 7 days (from the live Worker), kept 5 minutes in
// the edge cache so that a crowd opening the app makes liveresultat read once per place and period, not once per phone.
// Public data, open to other sites (O'CN's « En direct » reads it).
const open = (res) => {
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", "*");
  return out;
};

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL("/api/live/list", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return open(hit);
  const fresh = await env.LIVEW.fetch("https://ocap-live/list");
  const res = new Response(fresh.body, fresh);
  res.headers.set("Cache-Control", "public, max-age=300");
  waitUntil(cache.put(key, res.clone()));
  return open(res);
}

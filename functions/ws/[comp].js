// /ws/<competition> — « En direct »'s live connection to one race, handed to that race's Durable Object on O'CN's live relay
// (live/, Worker « ocn-live », « LiveRace », bound here as LIVE_RACE). One request per
// connection; the updates then flow over the WebSocket. Signed-in accounts only: the login gate passes the handshake on
// untouched (_middleware.js).
export async function onRequest({ request, env, params }) {
  if (!/^\d{1,9}$/.test(params.comp || "")) return new Response("Bad competition", { status: 400 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket expected", { status: 426 });
  if (!env.LIVE_RACE) return new Response("Live server not bound", { status: 500 });
  return env.LIVE_RACE.get(env.LIVE_RACE.idFromName(params.comp)).fetch(request);
}

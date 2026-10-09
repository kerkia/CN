// /ws/<competition>: a phone's live connection, handed to that competition's Durable Object (ocap/worker). One request
// per connection; the updates then flow over the WebSocket.
export async function onRequest({ request, env, params }) {
  if (!/^\d{1,9}$/.test(params.comp || "")) return new Response("Bad competition", { status: 400 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket expected", { status: 426 });
  return env.LIVE.get(env.LIVE.idFromName(params.comp)).fetch(request);
}

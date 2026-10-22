// POST /api/live/mop — MeOS's online results (MeOS Online Protocol, MOP; 2026-10-22): MeOS posts its whole race, then what
// changed, every few seconds, to the address the organiser gives it, with two headers: « Competition » (the broadcast's
// number, shown on « Organisation › Direct ») and « Pwd » (the broadcast's MeOS password, shown there too). No session:
// MeOS has none, so the login gate lets this path through (_middleware.js PUBLIC) and the password is the check; a
// competition number that is not one of ours (MeOS's own, 0, empty) is looked up by the password alone. The body is not
// read here (the free plan's ~10 ms of CPU): it goes as it is to the race's object on the live relay (live/, Worker
// « ocn-live », path /mop), which reads it (live/src/mop.js), keeps the race's state and pushes the changes to « En direct ».
// The answer is MeOS's own: <MOPStatus status="OK|BADCMP|BADPWD|NODATA|NOZIP|BADXML|ERROR">.
import { broadcasts, liveDir } from "../../_lib/live.js";

const MAX = 16 * 1024 * 1024;
const reply = (status, code = 200) => new Response(`<?xml version="1.0"?><MOPStatus status="${status}"></MOPStatus>`,
  { status: code, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
// a comparison that takes the same time whatever matches
const same = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.LIVE_RACE || !env.LIVE_DIR) return reply("ERROR", 500);
  const cmp = (request.headers.get("Competition") || "").trim(), pwd = (request.headers.get("Pwd") || "").trim();
  if (!pwd || pwd.length > 64) return reply("BADPWD", 403);
  if (Number(request.headers.get("Content-Length") || 0) > MAX) return reply("ERROR", 413);
  const all = await broadcasts(env);
  const b = /^9\d{8}$/.test(cmp) ? all.find((x) => x.id === Number(cmp)) : all.find((x) => x.mop && same(x.mop, pwd));
  if (!b) return reply(/^9\d{8}$/.test(cmp) ? "BADCMP" : "BADPWD", 403);
  if (!b.mop || !same(b.mop, pwd)) return reply("BADPWD", 403);
  const race = env.LIVE_RACE.get(env.LIVE_RACE.idFromName(String(b.id)));
  let r;
  try {
    r = await race.fetch(`https://ocn-live/mop?comp=${b.id}`, { method: "POST", body: request.body,
      headers: { "X-Info": encodeURIComponent(JSON.stringify({ name: b.name, organizer: b.organizer, date: b.date })) } });
  } catch (e) {
    return reply("ERROR", 502);
  }
  const d = await r.json().catch(() => ({}));
  if (d.status === "OK") {
    waitUntil(liveDir(env).fetch("https://ocn-live/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "touch", id: b.id, via: "mop", runners: d.runners }) }).catch(() => {}));
  }
  return reply(d.status || "ERROR", r.ok ? 200 : r.status);
}

export const onRequest = () => new Response("MeOS online results (MOP): POST only.\n", { status: 405, headers: { Allow: "POST" } });

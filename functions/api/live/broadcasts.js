// /api/live/broadcasts — the races an organiser feeds live from their timing software (« Organisation › Direct »,
// pages/orgdirect.js; administrators only for now, owner 2026-10-15). GET lists them; POST { name, date, organizer, key }
// opens one and answers its number (from 900 000 000, apart from liveresultat's). The register is kept by the live
// server's directory (ocap/worker, Durable Object « Directory », bound here as LIVE_DIR), reached at an internal path.
import { json, readBody, withUser } from "../../_lib/api.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dir = (env) => env.LIVE_DIR.get(env.LIVE_DIR.idFromName("directory"));

export const onRequestGet = withUser(async ({ env }) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const r = await dir(env).fetch("https://ocap-live/broadcasts");
  return json(await r.json());
}, { admin: true });

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const b = await readBody(request);
  const name = String(b?.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const date = String(b?.date || "");
  if (!name || !DAY.test(date)) return json({ error: "name and date required" }, 400);
  const r = await dir(env).fetch("https://ocap-live/broadcasts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "new", name, date, organizer: String(b.organizer || "").trim().slice(0, 160),
      key: b.key ? String(b.key).slice(0, 40) : null, by: user.id }),
  });
  return json(await r.json());
}, { admin: true });

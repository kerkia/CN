// /api/live/broadcasts — the races an organiser feeds live from their timing software (« Organisation › Direct »,
// pages/orgdirect.js; every account since 2026-10-15, owner). GET lists them (each with `mine`: the account opened it;
// the opener's account number to administrators only; its MeOS password, `mop`, to the opener and administrators);
// POST { name, date, organizer, key } opens one and answers its number (from 900 000 000, apart from liveresultat's), at
// most PER_DAY a day per account, with a MeOS password for MeOS's online results (api/live/mop.js, 2026-10-22); POST
// { op: "mopkey", id } gives one's broadcast a new MeOS password (the former one stops working). The register is kept
// by the live relay's directory (live/, Worker « ocn-live », Durable Object « Directory », bound here as LIVE_DIR),
// reached at an internal path.
import { isAdmin, json, readBody, withUser } from "../../_lib/api.js";
import { broadcasts, liveDir, newMopKey } from "../../_lib/live.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PER_DAY = 10;

export const onRequestGet = withUser(async ({ env }, user) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const admin = isAdmin(env, user);
  return json({ broadcasts: (await broadcasts(env)).map(({ by, key, mop, ...b }) => ({ ...b, mine: by === user.id,
    ...(admin ? { by } : {}), ...(by === user.id || admin ? { mop: mop || null } : {}) })) });
});

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const b = await readBody(request);
  if (b?.op === "mopkey") {
    const x = (await broadcasts(env)).find((y) => y.id === Number(b.id));
    if (!x) return json({ error: "unknown broadcast" }, 404);
    if (x.by !== user.id && !isAdmin(env, user)) return json({ error: "not your broadcast" }, 403);
    const mop = newMopKey();
    await liveDir(env).fetch("https://ocn-live/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "mop", id: x.id, mop }) });
    return json({ ok: true, mop });
  }
  const name = String(b?.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const date = String(b?.date || "");
  if (!name || !DAY.test(date)) return json({ error: "name and date required" }, 400);
  const since = Date.now() - 86400e3;
  if (!isAdmin(env, user) && (await broadcasts(env)).filter((x) => x.by === user.id && x.created > since).length >= PER_DAY) {
    return json({ error: "too many broadcasts today" }, 429);
  }
  const r = await liveDir(env).fetch("https://ocn-live/broadcasts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "new", name, date, organizer: String(b.organizer || "").trim().slice(0, 160),
      key: b.key ? String(b.key).slice(0, 40) : null, mop: newMopKey(), by: user.id }),
  });
  return json(await r.json());
});

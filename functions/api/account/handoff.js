// POST /api/account/handoff — the move to ozimut.com (2026-10-19): a signed-in visitor of the old address arrives signed in
// on the new one (assets/js/bridge.js).
//   on an old address (OLD_HOSTS), signed in:   {}          -> { token }: signed with a key of its own (never a session
//                                                              cookie), valid 60 seconds, usable once
//   on the new address:                         { token }   -> the user and a session cookie, as /api/account/login gives
// The token travels in the part of the address after « # », which no server receives; a token seen once is refused
// (D1 handoffs, migration 0013).

import { allow, clientIp, currentUser, demoExpired, json, readBody } from "../../_lib/api.js";
import { accountView } from "../../_lib/countries.js";
import { oldHosts, readToken, signSession } from "../../_middleware.js";

const LIFE_MS = 60e3;
const key = (env) => `${env.SESSION_SECRET}|handoff`;

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.DB) return json({ error: "server not configured" }, 500);
  const host = new URL(request.url).hostname;
  if (oldHosts(env).includes(host)) {
    const user = await currentUser(request, env);
    if (!user) return json({ error: "login required" }, 401);
    if (!(await allow(env, `handoff-out:${user.id}`, 20, 600))) return json({ error: "rate" }, 429);
    const token = await signSession({ ho: 1, uid: user.id, n: crypto.randomUUID(), exp: Date.now() + LIFE_MS }, key(env));
    return json({ token });
  }
  if (!(await allow(env, `handoff-in:${clientIp(request)}`, 30, 600))) return json({ error: "rate" }, 429);
  const b = await readBody(request);
  const p = typeof b?.token === "string" && b.token.length < 600 ? await readToken(b.token, key(env)) : null;
  if (!p?.ho || !Number.isInteger(p.uid) || typeof p.n !== "string") return json({ error: "invalid" }, 401);
  const used = await env.DB.prepare("INSERT OR IGNORE INTO handoffs (nonce, used_at) VALUES (?, ?)").bind(p.n, Date.now()).run();
  if (!used.meta.changes) return json({ error: "used" }, 401);
  await env.DB.prepare("DELETE FROM handoffs WHERE used_at < ?").bind(Date.now() - 86400e3).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(p.uid).first();
  if (!user || user.status !== "active" || !user.email_verified || demoExpired(user)) return json({ error: "disabled" }, 403);
  const view = await accountView(env, user);
  return json(view.body, 200, { "Set-Cookie": view.cookie });
}

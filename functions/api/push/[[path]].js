// The account's devices for push notifications (2026-10-18; functions/_lib/push.js). Logged-in accounts only.
//   GET  /api/push              -> { ready, key, devices, enabled }: the VAPID public key to subscribe with, how many devices
//                                  the account has, and whether it wants any alert by push (users.push_*)
//   POST /api/push/subscribe    { subscription: { endpoint, keys: { p256dh, auth } }, label } — this device (again: a browser
//                                  renews its subscription now and then; an address another account had moves to this one)
//   POST /api/push/unsubscribe  { endpoint } — this device no longer
//   POST /api/push/test         -> { reached }: a test notification to the account's devices
import { allow, json, readBody, userLang, withUser } from "../../_lib/api.js";
import { pushReady, pushToUser, validSubscription } from "../../_lib/push.js";
import { testPush } from "../../_lib/templates.js";

export const onRequestGet = withUser(async ({ env }, user) => {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(user.id).first().catch(() => null);
  return json({ ready: pushReady(env), key: env.VAPID_PUBLIC_KEY || null, devices: n?.n || 0,
    enabled: [user.push_starts, user.push_results, user.push_agenda, user.push_deadline].some((v) => v === 1) || user.push_starts === undefined });
});

export const onRequestPost = withUser(async ({ request, env, params }, user) => {
  const action = (params.path || []).join("/");
  const b = (await readBody(request)) || {};
  if (action === "subscribe") {
    if (!pushReady(env)) return json({ error: "not configured" }, 503);
    if (!validSubscription(b.subscription)) return json({ error: "bad request" }, 400);
    if (!(await allow(env, `push-sub:${user.id}`, 30, 3600))) return json({ error: "too many" }, 429);
    const s = b.subscription, label = String(b.label || "").slice(0, 60) || null;
    await env.DB.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        label = excluded.label, fails = 0`).bind(user.id, s.endpoint, s.keys.p256dh, s.keys.auth, label, Date.now()).run();
    return json({ ok: true });
  }
  if (action === "unsubscribe") {
    const endpoint = String(b.endpoint || "").slice(0, 1000);
    if (!endpoint) return json({ error: "bad request" }, 400);
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(endpoint, user.id).run();
    return json({ ok: true });
  }
  if (action === "test") {
    if (!pushReady(env)) return json({ error: "not configured" }, 503);
    if (!(await allow(env, `push-test:${user.id}`, 6, 3600))) return json({ error: "too many" }, 429);
    const reached = await pushToUser(env, user.id, testPush(userLang(user)), { ttl: 600 });
    return json({ reached });
  }
  return json({ error: "not found" }, 404);
});

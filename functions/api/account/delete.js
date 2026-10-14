// POST /api/account/delete { password } — erases the account and everything tied to it (GDPR).
import { allow, clearCookie, json, readBody, withUser } from "../../_lib/api.js";
import { checkPassword } from "../../_lib/crypto.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (!(await allow(env, `pwchange:${user.id}`, 8, 600))) return json({ error: "rate" }, 429);
  if (!(await checkPassword(String(b?.password || ""), user, env))) return json({ error: "invalid" }, 401);
  // the account's traces on shared analyses (R2: analyses/<id>/trace-<n>-<uid>.json)
  if (env.BUCKET) {
    try {
      const keys = [];
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: "analyses/", cursor, limit: 1000 });
        for (const o of r.objects) if (o.key.includes("/trace-") && o.key.endsWith(`-${user.id}.json`)) keys.push(o.key);
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
      // the analyses the account organised stay (their maps are kept, the other runners' traces too), without its
      // name: the administrators manage them from then on
      cursor = undefined;
      do {
        const r = await env.BUCKET.list({ prefix: "analyses-meta/", cursor, limit: 1000, include: ["customMetadata"] });
        for (const o of r.objects) {
          if (Number(o.customMetadata?.owner) !== user.id) continue;
          const obj = await env.BUCKET.get(o.key);
          const meta = obj ? await obj.json() : null;
          if (!meta) continue;
          meta.owner = 0; meta.ownerName = "";
          const custom = { ...(o.customMetadata || {}), owner: "0", ownerName: "" };
          await env.BUCKET.put(o.key, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" }, customMetadata: custom });
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
    } catch (e) { /* the account goes all the same */ }
  }
  // the relay simulator's added runners (a table that may not exist yet: migration 0008)
  try { await env.DB.prepare("DELETE FROM relay_runners WHERE user_id = ?").bind(user.id).run(); } catch (e) {}
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notified WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
});

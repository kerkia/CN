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
    // the Tracer's events the account created: to the first setter (else controller) of the team who has an account; with
    // nobody to take one over, it goes with its map, versions, comments and field states (its courses were the team's secret)
    try {
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: "tracer-meta/", cursor, limit: 1000, include: ["customMetadata"] });
        for (const o of r.objects) {
          if (Number(o.customMetadata?.owner) !== user.id) continue;
          const obj = await env.BUCKET.get(o.key);
          const meta = obj ? await obj.json().catch(() => null) : null;
          if (!meta) continue;
          let heir = null;
          for (const role of ["setter", "controller"]) for (const m of meta.team || []) {
            if (heir || m.role !== role || Number(m.uid) === user.id || (m.lic && String(m.lic) === String(user.licence))) continue;
            // a member added by account (uid), else by licence
            const u = m.uid
              ? await env.DB.prepare("SELECT id, display_name, licence FROM users WHERE id = ? AND status = 'active'").bind(Number(m.uid)).first()
              : m.lic ? await env.DB.prepare("SELECT id, display_name, licence FROM users WHERE licence = ? AND id != ? AND status = 'active' LIMIT 1").bind(String(m.lic), user.id).first() : null;
            if (u) heir = { u, m };
          }
          if (heir) {
            Object.assign(meta, { owner: heir.u.id, ownerName: heir.u.display_name || heir.m.name || "", ownerLic: String(heir.u.licence || heir.m.lic || "") });
            meta.team = meta.team.filter((x) => x !== heir.m);
            await env.BUCKET.put(o.key, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" },
              customMetadata: { ...(o.customMetadata || {}), owner: String(meta.owner), ownerName: meta.ownerName,
                team: meta.team.filter((x) => x.lic).map((x) => x.lic).join(","), uids: meta.team.filter((x) => x.uid).map((x) => x.uid).join(",") } });
          } else {
            const keys = [o.key];
            let c2;
            do {
              const l = await env.BUCKET.list({ prefix: `tracer/${meta.id}/`, cursor: c2, limit: 1000 });
              keys.push(...l.objects.map((x) => x.key));
              c2 = l.truncated ? l.cursor : undefined;
            } while (c2);
            for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
          }
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
    } catch (e) { /* the account goes all the same */ }
  }
  // the relay simulator's added runners (a table that may not exist yet: migration 0008)
  try { await env.DB.prepare("DELETE FROM relay_runners WHERE user_id = ?").bind(user.id).run(); } catch (e) {}
  try {                                       // the devices' push subscriptions and what was sent to them (migration 0010)
    await env.DB.batch([env.DB.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM push_sent WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM push_queue WHERE user_id = ?").bind(user.id)]);
  } catch (e) {}
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notified WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_countries WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
});

// Called by update.py (Authorization: Bearer NOTIFY_SECRET), never by the browser.
//
//   GET  /api/notify            -> { licences: [...] } licences with at least one subscribed account
//   POST /api/notify { items: [{ lic, races: [{ id, title, date, location }] }] }
//        queues one digest e-mail per subscribed account (races it was not told about yet),
//        then sends what fits in today's quota. { items: [] } just drains the backlog.
//   -> { queued, sent, remaining, budget }
//
// update.py computes who ran which new competition (it has the database); this side only
// knows who subscribed, so the server stays small.

import { json, readBody } from "../_lib/api.js";
import { sha256hex } from "../_lib/crypto.js";
import { flushQueue, queueStatement } from "../_lib/mail.js";
import { digestMail } from "../_lib/templates.js";

async function authorised(request, env) {
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.NOTIFY_SECRET || !given) return false;
  return (await sha256hex(given)) === (await sha256hex(env.NOTIFY_SECRET));
}

const SUBSCRIBED = "notify = 1 AND email_verified = 1 AND status = 'active'";

export async function onRequestGet({ request, env }) {
  if (!(await authorised(request, env))) return json({ error: "forbidden" }, 403);
  const { results } = await env.DB.prepare(`SELECT DISTINCT licence FROM users WHERE ${SUBSCRIBED}`).all();
  return json({ licences: results.map((r) => r.licence) });
}

export async function onRequestPost({ request, env }) {
  if (!(await authorised(request, env))) return json({ error: "forbidden" }, 403);
  const b = await readBody(request);
  const items = Array.isArray(b?.items) ? b.items.slice(0, 100) : [];
  let queued = 0;
  if (items.length) {
    const byLic = new Map(items.map((i) => [String(i.lic), (i.races || []).slice(0, 30)]));
    const lics = [...byLic.keys()];
    const { results: users } = await env.DB.prepare(
      `SELECT * FROM users WHERE ${SUBSCRIBED} AND licence IN (${lics.map(() => "?").join(",")})`).bind(...lics).all();
    // announce each (account, competition) once: INSERT OR IGNORE tells which ones are new
    const pairs = users.flatMap((u) => byLic.get(u.licence).map((r) => [u, r]));
    if (pairs.length) {
      const res = await env.DB.batch(pairs.map(([u, r]) =>
        env.DB.prepare("INSERT OR IGNORE INTO notified (user_id, course_id) VALUES (?, ?)").bind(u.id, String(r.id))));
      const fresh = new Map();
      pairs.forEach(([u, r], i) => { if (res[i].meta.changes) fresh.set(u, [...(fresh.get(u) || []), r]); });
      const stmts = [...fresh].map(([u, races]) => queueStatement(env,
        { to: u.email, ...digestMail(env, u, races), kind: "digest", priority: 0 }));
      if (stmts.length) await env.DB.batch(stmts);
      queued = stmts.length;
    }
  }
  return json({ queued, ...(await flushQueue(env)) });
}

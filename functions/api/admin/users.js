// GET /api/admin/users -> every account, plus the licences claimed by several confirmed accounts.
import { json, withUser } from "../../_lib/api.js";

export const onRequestGet = withUser(async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, licence, display_name, email_verified, status, notify, created_at, last_login
     FROM users ORDER BY created_at DESC`).all();
  const count = new Map();
  for (const u of results) if (u.email_verified) count.set(u.licence, (count.get(u.licence) || 0) + 1);
  const duplicates = [...count].filter(([, n]) => n > 1).map(([lic]) => lic);
  const queue = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue").first();
  return json({ users: results, duplicates, queued: queue.n });
}, { admin: true });

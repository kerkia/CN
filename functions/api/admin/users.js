// GET /api/admin/users -> every account (with its countries, "FR,CH": migration 0014), plus the licences claimed by several
// confirmed accounts.
import { json, withUser } from "../../_lib/api.js";

export const onRequestGet = withUser(async ({ env }, admin) => {
  const { results } = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, licence, display_name, email_verified, status, notify, created_at, last_login,
            analyst, alerts_allowed, agenda_alert, deadline_alert
     FROM users WHERE demo_until IS NULL ORDER BY created_at DESC`).all();       // demo accounts: their own tab
  let byUser = new Map();
  try {
    const { results: cs } = await env.DB.prepare(
      "SELECT user_id, group_concat(country || ':' || status) AS cs FROM user_countries GROUP BY user_id").all();
    byUser = new Map(cs.map((r) => [r.user_id, r.cs]));
  } catch (e) { /* the table not there yet */ }
  for (const u of results) u.countries = (byUser.get(u.id) || "").split(",").filter(Boolean).map((x) => { const [cc, status] = x.split(":"); return { cc, status }; });
  const count = new Map();
  for (const u of results) if (u.email_verified && u.licence) count.set(u.licence, (count.get(u.licence) || 0) + 1);
  const duplicates = [...count].filter(([, n]) => n > 1).map(([lic]) => lic);
  const queue = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_queue").first();
  return json({ users: results, duplicates, queued: queue.n, me: { signupAlert: !!admin.signup_alert } });
}, { admin: true });

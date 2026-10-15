// GET /api/admin/members — the accounts over time, for the admin page's « Inscrits » tab: each account's sign-up time,
// whether it is confirmed, its status and whether it is an administrator (no name, no e-mail), and the days on which each
// account used the site (usage_daily, Paris days, kept 13 months). The page counts registered and active accounts from it.
import { isAdmin, json, withUser } from "../../_lib/api.js";

export const onRequestGet = withUser(async ({ env }) => {
  const [users, seen, first] = await env.DB.batch([
    env.DB.prepare("SELECT id, email, email_verified, status, created_at FROM users"),
    env.DB.prepare("SELECT user_id, day FROM usage_daily GROUP BY user_id, day ORDER BY day"),
    env.DB.prepare("SELECT MIN(day) AS day FROM usage_daily"),
  ]);
  return json({
    users: users.results.map((u) => ({ id: u.id, created: u.created_at, verified: !!u.email_verified, status: u.status,
      admin: isAdmin(env, u) })),
    seen: seen.results.map((r) => [r.user_id, r.day]),
    first: first.results[0]?.day || null,
  });
}, { admin: true });

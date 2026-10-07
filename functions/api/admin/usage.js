// GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD — the usage over a period (both days included; without
// them, everything kept): per account and page, per account (active days), and per day.
import { isAdmin, json, withUser } from "../../_lib/api.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const onRequestGet = withUser(async ({ request, env }) => {
  const q = new URL(request.url).searchParams;
  const from = DAY.test(q.get("from") || "") ? q.get("from") : "0000-00-00";
  const to = DAY.test(q.get("to") || "") ? q.get("to") : "9999-99-99";
  const [byPage, byUser, byDay, first] = await env.DB.batch([
    // views of each page by each account; '_visit' = the visits
    env.DB.prepare(`SELECT user_id, page, SUM(views) AS views, COUNT(DISTINCT day) AS days FROM usage_daily
      WHERE day BETWEEN ? AND ? GROUP BY user_id, page`).bind(from, to),
    env.DB.prepare(`SELECT d.user_id, COUNT(DISTINCT d.day) AS days, MAX(d.day) AS last, u.email, u.first_name, u.last_name,
      u.display_name, u.licence FROM usage_daily d LEFT JOIN users u ON u.id = d.user_id
      WHERE d.day BETWEEN ? AND ? GROUP BY d.user_id`).bind(from, to),
    // per day and account: the views and visits, so the page can count active accounts with any filter
    env.DB.prepare(`SELECT day, user_id, SUM(CASE WHEN page = '_visit' THEN views ELSE 0 END) AS visits,
      SUM(CASE WHEN page = '_visit' THEN 0 ELSE views END) AS views FROM usage_daily
      WHERE day BETWEEN ? AND ? GROUP BY day, user_id ORDER BY day`).bind(from, to),
    env.DB.prepare("SELECT MIN(day) AS day FROM usage_daily"),
  ]);
  const users = byUser.results.map((u) => ({ ...u, admin: !!u.email && isAdmin(env, { ...u, email_verified: 1 }) }));
  return json({ from, to, first: first.results[0]?.day || null, pages: byPage.results, users, days: byDay.results });
}, { admin: true });

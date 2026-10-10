// POST /api/track { page, visit } — counts one page view of the logged-in account, by day (Paris time) and page;
// visit: true when the page opens a new browser session (one visit). Shown to the administrator only, on the
// admin page; kept 13 months. Two upserts at most per page view, well within D1's free quota.
import { json, readBody, withUser } from "../_lib/api.js";

// the site's pages (app.js routes; the Réseau views apart) — anything else is refused
const PAGES = new Set(["overview", "ranking", "runner", "compare", "clubs", "club", "clubcompare", "courses", "agenda",
  "methods", "settings", "contact", "admin", "provisional", "splits", "deposit", "live", "network:ego", "network:leaders", "network:territories", "network:stats"]);
const KEEP_DAYS = 400;

/** Today's date in Paris, YYYY-MM-DD; `plus` days later (negative: earlier). */
export const parisDay = (plus = 0) => {
  const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString().slice(0, 10);
};

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  const page = String(b?.page || "");
  if (!PAGES.has(page)) return json({ error: "bad request" }, 400);
  const day = parisDay();
  const up = (p) => env.DB.prepare(
    "INSERT INTO usage_daily (user_id, day, page, views) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, day, page) DO UPDATE SET views = views + 1",
  ).bind(user.id, day, p);
  const stmts = [up(page)];
  if (b.visit === true) stmts.push(up("_visit"));
  if (Math.random() < 0.01) stmts.push(env.DB.prepare("DELETE FROM usage_daily WHERE day < ?").bind(parisDay(-KEEP_DAYS)));
  await env.DB.batch(stmts);
  return json({ ok: true });
});

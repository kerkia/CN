// « Nutrition »: telling its readers that an article is out (owner, 2026-11-01; migration 0018). An article is announced once,
// the first time it is published and its day has come (nut_posts.announced_at): at once when it is published for today, or —
// for a date to come — by the first request that looks after that day (announceSoon: « Nutrition »'s own list, and the page
// views every signed-in account posts to /api/track, at most every 10 minutes an isolate). Each account that may read the
// articles (_lib/api.js nutritionRole), the author apart, gets one e-mail (users.nut_mail, with the administrator's e-mail
// right, users.alerts_allowed, as every alert) and one notification (users.nut_push) for the articles announced together;
// both are queued, then a few are sent at once (the rest by the next /api/notify, after a deploy, or the next announcement).

import { adminEmails, nowIso, nutritionRole, userLang } from "./api.js";
import { queueStatement, flushQueue } from "./mail.js";
import { queuePush, flushPush, pushReady } from "./push.js";
import { nutritionMail, nutritionPush } from "./templates.js";

const DAYS_BACK = 14;               // an article whose day is further back is no news (published long after it was dated)
let lastCheck = 0;

/** Announce the articles due, if any; -> how many. */
export async function announceDue(env) {
  if (!env.DB) return 0;
  const now = nowIso(), since = new Date(Date.now() - DAYS_BACK * 86400e3).toISOString();
  let due;
  try {
    // taken by this request alone: the UPDATE marks them, RETURNING says which (two requests at once cannot both get one)
    ({ results: due } = await env.DB.prepare(
      `UPDATE nut_posts SET announced_at = ? WHERE status = 'published' AND announced_at IS NULL AND published_at <= ?
       RETURNING id, title, summary, body, lang, author_id, author_name, published_at`).bind(now, now).all());
  } catch (e) { return 0; }        // before migration 0018
  const posts = due.filter((p) => p.published_at >= since).sort((a, b) => a.published_at.localeCompare(b.published_at))
    .map((p) => ({ id: p.id, title: p.title, summary: p.summary || excerpt(p.body), author: p.author_name, authorId: p.author_id, lang: p.lang }));
  if (!posts.length) return 0;
  const admins = adminEmails(env);
  const { results: users } = await env.DB.prepare(
    `SELECT * FROM users WHERE status = 'active' AND email_verified = 1 AND demo_until IS NULL AND (nut_mail = 1 OR nut_push = 1)
       AND (nutrition IN ('reader', 'author') OR ? = '1' OR lower(email) IN (${admins.map(() => "?").join(",") || "''"}))`,
  ).bind(env.NUTRITION_OPEN || "0", ...admins).all();
  const stmts = [];
  const push = pushReady(env);
  for (const u of users) {
    if (!nutritionRole(env, u)) continue;
    const mine = posts.filter((p) => p.authorId !== u.id);
    if (!mine.length) continue;
    if (u.nut_mail === 1 && u.alerts_allowed) {
      const m = nutritionMail(env, u, mine);
      stmts.push(queueStatement(env, { to: u.email, subject: m.subject, html: m.html, text: m.text, kind: "nutrition", priority: 0 }));
    }
    if (u.nut_push === 1 && push) stmts.push(queuePush(env, u.id, "nutrition", nutritionPush(userLang(u), mine), { topic: "nutrition" }));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await Promise.allSettled([flushQueue(env, 10), flushPush(env, 8)]);
  return posts.length;
}

/** announceDue in the background, at most every 10 minutes in this isolate (a request's ctx.waitUntil keeps it running). */
export function announceSoon(ctx, { now = false } = {}) {
  if (!now && Date.now() - lastCheck < 10 * 60e3) return;
  lastCheck = Date.now();
  ctx.waitUntil(announceDue(ctx.env).catch(() => 0));
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** The first sentences of an article, its summary when none is typed. */
export function excerpt(h, max = 220) {
  const s = String(h || "").replace(/<\/(p|h2|h3|h4|li|blockquote|tr|td|th)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1)) || 32) : ENT[e.toLowerCase()] ?? " ")).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  return `${cut.slice(0, at > max / 2 ? at + (cut[at] === "." ? 1 : 0) : max).trim()}…`;
}

// « Santé » (« Nutrition » until 2026-11-01): telling its readers that an article is out (owner, 2026-11-01; migration 0018). An article is announced once,
// the first time it is published and its day has come (nut_posts.announced_at): at once when it is published for today, or —
// for a date to come — by the first request that looks after that day (announceSoon: « Nutrition »'s own list, and the page
// views every signed-in account posts to /api/track, at most every 10 minutes an isolate). Each account that may read the
// articles (_lib/api.js nutritionRole), the author apart, gets one e-mail (users.nut_mail, with the administrator's e-mail
// right, users.alerts_allowed, as every alert) and one notification (users.nut_push) for the articles announced together;
// both are queued, then a few are sent at once (the rest by the next /api/notify, after a deploy, or the next announcement).
// Also here: the articles' English and French translations, made by Workers AI and kept, ahead of the readers (translateDue, below).

import { adminEmails, allow, nowIso, nutritionRole, userLang } from "./api.js";
import { queueStatement, flushQueue } from "./mail.js";
import { queuePush, flushPush, pushReady } from "./push.js";
import { nutritionMail, nutritionPush } from "./templates.js";
import { DEFAULT_MODEL } from "./ask.js";

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

// ---- translations ------------------------------------------------------------------------------------------------
export const LANGS = ["fr", "en", "de", "es"];
export const LANG_NAME = { fr: "French", en: "English", de: "German", es: "Spanish" };
const MAX_BODY = 400_000;                  // characters of HTML
export const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);

/** A first, cheap cleaning of the HTML (the browser cleans it again, with an allowlist, before showing it). */
export function stripHtml(h) {
  return String(h || "").slice(0, MAX_BODY)
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base|svg|math)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base|svg|math)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"');
}

// ---- translation -----------------------------------------------------------------------------------------------
export async function ai(env, messages, maxTokens) {
  const out = await env.AI.run(DEFAULT_MODEL, { messages, max_tokens: maxTokens, temperature: 0.1,
    ...(DEFAULT_MODEL.includes("gpt-oss") ? { reasoning: { effort: "low" } } : {}) });
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? (typeof out === "string" ? out : "");
  return typeof text === "string" ? text : JSON.stringify(text);
}

/** An article in another language: { title, summary, body }, or throws. */
export async function translatePost(env, p, to) {
  const from = LANG_NAME[p.lang] || "French", into = LANG_NAME[to];
  const messages = [
    { role: "system", content: `You translate articles about nutrition for orienteers (orienteering is an outdoor running sport) from ${from} into ${into}.
Translate only the visible text. Keep every HTML tag, attribute and URL exactly as it is, in the same order; never add, remove or reorder elements, never add comments or explanations.
Keep units, numbers and quantities as they are. Use natural, idiomatic ${into}${to === "de" ? " (address the reader as « du »)" : to === "es" ? " (address the reader as « tú »)" : ""}.
Answer with exactly three parts, each after its marker line, and nothing else:
@@TITLE@@
(the title)
@@SUMMARY@@
(the summary, or nothing when it is empty)
@@BODY@@
(the HTML body)` },
    { role: "user", content: `@@TITLE@@\n${p.title}\n@@SUMMARY@@\n${p.summary || ""}\n@@BODY@@\n${p.body}` },
  ];
  const text = await ai(env, messages, Math.min(16000, 1500 + Math.ceil(p.body.length / 2)));
  const m = /@@TITLE@@\s*([\s\S]*?)\s*@@SUMMARY@@\s*([\s\S]*?)\s*@@BODY@@\s*([\s\S]*)$/.exec(text);
  if (!m || !m[1].trim() || (p.body.trim() && !m[3].trim())) throw new Error("unreadable");
  return { title: clean(m[1], 300), summary: clean(m[2], 900), body: stripHtml(m[3].replace(/^```(?:html)?\s*|\s*```\s*$/g, "")) };
}

/** A translation kept (one per article and language, of the article's version it was made from). -> the row. */
export async function saveTranslation(env, p, to, t) {
  const row = { ...t, lang: to, version: p.version, created_at: nowIso() };
  await env.DB.prepare(`INSERT INTO nut_translations (post_id, lang, version, title, summary, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (post_id, lang) DO UPDATE SET version = excluded.version, title = excluded.title, summary = excluded.summary, body = excluded.body, created_at = excluded.created_at`)
    .bind(p.id, to, p.version, t.title, t.summary, t.body, row.created_at).run();
  return row;
}

// Every published article is kept in its original, in English and in French (owner, 2026-11-10; English only from 2026-11-01,
// translating into every language being too costly): each one is translated ahead of time into those of the two it is not
// written in (`TARGETS`), and into nothing else — a reader sees their own language when the original or a translation is in
// it, else English: at once when it is published or changed, in the background of that request, and
// whatever is still missing — a translation cut short, an article changed since — one at a time in the background of the page
// views (/api/track) and of « Santé »'s list, at most every 10 minutes an isolate. Each (article, version) is claimed for 15
// minutes so that two requests do not make it twice, and at most AUTO_PER_DAY are made a day (the account's free AI allowance,
// 10 000 neurons, shared with « IA »).
const AUTO_PER_DAY = 40;
export const TARGETS = ["en", "fr"];
let lastTranslate = 0;

/** Make up to `max` missing translations (of one article — all it lacks by default —, or of any); -> how many were made. */
export async function translateDue(env, { postId = null, max = postId ? TARGETS.length : 1 } = {}) {
  if (!env.DB || !env.AI) return 0;
  let posts, done;
  try {
    ({ results: posts } = await env.DB.prepare(`SELECT * FROM nut_posts WHERE status = 'published' AND published_at <= ?${postId ? " AND id = ?" : ""}
      ORDER BY published_at DESC`).bind(nowIso(), ...(postId ? [postId] : [])).all());
    ({ results: done } = await env.DB.prepare("SELECT post_id, lang, version FROM nut_translations").all());
  } catch (e) { return 0; }
  const have = new Set(done.map((d) => `${d.post_id}:${d.lang}:${d.version}`));
  const todo = posts.flatMap((p) => TARGETS.filter((l) => p.lang !== l && !have.has(`${p.id}:${l}:${p.version}`)).map((l) => [p, l]));
  const picked = [];
  for (const [p, l] of todo) {
    if (picked.length >= max) break;
    if (!(await allow(env, `nuttrlock:${p.id}:${l}:${p.version}`, 1, 900))) continue;      // being made by another request
    if (!(await allow(env, "nuttrauto", AUTO_PER_DAY, 86400))) break;                      // the day's share is spent
    picked.push([p, l]);
  }
  const made = await Promise.allSettled(picked.map(async ([p, l]) => saveTranslation(env, p, l, await translatePost(env, p, l))));
  return made.filter((r) => r.status === "fulfilled").length;
}

/** translateDue in the background: an article's translations at once (`postId`), or one missing translation, at most every
 *  10 minutes in this isolate (`now` skips the wait). */
export function translateSoon(ctx, { postId = null, now = false } = {}) {
  if (postId) { ctx.waitUntil(translateDue(ctx.env, { postId }).catch(() => 0)); return; }
  if (!now && Date.now() - lastTranslate < 10 * 60e3) return;
  lastTranslate = Date.now();
  ctx.waitUntil(translateDue(ctx.env).catch(() => 0));
}

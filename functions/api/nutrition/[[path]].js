// /api/nutrition — « Nutrition » (Coach; owner, 2026-11-01): articles by theme and date. D1 (migration 0017): nut_posts,
// nut_categories, nut_post_cats, nut_translations; the images in R2 (cn-state, nutrition/img/<key>).
// Who: an administrator (always an author), an account whose users.nutrition is 'author' (set on the admin page) writes;
// 'reader' reads; NUTRITION_OPEN "1" (wrangler.toml) would let every account read. An author changes and deletes their own
// articles, an administrator anyone's (and gives an article to another author); authors and administrators manage the themes.
// An article is shown in the language it was written in; a reader may ask for it in their own, translated by Workers AI once
// per article, language and version, kept in nut_translations.
//
//   GET    /api/nutrition[?manage=1]          { role, categories, posts } — the published articles (manage: also the drafts
//                                             one may change, and the authors an administrator may choose)
//   GET    /api/nutrition/posts/<id>[?lang=xx]   an article with its body; lang: its translation (made if needed)
//   POST   /api/nutrition/posts               a new article -> { post }
//   PUT    /api/nutrition/posts/<id>          changed { …, version } (409 when another change came first) -> { post }
//   DELETE /api/nutrition/posts/<id>
//   POST   /api/nutrition/bulk                { ids, op: delete | author | addCat | removeCat | publish | unpublish, author?, cat? }
//   POST   /api/nutrition/categories          { names } -> { category }; PUT …/categories/<id> { names }; DELETE …/categories/<id>
//   POST   /api/nutrition/img                 an image body (JPEG, PNG, WebP, GIF; 6 MB) -> { url }
//   GET    /api/nutrition/img/<key>

import { allow, json, nowIso, nutritionRole, readBody, withUser } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";
import { DEFAULT_MODEL } from "../../_lib/ask.js";

const IMG = "nutrition/img/";
const IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMG = 6 * 1024 * 1024;
const MAX_BODY = 400_000;                  // characters of HTML
const LANGS = ["fr", "en", "de", "es"];
const LANG_NAME = { fr: "French", en: "English", de: "German", es: "Spanish" };
const TRANSLATIONS_PER_DAY = 30;           // AI translations an account may start a day (those already made cost nothing)

const writes = (role) => role === "admin" || role === "author";
const authorName = (u) => `${String(u.first_name || "").trim()} ${String(u.last_name || "").trim()}`.trim() || u.display_name || "";
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max);
const newKey = () => Array.from(randomBytes(12), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

/** A first, cheap cleaning of the HTML (the browser cleans it again, with an allowlist, before showing it). */
function stripHtml(h) {
  return String(h || "").slice(0, MAX_BODY)
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base|svg|math)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base|svg|math)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, '$1="#"');
}
const textOf = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z#0-9]+;/gi, "x");
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** The first sentences of an article, its summary when none is typed. */
function excerpt(h, max = 220) {
  const s = String(h || "").replace(/<\/(p|h2|h3|h4|li|blockquote|tr|td|th)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1)) || 32) : ENT[e.toLowerCase()] ?? " ")).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  return `${cut.slice(0, at > max / 2 ? at + (cut[at] === "." ? 1 : 0) : max).trim()}…`;
}
const wordCount = (h) => (textOf(h).match(/[\p{L}\p{N}]+/gu) || []).length;
const imgKeys = (s) => [...String(s || "").matchAll(/\/api\/nutrition\/img\/([a-z0-9]{8,40}\.(?:jpg|png|webp|gif))/g)].map((m) => m[1]);

function parseNames(v) {
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
}
function cleanNames(v) {
  const o = parseNames(v), out = {};
  for (const l of LANGS) { const s = clean(o[l], 60); if (s) out[l] = s; }
  return out;
}

async function categories(env) {
  const { results } = await env.DB.prepare(
    "SELECT c.id, c.names, (SELECT COUNT(*) FROM nut_post_cats pc JOIN nut_posts p ON p.id = pc.post_id WHERE pc.cat_id = c.id AND p.status = 'published' AND p.published_at <= ?) AS n FROM nut_categories c ORDER BY c.id",
  ).bind(nowIso()).all();
  return results.map((c) => ({ id: c.id, names: parseNames(c.names), n: c.n }));
}

async function catsOf(env, ids) {
  const out = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(`SELECT post_id, cat_id FROM nut_post_cats WHERE post_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).all();
  for (const r of results) out.get(r.post_id)?.push(r.cat_id);
  return out;
}

/** What a list shows of an article (no body). */
const listed = (p, cats, me, role) => ({
  // a summary not typed: the article's first lines, for the lists only
  id: p.id, title: p.title, summary: p.summary || excerpt(p.body), cover: p.cover, lang: p.lang, status: p.status, pinned: !!p.pinned,
  published: p.published_at, updated: p.updated_at, words: p.words, author: p.author_name, authorId: p.author_id,
  cats: cats.get(p.id) || [], version: p.version, mine: p.author_id === me.id, canEdit: role === "admin" || (role === "author" && p.author_id === me.id),
});

const isLive = (p, now = nowIso()) => p.status === "published" && p.published_at && p.published_at <= now;

/** The fields of an article sent by the editor, checked. */
async function fields(env, b) {
  const title = clean(b.title, 200);
  if (!title) return { error: "title" };
  const lang = LANGS.includes(b.lang) ? b.lang : "fr";
  const body = stripHtml(b.body);
  const status = b.status === "published" ? "published" : "draft";
  let published = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(b.published || ""))) {
    const d = new Date(String(b.published).length === 10 ? `${b.published}T06:00:00Z` : b.published);
    if (!isNaN(d)) published = d.toISOString();
  }
  const cover = imgKeys(b.cover).length ? `/api/nutrition/img/${imgKeys(b.cover)[0]}` : "";
  const { results } = await env.DB.prepare("SELECT id FROM nut_categories").all();
  const known = new Set(results.map((r) => r.id));
  const cats = [...new Set((Array.isArray(b.cats) ? b.cats : []).map(Number))].filter((id) => known.has(id));
  return { title, lang, body, status, published, cover, cats, summary: clean(b.summary, 600), pinned: b.pinned ? 1 : 0, words: wordCount(body) };
}

async function setCats(env, id, cats) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM nut_post_cats WHERE post_id = ?").bind(id),
    ...cats.map((c) => env.DB.prepare("INSERT OR IGNORE INTO nut_post_cats (post_id, cat_id) VALUES (?, ?)").bind(id, c)),
  ]);
}

async function onePost(env, id) {
  return env.DB.prepare("SELECT * FROM nut_posts WHERE id = ?").bind(id).first();
}
async function full(env, p, me, role) {
  const cats = await catsOf(env, [p.id]);
  return { ...listed(p, cats, me, role), summary: p.summary, body: p.body };
}

/** The images of deleted articles that no other article shows any more. */
async function dropImages(env, posts) {
  const keys = new Set(posts.flatMap((p) => imgKeys(`${p.body} ${p.cover}`)));
  for (const k of keys) {
    const still = await env.DB.prepare("SELECT 1 FROM nut_posts WHERE body LIKE ? OR cover LIKE ? LIMIT 1").bind(`%${k}%`, `%${k}%`).first();
    if (!still) await env.BUCKET.delete(IMG + k).catch(() => {});
  }
}
async function deletePosts(env, posts) {
  if (!posts.length) return;
  const ids = posts.map((p) => p.id), qs = ids.map(() => "?").join(",");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM nut_post_cats WHERE post_id IN (${qs})`).bind(...ids),
    env.DB.prepare(`DELETE FROM nut_translations WHERE post_id IN (${qs})`).bind(...ids),
    env.DB.prepare(`DELETE FROM nut_posts WHERE id IN (${qs})`).bind(...ids),
  ]);
  if (env.BUCKET) await dropImages(env, posts);
}

// ---- translation -----------------------------------------------------------------------------------------------
async function ai(env, messages, maxTokens) {
  const out = await env.AI.run(DEFAULT_MODEL, { messages, max_tokens: maxTokens, temperature: 0.1,
    ...(DEFAULT_MODEL.includes("gpt-oss") ? { reasoning: { effort: "low" } } : {}) });
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? (typeof out === "string" ? out : "");
  return typeof text === "string" ? text : JSON.stringify(text);
}

/** An article in another language: { title, summary, body }, or throws. */
async function translatePost(env, p, to) {
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

/** A theme's names in every language: those typed kept, the others asked of the AI (none when it fails). */
async function fillNames(env, names) {
  const have = Object.keys(names);
  const missing = LANGS.filter((l) => !names[l]);
  if (!have.length || !missing.length || !env.AI) return names;
  try {
    const src = have[0];
    const text = await ai(env, [
      { role: "system", content: "You translate the short name of a theme of articles about nutrition for orienteers. Answer with one JSON object only, its keys the language codes asked for, its values the names; no other text." },
      { role: "user", content: `Name (${LANG_NAME[src]}): ${names[src]}\nLanguages: ${missing.join(", ")}` },
    ], 600);
    const o = JSON.parse((/\{[\s\S]*\}/.exec(text) || ["{}"])[0]);
    for (const l of missing) { const s = clean(o[l], 60); if (s) names[l] = s; }
  } catch (e) { /* the names typed only */ }
  return names;
}

// ---- the handler -----------------------------------------------------------------------------------------------
export const onRequest = withUser(async (ctx, me) => {
  const { request, env, params } = ctx;
  const role = nutritionRole(env, me);
  if (!role) return json({ error: "forbidden" }, 403);
  const parts = [].concat(params.path || []).map(String).filter(Boolean);
  const url = new URL(request.url);
  const method = request.method;
  const [what, arg] = parts;

  // an image of an article
  if (what === "img") {
    if (method === "GET" && arg) {
      if (!/^[a-z0-9]{8,40}\.(jpg|png|webp|gif)$/.test(arg)) return json({ error: "not found" }, 404);
      const obj = await env.BUCKET.get(IMG + arg);
      if (!obj) return json({ error: "not found" }, 404);
      return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    if (method === "POST" && !arg) {
      if (!writes(role)) return json({ error: "forbidden" }, 403);
      const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (!IMG_TYPES[type]) return json({ error: "type" }, 415);
      if (!(await allow(env, `nutimg:${me.id}`, 300, 86400))) return json({ error: "rate" }, 429);
      const buf = await request.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_IMG) return json({ error: "size" }, 413);
      const key = `${newKey()}.${IMG_TYPES[type]}`;
      await env.BUCKET.put(IMG + key, buf, { httpMetadata: { contentType: type }, customMetadata: { by: String(me.id), at: nowIso() } });
      return json({ url: `/api/nutrition/img/${key}` });
    }
    return json({ error: "bad request" }, 400);
  }

  // the list: the themes and the articles
  if (!what && method === "GET") {
    const manage = url.searchParams.get("manage") === "1" && writes(role);
    const now = nowIso();
    const { results } = manage
      ? (role === "admin"
        ? await env.DB.prepare("SELECT * FROM nut_posts ORDER BY COALESCE(published_at, updated_at) DESC").all()
        : await env.DB.prepare("SELECT * FROM nut_posts WHERE author_id = ? OR (status = 'published') ORDER BY COALESCE(published_at, updated_at) DESC").bind(me.id).all())
      : await env.DB.prepare("SELECT * FROM nut_posts WHERE status = 'published' AND published_at <= ? ORDER BY pinned DESC, published_at DESC").bind(now).all();
    const cats = await catsOf(env, results.map((p) => p.id));
    const out = { role, me: me.id, categories: await categories(env), posts: results.map((p) => listed(p, cats, me, role)) };
    if (manage && role === "admin") {
      const { results: au } = await env.DB.prepare(
        "SELECT id, first_name, last_name, display_name, email FROM users WHERE status = 'active' AND email_verified = 1 AND (nutrition = 'author' OR lower(email) IN (" +
        (String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean).map(() => "?").join(",") || "''") + "))",
      ).bind(...String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean)).all();
      out.authors = au.map((u) => ({ id: u.id, name: authorName(u) }));
    }
    return json(out);
  }

  // the bulk actions of the author's page
  if (what === "bulk" && method === "POST") {
    if (!writes(role)) return json({ error: "forbidden" }, 403);
    const b = await readBody(request);
    const ids = [...new Set((Array.isArray(b?.ids) ? b.ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
    if (!ids.length) return json({ error: "bad request" }, 400);
    const { results } = await env.DB.prepare(`SELECT * FROM nut_posts WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    const mine = results.filter((p) => role === "admin" || p.author_id === me.id);
    if (mine.length !== results.length) return json({ error: "forbidden" }, 403);
    const now = nowIso(), qs = mine.map(() => "?").join(","), keep = mine.map((p) => p.id);
    if (!keep.length) return json({ ok: true, n: 0 });
    if (b.op === "delete") await deletePosts(env, mine);
    else if (b.op === "author") {
      if (role !== "admin") return json({ error: "forbidden" }, 403);
      const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(Number(b.author)).first();
      if (!u || !writes(nutritionRole(env, u))) return json({ error: "author" }, 400);
      await env.DB.prepare(`UPDATE nut_posts SET author_id = ?, author_name = ?, updated_at = ? WHERE id IN (${qs})`).bind(u.id, authorName(u), now, ...keep).run();
    } else if (b.op === "addCat" || b.op === "removeCat") {
      const cat = await env.DB.prepare("SELECT id FROM nut_categories WHERE id = ?").bind(Number(b.cat)).first();
      if (!cat) return json({ error: "category" }, 400);
      await env.DB.batch(keep.map((id) => b.op === "addCat"
        ? env.DB.prepare("INSERT OR IGNORE INTO nut_post_cats (post_id, cat_id) VALUES (?, ?)").bind(id, cat.id)
        : env.DB.prepare("DELETE FROM nut_post_cats WHERE post_id = ? AND cat_id = ?").bind(id, cat.id)));
    } else if (b.op === "publish") {
      await env.DB.prepare(`UPDATE nut_posts SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id IN (${qs})`).bind(now, now, ...keep).run();
    } else if (b.op === "unpublish") {
      await env.DB.prepare(`UPDATE nut_posts SET status = 'draft', updated_at = ? WHERE id IN (${qs})`).bind(now, ...keep).run();
    } else return json({ error: "bad request" }, 400);
    return json({ ok: true, n: keep.length });
  }

  // the themes
  if (what === "categories") {
    if (!writes(role)) return json({ error: "forbidden" }, 403);
    if (method === "DELETE" && arg) {
      await env.DB.batch([env.DB.prepare("DELETE FROM nut_post_cats WHERE cat_id = ?").bind(Number(arg)),
        env.DB.prepare("DELETE FROM nut_categories WHERE id = ?").bind(Number(arg))]);
      return json({ ok: true });
    }
    const b = await readBody(request);
    const names = cleanNames(b?.names);
    if (!Object.keys(names).length) return json({ error: "name" }, 400);
    // a name changed in one language: the others typed are kept, those left empty asked of the AI again
    await fillNames(env, names);
    if (method === "POST" && !arg) {
      const r = await env.DB.prepare("INSERT INTO nut_categories (names, created_at) VALUES (?, ?) RETURNING id").bind(JSON.stringify(names), nowIso()).first();
      return json({ category: { id: r.id, names, n: 0 } });
    }
    if (method === "PUT" && arg) {
      const r = await env.DB.prepare("UPDATE nut_categories SET names = ? WHERE id = ?").bind(JSON.stringify(names), Number(arg)).run();
      return r.meta.changes ? json({ category: { id: Number(arg), names } }) : json({ error: "not found" }, 404);
    }
    return json({ error: "bad request" }, 400);
  }

  // one article
  if (what === "posts") {
    const id = arg ? Number(arg) : null;
    if (arg && !Number.isInteger(id)) return json({ error: "not found" }, 404);
    const p = id ? await onePost(env, id) : null;
    if (id && !p) return json({ error: "not found" }, 404);
    const mayEdit = p && (role === "admin" || (role === "author" && p.author_id === me.id));

    if (method === "GET" && p) {
      if (!isLive(p) && !mayEdit) return json({ error: "not found" }, 404);
      const out = await full(env, p, me, role);
      const to = url.searchParams.get("lang");
      if (to && LANGS.includes(to) && to !== p.lang) {
        let tr = await env.DB.prepare("SELECT * FROM nut_translations WHERE post_id = ? AND lang = ?").bind(p.id, to).first();
        if (!tr || tr.version !== p.version) {
          if (!env.AI) return json({ ...out, translation: { error: "ai" } });
          if (role !== "admin" && !(await allow(env, `nuttr:${me.id}`, TRANSLATIONS_PER_DAY, 86400))) return json({ ...out, translation: { error: "rate" } });
          try {
            const t = await translatePost(env, p, to);
            tr = { ...t, lang: to, version: p.version, created_at: nowIso() };
            await env.DB.prepare(`INSERT INTO nut_translations (post_id, lang, version, title, summary, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (post_id, lang) DO UPDATE SET version = excluded.version, title = excluded.title, summary = excluded.summary, body = excluded.body, created_at = excluded.created_at`)
              .bind(p.id, to, p.version, t.title, t.summary, t.body, tr.created_at).run();
          } catch (e) {
            const msg = String(e?.message || e);
            return json({ ...out, translation: { error: /neuron|quota|limit|429|capacity/i.test(msg) ? "quota" : "model" } });
          }
        }
        out.translation = { lang: to, title: tr.title, summary: tr.summary, body: tr.body, at: tr.created_at };
      }
      return json(out);
    }
    if (!writes(role)) return json({ error: "forbidden" }, 403);

    if (method === "POST" && !id) {
      if (!(await allow(env, `nutpost:${me.id}`, 200, 86400))) return json({ error: "rate" }, 429);
      const f = await fields(env, await readBody(request) || {});
      if (f.error) return json({ error: f.error }, 400);
      const now = nowIso();
      const r = await env.DB.prepare(`INSERT INTO nut_posts (author_id, author_name, lang, title, summary, body, cover, status, pinned, published_at, words, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id`)
        .bind(me.id, authorName(me), f.lang, f.title, f.summary, f.body, f.cover, f.status, f.pinned,
          f.status === "published" ? f.published || now : f.published, f.words, now, now).first();
      await setCats(env, r.id, f.cats);
      return json({ post: await full(env, await onePost(env, r.id), me, role) });
    }
    if (method === "PUT" && p) {
      if (!mayEdit) return json({ error: "forbidden" }, 403);
      const b = await readBody(request) || {};
      if (b.version != null && Number(b.version) !== p.version) return json({ error: "conflict", post: await full(env, p, me, role) }, 409);
      const f = await fields(env, b);
      if (f.error) return json({ error: f.error }, 400);
      const now = nowIso();
      const published = f.published || (f.status === "published" ? p.published_at || now : p.published_at);
      // an administrator may give the article to another author
      let author = [p.author_id, p.author_name];
      if (role === "admin" && b.author != null && Number(b.author) !== p.author_id) {
        const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(Number(b.author)).first();
        if (!u || !writes(nutritionRole(env, u))) return json({ error: "author" }, 400);
        author = [u.id, authorName(u)];
      }
      const before = { body: p.body, cover: p.cover };
      await env.DB.prepare(`UPDATE nut_posts SET author_id = ?, author_name = ?, lang = ?, title = ?, summary = ?, body = ?, cover = ?, status = ?, pinned = ?,
        published_at = ?, words = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .bind(author[0], author[1], f.lang, f.title, f.summary, f.body, f.cover, f.status, f.pinned, published, f.words, now, p.id).run();
      await setCats(env, p.id, f.cats);
      // the images the change took out
      const kept = new Set(imgKeys(`${f.body} ${f.cover}`));
      const gone = imgKeys(`${before.body} ${before.cover}`).filter((k) => !kept.has(k));
      if (gone.length && env.BUCKET) await dropImages(env, [{ body: gone.map((k) => `/api/nutrition/img/${k}`).join(" "), cover: "" }]);
      return json({ post: await full(env, await onePost(env, p.id), me, role) });
    }
    if (method === "DELETE" && p) {
      if (!mayEdit) return json({ error: "forbidden" }, 403);
      await deletePosts(env, [p]);
      return json({ ok: true });
    }
  }
  return json({ error: "bad request" }, 400);
});

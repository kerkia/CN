// /api/nutrition — « Nutrition » (Coach; owner, 2026-11-01): articles by theme and date. D1 (migration 0017): nut_posts,
// nut_categories, nut_post_cats, nut_translations; the images in R2 (cn-state, nutrition/img/<key>).
// Who: an administrator (always an author), an account whose users.nutrition is 'author' (set on the admin page) writes;
// 'reader' reads; NUTRITION_OPEN "1" (wrangler.toml) would let every account read. An author changes and deletes their own
// articles, an administrator anyone's (and gives an article to another author); authors and administrators manage the themes.
// An article is shown in the reader's language when its original or a translation into it is kept, else in English (each
// article is translated into English and French, those it is not written in, when published or changed: _lib/nutrition.js
// translateDue), the original one click away; nut_translations keeps one per article, language and version (those into German
// or Spanish made on request before 2026-11-01 are still used).
//
//   GET    /api/nutrition[?manage=1][?lang=xx]          { role, categories, posts } — the published articles (manage: also the drafts
//                                             one may change, and the authors an administrator may choose)
//   GET    /api/nutrition/posts/<id>[?lang=xx]   an article with its body; lang: the reader's, its translation into it, else into
//                                             English, when one is kept (none is made on request since 2026-11-01)
//   POST   /api/nutrition/posts               a new article -> { post }
//   PUT    /api/nutrition/posts/<id>          changed { …, version } (409 when another change came first) -> { post }
//   DELETE /api/nutrition/posts/<id>
//   POST   /api/nutrition/bulk                { ids, op: delete | author | addCat | removeCat | publish | unpublish, author?, cat? }
//   POST   /api/nutrition/categories          { names } -> { category }; PUT …/categories/<id> { names }; DELETE …/categories/<id>
//   POST   /api/nutrition/posts/<id>/like  { on } a reader's like (on: false takes it back) -> { likes, liked }
//   POST   /api/nutrition/img                 an image body (JPEG, PNG, WebP, GIF; 6 MB) -> { url }
//   GET    /api/nutrition/img/<key>

import { allow, json, nowIso, nutritionRole, readBody, withUser } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";
import { ai, announceSoon, clean, excerpt, LANG_NAME, LANGS, stripHtml, translateSoon } from "../../_lib/nutrition.js";

const IMG = "nutrition/img/";
const IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMG = 6 * 1024 * 1024;

const writes = (role) => role === "admin" || role === "author";
const authorName = (u) => `${String(u.first_name || "").trim()} ${String(u.last_name || "").trim()}`.trim() || u.display_name || "";
const newKey = () => Array.from(randomBytes(12), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

const textOf = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z#0-9]+;/gi, "x");
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

/** The translations to show of these articles to a reader of `lang`: into that language when one of the article's current
 *  version exists, else into English (an article not written in English, in their language neither). id -> row. */
async function translationsFor(env, posts, lang) {
  const out = new Map();
  if (!posts.length || !LANGS.includes(lang)) return out;
  const { results } = await env.DB.prepare(`SELECT * FROM nut_translations WHERE lang IN (?, 'en') AND post_id IN (${posts.map(() => "?").join(",")})`)
    .bind(lang, ...posts.map((p) => p.id)).all();
  for (const p of posts) {
    if (p.lang === lang) continue;
    const mine = results.filter((r) => r.post_id === p.id && r.version === p.version);
    const pick = mine.find((r) => r.lang === lang) || (p.lang !== "en" ? mine.find((r) => r.lang === "en") : null);
    if (pick) out.set(p.id, pick);
  }
  return out;
}
async function translationFor(env, p, lang) {
  const r = (await translationsFor(env, [p], lang)).get(p.id);
  return r ? { lang: r.lang, title: r.title, summary: r.summary, body: r.body, at: r.created_at } : null;
}

/** Each article's likes and whether the account likes it: id -> [n, mine] (none before migration 0018). */
async function likesOf(env, ids, me) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { results } = await env.DB.prepare(`SELECT post_id, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM nut_likes WHERE post_id IN (${ids.map(() => "?").join(",")}) GROUP BY post_id`)
      .bind(me.id, ...ids).all();
    for (const r of results) out.set(r.post_id, [r.n, !!r.mine]);
  } catch (e) { /* no table yet */ }
  return out;
}

/** What a list shows of an article (no body). */
const listed = (p, cats, me, role, likes = new Map()) => ({
  // a summary not typed: the article's first lines, for the lists only
  id: p.id, title: p.title, summary: p.summary || excerpt(p.body), cover: p.cover, lang: p.lang, status: p.status, pinned: !!p.pinned,
  published: p.published_at, updated: p.updated_at, words: p.words, author: p.author_name, authorId: p.author_id,
  cats: cats.get(p.id) || [], version: p.version, mine: p.author_id === me.id, canEdit: role === "admin" || (role === "author" && p.author_id === me.id),
  likes: likes.get(p.id)?.[0] || 0, liked: !!likes.get(p.id)?.[1],
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
  const [cats, likes] = await Promise.all([catsOf(env, [p.id]), likesOf(env, [p.id], me)]);
  return { ...listed(p, cats, me, role, likes), summary: p.summary, body: p.body };
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
  try { await env.DB.prepare(`DELETE FROM nut_likes WHERE post_id IN (${qs})`).bind(...ids).run(); } catch (e) { /* before migration 0018 */ }
  if (env.BUCKET) await dropImages(env, posts);
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
    const ids = results.map((p) => p.id);
    const [cats, likes] = await Promise.all([catsOf(env, ids), likesOf(env, ids, me)]);
    const out = { role, me: me.id, categories: await categories(env), posts: results.map((p) => listed(p, cats, me, role, likes)) };
    // the readers' list: each article's title and summary in the language it is shown in (translationFor's rule)
    if (!manage) {
      const trs = await translationsFor(env, results, url.searchParams.get("lang"));
      for (const o of out.posts) {
        const r = trs.get(o.id);
        if (r) o.tr = { lang: r.lang, title: r.title, summary: r.summary || excerpt(r.body) };
      }
    }
    announceSoon(ctx);           // an article whose publication day has come since: its readers are told
    translateSoon(ctx);          // and the translations still to make, one at a time
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
    if (b.op === "publish") { announceSoon(ctx, { now: true }); translateSoon(ctx, { now: true }); }
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

    // a like, by any reader, on a published article: POST …/posts/<id>/like { on } -> { likes, liked }
    if (parts[2] === "like" && method === "POST" && p) {
      if (!isLive(p)) return json({ error: "not found" }, 404);
      if (!(await allow(env, `nutlike:${me.id}`, 300, 86400))) return json({ error: "rate" }, 429);
      const b = await readBody(request);
      await (b?.on === false
        ? env.DB.prepare("DELETE FROM nut_likes WHERE post_id = ? AND user_id = ?").bind(p.id, me.id)
        : env.DB.prepare("INSERT OR IGNORE INTO nut_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(p.id, me.id, nowIso())).run();
      const [n, mine] = (await likesOf(env, [p.id], me)).get(p.id) || [0, false];
      return json({ likes: n, liked: mine });
    }

    if (method === "GET" && p) {
      if (!isLive(p) && !mayEdit) return json({ error: "not found" }, 404);
      const out = await full(env, p, me, role);
      // the reader's language when a translation into it exists, else English (owner, 2026-11-01); none is made here
      const tr = await translationFor(env, p, url.searchParams.get("lang"));
      if (tr) out.translation = tr;
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
      if (f.status === "published") { announceSoon(ctx, { now: true }); translateSoon(ctx, { postId: r.id }); }
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
      // a change that leaves the text as it was (the date, the themes, the author…) keeps its translations: they follow the new
      // version instead of being made again (owner, 2026-11-02: authors re-date articles)
      if (f.title === p.title && f.summary === (p.summary || "") && f.body === p.body && f.lang === p.lang)
        await env.DB.prepare("UPDATE nut_translations SET version = ? WHERE post_id = ? AND version = ?").bind(p.version + 1, p.id, p.version).run();
      // the images the change took out
      const kept = new Set(imgKeys(`${f.body} ${f.cover}`));
      const gone = imgKeys(`${before.body} ${before.cover}`).filter((k) => !kept.has(k));
      if (gone.length && env.BUCKET) await dropImages(env, [{ body: gone.map((k) => `/api/nutrition/img/${k}`).join(" "), cover: "" }]);
      if (f.status === "published") { announceSoon(ctx, { now: true }); translateSoon(ctx, { postId: p.id }); }
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

// /api/mymaps — « Mes cartes » (Coach; owner, 2026-11-01): each account's archive of its maps and the routes it ran on them.
// D1 (migration 0019): mymaps, mymap_runs, mymap_links. R2 (cn-state, binding BUCKET): mymaps/<user>/<map>/map (the image
// as it came), …/thumb (a small WebP or JPEG the browser made), …/runs/<run>.json (a run as drawn on the map: positions in
// the map's pixels and times, the personal channels only when the runner kept them). Everything is read and written in the
// browser; the server keeps, lists and serves. Private: only the account, unless it made a link (the whole archive, or one
// map), which anyone holding it reads — a visitor without an account too (with the guest pass: _middleware.js GUEST); the
// personal channels are never served through a link.
//
//   GET    /api/mymaps                          { maps: [map + runs], links: { archive, maps: { id: token } }, name }
//   POST   /api/mymaps/maps                     the image as the body, X-Meta (URI-encoded JSON: sha, title, day, place,
//                                               notes, w, h, geo) -> { map, existed } (the same image again: the map kept)
//   PUT    /api/mymaps/maps/<id>                { title, day, place, notes, geo } -> { map }
//   DELETE /api/mymaps/maps/<id>                the map, its runs, its link
//   PUT    /api/mymaps/maps/<id>/thumb          the thumbnail as the body
//   GET    /api/mymaps/maps/<id>/map | /thumb
//   POST   /api/mymaps/maps/<id>/runs           { title, day, start, dur, dist, source, rec } -> { run }
//   GET    /api/mymaps/runs/<id>                the run's record
//   PUT    /api/mymaps/runs/<id>                { title } -> { run };  DELETE /api/mymaps/runs/<id>
//   POST   /api/mymaps/link                     { map: id | null, on: true | false } -> { token | null }
//   GET    /api/mymaps/s/<token>                { name, maps } of a link (the archive's: every map; a map's: that one)
//   GET    /api/mymaps/s/<token>/maps/<id>/map | /thumb,  GET /api/mymaps/s/<token>/runs/<id>

import { allow, currentUser, json, nowIso, readBody } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";

const MAX_MAP = 80 * 1024 * 1024;                     // as the shared analyses' maps (Cloudflare takes 100 MB a request)
const MAX_THUMB = 600 * 1024;
const MAX_RUN = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
const newId = (n = 12) => Array.from(randomBytes(n), (b) => ALPHA[b % 32]).join("");
const ID = /^[a-z2-9]{8,40}$/;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const cleanDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
function cleanGeo(g) {
  if (!g || typeof g !== "object") return null;
  const o = {};
  for (const k of ["a", "b", "c", "d", "e", "f"]) { if (!Number.isFinite(g[k])) return null; o[k] = g[k]; }
  return Math.abs(o.a * o.e - o.b * o.d) > 1e-9 ? o : null;
}
/** The map's centre in longitude/latitude, from its georeference. */
function centre(geo, w, h) {
  if (!geo) return [null, null];
  const det = geo.a * geo.e - geo.b * geo.d, x = w / 2 - geo.c, y = h / 2 - geo.f;
  return [(geo.a * y - geo.d * x) / det, (geo.e * x - geo.b * y) / det];       // [lat, lon]
}
const key = (uid, map, rest) => `mymaps/${uid}/${map}/${rest}`;

const mapOut = (m) => ({ id: m.id, sha: m.sha, title: m.title, day: m.day, place: m.place, notes: m.notes, type: m.type, bytes: m.bytes,
  w: m.w, h: m.h, geo: m.geo ? JSON.parse(m.geo) : null, thumb: !!m.thumb, created: m.created_at, updated: m.updated_at });
const runOut = (r, shared = false) => ({ id: r.id, map: r.map_id, title: r.title, day: r.day, start: r.start_ms, dur: r.dur, dist: r.dist,
  source: r.source, personal: shared ? false : !!r.personal, bytes: shared ? undefined : r.bytes });

async function mapsOf(env, uid, only = null) {
  const q = only ? env.DB.prepare("SELECT * FROM mymaps WHERE user_id = ? AND id = ?").bind(uid, only)
    : env.DB.prepare("SELECT * FROM mymaps WHERE user_id = ? ORDER BY day DESC, created_at DESC").bind(uid);
  const [{ results: maps }, { results: runs }] = await Promise.all([q.all(),
    env.DB.prepare("SELECT * FROM mymap_runs WHERE user_id = ? ORDER BY start_ms").bind(uid).all()]);
  return { maps, runs };
}
const listed = (maps, runs, shared = false) => maps.map((m) => ({ ...mapOut(m), runs: runs.filter((r) => r.map_id === m.id).map((r) => runOut(r, shared)) }));
const nameOf = (u) => `${String(u.first_name || "").trim()} ${String(u.last_name || "").trim()}`.trim() || u.display_name || "";

/** An R2 object as the response (an image cached a year: a map never changes under its id). */
async function serve(env, k, { cache = "private, max-age=31536000, immutable", strip = false } = {}) {
  const obj = await env.BUCKET.get(k);
  if (!obj) return json({ error: "not found" }, 404);
  if (strip) {                                         // a run through a link: its personal channels left out
    const rec = await obj.json().catch(() => null);
    if (!rec) return json({ error: "not found" }, 404);
    delete rec.ch;
    return json(rec, 200, { "Cache-Control": "private, max-age=300" });
  }
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": cache } });
}
async function dropPrefix(env, prefix) {
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    if (r.objects.length) await env.BUCKET.delete(r.objects.map((o) => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
}
/** The body, up to `max` bytes (null beyond). */
async function bodyBytes(request, max) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > max) return null;
  const buf = await request.arrayBuffer();
  return buf.byteLength > max || !buf.byteLength ? null : buf;
}

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (!env.DB || !env.BUCKET) return json({ error: "server not configured" }, 500);
  const parts = [].concat(params.path || []).map(String);
  const method = request.method;
  try {
    // ---- a link: anyone who holds it (the login gate lets a visitor's GET through, with the guest pass)
    if (parts[0] === "s") {
      if (method !== "GET") return json({ error: "method" }, 405);
      const token = parts[1] || "";
      if (!ID.test(token)) return json({ error: "not found" }, 404);
      const link = await env.DB.prepare("SELECT * FROM mymap_links WHERE token = ?").bind(token).first();
      if (!link) return json({ error: "not found" }, 404);
      const uid = link.user_id;
      if (parts.length === 2) {
        const u = await env.DB.prepare("SELECT first_name, last_name, display_name FROM users WHERE id = ?").bind(uid).first();
        const { maps, runs } = await mapsOf(env, uid, link.map_id);
        return json({ name: u ? nameOf(u) : "", archive: !link.map_id, maps: listed(maps, runs, true) }, 200, { "Cache-Control": "private, max-age=60" });
      }
      if (parts[2] === "maps" && ID.test(parts[3] || "") && ["map", "thumb"].includes(parts[4]) && parts.length === 5) {
        if (link.map_id && link.map_id !== parts[3]) return json({ error: "not found" }, 404);
        const m = await env.DB.prepare("SELECT id FROM mymaps WHERE id = ? AND user_id = ?").bind(parts[3], uid).first();
        return m ? serve(env, key(uid, m.id, parts[4])) : json({ error: "not found" }, 404);
      }
      if (parts[2] === "runs" && ID.test(parts[3] || "") && parts.length === 4) {
        const r = await env.DB.prepare("SELECT * FROM mymap_runs WHERE id = ? AND user_id = ?").bind(parts[3], uid).first();
        if (!r || (link.map_id && link.map_id !== r.map_id)) return json({ error: "not found" }, 404);
        return serve(env, key(uid, r.map_id, `runs/${r.id}.json`), { strip: true });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- the account's own
    const user = await currentUser(request, env);
    if (!user) return json({ error: "login required" }, 401);
    const uid = user.id;

    if (!parts.length) {
      if (method !== "GET") return json({ error: "method" }, 405);
      const [{ maps, runs }, { results: links }] = await Promise.all([mapsOf(env, uid),
        env.DB.prepare("SELECT token, map_id FROM mymap_links WHERE user_id = ?").bind(uid).all()]);
      const out = { archive: null, maps: {} };
      for (const l of links) { if (l.map_id) out.maps[l.map_id] = l.token; else out.archive = l.token; }
      return json({ maps: listed(maps, runs), links: out, name: nameOf(user) });
    }

    if (parts[0] === "link" && parts.length === 1 && method === "POST") {
      const b = await readBody(request);
      const mapId = b?.map ? String(b.map) : null;
      if (mapId && !(await env.DB.prepare("SELECT id FROM mymaps WHERE id = ? AND user_id = ?").bind(mapId, uid).first())) return json({ error: "not found" }, 404);
      const where = mapId ? ["DELETE FROM mymap_links WHERE user_id = ? AND map_id = ?", uid, mapId] : ["DELETE FROM mymap_links WHERE user_id = ? AND map_id IS NULL", uid];
      if (!b?.on) { await env.DB.prepare(where[0]).bind(...where.slice(1)).run(); return json({ token: null }); }
      const sel = mapId ? env.DB.prepare("SELECT token FROM mymap_links WHERE user_id = ? AND map_id = ?").bind(uid, mapId)
        : env.DB.prepare("SELECT token FROM mymap_links WHERE user_id = ? AND map_id IS NULL").bind(uid);
      const old = await sel.first();
      if (old) return json({ token: old.token });
      const token = newId(20);
      await env.DB.prepare("INSERT INTO mymap_links (token, user_id, map_id, created_at) VALUES (?, ?, ?, ?)").bind(token, uid, mapId, nowIso()).run();
      return json({ token });
    }

    if (parts[0] === "maps") {
      if (parts.length === 1 && method === "POST") {
        if (!(await allow(env, `mymaps:${uid}`, 400, 3600))) return json({ error: "rate" }, 429);
        let meta;
        try { meta = JSON.parse(decodeURIComponent(request.headers.get("X-Meta") || "")); } catch (e) { return json({ error: "meta" }, 400); }
        const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim();
        const sha = String(meta?.sha || "");
        if (!TYPES.includes(type) || !/^[0-9a-f]{64}$/.test(sha)) return json({ error: "type" }, 415);
        const old = await env.DB.prepare("SELECT * FROM mymaps WHERE user_id = ? AND sha = ?").bind(uid, sha).first();
        if (old) return json({ map: mapOut(old), existed: true });
        const buf = await bodyBytes(request, MAX_MAP);
        if (!buf) return json({ error: "size" }, 413);
        const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
        if ([...d].map((x) => x.toString(16).padStart(2, "0")).join("") !== sha) return json({ error: "sha" }, 400);
        const w = Math.round(num(meta.w) || 0), h = Math.round(num(meta.h) || 0);
        if (!(w > 0 && h > 0 && w <= 40000 && h <= 40000)) return json({ error: "size" }, 400);
        const geo = cleanGeo(meta.geo), [lat, lon] = centre(geo, w, h), id = newId(), now = nowIso();
        await env.BUCKET.put(key(uid, id, "map"), buf, { httpMetadata: { contentType: type } });
        await env.DB.prepare(`INSERT INTO mymaps (id, user_id, sha, title, day, place, notes, type, bytes, w, h, geo, lat, lon, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, uid, sha, clean(meta.title, 200), cleanDay(meta.day), clean(meta.place, 200),
          clean(meta.notes, 4000), type, buf.byteLength, w, h, geo ? JSON.stringify(geo) : null, lat, lon, now, now).run();
        const m = await env.DB.prepare("SELECT * FROM mymaps WHERE id = ?").bind(id).first();
        return json({ map: mapOut(m), existed: false });
      }
      const id = parts[1] || "";
      if (!ID.test(id)) return json({ error: "not found" }, 404);
      const m = await env.DB.prepare("SELECT * FROM mymaps WHERE id = ? AND user_id = ?").bind(id, uid).first();
      if (!m) return json({ error: "not found" }, 404);
      if (parts.length === 2 && method === "PUT") {
        const b = await readBody(request);
        if (!b) return json({ error: "fields" }, 400);
        const geo = "geo" in b ? cleanGeo(b.geo) : m.geo ? JSON.parse(m.geo) : null, [lat, lon] = centre(geo, m.w, m.h);
        await env.DB.prepare("UPDATE mymaps SET title = ?, day = ?, place = ?, notes = ?, geo = ?, lat = ?, lon = ?, updated_at = ? WHERE id = ?")
          .bind("title" in b ? clean(b.title, 200) : m.title, "day" in b ? cleanDay(b.day) : m.day, "place" in b ? clean(b.place, 200) : m.place,
            "notes" in b ? clean(b.notes, 4000) : m.notes, geo ? JSON.stringify(geo) : null, lat, lon, nowIso(), id).run();
        return json({ map: mapOut(await env.DB.prepare("SELECT * FROM mymaps WHERE id = ?").bind(id).first()) });
      }
      if (parts.length === 2 && method === "DELETE") {
        await dropPrefix(env, `mymaps/${uid}/${id}/`);
        await env.DB.batch([env.DB.prepare("DELETE FROM mymap_runs WHERE map_id = ?").bind(id),
          env.DB.prepare("DELETE FROM mymap_links WHERE map_id = ?").bind(id), env.DB.prepare("DELETE FROM mymaps WHERE id = ?").bind(id)]);
        return json({ ok: true });
      }
      if (parts.length === 3 && parts[2] === "thumb" && method === "PUT") {
        const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim();
        if (!TYPES.includes(type)) return json({ error: "type" }, 415);
        const buf = await bodyBytes(request, MAX_THUMB);
        if (!buf) return json({ error: "size" }, 413);
        await env.BUCKET.put(key(uid, id, "thumb"), buf, { httpMetadata: { contentType: type } });
        await env.DB.prepare("UPDATE mymaps SET thumb = 1 WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (parts.length === 3 && ["map", "thumb"].includes(parts[2]) && method === "GET") return serve(env, key(uid, id, parts[2]));
      if (parts.length === 3 && parts[2] === "runs" && method === "POST") {
        if (!(await allow(env, `mymaps:${uid}`, 400, 3600))) return json({ error: "rate" }, 429);
        const text = await request.text();
        if (text.length > MAX_RUN) return json({ error: "size" }, 413);
        let b;
        try { b = JSON.parse(text); } catch (e) { return json({ error: "fields" }, 400); }
        const rec = b?.rec;
        if (!rec || rec.v !== 1 || !Array.isArray(rec.x) || rec.x.length < 2 || rec.x.length !== rec.y?.length) return json({ error: "run" }, 400);
        if (rec.ch && !b.personal) delete rec.ch;                 // kept only when the runner ticked it
        const body = JSON.stringify(rec), rid = newId(), day = cleanDay(b.day);
        await env.BUCKET.put(key(uid, id, `runs/${rid}.json`), body, { httpMetadata: { contentType: "application/json" } });
        await env.DB.prepare(`INSERT INTO mymap_runs (id, map_id, user_id, title, day, start_ms, dur, dist, source, personal, bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(rid, id, uid, clean(b.title, 200), day, num(b.start), num(b.dur), num(b.dist),
          clean(b.source, 20), rec.ch ? 1 : 0, body.length, nowIso()).run();
        if (!m.day && day) await env.DB.prepare("UPDATE mymaps SET day = ? WHERE id = ?").bind(day, id).run();
        return json({ run: runOut(await env.DB.prepare("SELECT * FROM mymap_runs WHERE id = ?").bind(rid).first()) });
      }
      return json({ error: "not found" }, 404);
    }

    if (parts[0] === "runs" && parts.length === 2 && ID.test(parts[1])) {
      const r = await env.DB.prepare("SELECT * FROM mymap_runs WHERE id = ? AND user_id = ?").bind(parts[1], uid).first();
      if (!r) return json({ error: "not found" }, 404);
      const k = key(uid, r.map_id, `runs/${r.id}.json`);
      if (method === "GET") return serve(env, k, { cache: "private, max-age=31536000, immutable" });
      if (method === "PUT") {
        const b = await readBody(request);
        await env.DB.prepare("UPDATE mymap_runs SET title = ? WHERE id = ?").bind(clean(b?.title, 200), r.id).run();
        return json({ run: runOut(await env.DB.prepare("SELECT * FROM mymap_runs WHERE id = ?").bind(r.id).first()) });
      }
      if (method === "DELETE") {
        await env.BUCKET.delete(k);
        await env.DB.prepare("DELETE FROM mymap_runs WHERE id = ?").bind(r.id).run();
        return json({ ok: true });
      }
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (/no such table/i.test(String(e?.message))) return json({ error: "not ready" }, 503);     // migration 0019 not applied
    throw e;
  }
}


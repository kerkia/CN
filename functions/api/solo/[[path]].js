// /api/solo — the solo analyses an account keeps (owner, 2026-11-05: « Analyse solo »'s « Enregistrer l'analyse », beside
// « Voir la course »; listed in « Analyse de carte », replayed or deleted there; not « Mes cartes », which keeps what one saves
// to it from the playback's « Export »). Private: only the account reads its own. R2 only (cn-state, binding BUCKET), no D1:
//   solo/<user>/a/<id>.json   the analysis: { v, title, day, source, map: { sha, type, w, h }, geo, start, dur, dist, rec,
//                             orga } — rec the run as the playback drew it (trace/mymaps.js encodeRun: positions in the map's
//                             pixels and times, the controls placed; never heart rate or the watch's other channels); its
//                             summary in the object's custom metadata `s`, so that the list is one R2 list
//   solo/<user>/m/<sha>       a map, once per account whatever the number of analyses on it;  …/m/<sha>.thumb  its thumbnail
//
//   GET    /api/solo                  { analyses: [summary + id] }
//   POST   /api/solo                  the analysis (JSON) -> { id }        PUT /api/solo/<id>  the same, replacing it
//   GET    /api/solo/<id>             the analysis (its current title also in X-Title, URI-encoded: a rename touches the summary only)
//   PATCH  /api/solo/<id>             { title } -> { analysis }  (renamed)   DELETE /api/solo/<id>  it, and its map once unused
//   GET    /api/solo/maps/<sha>/has   { map, thumb }  (what the browser need not send again)
//   PUT    /api/solo/maps/<sha>       the image as the body;  PUT …/maps/<sha>/thumb  the thumbnail
//   GET    /api/solo/maps/<sha>  |  /maps/<sha>/thumb
// The account's deletion removes them all (api/account/delete.js).

import { allow, currentUser, json, nowIso } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";

const MAX_MAP = 80 * 1024 * 1024;                    // as « Mes cartes » and the shared analyses (Cloudflare takes 100 MB a request)
const MAX_THUMB = 600 * 1024;
const MAX_REC = 8 * 1024 * 1024;
const MAX_COUNT = 2000;                              // analyses an account keeps
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
const newId = (n = 12) => Array.from(randomBytes(n), (b) => ALPHA[b % 32]).join("");
const ID = /^[a-z2-9]{8,40}$/;
const SHA = /^[0-9a-f]{64}$/;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const cleanDay = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
function cleanGeo(g) {
  if (!g || typeof g !== "object") return null;
  const o = {};
  for (const k of ["a", "b", "c", "d", "e", "f"]) { if (!Number.isFinite(g[k])) return null; o[k] = g[k]; }
  return Math.abs(o.a * o.e - o.b * o.d) > 1e-9 ? o : null;
}
const aKey = (uid, id) => `solo/${uid}/a/${id}.json`;
const mKey = (uid, sha, thumb = false) => `solo/${uid}/m/${sha}${thumb ? ".thumb" : ""}`;

/** The analysis as kept, from what the browser sent (null when it is not one). */
function cleanAnalysis(b) {
  if (!b || typeof b !== "object") return null;
  const m = b.map || {};
  if (!SHA.test(String(m.sha || "")) || !TYPES.includes(m.type) || !(num(m.w) > 0) || !(num(m.h) > 0)) return null;
  const rec = b.rec;
  if (!rec || typeof rec !== "object" || rec.ch) return null;                         // positions and times only
  const orga = b.orga && ID.test(String(b.orga.id || "")) ? { id: String(b.orga.id), n: Math.max(0, Math.floor(num(b.orga.n) || 0)) } : null;
  return { v: 1, title: clean(b.title, 200), day: cleanDay(b.day), source: ["solo", "drawn", "orga"].includes(b.source) ? b.source : "solo",
    map: { sha: m.sha, type: m.type, w: Math.round(m.w), h: Math.round(m.h) }, geo: cleanGeo(b.geo),
    start: num(b.start), dur: num(b.dur), dist: num(b.dist), rec, orga };
}
/** What the list shows of an analysis (the object's custom metadata: 2 KB at most). */
const summary = (a, id, created, updated) => ({ id, title: a.title, day: a.day, source: a.source, sha: a.map.sha, w: a.map.w, h: a.map.h, geo: a.geo,
  start: a.start, dur: a.dur, dist: a.dist, orga: a.orga, created, updated });

async function listAll(env, uid) {
  const out = [];
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix: `solo/${uid}/a/`, cursor, limit: 1000, include: ["customMetadata"] });
    for (const o of r.objects) { try { out.push(JSON.parse(o.customMetadata?.s || "null")); } catch (e) { /* a summary unreadable: left out */ } }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out.filter(Boolean);
}
async function serve(env, k) {
  const obj = await env.BUCKET.get(k);
  if (!obj) return json({ error: "not found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable" } });     // a map never changes under its hash
}
async function bodyBytes(request, max) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > max) return null;
  const buf = await request.arrayBuffer();
  return buf.byteLength > max || !buf.byteLength ? null : buf;
}
async function bodyJson(request) {
  const buf = await bodyBytes(request, MAX_REC);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return null; }
}

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  if (!env.BUCKET) return json({ error: "server not configured" }, 500);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "login required" }, 401);
  const uid = user.id, method = request.method;
  const parts = [].concat(params.path || []).map(String);
  try {
    if (!parts.length) {
      if (method === "GET") {
        const list = await listAll(env, uid);
        list.sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")) || String(b.created || "").localeCompare(String(a.created || "")));
        return json({ analyses: list }, 200, { "Cache-Control": "private, no-store" });
      }
      if (method !== "POST") return json({ error: "method" }, 405);
    }
    // ---- the maps, by their hash
    if (parts[0] === "maps") {
      const sha = parts[1] || "";
      if (!SHA.test(sha)) return json({ error: "not found" }, 404);
      const thumb = parts[2] === "thumb";
      if (parts[2] === "has" && parts.length === 3 && method === "GET") {
        const [m, th] = await Promise.all([env.BUCKET.head(mKey(uid, sha)), env.BUCKET.head(mKey(uid, sha, true))]);
        return json({ map: !!m, thumb: !!th });
      }
      if (parts.length > (thumb ? 3 : 2)) return json({ error: "not found" }, 404);
      if (method === "GET") return serve(env, mKey(uid, sha, thumb));
      if (method !== "PUT") return json({ error: "method" }, 405);
      if (!(await allow(env, `solo:${uid}`, 300, 3600))) return json({ error: "rate" }, 429);
      const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim();
      if (!TYPES.includes(type)) return json({ error: "type" }, 415);
      const buf = await bodyBytes(request, thumb ? MAX_THUMB : MAX_MAP);
      if (!buf) return json({ error: "size" }, 413);
      await env.BUCKET.put(mKey(uid, sha, thumb), buf, { httpMetadata: { contentType: type } });
      return json({ ok: true });
    }
    // ---- an analysis
    const id = parts[0] || "";
    if (parts.length > 1 || (id && !ID.test(id))) return json({ error: "not found" }, 404);
    if (method === "GET") {
      const obj = id ? await env.BUCKET.get(aKey(uid, id)) : null;
      if (!obj) return json({ error: "not found" }, 404);
      let title = "";
      try { title = JSON.parse(obj.customMetadata?.s || "null")?.title || ""; } catch (e) { /* the record's own */ }
      return new Response(obj.body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Title": encodeURIComponent(title) } });
    }
    if (method === "PATCH") {
      if (!(await allow(env, `solo:${uid}`, 300, 3600))) return json({ error: "rate" }, 429);
      const b = await bodyJson(request);
      if (!b || typeof b.title !== "string") return json({ error: "fields" }, 400);
      const obj = id ? await env.BUCKET.get(aKey(uid, id)) : null;
      if (!obj) return json({ error: "not found" }, 404);
      let s;
      try { s = JSON.parse(obj.customMetadata?.s || "null"); } catch (e) { s = null; }
      if (!s) return json({ error: "server" }, 500);
      s = { ...s, title: clean(b.title, 200), updated: nowIso() };
      // the record copied as it is (not read: it may be large); the summary carries the new title
      await env.BUCKET.put(aKey(uid, id), await obj.arrayBuffer(), { httpMetadata: { contentType: "application/json" }, customMetadata: { s: JSON.stringify(s) } });
      return json({ analysis: s });
    }
    if (method === "DELETE") {
      const obj = await env.BUCKET.head(aKey(uid, id));
      if (!obj) return json({ error: "not found" }, 404);
      let sha = null;
      try { sha = JSON.parse(obj.customMetadata?.s || "null")?.sha || null; } catch (e) { /* the map stays */ }
      await env.BUCKET.delete(aKey(uid, id));
      // its map goes once no other analysis shows it
      if (sha && !(await listAll(env, uid)).some((s) => s.sha === sha)) await env.BUCKET.delete([mKey(uid, sha), mKey(uid, sha, true)]);
      return json({ ok: true });
    }
    if (method !== "POST" && method !== "PUT") return json({ error: "method" }, 405);
    if (!(await allow(env, `solo:${uid}`, 300, 3600))) return json({ error: "rate" }, 429);
    const a = cleanAnalysis(await bodyJson(request));
    if (!a) return json({ error: "fields" }, 400);
    if (!(await env.BUCKET.head(mKey(uid, a.map.sha)))) return json({ error: "map" }, 409);       // the map first
    let created = nowIso(), key = id;
    if (method === "PUT") {
      if (!id) return json({ error: "not found" }, 404);
      const was = await env.BUCKET.head(aKey(uid, id));
      if (!was) return json({ error: "not found" }, 404);
      try {
        const old = JSON.parse(was.customMetadata?.s || "null");
        created = old?.created || created;
        if (!a.title && old?.title) a.title = old.title;           // a calibration made again keeps the name given (a rename too)
      } catch (e) { /* now */ }
    } else {
      if (id) return json({ error: "method" }, 405);
      if ((await listAll(env, uid)).length >= MAX_COUNT) return json({ error: "full" }, 409);
      key = newId();
    }
    const s = summary(a, key, created, nowIso());
    await env.BUCKET.put(aKey(uid, key), JSON.stringify(a), { httpMetadata: { contentType: "application/json" }, customMetadata: { s: JSON.stringify(s) } });
    return json({ id: key, analysis: s });
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
}

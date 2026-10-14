// /api/analyses — the shared analyses (« Analyse club », « Analyse compétition »): an organiser's circuits (maps,
// georeferences, controls) and the runners' own GPS traces, kept in R2 (bucket cn-state, binding BUCKET):
//   analyses-meta/<id>.json                — the analysis (its summary also in the object's custom metadata: one list)
//   analyses/<id>/map-<n>                  — a circuit's map image
//   analyses/<id>/trace-<n>-<uid>.json     — one account's trace on circuit n: positions and times only, cropped to
//                                            the map by the browser; the name and licence are the account's
// Access: the organiser and the administrators always; otherwise by the analysis's rule — every logged-in account
// ("public"), the members of the organiser's club ("club": the club of one's latest race in the site's data), or a
// password ("password": checked once by /unlock, which returns a key — an HMAC of the analysis, the account and the
// password's salt — sent back in X-Analysis-Key). Each account adds, replaces or removes only its own trace; the
// organiser and the administrators may remove any.
//
//   GET    /api/analyses?kind=club|race[&race=<key>]   the analyses one may open (or unlock)
//   POST   /api/analyses                               create { kind, title, date, race?, vis, password? } -> { id }
//   GET    /api/analyses/<id>                          the analysis and its traces' list
//   PUT    /api/analyses/<id>                          the organiser: { title?, vis?, password?, courses? }
//   DELETE /api/analyses/<id>                          the organiser: the analysis, its maps and traces
//   POST   /api/analyses/<id>/unlock                   { password } -> { key }
//   GET|PUT /api/analyses/<id>/map/<n>                 a circuit's map (PUT: the organiser, an image body)
//   GET    /api/analyses/<id>/traces/<n>               every trace of circuit n, one JSON array
//   PUT|DELETE /api/analyses/<id>/trace/<n>[/<uid>]    one's own trace (DELETE <uid>: the organiser, an admin)

import { allow, isAdmin, json, readBody, withUser, nowIso } from "../../_lib/api.js";
import { hashPassword, checkPassword, b64url, randomBytes } from "../../_lib/crypto.js";

const META = "analyses-meta/";
const DATA = "analyses/";
const KINDS = ["club", "race"];
const VIS = ["public", "club", "password"];
const MAX_MAP = 80 * 1024 * 1024, MAX_TRACE = 3 * 1024 * 1024, MAX_POINTS = 40000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const newId = () => Array.from(randomBytes(12), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

/** The club (4 digits) of the account's licence: that of its latest race in the site's data, or null. */
async function clubOf(env, request, licence) {
  const lic = String(licence || "");
  if (!/^\d+$/.test(lic)) return null;
  try {
    const res = await env.ASSETS.fetch(new URL(`/data/r/${Math.floor(Number(lic) / 10)}.json`, request.url));
    const rows = res.ok ? (await res.json())[lic] || [] : [];
    let best = null;
    for (const r of rows) if (r && typeof r[4] === "string" && (!best || r[4] > best[4])) best = r;
    const m = /^(\d{4})/.exec(best?.[9] || "");
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function hmacKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`an:${env.SESSION_SECRET}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function unlockKey(env, meta, uid) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(`${meta.id}:${uid}:${meta.pw?.pw_salt || ""}`));
  return b64url(sig);
}

const summary = (m) => ({ id: m.id, kind: m.kind, title: m.title, date: m.date, race: m.race || "", club: m.club || "", vis: m.vis,
  owner: m.owner, ownerName: m.ownerName || "", courses: (m.courses || []).length, updated: m.updated });
const custom = (m) => Object.fromEntries(Object.entries(summary(m)).map(([k, v]) => [k, String(v ?? "")]));
const publicMeta = (m) => { const { pw, ...rest } = m; return rest; };

async function loadMeta(env, id) {
  const o = await env.BUCKET.get(`${META}${id}.json`);
  if (!o) return null;
  try { return await o.json(); } catch (e) { return null; }
}
async function saveMeta(env, meta) {
  meta.updated = nowIso();
  await env.BUCKET.put(`${META}${meta.id}.json`, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" }, customMetadata: custom(meta) });
}
async function listAll(env, prefix, include = true) {
  const out = [];
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix, cursor, include: include ? ["customMetadata"] : undefined, limit: 1000 });
    out.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/** "open", "locked" (a password to give) or null (not for this account). */
async function access(ctx, user, meta, lazyClub) {
  const { env, request } = ctx;
  if (meta.owner === user.id || isAdmin(env, user)) return "open";
  if (meta.vis === "public") return "open";
  if (meta.vis === "club") return meta.club && (await lazyClub()) === meta.club ? "open" : null;
  if (meta.vis === "password") {
    const k = request.headers.get("X-Analysis-Key");
    return k && k === await unlockKey(env, meta, user.id) ? "open" : "locked";
  }
  return null;
}
const isOrganiser = (env, user, meta) => meta.owner === user.id || isAdmin(env, user);

function cleanCourses(list) {
  if (!Array.isArray(list) || list.length > 12) return null;
  const out = [];
  for (const c of list) {
    const n = Number(c?.n);
    if (!Number.isInteger(n) || n < 0 || n > 99 || out.some((x) => x.n === n)) return null;
    const g = c.geo || {};
    const geo = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, num(g[k])]));
    if (Object.values(geo).some((v) => v == null)) return null;
    const ctrls = Array.isArray(c.controls) ? c.controls.slice(0, 80).map((p) => ({
      kind: ["start", "control", "finish"].includes(p?.kind) ? p.kind : "control", code: clean(p?.code, 10), x: num(p?.x), y: num(p?.y) })) : [];
    if (ctrls.some((p) => p.x == null || p.y == null)) return null;
    const m = c.map || {};
    out.push({ n, name: clean(c.name, 60) || `Circuit ${n + 1}`, circuit: clean(c.circuit, 80), r: num(c.r) || 20,
      map: { w: Math.round(num(m.w) || 0), h: Math.round(num(m.h) || 0), type: /^image\/(png|jpeg|webp)$/.test(m.type) ? m.type : "image/jpeg", v: Math.round(num(m.v) || 0) },
      geo, controls: ctrls });
  }
  return out;
}

function cleanTrace(b) {
  if (!b || b.v !== 1 || !Number.isFinite(b.t0) || !Array.isArray(b.dt) || !Array.isArray(b.la) || !Array.isArray(b.lo)) return null;
  const n = b.dt.length;
  if (n < 10 || n > MAX_POINTS || b.la.length !== n || b.lo.length !== n) return null;
  const ints = (a) => a.every((v) => Number.isInteger(v) && Math.abs(v) < 400000000);
  if (!ints(b.dt) || !ints(b.la) || !ints(b.lo) || b.dt.some((v, i) => i && v <= 0)) return null;
  return { v: 1, t0: Math.round(b.t0), dt: b.dt, la: b.la, lo: b.lo };
}

export const onRequest = withUser(async (ctx, user) => {
  const { request, env, params } = ctx;
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const parts = [].concat(params.path || []).map(String).filter(Boolean);
  const method = request.method;
  let clubMemo;
  const lazyClub = async () => (clubMemo === undefined ? (clubMemo = await clubOf(env, request, user.licence)) : clubMemo);

  // ---- the list, a new analysis
  if (!parts.length) {
    if (method === "GET") {
      const url = new URL(request.url), kind = url.searchParams.get("kind"), race = url.searchParams.get("race");
      // the administrators: how much of R2's 10 free GB the site uses (maps are kept as long as their analysis)
      if (url.searchParams.get("stats") && isAdmin(env, user)) {
        const all = await listAll(env, "", false);
        const an = all.filter((o) => o.key.startsWith(DATA) || o.key.startsWith(META));
        return json({ bytes: all.reduce((s, o) => s + o.size, 0), analyses: an.reduce((s, o) => s + o.size, 0),
          maps: an.filter((o) => o.key.includes("/map-")).length, traces: an.filter((o) => o.key.includes("/trace-")).length });
      }
      const objs = await listAll(env, META);
      const out = [];
      for (const o of objs) {
        const m = o.customMetadata || {};
        if (kind && m.kind !== kind) continue;
        if (race && m.race !== race) continue;
        const meta = { ...m, owner: Number(m.owner), courses: [] };
        let acc;
        if (meta.owner === user.id || isAdmin(env, user) || m.vis === "public") acc = "open";
        else if (m.vis === "club") acc = m.club && (await lazyClub()) === m.club ? "open" : null;
        else if (m.vis === "password") acc = "locked";
        if (!acc) continue;
        out.push({ id: m.id, kind: m.kind, title: m.title, date: m.date, race: m.race, vis: m.vis, ownerName: m.ownerName,
          courses: Number(m.courses) || 0, updated: m.updated, mine: meta.owner === user.id, access: acc });
      }
      out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updated || "").localeCompare(a.updated || ""));
      return json({ analyses: out, club: await lazyClub() });
    }
    if (method === "POST") {
      const b = await readBody(request);
      if (!b) return json({ error: "bad request" }, 400);
      if (!(await allow(env, `ancreate:${user.id}`, 20, 86400))) return json({ error: "too many" }, 429);
      const kind = KINDS.includes(b.kind) ? b.kind : null, vis = VIS.includes(b.vis) ? b.vis : null;
      const title = clean(b.title, 120), date = String(b.date || "");
      if (!kind || !vis || title.length < 3 || !DAY.test(date)) return json({ error: "fields" }, 400);
      let race = "";
      if (kind === "race") {
        race = clean(b.race, 40);
        const res = await env.ASSETS.fetch(new URL("/data/prov/index.json", request.url));
        const known = res.ok ? (await res.json()).races?.some((r) => r.key === race && r.docs) : false;
        if (!known) return json({ error: "race" }, 400);
      }
      const club = await lazyClub();
      if (vis === "club" && !club) return json({ error: "noclub" }, 400);
      let pw = null;
      if (vis === "password") {
        const p = String(b.password || "");
        if (p.length < 4 || p.length > 100) return json({ error: "password" }, 400);
        const h = await hashPassword(p, env);
        pw = { pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iter };
      }
      const meta = { id: newId(), kind, title, date, race, club: club || "", vis, pw, owner: user.id, ownerName: user.display_name || "",
        created: nowIso(), updated: nowIso(), courses: [] };
      await saveMeta(env, meta);
      return json({ id: meta.id });
    }
    return json({ error: "method" }, 405);
  }

  // ---- one analysis
  const id = parts[0];
  if (!/^[a-z0-9]{8,16}$/.test(id)) return json({ error: "not found" }, 404);
  const meta = await loadMeta(env, id);
  if (!meta) return json({ error: "not found" }, 404);
  const sub = parts[1] || "";
  const organiser = isOrganiser(env, user, meta);

  if (sub === "unlock" && method === "POST") {
    if (meta.vis !== "password" || !meta.pw) return json({ error: "bad request" }, 400);
    if (!(await allow(env, `anunlock:${user.id}`, 20, 3600))) return json({ error: "too many" }, 429);
    const b = await readBody(request);
    if (!(await checkPassword(String(b?.password || ""), meta.pw, env))) return json({ error: "invalid" }, 401);
    return json({ key: await unlockKey(env, meta, user.id) });
  }

  const acc = await access(ctx, user, meta, lazyClub);
  if (acc !== "open") return json({ error: acc === "locked" ? "locked" : "forbidden" }, 403);

  if (!sub) {
    if (method === "GET") {
      const traces = (await listAll(env, `${DATA}${id}/trace-`)).map((o) => {
        const m = o.customMetadata || {};
        return { course: Number(m.course), uid: Number(m.uid), name: m.name || "", lic: m.lic || "", updated: m.updated || "", size: o.size };
      });
      return json({ analysis: publicMeta(meta), traces, you: { uid: user.id, organiser } });
    }
    if (!organiser) return json({ error: "forbidden" }, 403);
    if (method === "PUT") {
      const b = await readBody(request);
      if (!b) return json({ error: "bad request" }, 400);
      if (b.title != null) { const tt = clean(b.title, 120); if (tt.length < 3) return json({ error: "fields" }, 400); meta.title = tt; }
      if (b.date != null) { if (!DAY.test(String(b.date))) return json({ error: "fields" }, 400); meta.date = String(b.date); }
      if (b.vis != null) {
        if (!VIS.includes(b.vis)) return json({ error: "fields" }, 400);
        if (b.vis === "club" && !meta.club) { meta.club = (await lazyClub()) || ""; if (!meta.club) return json({ error: "noclub" }, 400); }
        meta.vis = b.vis;
      }
      if (b.password) {
        const p = String(b.password);
        if (p.length < 4 || p.length > 100) return json({ error: "password" }, 400);
        const h = await hashPassword(p, env);
        meta.pw = { pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iter };
      }
      if (meta.vis === "password" && !meta.pw) return json({ error: "password" }, 400);
      if (b.courses != null) {
        const cs = cleanCourses(b.courses);
        if (!cs) return json({ error: "courses" }, 400);
        // the circuits removed: their maps and traces go
        const gone = (meta.courses || []).filter((c) => !cs.some((x) => x.n === c.n)).map((c) => c.n);
        if (gone.length) {
          const keys = (await listAll(env, `${DATA}${id}/`, false)).map((o) => o.key)
            .filter((k) => gone.some((n) => k === `${DATA}${id}/map-${n}` || k.startsWith(`${DATA}${id}/trace-${n}-`)));
          for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
        }
        meta.courses = cs;
      }
      await saveMeta(env, meta);
      return json({ ok: true, analysis: publicMeta(meta) });
    }
    if (method === "DELETE") {
      const keys = (await listAll(env, `${DATA}${id}/`, false)).map((o) => o.key);
      for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
      await env.BUCKET.delete(`${META}${id}.json`);
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }

  const n = Number(parts[2]);
  if (!Number.isInteger(n) || n < 0 || n > 99) return json({ error: "not found" }, 404);
  const course = (meta.courses || []).find((c) => c.n === n);

  if (sub === "map") {
    const key = `${DATA}${id}/map-${n}`;
    if (method === "GET") {
      const o = await env.BUCKET.get(key);
      if (!o) return json({ error: "not found" }, 404);
      return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    }
    if (method === "PUT") {
      if (!organiser) return json({ error: "forbidden" }, 403);
      const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
      if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ error: "type" }, 415);
      const size = Number(request.headers.get("Content-Length") || 0);
      if (!size) return json({ error: "empty" }, 400);
      if (size > MAX_MAP) return json({ error: "too big" }, 413);
      if (!(await allow(env, `anmap:${user.id}`, 60, 86400))) return json({ error: "too many" }, 429);
      await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: type } });
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "traces" && method === "GET") {
    const objs = await listAll(env, `${DATA}${id}/trace-${n}-`, false);
    const bodies = [];
    for (const o of objs) { const b = await env.BUCKET.get(o.key); if (b) bodies.push(await b.text()); }
    return new Response(`[${bodies.join(",")}]`, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  if (sub === "trace") {
    if (!course) return json({ error: "not found" }, 404);
    if (method === "PUT") {
      const size = Number(request.headers.get("Content-Length") || 0);
      if (size > MAX_TRACE) return json({ error: "too big" }, 413);
      if (!(await allow(env, `antrace:${user.id}`, 100, 86400))) return json({ error: "too many" }, 429);
      const b = await readBody(request);
      if (b?.consent !== true) return json({ error: "consent" }, 400);
      const tr = cleanTrace(b?.trace);
      if (!tr) return json({ error: "trace" }, 400);
      // the runner is the account: no trace in someone else's name
      const rec = { ...tr, uid: user.id, name: user.display_name || "", lic: user.licence || "", course: n, updated: nowIso() };
      await env.BUCKET.put(`${DATA}${id}/trace-${n}-${user.id}.json`, JSON.stringify(rec), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { uid: String(user.id), name: rec.name, lic: String(rec.lic), course: String(n), updated: rec.updated } });
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const uid = parts[3] != null ? Number(parts[3]) : user.id;
      if (!Number.isInteger(uid)) return json({ error: "bad request" }, 400);
      if (uid !== user.id && !organiser) return json({ error: "forbidden" }, 403);
      await env.BUCKET.delete(`${DATA}${id}/trace-${n}-${uid}.json`);
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }
  return json({ error: "not found" }, 404);
});

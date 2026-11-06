// The administrators' map collection (owner, 2026-11-06: « a special admin map library … all maps that go to Ozimut; avoid
// saving the same map multiple times, always using the best quality map, and the latest one, for a given location »).
// Every map an account sends to Ozimut — « Analyse solo »'s kept analyses (solo/<uid>/m/<sha>), the organisers' map analyses
// (analyses/<id>/map-<n>) and the Tracer's events' maps (tracer/<id>/map, never an encrypted event's, never its courses) — is
// copied once into R2 (cn-state):
//   admin-maps/m/<etag>   the map as it came (its R2 etag — the MD5 of its bytes — as its name: the same image sent to Solo and
//                         to an analysis is kept once), what it is in the object's custom metadata (below), one R2 list
//   admin-maps/t/<etag>   its thumbnail (the source's, else made by an administrator's browser);  admin-maps/v/<etag>  its
//                         viewing copy (made by the browser, as « Mes cartes »')
//   admin-maps/x/<etag>   a map left out: another of the same place replaced it (`by`) — so that it is not copied again
// One place, one map: maps whose centres lie within a quarter of the smaller one's extent (200 m when an extent is unknown),
// of extents within 1.5 times, are one place; the latest (its event's day, else the day it came) is kept, or, among those
// within 60 days of it, the one of most pixels — the best quality. « Mes cartes »' own maps are not copied: the collection's
// page shows them from the accounts' libraries, tagged with their owner (functions/api/admin/maplib.js).
// A sync step copies a few maps at a time (`budget`): from /api/track at most every 30 minutes an isolate, so that a map
// deleted soon after it came is kept, and from the collection's page until nothing is left. The account's deletion takes
// its Solo maps out of the collection (api/account/delete.js); the organisers' maps stay.
import { clubLabel } from "./club.js";

export const PFX = "admin-maps/";
const M = `${PFX}m/`, X = `${PFX}x/`, T = `${PFX}t/`, V = `${PFX}v/`;
export const keys = { map: (e) => `${M}${e}`, thumb: (e) => `${T}${e}`, view: (e) => `${V}${e}`, gone: (e) => `${X}${e}` };
const RAD = Math.PI / 180;
const km = (a, b) => { const dl = (b[0] - a[0]) * RAD, dn = (b[1] - a[1]) * RAD, s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(s)); };
const s = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 300);

export async function listAll(env, prefix, meta = true) {
  const out = [];
  let cursor;
  do {
    const r = await env.BUCKET.list({ prefix, cursor, limit: 1000, include: meta ? ["customMetadata", "httpMetadata"] : undefined });
    out.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}
const tail = (k) => k.slice(k.lastIndexOf("/") + 1);
const etagOf = (o) => String(o.etag || "").replace(/"/g, "");

/** (lon, lat) → px (or mm) affine `g` inverted at (x, y): [lat, lon]. */
function latLon(g, x, y) {
  const det = g.a * g.e - g.b * g.d;
  if (!det) return null;
  const X = x - g.c, Y = y - g.f, lon = (g.e * X - g.b * Y) / det, lat = (-g.d * X + g.a * Y) / det;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && Math.abs(lat) + Math.abs(lon) > 0.1 ? [lat, lon] : null;
}
/** A map's centre and extent (its diagonal, km) from a georeference over w × h (pixels or mm). */
function placeOf(g, w, h, centre = null) {
  if (!g || !(w > 0) || !(h > 0)) return {};
  const c = centre ? latLon(g, centre[0], centre[1]) : latLon(g, w / 2, h / 2), a = latLon(g, 0, 0), b = latLon(g, w, h);
  return c ? { pos: `${c[0].toFixed(5)},${c[1].toFixed(5)}`, ext: a && b ? km(a, b).toFixed(2) : "" } : {};
}

// ---- the sources ----------------------------------------------------------------------------------------------------
/**
 * The maps of Solo, the analyses and the Tracer not held nor left out yet: [{ etag, key, thumb, info() → custom metadata }].
 * `info` reads what the listing does not give (an analysis's or an event's own record) only for a map to copy.
 */
async function candidates(env, seen) {
  const out = [];
  // Analyse solo: each account's maps, named by their SHA-256, described by the analyses that use them
  const solo = await listAll(env, "solo/");
  const soloMeta = new Map();
  for (const o of solo) {
    const m = /^solo\/(\d+)\/a\/[^/]+\.json$/.exec(o.key);
    if (!m) continue;
    let a = null;
    try { a = JSON.parse(o.customMetadata?.s || "null"); } catch (e) { /* none */ }
    if (!a?.sha) continue;
    const k = `${m[1]}/${a.sha}`, old = soloMeta.get(k);
    if (!old || String(a.updated || "") > String(old.updated || "")) soloMeta.set(k, { ...a, runs: (old?.runs || 0) + 1 });
    else old.runs = (old.runs || 1) + 1;
  }
  for (const o of solo) {
    const m = /^solo\/(\d+)\/m\/([0-9a-f]{64})$/.exec(o.key);
    if (!m || seen.has(etagOf(o))) continue;
    const a = soloMeta.get(`${m[1]}/${m[2]}`) || {};
    out.push({ etag: etagOf(o), key: o.key, thumb: `${o.key}.thumb`, uid: m[1],
      info: async () => ({ src: "solo", uid: m[1], title: s(a.title), day: s(a.day || (a.created || "").slice(0, 10)), runs: String(a.runs || 0),
        w: String(a.w || ""), h: String(a.h || ""), ...placeOf(a.geo, a.w, a.h) }) });
  }
  // the organisers' map analyses: each circuit's map
  const metas = new Map((await listAll(env, "analyses-meta/")).map((o) => [o.customMetadata?.id || tail(o.key).replace(/\.json$/, ""), o.customMetadata || {}]));
  for (const o of await listAll(env, "analyses/", false)) {
    const m = /^analyses\/([^/]+)\/map-(\d+)$/.exec(o.key);
    if (!m || seen.has(etagOf(o)) || !metas.has(m[1])) continue;
    const sm = metas.get(m[1]);
    out.push({ etag: etagOf(o), key: o.key, thumb: `analyses/${m[1]}/thumb-${m[2]}`, uid: sm.owner,
      info: async () => {
        let full = null;
        try { full = await (await env.BUCKET.get(`analyses-meta/${m[1]}.json`))?.json(); } catch (e) { /* the summary's */ }
        const c = (full?.courses || [])[Number(m[2])] || {};
        return { src: "analysis", ref: m[1], uid: s(sm.owner), user: s(sm.ownerName), title: s([sm.title, c.name].filter(Boolean).join(" · ")), day: s(sm.date),
          club: s(sm.orgName), w: String(c.map?.w || ""), h: String(c.map?.h || ""), ...placeOf(c.geo, c.map?.w, c.map?.h) };
      } });
  }
  // the Tracer's events: the map as it came — not an encrypted event's (the server cannot read it), never the courses
  for (const o of await listAll(env, "tracer-meta/")) {
    const sm = o.customMetadata || {};
    if (sm.enc === "1" || !sm.id) continue;
    const h = await env.BUCKET.head(`tracer/${sm.id}/map`);
    if (!h || seen.has(etagOf(h))) continue;
    out.push({ etag: etagOf(h), key: h.key, thumb: null, uid: sm.owner,
      info: async () => {
        let ev = null;
        try { const e = await env.BUCKET.get(`tracer/${sm.id}/event`); const txt = e ? await e.text() : ""; if (txt.startsWith("{")) ev = JSON.parse(txt); } catch (e) { /* none */ }
        let place = {};
        if (ev?.geo && ev.map?.w) {
          const cs = Object.values(ev.controls || {}).filter((c) => Number.isFinite(c?.x) && Number.isFinite(c?.y));
          const centre = cs.length ? [cs.reduce((t, c) => t + c.x, 0) / cs.length, cs.reduce((t, c) => t + c.y, 0) / cs.length] : null;
          place = placeOf(ev.geo, ev.map.w, ev.map.h, centre);
        }
        return { src: "tracer", ref: sm.id, uid: s(sm.owner), user: s(sm.ownerName), title: s(sm.title), day: s(sm.date), club: s(sm.orgClub),
          name: s(ev?.map?.file || ""), kind: s(ev?.map?.kind || ""), ...place };
      } });
  }
  return out;
}

/** Copy an R2 object (streamed: up to 80 MB without holding it). */
async function copy(env, from, to, customMetadata) {
  const o = await env.BUCKET.get(from);
  if (!o) return false;
  const { readable, writable } = new FixedLengthStream(o.size);
  const done = o.body.pipeTo(writable);
  await env.BUCKET.put(to, readable, { httpMetadata: o.httpMetadata, customMetadata });
  await done;
  return true;
}

/** Accounts' names and clubs: { uid: { name, club } } (the club as the results write it, France's licensees only). */
async function people(env, request, uids) {
  const ids = [...new Set(uids.filter((u) => /^\d+$/.test(String(u))).map(Number))];
  const out = {};
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(`SELECT id, first_name, last_name, display_name, licence FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  for (const u of results) {
    out[u.id] = { name: `${String(u.first_name || "").trim()} ${String(u.last_name || "").trim()}`.trim() || u.display_name || "",
      club: request && u.licence ? (await clubLabel(env, request, u.licence).catch(() => null)) || "" : "" };
  }
  return out;
}

/**
 * One step: up to `budget` maps copied, then — when none is left — one place, one map. -> { copied, left, gone }.
 * request: for the clubs (read from the site's data).
 */
export async function syncStep(env, request, { budget = 4 } = {}) {
  const held = await listAll(env, M), goneList = await listAll(env, X, false);
  const seen = new Set([...held.map((o) => tail(o.key)), ...goneList.map((o) => tail(o.key))]);
  const todo = await candidates(env, seen);
  const pick = todo.slice(0, budget);
  const who = await people(env, request, pick.map((c) => c.uid));
  let copied = 0;
  for (const c of pick) {
    const info = await c.info();
    const p = who[info.uid] || {};
    const meta = { ...info, user: info.user || s(p.name), club: info.club || s(p.club), up: new Date().toISOString().slice(0, 10), from: c.key };
    for (const k of Object.keys(meta)) if (meta[k] === "" || meta[k] == null) delete meta[k];
    if (await copy(env, c.key, keys.map(c.etag), meta)) {
      copied++;
      if (c.thumb) await copy(env, c.thumb, keys.thumb(c.etag), {}).catch(() => false);
    }
  }
  const left = todo.length - pick.length;
  const gone = left ? 0 : await onePerPlace(env);
  return { copied, left, gone };
}

/** One place, one map: the others of a place are left out (their copies deleted, a record kept). -> how many. */
async function onePerPlace(env) {
  const items = (await listAll(env, M)).map((o) => {
    const m = o.customMetadata || {}, p = String(m.pos || "").split(",").map(Number);
    return { etag: tail(o.key), m, pos: p.length === 2 && p.every(Number.isFinite) ? p : null, ext: Number(m.ext) || 0,
      day: m.day || m.up || "", px: (Number(m.w) || 0) * (Number(m.h) || 0) || o.size };
  }).filter((x) => x.pos);
  const near = (a, b) => {
    const d = km(a.pos, b.pos);
    if (a.ext && b.ext) return Math.max(a.ext, b.ext) / Math.min(a.ext, b.ext) <= 1.5 && d <= Math.min(a.ext, b.ext) / 4;
    return d <= 0.2;
  };
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (near(items[i], items[j])) parent[find(i)] = find(j);
  const groups = new Map();
  items.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });
  let gone = 0;
  const dayMs = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) || 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const latest = Math.max(...g.map((x) => dayMs(x.day)));
    const keep = g.filter((x) => latest - dayMs(x.day) <= 60 * 864e5).sort((a, b) => b.px - a.px || dayMs(b.day) - dayMs(a.day))[0];
    for (const x of g) {
      if (x === keep) continue;
      await env.BUCKET.put(keys.gone(x.etag), "", { customMetadata: { by: keep.etag, title: x.m.title || "", src: x.m.src || "", uid: x.m.uid || "", user: x.m.user || "", day: x.day } });
      await env.BUCKET.delete([keys.map(x.etag), keys.thumb(x.etag), keys.view(x.etag)]);
      gone++;
    }
  }
  return gone;
}

let lastSync = 0;
/** From /api/track: a small step at most every 30 minutes an isolate (a map deleted soon after it came is kept). */
export function maplibSoon(ctx) {
  if (!ctx.env.BUCKET || Date.now() - lastSync < 30 * 60e3) return;
  lastSync = Date.now();
  ctx.waitUntil(syncStep(ctx.env, ctx.request, { budget: 2 }).catch((e) => console.error("maplib", e)));
}

/** An account deleted: its Solo maps leave the collection (the organisers' maps stay: published to their runners). */
export async function dropUser(env, uid) {
  const mine = [...(await listAll(env, M)), ...(await listAll(env, X))].filter((o) => o.customMetadata?.src === "solo" && o.customMetadata?.uid === String(uid));
  for (const o of mine) { const e = tail(o.key); await env.BUCKET.delete([keys.map(e), keys.thumb(e), keys.view(e), keys.gone(e)]); }
}

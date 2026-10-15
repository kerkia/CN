// /api/tracer — the course-setting events of « Organisation › Tracer », kept in R2 (bucket cn-state, binding BUCKET):
//   tracer-meta/<id>.json        the event's card: title, date, race, owner, team, encryption check (its summary also in
//                                the object's custom metadata, so the list is one R2 list)
//   tracer/<id>/event            the event itself (JSON, or ciphertext when the team encrypts it in the browser)
//   tracer/<id>/map              the map file as it came (PDF or image), never re-encoded
//   tracer/<id>/v/<n>            saved versions (each with its author, time and note in the object's metadata)
//   tracer/<id>/comments         the team's comments (JSON or ciphertext)
//   tracer/<id>/field            the field statuses of the controls (set, checked, collected)
//   tracer/<id>/lock             who is editing (refreshed every minute; others open the event read-only)
// Courses are secret until the race (owner, 2026-10-15): only the event's team opens it — its creator and the licences
// the creator adds (« setter » edits, « controller » edits and comments, « viewer » reads and comments); not the
// administrators. A competition's event is created by a member of the race's organising club (_lib/club.js); a
// training event by any account. With encryption, the server never sees the courses: it stores bytes.
//
//   GET    /api/tracer                       one's events, one's club
//   POST   /api/tracer                       { kind: "race"|"training", title, date, race? (a<agenda id> or a race of
//                                            « Résultats ») } -> { id }
//   GET    /api/tracer/<id>                  the card and one's role
//   PUT    /api/tracer/<id>                  setters: { title?, date?, team?, encrypted? }
//   DELETE /api/tracer/<id>                  the owner: everything
//   GET|PUT /api/tracer/<id>/event           PUT: X-Base-Version (the version edited; 409 if another was saved since)
//   GET|PUT /api/tracer/<id>/map             PUT: the file (Content-Type, up to 80 MB)
//   GET    /api/tracer/<id>/versions         the list;  GET …/versions/<n> one;  POST …/versions (body, X-Note);
//                                            DELETE …/versions?below=<n> (the owner, after encrypting)
//   GET|PUT /api/tracer/<id>/comments, …/field
//   POST|DELETE /api/tracer/<id>/lock        take (or refresh) / release the editing lock
//   GET    /api/tracer/<id>/member?lic=…     the licensee's name, before adding them to the team

import { allow, isAdmin, json, readBody, withUser, nowIso, cleanLicence } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";
import { clubOf, orgCode, raceOf } from "../../_lib/club.js";

const META = "tracer-meta/", DATA = "tracer/";
const MAX_MAP = 80 * 1024 * 1024, MAX_EVENT = 12 * 1024 * 1024, MAX_SMALL = 4 * 1024 * 1024, MAX_VERSIONS = 120;
const ROLES = ["setter", "controller", "viewer"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const newId = () => Array.from(randomBytes(12), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const LOCK_MS = 150e3;

const summary = (m) => ({ id: m.id, kind: m.kind, title: m.title, date: m.date, race: m.race || "", orgClub: m.orgClub || "", owner: String(m.owner),
  ownerName: m.ownerName || "", team: m.team.map((x) => x.lic).join(","), enc: m.encrypted ? "1" : "", updated: m.updated || "", version: String(m.version || 0) });
async function loadMeta(env, id) {
  const o = await env.BUCKET.get(`${META}${id}.json`);
  if (!o) return null;
  try { return await o.json(); } catch (e) { return null; }
}
async function saveMeta(env, meta) {
  await env.BUCKET.put(`${META}${meta.id}.json`, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" }, customMetadata: summary(meta) });
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
/** One's role on an event: "owner", "setter", "controller", "viewer", or null. */
function roleOf(meta, user) {
  if (meta.owner === user.id) return "owner";
  const m = meta.team.find((x) => x.lic && String(x.lic) === String(user.licence));
  return m ? m.role : null;
}
const canEdit = (r) => r === "owner" || r === "setter" || r === "controller";
/** The licensee's display name from the licensee index (never served to browsers). */
async function licenseeName(env, request, lic) {
  if (!/^\d+$/.test(lic)) return null;
  try {
    const res = await env.ASSETS.fetch(new URL(`/auth/${Math.floor(Number(lic) / 100)}.json`, request.url));
    const entry = res.ok ? (await res.json())[lic] : null;
    return entry ? entry[1] : null;
  } catch (e) { return null; }
}
/** A competition of the agenda (site/data/agenda.json) by its id, or null. */
async function agendaRace(env, request, id) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/agenda.json", request.url));
    return res.ok ? (await res.json()).events?.find((e) => e.kind === "c" && String(e.id) === String(id)) || null : null;
  } catch (e) { return null; }
}
function rawResponse(o, type = "application/octet-stream") {
  return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || type, "Cache-Control": "no-store",
    "X-Version": o.customMetadata?.version || "", "X-Updated": o.customMetadata?.updated || "", "X-Updated-By": o.customMetadata?.by || "" } });
}
async function putRaw(env, request, key, max, meta = {}) {
  const size = Number(request.headers.get("Content-Length") || 0);
  if (!size) return json({ error: "empty" }, 400);
  if (size > max) return json({ error: "too big" }, 413);
  const type = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim();
  await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: type }, customMetadata: meta });
  return null;
}

export const onRequest = withUser(async (ctx, user) => {
  const { request, env, params } = ctx;
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const parts = [].concat(params.path || []).map(String).filter(Boolean);
  const method = request.method;
  let clubMemo;
  const lazyClub = async () => (clubMemo === undefined ? (clubMemo = await clubOf(env, request, user.licence)) : clubMemo);

  if (!parts.length) {
    if (method === "GET") {
      const out = [];
      for (const o of await listAll(env, META)) {
        const m = o.customMetadata || {};
        const mine = Number(m.owner) === user.id, member = (m.team || "").split(",").includes(String(user.licence));
        if (!mine && !member) continue;
        out.push({ id: m.id, kind: m.kind, title: m.title, date: m.date, race: m.race, ownerName: m.ownerName, mine, encrypted: !!m.enc, updated: m.updated });
      }
      out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updated || "").localeCompare(a.updated || ""));
      const url = new URL(request.url);
      const stats = url.searchParams.get("stats") && isAdmin(env, user)
        ? { events: (await listAll(env, META, false)).length, bytes: (await listAll(env, DATA, false)).reduce((s, o) => s + o.size, 0) } : null;
      return json({ events: out, club: await lazyClub(), stats });
    }
    if (method === "POST") {
      const b = await readBody(request);
      if (!b) return json({ error: "bad request" }, 400);
      if (!(await allow(env, `trcreate:${user.id}`, 30, 86400))) return json({ error: "too many" }, 429);
      const kind = b.kind === "race" ? "race" : b.kind === "training" ? "training" : null;
      const title = clean(b.title, 140), date = String(b.date || "");
      if (!kind || title.length < 3 || !DAY.test(date)) return json({ error: "fields" }, 400);
      let race = "", orgClub = "";
      if (kind === "race") {
        race = clean(b.race, 60);
        const r = race ? (race.startsWith("a") ? await agendaRace(env, request, race.slice(1)) : await raceOf(env, request, race)) : null;
        if (!r) return json({ error: "race" }, 400);
        orgClub = orgCode(r.org) || "";
        // a competition: by a member of its organising club (or an administrator)
        if (!isAdmin(env, user) && (!orgClub || (await lazyClub()) !== orgClub)) return json({ error: "not organiser" }, 403);
      }
      const meta = { id: newId(), kind, title, date, race, orgClub, owner: user.id, ownerName: user.display_name || "", ownerLic: String(user.licence || ""),
        team: [], encrypted: null, created: nowIso(), updated: nowIso(), version: 0, map: null };
      await saveMeta(env, meta);
      return json({ id: meta.id });
    }
    return json({ error: "method" }, 405);
  }

  const id = parts[0];
  if (!/^[a-z0-9]{8,16}$/.test(id)) return json({ error: "not found" }, 404);
  const meta = await loadMeta(env, id);
  if (!meta) return json({ error: "not found" }, 404);
  const role = roleOf(meta, user);
  if (!role) return json({ error: "forbidden" }, 403);
  const sub = parts[1] || "";
  const base = `${DATA}${id}/`;

  if (!sub) {
    if (method === "GET") {
      const lock = await env.BUCKET.get(`${base}lock`).then((o) => (o ? o.json() : null)).catch(() => null);
      const held = lock && lock.until > Date.now() && lock.uid !== user.id ? lock : null;
      return json({ event: meta, role, you: { uid: user.id, lic: String(user.licence || ""), name: user.display_name || "" }, lock: held });
    }
    if (method === "PUT") {
      if (role !== "owner" && role !== "setter") return json({ error: "forbidden" }, 403);
      const b = await readBody(request);
      if (!b) return json({ error: "bad request" }, 400);
      if (b.title != null) { const t = clean(b.title, 140); if (t.length < 3) return json({ error: "fields" }, 400); meta.title = t; }
      if (b.date != null) { if (!DAY.test(String(b.date))) return json({ error: "fields" }, 400); meta.date = String(b.date); }
      if (b.team != null) {
        if (!Array.isArray(b.team) || b.team.length > 40) return json({ error: "team" }, 400);
        const team = [];
        for (const x of b.team) {
          const lic = cleanLicence(x?.lic);
          if (!/^\d{1,8}$/.test(lic) || team.some((y) => y.lic === lic) || lic === meta.ownerLic) continue;
          const name = (await licenseeName(env, request, lic)) || clean(x?.name, 80);
          team.push({ lic, name, role: ROLES.includes(x?.role) ? x.role : "viewer" });
        }
        meta.team = team;
      }
      if (b.encrypted !== undefined) {
        // the team's passphrase check (salt, iterations, an encrypted known text), set when the event's data is
        // re-encrypted by the browser; null when decrypted again
        const e = b.encrypted;
        meta.encrypted = e && typeof e.salt === "string" && typeof e.check === "string" && e.salt.length < 100 && e.check.length < 400
          ? { salt: e.salt, check: e.check, iter: Number(e.iter) || 250000 } : null;
      }
      if (b.map !== undefined) meta.map = b.map ? { name: clean(b.map.name, 200), type: clean(b.map.type, 60), size: Number(b.map.size) || 0 } : null;
      if (b.published !== undefined) meta.published = b.published ? { analysis: clean(b.published.analysis, 20), at: nowIso() } : null;
      meta.updated = nowIso();
      await saveMeta(env, meta);
      return json({ ok: true, event: meta });
    }
    if (method === "DELETE") {
      if (role !== "owner") return json({ error: "forbidden" }, 403);
      const keys = (await listAll(env, base, false)).map((o) => o.key);
      for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
      await env.BUCKET.delete(`${META}${id}.json`);
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "member" && method === "GET") {
    const lic = cleanLicence(new URL(request.url).searchParams.get("lic"));
    if (!(await allow(env, `trmember:${user.id}`, 60, 3600))) return json({ error: "too many" }, 429);
    return json({ lic, name: await licenseeName(env, request, lic) });
  }

  if (sub === "event") {
    if (method === "GET") {
      const o = await env.BUCKET.get(`${base}event`);
      return o ? rawResponse(o, "application/json") : json({ error: "empty" }, 404);
    }
    if (method === "PUT") {
      if (!canEdit(role)) return json({ error: "forbidden" }, 403);
      if (!(await allow(env, `trsave:${user.id}`, 2000, 86400))) return json({ error: "too many" }, 429);
      const baseVersion = Number(request.headers.get("X-Base-Version") ?? -1);
      if (baseVersion >= 0 && baseVersion !== (meta.version || 0)) return json({ error: "conflict", version: meta.version, by: meta.updatedBy || "", at: meta.updated }, 409);
      const version = (meta.version || 0) + 1;
      const err = await putRaw(env, request, `${base}event`, MAX_EVENT, { version: String(version), updated: nowIso(), by: user.display_name || "" });
      if (err) return err;
      meta.version = version; meta.updated = nowIso(); meta.updatedBy = user.display_name || "";
      await saveMeta(env, meta);
      return json({ ok: true, version });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "map") {
    if (method === "GET") {
      const o = await env.BUCKET.get(`${base}map`);
      if (!o) return json({ error: "not found" }, 404);
      return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=600" } });
    }
    if (method === "PUT") {
      if (role !== "owner" && role !== "setter") return json({ error: "forbidden" }, 403);
      if (!(await allow(env, `trmap:${user.id}`, 60, 86400))) return json({ error: "too many" }, 429);
      const err = await putRaw(env, request, `${base}map`, MAX_MAP, { updated: nowIso() });
      return err || json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "versions") {
    const n = parts[2];
    if (method === "GET" && n == null) {
      const list = (await listAll(env, `${base}v/`)).map((o) => ({ n: Number(o.key.slice(`${base}v/`.length)), size: o.size, at: o.customMetadata?.at || "",
        by: o.customMetadata?.by || "", note: o.customMetadata?.note || "", summary: o.customMetadata?.summary || "" })).sort((a, b) => b.n - a.n);
      return json({ versions: list });
    }
    if (method === "GET") {
      const o = /^\d+$/.test(n) ? await env.BUCKET.get(`${base}v/${n}`) : null;
      return o ? rawResponse(o, "application/json") : json({ error: "not found" }, 404);
    }
    if (method === "DELETE") {
      // the owner removes the versions saved before a number (those written in clear, once the event is encrypted)
      if (role !== "owner") return json({ error: "forbidden" }, 403);
      const below = Number(new URL(request.url).searchParams.get("below") || 0);
      const keys = (await listAll(env, `${base}v/`, false)).map((o) => o.key).filter((k) => Number(k.slice(`${base}v/`.length)) < below);
      for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
      return json({ ok: true, removed: keys.length });
    }
    if (method === "POST") {
      if (!canEdit(role)) return json({ error: "forbidden" }, 403);
      if (!(await allow(env, `trversion:${user.id}`, 300, 86400))) return json({ error: "too many" }, 429);
      const list = (await listAll(env, `${base}v/`, false)).map((o) => Number(o.key.slice(`${base}v/`.length))).sort((a, b) => a - b);
      const next = (list[list.length - 1] || 0) + 1;
      const note = decodeURIComponent(request.headers.get("X-Note") || "").slice(0, 300), sum = decodeURIComponent(request.headers.get("X-Summary") || "").slice(0, 800);
      const err = await putRaw(env, request, `${base}v/${next}`, MAX_EVENT, { at: nowIso(), by: user.display_name || "", note, summary: sum });
      if (err) return err;
      if (list.length + 1 > MAX_VERSIONS) await env.BUCKET.delete(list.slice(0, list.length + 1 - MAX_VERSIONS).map((k) => `${base}v/${k}`));
      return json({ ok: true, n: next });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "comments" || sub === "field") {
    if (method === "GET") {
      const o = await env.BUCKET.get(`${base}${sub}`);
      return o ? rawResponse(o, "application/json") : json({ empty: true });
    }
    if (method === "PUT") {
      // comments: every team member; field statuses: those who may edit
      if (sub === "field" && !canEdit(role)) return json({ error: "forbidden" }, 403);
      if (!(await allow(env, `tr${sub}:${user.id}`, 1000, 86400))) return json({ error: "too many" }, 429);
      const err = await putRaw(env, request, `${base}${sub}`, MAX_SMALL, { updated: nowIso(), by: user.display_name || "" });
      return err || json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }

  if (sub === "lock") {
    if (!canEdit(role)) return json({ error: "forbidden" }, 403);
    const cur = await env.BUCKET.get(`${base}lock`).then((o) => (o ? o.json() : null)).catch(() => null);
    const held = cur && cur.until > Date.now() && cur.uid !== user.id;
    if (method === "POST") {
      const b = await readBody(request);
      if (held && !b?.force) return json({ ok: false, holder: cur });
      await env.BUCKET.put(`${base}lock`, JSON.stringify({ uid: user.id, name: user.display_name || "", until: Date.now() + LOCK_MS }), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true, took: held ? cur : null });
    }
    if (method === "DELETE") {
      if (cur && cur.uid === user.id) await env.BUCKET.delete(`${base}lock`);
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  }
  return json({ error: "not found" }, 404);
});

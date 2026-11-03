// /api/booking — « Réservation des horaires » (owner, 2026-11-03; migration 0023, _lib/booking.js): a competition's
// organisers open its start times to booking, as the clubs' Google Sheets did; an Ozimut account books for its runners
// (« Mes coureurs »: itself, its family, anyone, licensed or not, of any club of any country, or none). The grid — names and
// clubs — is public (a visitor reads it with the guest pass: _middleware.js GUEST); booking needs an account. Two runners of a
// club start `gap` seconds apart at least, whatever their circuits (a club: its federation's number, else its country and
// name); a slot, and a runner, are booked once (D1's unique keys). After the closing time only the organisers change
// anything; the bookings then become the race's start list (_lib/booking.js publish).
//
//   GET    /api/booking                      { events: [{ key, name, date, place, org, country, status, close }] } (the coming
//                                            ones open or closed), mine: [my bookings to come] when signed in
//   GET    /api/booking/runners              { runners } « Mes coureurs » (the holder added the first time, from the account)
//   POST   /api/booking/runners              { first_name, last_name, licence?, club_country?, club_code?, club_name?, card? } -> { runner }
//   PUT    /api/booking/runners/<id>         the same -> { runner };  DELETE /api/booking/runners/<id>
//   GET    /api/booking/<race>               { event, bookings: [{ id?, c, s, n, club, cc, mine, card? }], organiser }
//                                            (a draft: its organisers only; id and card: one's own, all to the organisers)
//   POST   /api/booking/<race>               { book: [{ runner, circuit, start }] } -> { results: [{ ok, id } | { error }] }
//                                            (errors: taken, club, twice, slot, closed, max, runner)
//   PATCH  /api/booking/<race>/<id>          { circuit, start, force? } -> { ok } | { error } (one's own until the closing;
//                                            the organisers' any time, `force` past the club rule; the booker told)
//   DELETE /api/booking/<race>/<id>          one's own until the closing, the organisers' any time (the booker told)
//   PUT    /api/booking/<race>/config        { config, status } the organisers' settings (_lib/booking.js cleanConfig)
//   DELETE /api/booking/<race>/config        the booking and its bookings gone (the bookers told)
//   POST   /api/booking/<race>/org           { add: [{ circuit, start, first_name, last_name, licence?, club_*, card? }], force? }
//                                            -> { results } the organisers' own entries (by hand, or a sheet imported)
//   POST   /api/booking/<race>/publish       the organisers: the start list published now (also done at the closing)

import { allow, currentUser, isAdmin, json, nowIso, readBody } from "../../_lib/api.js";
import { clubOf as accountClub, findRace, organises } from "../../_lib/club.js";
import {
  MAX_RUNNERS, clean, cleanConfig, clubKey, clubOf, eventOf, isOpen, loadEvent, parisDay, personOf, publish, slotOk, tellBookers,
} from "../../_lib/booking.js";

const RACE = /^[ad][a-z0-9]{1,20}$/;

export const onRequest = async (ctx) => {
  const { request, env, params } = ctx;
  if (!env.DB) return json({ error: "server not configured" }, 500);
  const parts = [].concat(params.path || []).map(String);
  const method = request.method;
  const user = await currentUser(request, env);
  try {
    if (!parts.length && method === "GET") return list(env, user);
    if (parts[0] === "runners") {
      if (!user) return json({ error: "login required" }, 401);
      return runners(ctx, user, parts[1] ? Number(parts[1]) : null);
    }
    const key = parts[0];
    if (!RACE.test(key || "")) return json({ error: "not found" }, 404);
    if (parts.length === 1 && method === "GET") return grid(ctx, user, key);
    if (!user) return json({ error: "login required" }, 401);
    if (parts.length === 1 && method === "POST") return book(ctx, user, key);
    if (parts[1] === "config") return config(ctx, user, key);
    if (parts[1] === "org" && method === "POST") return orgAdd(ctx, user, key);
    if (parts[1] === "publish" && method === "POST") return publishNow(ctx, user, key);
    if (/^\d+$/.test(parts[1] || "") && (method === "PATCH" || method === "DELETE")) return change(ctx, user, key, Number(parts[1]));
  } catch (e) {
    if (/no such table|no such column/i.test(String(e?.message))) return json({ error: "not ready" }, 503);       // before migration 0023
    throw e;
  }
  return json({ error: "not found" }, 404);
};

// ---- the list ------------------------------------------------------------------------------------------------------
async function list(env, user) {
  const today = parisDay();
  const { results } = await env.DB.prepare(
    "SELECT race_key, name, race_date, place, org, country, status, config FROM booking_events WHERE race_date >= ? AND status IN ('open', 'closed') ORDER BY race_date, name")
    .bind(today).all();
  const events = results.map((r) => ({ key: r.race_key, name: r.name, date: r.race_date, place: r.place, org: r.org, country: r.country,
    status: r.status, close: JSON.parse(r.config || "{}").close || null }));
  let mine = [];
  if (user) {
    const { results: b } = await env.DB.prepare(
      `SELECT b.id, b.race_key, b.circuit, b.start_s, b.first_name, b.last_name, e.name, e.race_date, e.config FROM bookings b
       JOIN booking_events e ON e.race_key = b.race_key WHERE b.user_id = ? AND b.by_org = 0 AND e.race_date >= ? ORDER BY e.race_date, b.start_s`)
      .bind(user.id, today).all();
    mine = b.map((x) => ({ id: x.id, race: x.race_key, name: x.name, date: x.race_date, s: x.start_s,
      runner: `${x.first_name} ${x.last_name}`.trim(), circuit: JSON.parse(x.config).circuits?.find((c) => c.id === x.circuit)?.name || x.circuit }));
  }
  return json({ events, mine }, 200, { "Cache-Control": user ? "no-store" : "private, max-age=60" });
}

// ---- « Mes coureurs » ------------------------------------------------------------------------------------------------
function runnerFields(b) {
  const first = clean(b?.first_name, 60), last = clean(b?.last_name, 60);
  if (!first || !last) return null;
  const club = clubOf(b);
  return { first_name: first, last_name: last, licence: /^\d{1,9}$/.test(String(b?.licence || "").trim()) ? String(b.licence).trim().replace(/^0+(?=\d)/, "") : "",
    ...club, card: /^\d{1,10}$/.test(String(b?.card || "").trim()) ? String(b.card).trim() : "" };
}
async function runners(ctx, user, id) {
  const { request, env } = ctx;
  const method = request.method;
  if (method === "GET" && !id) {
    let { results } = await env.DB.prepare("SELECT * FROM booking_runners WHERE user_id = ? ORDER BY self DESC, id").bind(user.id).all();
    if (!results.length) {                     // the account's holder, the first time
      const self = await holder(ctx, user);
      const r = await env.DB.prepare(`INSERT INTO booking_runners (user_id, first_name, last_name, licence, club_country, club_code, club_name, card, self, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', 1, ?) RETURNING *`).bind(user.id, self.first_name, self.last_name, self.licence, self.club_country,
        self.club_code, self.club_name, nowIso()).first();
      results = [r];
    }
    return json({ runners: results.map(pub) });
  }
  if (method === "POST" && !id) {
    const f = runnerFields(await readBody(request));
    if (!f) return json({ error: "bad request" }, 400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM booking_runners WHERE user_id = ?").bind(user.id).first();
    if (n.n >= MAX_RUNNERS) return json({ error: "too many" }, 400);
    const r = await env.DB.prepare(`INSERT INTO booking_runners (user_id, first_name, last_name, licence, club_country, club_code, club_name, card, self, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?) RETURNING *`).bind(user.id, f.first_name, f.last_name, f.licence, f.club_country, f.club_code,
      f.club_name, f.card, nowIso()).first();
    return json({ runner: pub(r) });
  }
  if (id && method === "PUT") {
    const f = runnerFields(await readBody(request));
    if (!f) return json({ error: "bad request" }, 400);
    const r = await env.DB.prepare(`UPDATE booking_runners SET first_name = ?, last_name = ?, licence = ?, club_country = ?, club_code = ?,
      club_name = ?, card = ? WHERE id = ? AND user_id = ? RETURNING *`).bind(f.first_name, f.last_name, f.licence, f.club_country, f.club_code,
      f.club_name, f.card, id, user.id).first();
    return r ? json({ runner: pub(r) }) : json({ error: "not found" }, 404);
  }
  if (id && method === "DELETE") {
    await env.DB.prepare("DELETE FROM booking_runners WHERE id = ? AND user_id = ?").bind(id, user.id).run();
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}
const pub = (r) => ({ id: r.id, first_name: r.first_name, last_name: r.last_name, licence: r.licence, club_country: r.club_country,
  club_code: r.club_code, club_name: r.club_name, card: r.card, self: !!r.self });
/** The account's holder as a runner: their names, their FFCO club from the data, else the club typed for another country. */
async function holder({ request, env }, user) {
  const out = { first_name: clean(user.first_name, 60) || clean(user.display_name, 60), last_name: clean(user.last_name, 60),
    licence: /^\d+$/.test(String(user.licence || "")) ? String(user.licence) : "", club_country: "", club_code: "", club_name: "" };
  const code = out.licence ? await accountClub(env, request, out.licence) : null;
  if (code) {
    out.club_country = "FR"; out.club_code = code;
    try {
      const r = await env.ASSETS.fetch(new URL("/data/fr/pub/meta.json", request.url));
      out.club_name = (r.ok ? (await r.json()).names?.clubs?.[code] : "") || "";
    } catch (e) { /* the page names it */ }
    return out;
  }
  try {
    const m = await env.DB.prepare("SELECT country, club FROM user_countries WHERE user_id = ? AND status = 'ok' AND club != '' ORDER BY added_at LIMIT 1")
      .bind(user.id).first();
    if (m) Object.assign(out, clubOf({ club_country: m.country, club_name: m.club }));
  } catch (e) { /* none then */ }
  return out;
}

// ---- one competition: the grid, booking, changes ------------------------------------------------------------------
async function canOrganise(ctx, user, key) {
  if (!user) return false;
  if (isAdmin(ctx.env, user)) return true;
  return organises(ctx.env, ctx.request, user, await findRace(ctx.env, ctx.request, key));
}
async function grid(ctx, user, key) {
  const { env } = ctx;
  const ev = await loadEvent(env, key);
  const org = await canOrganise(ctx, user, key);
  if (!ev || (ev.status === "draft" && !org)) return json({ error: "not found", organiser: org }, 404);
  const { results } = await env.DB.prepare("SELECT * FROM bookings WHERE race_key = ? ORDER BY start_s").bind(key).all();
  const bookings = results.map((b) => {
    const mine = !!user && b.user_id === user.id && !b.by_org;
    return { c: b.circuit, s: b.start_s, n: `${b.first_name} ${b.last_name}`.trim(), club: b.club_name || b.club_code, code: b.club_code, cc: b.club_country,
      ck: b.club_key, ...(mine || org ? { id: b.id, card: b.card, first: b.first_name, last: b.last_name, lic: b.licence } : {}),
      ...(mine ? { mine: true } : {}), ...(org && b.by_org ? { byOrg: true } : {}) };
  });
  const event = { key, name: ev.name, date: ev.race_date, place: ev.place, org: ev.org, country: ev.country, status: ev.status,
    open: isOpen(ev), ...ev.config, ...(org ? { published: ev.published_at, changed: ev.changed_at } : {}) };
  return json({ event, bookings, organiser: org }, 200, { "Cache-Control": "no-store" });
}

const errOf = (e) => (/start_s/.test(String(e?.message)) ? "taken" : /person/.test(String(e?.message)) ? "twice" : null);
/** Insert one booking under the club rule (unless `force`); -> { ok, id } or { error }. */
async function insert(env, ev, row, force) {
  const now = nowIso();
  const vals = [row.race_key, row.circuit, row.start_s, row.user_id, row.by_org, row.person, row.first_name, row.last_name, row.licence,
    row.club_country, row.club_code, row.club_name, row.club_key, row.card, now, now];
  const cols = "race_key, circuit, start_s, user_id, by_org, person, first_name, last_name, licence, club_country, club_code, club_name, club_key, card, created_at, updated_at";
  try {
    const gap = force || !row.club_key ? 0 : ev.config.gap;
    const r = await env.DB.prepare(`INSERT INTO bookings (${cols}) SELECT ${vals.map(() => "?").join(", ")}
      WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE race_key = ? AND club_key = ? AND abs(start_s - ?) < ?) RETURNING id`)
      .bind(...vals, row.race_key, row.club_key, row.start_s, gap).first();
    return r ? { ok: true, id: r.id } : { error: "club" };
  } catch (e) {
    const code = errOf(e);
    if (code) return { error: code };
    throw e;
  }
}
const touch = (env, key) => env.DB.prepare("UPDATE booking_events SET changed_at = ? WHERE race_key = ?").bind(nowIso(), key).run();

async function book(ctx, user, key) {
  const { request, env } = ctx;
  const ev = await loadEvent(env, key);
  if (!ev || ev.status === "draft") return json({ error: "not found" }, 404);
  if (user.demo_until) return json({ error: "demo" }, 403);
  const org = await canOrganise(ctx, user, key);
  if (!isOpen(ev) && !org) return json({ error: "closed" }, 400);
  if (!(await allow(env, `book:${user.id}`, 120, 3600))) return json({ error: "too many" }, 429);
  const b = await readBody(request);
  const items = Array.isArray(b?.book) ? b.book.slice(0, 30) : null;
  if (!items?.length) return json({ error: "bad request" }, 400);
  const ids = [...new Set(items.map((x) => Number(x.runner)).filter(Number.isInteger))];
  const { results: rs } = ids.length ? await env.DB.prepare(
    `SELECT * FROM booking_runners WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(user.id, ...ids).all() : { results: [] };
  const byId = new Map(rs.map((r) => [r.id, r]));
  const had = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE race_key = ? AND user_id = ? AND by_org = 0").bind(key, user.id).first()).n;
  let count = had;
  const results = [];
  for (const it of items) {
    const r = byId.get(Number(it.runner));
    const circuit = String(it.circuit || ""), s = Number(it.start);
    if (!r) { results.push({ runner: it.runner, error: "runner" }); continue; }
    if (!slotOk(ev.config, circuit, s)) { results.push({ runner: r.id, error: "slot" }); continue; }
    if (count >= ev.config.max && !org) { results.push({ runner: r.id, error: "max" }); continue; }
    if (ev.config.card && it.card != null && /^\d{1,10}$/.test(String(it.card).trim()) && String(it.card).trim() !== r.card) {
      r.card = String(it.card).trim();
      await env.DB.prepare("UPDATE booking_runners SET card = ? WHERE id = ?").bind(r.card, r.id).run();
    }
    const club = clubOf(r), ck = clubKey(club);
    const res = await insert(env, ev, { race_key: key, circuit, start_s: s, user_id: user.id, by_org: 0, person: personOf(r, ck),
      first_name: r.first_name, last_name: r.last_name, licence: r.licence, ...club, club_key: ck, card: ev.config.card ? r.card : "" }, false);
    if (res.ok) count++;
    results.push({ runner: r.id, ...res });
  }
  if (results.some((x) => x.ok)) await touch(env, key);
  return json({ results });
}

async function change(ctx, user, key, id) {
  const { request, env } = ctx;
  const ev = await loadEvent(env, key);
  const bk = ev ? await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND race_key = ?").bind(id, key).first() : null;
  if (!bk) return json({ error: "not found" }, 404);
  const org = await canOrganise(ctx, user, key);
  const own = bk.user_id === user.id && !bk.by_org;
  if (!org && !(own && isOpen(ev))) return json({ error: own ? "closed" : "forbidden" }, 403);
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(id).run();
    await touch(env, key);
    if (!bk.by_org) await tellBookers(env, ev, "cancelled", [bk], user.id);
    return json({ ok: true });
  }
  const b = await readBody(request);
  const circuit = String(b?.circuit || bk.circuit), s = Number(b?.start ?? bk.start_s);
  if (!slotOk(ev.config, circuit, s) && !(org && b?.force)) return json({ error: "slot" }, 400);
  const gap = org && b?.force ? 0 : bk.club_key ? ev.config.gap : 0;
  let r;
  try {
    r = await env.DB.prepare(`UPDATE bookings SET circuit = ?, start_s = ?, reminded = 0, updated_at = ? WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE race_key = ? AND club_key = ? AND id != ? AND abs(start_s - ?) < ?) RETURNING *`)
      .bind(circuit, s, nowIso(), id, key, bk.club_key, id, s, gap).first();
  } catch (e) {
    const code = errOf(e);
    if (code) return json({ error: code }, 409);
    throw e;
  }
  if (!r) return json({ error: "club" }, 409);
  await touch(env, key);
  if (!r.by_org && (r.circuit !== bk.circuit || r.start_s !== bk.start_s)) await tellBookers(env, ev, "moved", [r], user.id);
  return json({ ok: true });
}

// ---- the organisers -----------------------------------------------------------------------------------------------
async function config(ctx, user, key) {
  const { request, env } = ctx;
  const race = await findRace(env, request, key);
  if (!race || !(await organises(env, request, user, race))) return json({ error: "not organiser" }, 403);
  const ev = await loadEvent(env, key);
  if (request.method === "DELETE") {
    if (!ev) return json({ ok: true });
    const { results } = await env.DB.prepare("SELECT * FROM bookings WHERE race_key = ?").bind(key).all();
    await env.DB.batch([env.DB.prepare("DELETE FROM bookings WHERE race_key = ?").bind(key),
      env.DB.prepare("DELETE FROM booking_events WHERE race_key = ?").bind(key)]);
    if (ev.status !== "draft") await tellBookers(env, ev, "cancelled", results.filter((x) => !x.by_org), user.id);
    return json({ ok: true });
  }
  if (request.method !== "PUT") return json({ error: "not found" }, 404);
  if (race.date_iso < parisDay()) return json({ error: "past" }, 400);
  const b = await readBody(request);
  const cfg = cleanConfig(b?.config);
  const status = ["draft", "open", "closed"].includes(b?.status) ? b.status : ev?.status || "draft";
  if (!cfg) return json({ error: "config" }, 400);
  if (ev) {         // a circuit taken away keeps its bookings only if none: the organisers move them first
    const gone = ev.config.circuits.filter((c) => !cfg.circuits.some((x) => x.id === c.id)).map((c) => c.id);
    if (gone.length) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE race_key = ? AND circuit IN (${gone.map(() => "?").join(",")})`)
        .bind(key, ...gone).first();
      if (n.n) return json({ error: "circuit in use" }, 409);
    }
  }
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO booking_events (race_key, name, race_date, org, place, country, config, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (race_key) DO UPDATE SET name = excluded.name, race_date = excluded.race_date,
    org = excluded.org, place = excluded.place, country = excluded.country, config = excluded.config, status = excluded.status, updated_at = excluded.updated_at`)
    .bind(key, clean(race.name, 140), race.date_iso, clean(race.org, 120), clean(race.place, 120), race.country || "FR", JSON.stringify(cfg), status,
      user.id, now, now).run();
  return json({ ok: true, event: eventOf(await env.DB.prepare("SELECT * FROM booking_events WHERE race_key = ?").bind(key).first()) });
}

async function orgAdd(ctx, user, key) {
  const { request, env } = ctx;
  if (!(await canOrganise(ctx, user, key))) return json({ error: "not organiser" }, 403);
  const ev = await loadEvent(env, key);
  if (!ev) return json({ error: "not found" }, 404);
  const b = await readBody(request);
  const items = Array.isArray(b?.add) ? b.add.slice(0, 1000) : null;
  if (!items?.length) return json({ error: "bad request" }, 400);
  const results = [];
  for (const it of items) {
    const f = runnerFields(it), circuit = String(it?.circuit || ""), s = Number(it?.start);
    if (!f) { results.push({ error: "runner" }); continue; }
    if (!slotOk(ev.config, circuit, s) && !b.force) { results.push({ error: "slot" }); continue; }
    const ck = clubKey(f);
    results.push(await insert(env, ev, { race_key: key, circuit, start_s: s, user_id: user.id, by_org: 1, person: personOf(f, ck), ...f, club_key: ck },
      b.force === true));
  }
  if (results.some((x) => x.ok)) await touch(env, key);
  return json({ results });
}

async function publishNow(ctx, user, key) {
  const { request, env } = ctx;
  const race = await findRace(env, request, key);
  if (!race || !(await organises(env, request, user, race))) return json({ error: "not organiser" }, 403);
  const ev = await loadEvent(env, key);
  if (!ev) return json({ error: "not found" }, 404);
  if (ev.race_date < parisDay()) return json({ error: "past" }, 400);
  if (!(await allow(env, `book:pub:${key}`, 6, 600))) return json({ error: "too many" }, 429);
  const r = await publish(env, ev, user.id, race);
  return r.ok ? json(r) : json(r, 400);
}

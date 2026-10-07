// Called by update.py (Authorization: Bearer NOTIFY_SECRET), never by the browser.
//
//   GET  /api/notify            -> { licences: [...] } licences with at least one subscribed account
//   POST /api/notify { items: [{ lic, races: [{ id, title, date, location }] }] }
//        queues one digest e-mail per subscribed account (races it was not told about yet),
//        then sends what fits in today's quota. { items: [] } just drains the backlog.
//   -> { queued, sent, remaining, budget }
//
// update.py computes who ran which new competition (it has the database); this side only
// knows who subscribed, so the server stays small.

import { alertsAllowed, json, jsonList, readBody } from "../_lib/api.js";
import { sha256hex } from "../_lib/crypto.js";
import { flushQueue, queueStatement } from "../_lib/mail.js";
import { agendaMail, digestMail } from "../_lib/templates.js";

async function authorised(request, env) {
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.NOTIFY_SECRET || !given) return false;
  return (await sha256hex(given)) === (await sha256hex(env.NOTIFY_SECRET));
}

const SUBSCRIBED = "notify = 1 AND email_verified = 1 AND status = 'active'";

export async function onRequestGet({ request, env }) {
  if (!(await authorised(request, env))) return json({ error: "forbidden" }, 403);
  const { results } = await env.DB.prepare(`SELECT DISTINCT licence FROM users WHERE ${SUBSCRIBED}`).all();
  return json({ licences: results.map((r) => r.licence) });
}

/**
 * The courses of the agenda (all the upcoming ones, sent each morning) -> one digest for each account that
 * asked to be alerted about new courses in its regions. A course is announced once (agenda_announced).
 * The very first call only records what is already there, so nobody receives the whole agenda.
 */
async function announceAgenda(env, list) {
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const url = (v) => (/^https?:\/\//i.test(String(v || "")) ? str(v, 400) : "");
  const events = list.slice(0, 1000).filter((e) => e && e.id != null).map((e) => ({
    id: str(e.id, 20), name: str(e.name, 200), date: str(e.date, 10), place: str(e.place, 100), dep: str(e.dep, 4),
    depName: str(e.depName, 60), region: str(e.region, 60), type: str(e.type, 60), cn: !!e.cn, groupe: str(e.groupe, 30),
    manif: str(e.manif, 100), org: str(e.org, 150), referee: str(e.referee, 80), referee2: str(e.referee2, 80),
    controller: str(e.controller, 80), delegate: str(e.delegate, 80), contact: str(e.contact, 150), phone: str(e.phone, 40),
    email: /^[^\s@<>]+@[^\s@<>]+$/.test(String(e.email || "")) ? str(e.email, 120) : "",
    monitor: str(e.monitor, 80), access: str(e.access, 1600), mapUrl: url(e.mapUrl),
    gps: Array.isArray(e.gps) && e.gps.length === 2 && e.gps.every((n) => Number.isFinite(Number(n))) ? e.gps.map(Number) : null,
    site: url(e.site), flechage: str(e.flechage, 400), invitation: url(e.invitation), obs: str(e.obs, 800),
    reg: e.reg && url(e.reg.url) ? {
      url: url(e.reg.url), close: str(e.reg.close, 10), mods: str(e.reg.mods, 10),
      count: Number.isInteger(e.reg.count) ? e.reg.count : null, teams: Number.isInteger(e.reg.teams) ? e.reg.teams : null,
    } : null,
  }));
  if (!events.length) return { queued: 0, events };
  const first = (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_announced").first()).n === 0;
  const fresh = [];
  for (let i = 0; i < events.length; i += 45) {                     // 2 bound values per row, at most 100 per statement
    const part = events.slice(i, i + 45);
    const { results } = await env.DB.prepare(
      `INSERT OR IGNORE INTO agenda_announced (event_id, seen_at) VALUES ${part.map(() => "(?, ?)").join(",")} RETURNING event_id`,
    ).bind(...part.flatMap((e) => [e.id, Date.now()])).all();
    const added = new Set(results.map((r) => r.event_id));
    fresh.push(...part.filter((e) => added.has(e.id)));
  }
  if (first || !fresh.length) return { queued: 0, events };
  const { results: users } = await env.DB.prepare(
    "SELECT * FROM users WHERE agenda_alert = 1 AND email_verified = 1 AND status = 'active'").all();
  const stmts = [];
  for (const u of users) {
    if (!alertsAllowed(env, u)) continue;             // a right the administrator grants
    const regions = new Set(jsonList(u.agenda_regions));
    const mine = fresh.filter((e) => regions.has(e.region));
    if (mine.length) stmts.push(queueStatement(env, { to: u.email, ...agendaMail(env, u, mine), kind: "agenda", priority: 0 }));
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return { queued: stmts.length, events };
}

const DEADLINE_DAYS = 8;
/** Today in Paris, and a number of days later, as YYYY-MM-DD. */
const parisDay = (plus = 0) => {
  const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString().slice(0, 10);
};

/**
 * The courses whose registrations close within DEADLINE_DAYS -> one digest for each account that asked for this
 * alert, about the ones in its regions it has not been told about yet (deadline_announced), soonest first.
 */
async function announceDeadlines(env, events) {
  const today = parisDay(), until = parisDay(DEADLINE_DAYS);
  const soon = events.filter((e) => e.reg?.close && e.reg.close >= today && e.reg.close <= until);
  if (!soon.length) return 0;
  const { results: users } = await env.DB.prepare(
    "SELECT * FROM users WHERE deadline_alert = 1 AND email_verified = 1 AND status = 'active'").all();
  const stmts = [];
  for (const u of users) {
    if (!alertsAllowed(env, u)) continue;
    const regions = new Set(jsonList(u.agenda_regions));
    const mine = soon.filter((e) => regions.has(e.region)).slice(0, 90);
    if (!mine.length) continue;
    const res = await env.DB.batch(mine.map((e) => env.DB.prepare(
      "INSERT OR IGNORE INTO deadline_announced (user_id, event_id, seen_at) VALUES (?, ?, ?)").bind(u.id, e.id, Date.now())));
    const fresh = mine.filter((_, i) => res[i].meta.changes).sort((a, b) => a.reg.close.localeCompare(b.reg.close));
    if (fresh.length) stmts.push(queueStatement(env, { to: u.email, ...agendaMail(env, u, fresh, "deadline"), kind: "deadline", priority: 0 }));
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return stmts.length;
}

export async function onRequestPost({ request, env }) {
  if (!(await authorised(request, env))) return json({ error: "forbidden" }, 403);
  const b = await readBody(request);
  let agendaQueued = 0, deadlineQueued = 0;
  if (Array.isArray(b?.agenda)) {
    const r = await announceAgenda(env, b.agenda);
    agendaQueued = r.queued;
    deadlineQueued = await announceDeadlines(env, r.events);
  }
  const items = Array.isArray(b?.items) ? b.items.slice(0, 100) : [];
  let queued = 0;
  if (items.length) {
    const byLic = new Map(items.map((i) => [String(i.lic), (i.races || []).slice(0, 30)]));
    const lics = [...byLic.keys()];
    const { results: users } = await env.DB.prepare(
      `SELECT * FROM users WHERE ${SUBSCRIBED} AND licence IN (${lics.map(() => "?").join(",")})`).bind(...lics).all();
    // announce each (account, competition) once: INSERT OR IGNORE tells which ones are new
    const pairs = users.flatMap((u) => byLic.get(u.licence).map((r) => [u, r]));
    if (pairs.length) {
      const res = await env.DB.batch(pairs.map(([u, r]) =>
        env.DB.prepare("INSERT OR IGNORE INTO notified (user_id, course_id) VALUES (?, ?)").bind(u.id, String(r.id))));
      const fresh = new Map();
      pairs.forEach(([u, r], i) => { if (res[i].meta.changes) fresh.set(u, [...(fresh.get(u) || []), r]); });
      const stmts = [...fresh].map(([u, races]) => queueStatement(env,
        { to: u.email, ...digestMail(env, u, races), kind: "digest", priority: 0 }));
      if (stmts.length) await env.DB.batch(stmts);
      queued = stmts.length;
    }
  }
  return json({ queued, agendaQueued, deadlineQueued, ...(await flushQueue(env)) });
}

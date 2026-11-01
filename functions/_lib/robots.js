// « Robots » (owner, 2026-11-01): what Cloudflare did with the AI crawlers and agents (the zone's « AI Crawler and Agent access
// policies » block them), copied from Cloudflare's GraphQL analytics into D1 (migration 0020) so that the admin page shows
// 13 months where Cloudflare keeps 31 days; and the guest passes (functions/api/guest.js, the login gate), counted by day.
//   The copy: the security events of each UTC day (firewallEventsAdaptiveGroups by action, source and user agent, else the raw
//   firewallEventsAdaptive up to a page — then marked approximate), each user agent sorted by _lib/aibots.js, and the AI bots'
//   requests that went through (httpRequestsAdaptiveGroups by user agent and status, status < 400). A day is copied again
//   until it is over (the last day copied and the current one at each pass); a few days a pass (the Functions' 50 subrequests
//   and 10 ms of CPU), the oldest missing first; the first passes fill the last 30 days, every 10 minutes. Due every 3 hours, asked by
//   /api/track (robotsSoon) and by the admin page itself. The account's read-only token CF_ANALYTICS_TOKEN (« Consommation »)
//   with « Zone › Analytics › Read » and « Zone › Zone › Read » on the site's zone; the zone from CF_ZONE_ID, else found by
//   the site's name (SITE_URL's host, else ozimut.com).
// Every query was written from Cloudflare's documentation; a failing one is kept as the copy's error and shown on the page.
import { aiBot, AI_BOTS } from "./aibots.js";

const API = "https://api.cloudflare.com/client/v4";
const DUE_MS = 3 * 3600e3;
const KEEP_DAYS = 400;
const FIRST_DAYS = 30;
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

async function cf(env, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok || body?.success === false) throw new Error(body?.errors?.[0]?.message || `HTTP ${r.status}`);
  return body;
}
/** A GraphQL literal of a filter (keys as names, values as JSON): the datasets' filter types differ, a literal fits them all. */
const lit = (v) => (Array.isArray(v) ? `[${v.map(lit).join(", ")}]`
  : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${lit(x)}`).join(", ")} }` : JSON.stringify(v));
async function zoneQuery(env, zone, body) {
  const query = `query { viewer { zones(filter: { zoneTag: ${JSON.stringify(zone)} }) { ${body} } } }`;
  const r = await cf(env, "/graphql", { method: "POST", body: JSON.stringify({ query }) });
  if (r?.errors?.length) throw new Error(r.errors[0].message);
  return r?.data?.viewer?.zones?.[0] || {};
}
async function findZone(env) {
  let host = "ozimut.com";
  try { host = new URL(env.SITE_URL).hostname || host; } catch (e) { /* the default */ }
  const name = host.split(".").slice(-2).join(".");
  const r = await cf(env, `/zones?name=${encodeURIComponent(name)}`);
  const id = r?.result?.[0]?.id;
  if (!id) throw new Error(`zone ${name} not found (Zone › Zone › Read on it?)`);
  return id;
}
/** What the zone's plan offers of each dataset (Cloudflare's settings node); null when it cannot be read. */
async function settings(env, zone) {
  const node = "enabled maxDuration maxPageSize notOlderThan";
  try {
    const z = await zoneQuery(env, zone, `settings { firewallEventsAdaptive { ${node} } firewallEventsAdaptiveGroups { ${node} } httpRequestsAdaptiveGroups { ${node} } }`);
    return z.settings || null;
  } catch (e) { return null; }
}

/** The state of the copy (bot_sync), or a fresh one. */
async function readState(env) {
  try {
    const r = await env.DB.prepare("SELECT v FROM bot_sync WHERE k = 'state'").first();
    return r ? JSON.parse(r.v) : {};
  } catch (e) { return null; }                           // no table: migration 0020 not applied
}
const saveState = (env, s) => env.DB.prepare("INSERT INTO bot_sync (k, v) VALUES ('state', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
  .bind(JSON.stringify(s)).run();

/** The windows of a day a dataset may be asked for at once (maxDuration seconds), never past now. */
function windows(day, maxSec) {
  const out = [], end = Math.min(dayMs(day) + 864e5, Date.now()), step = Math.max(3600, Math.min(86400, maxSec || 86400)) * 1000;
  for (let t = dayMs(day); t < end; t += step) out.push([new Date(t).toISOString(), new Date(Math.min(t + step, end)).toISOString()]);
  return out;
}

/** One day's counts: { key bot|action|source -> n }, whether approximate. */
async function copyDay(env, zone, day, st) {
  const counts = new Map(), add = (bot, action, source, n) => { const k = `${bot}\t${action}\t${source || ""}`; counts.set(k, (counts.get(k) || 0) + n); };
  let approx = false, mode = "";
  const groups = st?.firewallEventsAdaptiveGroups, events = st?.firewallEventsAdaptive, http = st?.httpRequestsAdaptiveGroups;
  // the security events
  if (groups?.enabled !== false) {
    try {
      for (const [a, b] of windows(day, groups?.maxDuration)) {
        const f = lit({ datetime_geq: a, datetime_lt: b });
        const z = await zoneQuery(env, zone, `firewallEventsAdaptiveGroups(limit: ${Math.min(groups?.maxPageSize || 2000, 5000)}, filter: ${f}) { count dimensions { action source userAgent } }`);
        for (const r of z.firewallEventsAdaptiveGroups || []) add(aiBot(r.dimensions.userAgent), r.dimensions.action || "", r.dimensions.source, r.count || 0);
      }
      mode = "groups";
    } catch (e) { counts.clear(); mode = ""; if (events?.enabled === false) throw e; }
  }
  if (!mode) {
    const page = Math.min(events?.maxPageSize || 100, 10000);
    for (const [a, b] of windows(day, events?.maxDuration)) {
      const f = lit({ datetime_geq: a, datetime_lt: b });
      const z = await zoneQuery(env, zone, `firewallEventsAdaptive(limit: ${page}, filter: ${f}, orderBy: [datetime_DESC]) { action source userAgent }`);
      const rows = z.firewallEventsAdaptive || [];
      if (rows.length >= page) approx = true;
      for (const r of rows) add(aiBot(r.userAgent), r.action || "", r.source, 1);
    }
    mode = "events";
  }
  // the AI bots let through (their requests answered under 400)
  let allowedErr = null;
  if (http?.enabled !== false) {
    try {
      for (const [a, b] of windows(day, http?.maxDuration)) {
        const f = lit({ datetime_geq: a, datetime_lt: b, edgeResponseStatus_lt: 400, OR: AI_BOTS.map((x) => ({ userAgent_like: `%${x}%` })) });
        const z = await zoneQuery(env, zone, `httpRequestsAdaptiveGroups(limit: 1000, filter: ${f}) { count dimensions { userAgent } }`);
        for (const r of z.httpRequestsAdaptiveGroups || []) { const bot = aiBot(r.dimensions.userAgent); if (bot) add(bot, "allowed", "", r.count || 0); }
      }
    } catch (e) { allowedErr = String(e.message || e).slice(0, 160); }
  }
  return { counts, approx, mode, allowedErr };
}

/** The latest AI bots' requests Cloudflare acted on, over the last day (100 at most). */
async function copyRecent(env, zone, st) {
  const page = Math.min(st?.firewallEventsAdaptive?.maxPageSize || 100, 500);
  const f = lit({ datetime_geq: new Date(Date.now() - 864e5).toISOString(), datetime_lt: new Date().toISOString() });
  const z = await zoneQuery(env, zone, `firewallEventsAdaptive(limit: ${page}, filter: ${f}, orderBy: [datetime_DESC]) { datetime action source userAgent clientRequestPath clientCountryName }`);
  const rows = (z.firewallEventsAdaptive || []).map((r) => ({ ...r, bot: aiBot(r.userAgent) })).filter((r) => r.bot).slice(0, 100);
  await env.DB.batch([env.DB.prepare("DELETE FROM bot_recent"),
    ...rows.map((r) => env.DB.prepare("INSERT INTO bot_recent (ts, bot, action, source, path, country) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(Date.parse(r.datetime) || Date.now(), r.bot, r.action || "", r.source || "", String(r.clientRequestPath || "").slice(0, 200), r.clientCountryName || ""))]);
}

/**
 * Copy what is due: the days from the last one copied (or the last 30) to today, `maxDays` of them, then the latest events.
 * Returns the state ({ last, through, zone, mode, approx, error, allowedErr }), or null without the tables.
 */
export async function syncBots(env, { force = false, maxDays = 3, recent = false } = {}) {
  if (!env.DB) return null;
  const state = await readState(env);
  if (state === null) return null;
  if (!env.CF_ANALYTICS_TOKEN) return { ...state, error: "no token" };
  // while the first 30 days are filling in, a pass every 10 minutes; then every 3 hours
  const due = state.through && !state.done ? 10 * 60e3 : DUE_MS;
  if (!force && Date.now() - (state.last || 0) < due) return state;
  const s = { ...state, last: Date.now() };
  await saveState(env, s);                                  // taken: another isolate does not start the same pass
  try {
    s.zone = env.CF_ZONE_ID || s.zone || await findZone(env);
    const st = await settings(env, s.zone);
    const today = isoDay(Date.now());
    const oldest = isoDay(Math.max(Date.now() - FIRST_DAYS * 864e5, st?.firewallEventsAdaptive?.notOlderThan ? Date.now() - (st.firewallEventsAdaptive.notOlderThan - 3600) * 1000 : 0));
    // the days still to copy: from the last one copied (copied again: it may not have been over), else the oldest kept
    let from = s.through && s.through >= oldest ? s.through : oldest;
    const days = [];
    for (let t = dayMs(from); t <= dayMs(today) && days.length < maxDays; t += 864e5) days.push(isoDay(t));
    let approx = false, mode = "", allowedErr = null;
    for (const day of days) {
      const c = await copyDay(env, s.zone, day, st);
      approx = approx || c.approx; mode = c.mode; allowedErr = c.allowedErr || allowedErr;
      await env.DB.batch([env.DB.prepare("DELETE FROM bot_daily WHERE day = ?").bind(day),
        ...[...c.counts].filter(([, n]) => n > 0).map(([k, n]) => { const [bot, action, source] = k.split("\t");
          return env.DB.prepare("INSERT INTO bot_daily (day, bot, action, source, n) VALUES (?, ?, ?, ?, ?)").bind(day, bot, action, source, n); })]);
      s.through = day;
    }
    if (recent) await copyRecent(env, s.zone, st);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM bot_daily WHERE day < ?").bind(isoDay(Date.now() - KEEP_DAYS * 864e5)),
      env.DB.prepare("DELETE FROM guest_daily WHERE day < ?").bind(isoDay(Date.now() - KEEP_DAYS * 864e5)),
    ]);
    Object.assign(s, { mode, approx, allowedErr, error: null, done: s.through === today });
  } catch (e) {
    s.error = String(e.message || e).slice(0, 200);
  }
  await saveState(env, s);
  return s;
}

let lastCheck = 0;
/** From /api/track: the copy, when due (an isolate looks at most every 10 minutes). */
export function robotsSoon(ctx) {
  if (!ctx.env.CF_ANALYTICS_TOKEN || Date.now() - lastCheck < 10 * 60e3) return;
  lastCheck = Date.now();
  ctx.waitUntil(syncBots(ctx.env).catch(() => null));
}

// ---- the guest passes, counted by day
/** One more pass given (`passes`) or refused (`failed`); never fails the request. */
export async function countGuest(env, field, n = 1) {
  if (!env.DB || !["passes", "failed", "refused"].includes(field) || !n) return;
  try {
    await env.DB.prepare(`INSERT INTO guest_daily (day, ${field}) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET ${field} = ${field} + excluded.${field}`)
      .bind(isoDay(Date.now()), n).run();
  } catch (e) { /* no table yet */ }
}
// the reads refused for want of a pass, counted in the isolate and written at most once a minute (a script refused by the
// thousand would otherwise spend as many D1 writes)
let refused = 0, flushedAt = 0;
export function countRefused(ctx) {
  refused++;
  if (Date.now() - flushedAt < 60e3) return;
  flushedAt = Date.now();
  const n = refused; refused = 0;
  ctx.waitUntil(countGuest(ctx.env, "refused", n));
}

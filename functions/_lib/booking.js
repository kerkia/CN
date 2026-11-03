// « Réservation des horaires » (owner, 2026-11-03; migration 0023): what the API (api/booking/[[path]].js) and the page
// views' hook (api/track.js: bookingSoon) share — the rules of a slot and of a club, the runners' alert « Mes horaires
// réservés » (a start moved or cancelled by the organisers; the reminder the day before), and the start list written from
// the bookings, published as an organiser's deposit is (functions/api/upload.js: R2 uploads/<id>/, D1 uploads, then a run of
// the provisional results, which publishes it on the race's page and in the agenda — and tells the licensees their start
// time, as for any start list).

import { allow, nowIso, userLang } from "./api.js";
import { queueStatement, flushQueue } from "./mail.js";
import { queuePush, flushPush, pushReady } from "./push.js";
import { bookingMail, bookingPush } from "./templates.js";
import { startRun } from "../api/upload.js";
import { declaredRace } from "./club.js";

export const MAX_CIRCUITS = 40;
export const MAX_SLOTS = 400;            // a circuit's starts
export const MAX_PER_ACCOUNT = 30;       // the most an organiser may let one account book
export const MAX_RUNNERS = 40;           // « Mes coureurs »

/** Now in Paris, "YYYY-MM-DDTHH:MM" (the settings' closing time is written so). */
export const parisNow = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16).replace(" ", "T");
export const parisDay = (plus = 0) => {
  const d = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" })}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString().slice(0, 10);
};
export const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A name or club as compared: lower case, accents and punctuation gone. */
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A runner's club as kept: { club_country, club_code, club_name } cleaned (France's number four digits). */
export function clubOf(x = {}) {
  const cc = /^[A-Z]{2}$/.test(String(x.club_country || "")) ? String(x.club_country) : "";
  let code = clean(x.club_code, 12);
  if (cc === "FR") code = /^\d{3,4}$/.test(code) ? code.padStart(4, "0") : "";
  return { club_country: cc, club_code: cc ? code : "", club_name: cc ? clean(x.club_name, 80) : "" };
}
/** The club the gap rule compares: « FR:0109 » (a federation's number), else the country and the name; '' without a club. */
export function clubKey(c) {
  if (!c.club_country) return "";
  if (c.club_code) return `${c.club_country}:${c.club_code}`;
  const n = norm(c.club_name);
  return n ? `${c.club_country}:${n}` : "";
}
/** Who runs, to book them once a competition: their licence, else their name and club. */
export const personOf = (r, key) => (r.licence ? `L${r.licence}` : `N${norm(`${r.first_name} ${r.last_name}`)}|${key}`);

/** The settings, checked and cleaned; null if they do not hold. */
export function cleanConfig(c) {
  if (!c || typeof c !== "object" || !Array.isArray(c.circuits) || c.circuits.length > MAX_CIRCUITS) return null;
  const ids = new Set(), circuits = [];
  for (const x of c.circuits) {
    const id = clean(x?.id, 12), name = clean(x?.name, 60);
    const first = Math.round(Number(x?.first)), last = Math.round(Number(x?.last)), step = Math.round(Number(x?.step));
    if (!/^[\w-]{1,12}$/.test(id) || ids.has(id) || !name) return null;
    if (![first, last, step].every(Number.isFinite) || first < 0 || last >= 86400 || last < first || step < 10 || step > 3600) return null;
    if ((last - first) / step + 1 > MAX_SLOTS) return null;
    ids.add(id);
    circuits.push({ id, name, first, last, step });
  }
  const blocked = {};
  for (const [id, list] of Object.entries(c.blocked || {})) {
    if (!ids.has(id) || !Array.isArray(list)) continue;
    blocked[id] = [...new Set(list.map(Number).filter((s) => Number.isInteger(s) && s >= 0 && s < 86400))].slice(0, MAX_SLOTS);
  }
  const gap = Math.round(Number(c.gap) || 0), max = Math.round(Number(c.max) || 10);
  const close = String(c.close || "");
  if (gap < 0 || gap > 3600 || max < 1 || max > MAX_PER_ACCOUNT) return null;
  if (close && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(close)) return null;
  return { circuits, gap, max, close, card: c.card === true, note: clean(c.note, 600), blocked };
}

/** Is `s` one of the circuit's starts, and not kept back by the organisers? */
export function slotOk(cfg, circuitId, s) {
  const c = cfg.circuits.find((x) => x.id === circuitId);
  if (!c || !Number.isInteger(s) || s < c.first || s > c.last || (s - c.first) % c.step) return false;
  return !(cfg.blocked?.[circuitId] || []).includes(s);
}

/** An event row with its settings read. */
export const eventOf = (row) => (row ? { ...row, config: JSON.parse(row.config || "{}") } : null);
export const loadEvent = async (env, key) => eventOf(await env.DB.prepare("SELECT * FROM booking_events WHERE race_key = ?").bind(key).first());

/** May runners book now? Open, before its closing time and the race's day. */
export const isOpen = (ev) => ev?.status === "open" && (!ev.config.close || parisNow() <= ev.config.close) && ev.race_date >= parisDay();

const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}${s % 60 ? `:${String(s % 60).padStart(2, "0")}` : ""}`;
const circuitName = (ev, id) => ev.config.circuits.find((c) => c.id === id)?.name || id;

/**
 * Tell the accounts that booked: kind "moved" | "cancelled" | "reminder"; items [{ user_id, first_name, last_name, circuit,
 * start_s }] (a moved one: its new start). An account's own action is not told back to it (`actor`).
 */
export async function tellBookers(env, ev, kind, items, actor = 0) {
  const byUser = new Map();
  for (const b of items) {
    if (!b.user_id || b.user_id === actor) continue;
    if (!byUser.has(b.user_id)) byUser.set(b.user_id, []);
    byUser.get(b.user_id).push({ name: `${b.first_name} ${b.last_name}`.trim(), circuit: circuitName(ev, b.circuit), start: hm(b.start_s) });
  }
  if (!byUser.size) return 0;
  const ids = [...byUser.keys()];
  const { results: users } = await env.DB.prepare(
    `SELECT * FROM users WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'active' AND demo_until IS NULL`).bind(...ids).all();
  const race = { key: ev.race_key, name: ev.name, date: ev.race_date, place: ev.place };
  const stmts = [], push = pushReady(env);
  for (const u of users) {
    const list = byUser.get(u.id);
    if (u.book_mail === 1 && u.alerts_allowed) {
      const m = bookingMail(env, u, race, list, kind);
      stmts.push(queueStatement(env, { to: u.email, subject: m.subject, html: m.html, text: m.text, kind: "booking", priority: kind === "reminder" ? 1 : 0 }));
    }
    if (u.book_push !== 0 && push) {
      stmts.push(queuePush(env, u.id, "booking", bookingPush(userLang(u), race, list, kind), { topic: `book-${ev.race_key}`.slice(0, 32), hours: 36 }));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  await Promise.allSettled([flushQueue(env, 10), flushPush(env, 8)]);
  return stmts.length;
}

// ---- the start list from the bookings -----------------------------------------------------------------------------
const field = (v) => { const s = String(v ?? "").replace(/[\r\n]+/g, " ").trim(); return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const hms = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
/** The bookings as the CSV both start-list readers take (site/assets/js/sheettabs.js toCsv: Heure;Nom;Club;Circuit;Puce). */
export function startCsv(ev, rows) {
  const lines = rows.slice().sort((a, b) => a.start_s - b.start_s || a.circuit.localeCompare(b.circuit)).map((b) => [
    hms(b.start_s), `${b.first_name} ${b.last_name}`.trim(),
    // France's clubs by their number (the site names them), the others by their name
    b.club_country === "FR" && b.club_code ? b.club_code : b.club_name, circuitName(ev, b.circuit), b.card].map(field).join(";"));
  return ["Heure;Nom;Club;Circuit;Puce", ...lines].join("\r\n") + "\r\n";      // i18n-ignore (the file's headings)
}

/**
 * Publish the bookings as the race's start list: an organiser's deposit (functions/api/upload.js's storage, kind "startlist",
 * `booking: true`), then a run of the provisional results. -> { ok, id, soon } or { error }.
 */
export async function publish(env, ev, userId, race) {
  if (!env.BUCKET) return { error: "storage" };
  const { results: rows } = await env.DB.prepare("SELECT * FROM bookings WHERE race_key = ?").bind(ev.race_key).all();
  if (!rows.length) return { error: "empty" };
  const text = startCsv(ev, rows), now = nowIso();
  const filename = `horaires-${ev.race_key}.csv`, label = `${ev.name} (${ev.race_date}) — horaires réservés sur Ozimut`;      // i18n-ignore (the administrators' record)
  const size = new TextEncoder().encode(text).length;
  const row = await env.DB.prepare(
    "INSERT INTO uploads (user_id, race_key, race, filename, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, '', ?) RETURNING id")
    .bind(userId, ev.race_key, label, filename, size, now).first();
  const id = row.id, r2Key = `uploads/${id}/${filename}`;
  await env.BUCKET.put(r2Key, text, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
  const meta = { id, created: now, user: userId, race: ev.race_key, new_race: null, filename, stored: filename, size, status: "active",
    organiser: true, kind: "startlist", booking: true, ...(race?.declared ? { declared: race.declared } : {}) };
  await env.BUCKET.put(`uploads/${id}/meta.json`, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
  await env.DB.batch([env.DB.prepare("UPDATE uploads SET r2_key = ? WHERE id = ?").bind(r2Key, id),
    env.DB.prepare("UPDATE booking_events SET published_at = ? WHERE race_key = ?").bind(now, ev.race_key)]);
  return { ok: true, id, soon: await startRun(env) };
}

// ---- the page views' hook: the closings and the reminders ---------------------------------------------------------
let lastCheck = 0;
/**
 * What time brings, at most every 10 minutes an isolate (api/track.js, ctx.waitUntil): an open booking past its closing
 * time closes and its start list is published; a closed one changed since its last publication is published again; the
 * day before the race, the accounts that booked are reminded of their runners' starts.
 */
export function bookingSoon(ctx, { now = false } = {}) {
  if (!now && Date.now() - lastCheck < 10 * 60e3) return;
  lastCheck = Date.now();
  ctx.waitUntil(bookingDue(ctx.env).catch(() => 0));
}
export async function bookingDue(env) {
  if (!env.DB) return 0;
  const today = parisDay(), tomorrow = parisDay(1), nowP = parisNow();
  let events;
  try {
    ({ results: events } = await env.DB.prepare(
      "SELECT * FROM booking_events WHERE race_date >= ? AND status IN ('open', 'closed')").bind(today).all());
  } catch (e) { return 0; }          // before migration 0023
  let done = 0;
  for (const row of events) {
    const ev = eventOf(row);
    // the closing: taken by this request alone (the UPDATE says whether it changed the row)
    if (ev.status === "open" && ev.config.close && nowP > ev.config.close) {
      const r = await env.DB.prepare("UPDATE booking_events SET status = 'closed', updated_at = ? WHERE race_key = ? AND status = 'open'")
        .bind(nowIso(), ev.race_key).run();
      if (r.meta?.changes) { ev.status = "closed"; ev.published_at = null; }
    }
    if (ev.status === "closed" && ev.changed_at && (!ev.published_at || ev.changed_at > ev.published_at)
      && (await allow(env, `book:auto:${ev.race_key}`, 1, 600))) {
      await publish(env, ev, ev.created_by, ev.race_key.startsWith("d") ? await declaredRace(env, ev.race_key) : null).catch(() => null);
      done++;
    }
    if (ev.race_date === tomorrow) {
      const { results: due } = await env.DB.prepare(
        "UPDATE bookings SET reminded = 1 WHERE race_key = ? AND reminded = 0 RETURNING user_id, by_org, first_name, last_name, circuit, start_s")
        .bind(ev.race_key).all();
      const mine = due.filter((b) => !b.by_org);
      if (mine.length) { await tellBookers(env, ev, "reminder", mine); done++; }
    }
  }
  return done;
}

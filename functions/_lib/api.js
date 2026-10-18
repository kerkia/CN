// Shared plumbing for the account endpoints.

import { COOKIE, readSession, signSession, nameKey } from "../_middleware.js";
import { sha256hex } from "./crypto.js";

export const SESSION_DAYS = 30;

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
});

export async function readBody(request) {
  try { const b = await request.json(); return b && typeof b === "object" ? b : null; } catch (e) { return null; }
}

export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "0.0.0.0";
export const cleanEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(e);
export const cleanLicence = (l) => String(l || "").replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
export const nowIso = () => new Date().toISOString();
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fixed-window counter: true while `key` has made at most `max` attempts in the window. */
export async function allow(env, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec) * windowSec;
  const row = await env.DB.prepare(
    "INSERT INTO rate (k, window, n) VALUES (?, ?, 1) ON CONFLICT (k, window) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(key, win).first();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate WHERE window < ?").bind(now - 86400).run();
  return row.n <= max;
}

export const adminEmails = (env) => String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
export const isAdmin = (env, user) => !!user.email_verified && adminEmails(env).includes(user.email);

export function jsonList(s) {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/** What the browser needs to know about the logged-in user. */
export const publicUser = (env, u) => ({
  uid: u.id, lic: u.licence, nom: u.display_name, email: u.email, notify: !!u.notify, admin: isAdmin(env, u),
  agendaAlert: !!u.agenda_alert, agendaRegions: jsonList(u.agenda_regions), deadlineAlert: !!u.deadline_alert,
  // rights granted on the admin page, administrators included (an admin may uncheck one to see the site as others do)
  analyst: !!u.analyst, agendaAllowed: !!u.alerts_allowed,
  lang: userLang(u),
  // the alerts by push notification (migration 0010): the start times and the results on by default, the agenda's off
  pushStarts: u.push_starts !== 0, startsAlert: u.starts_alert === 1, pushResults: u.push_results !== 0, pushAgenda: u.push_agenda === 1,
  pushDeadline: u.push_deadline === 1,
  // a demo account (admin page, « Démo »): read-only, tied to no licence, valid until that day
  demo: u.demo_until || null,
});
/** An account's language, "fr" or "en" (users.lang, migration 0009; French before it). */
export const userLang = (u) => (u?.lang === "en" ? "en" : "fr");
/** May this account receive the agenda alerts? */
export const alertsAllowed = (env, u) => !!u.alerts_allowed;

/** Today in Paris, YYYY-MM-DD. */
export const parisToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
/** A demo account past its last day (users.demo_until, migration 0012). */
export const demoExpired = (u) => !!u?.demo_until && u.demo_until < parisToday();

export async function sessionCookie(env, user) {
  // a demo account's session: marked (the login gate refuses its changes) and never longer than the account
  const until = user.demo_until ? Date.parse(`${user.demo_until}T23:59:59+01:00`) : Infinity;
  const exp = Math.min(Date.now() + SESSION_DAYS * 86400e3, until);
  const token = await signSession({ uid: user.id, lic: user.licence, exp, chk: Date.now(), ...(user.demo_until ? { demo: 1 } : {}) },
    env.SESSION_SECRET);
  return `${COOKIE}=${token}; Path=/; Max-Age=${Math.max(60, Math.floor((exp - Date.now()) / 1000))}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The active, verified account behind the session cookie, or null. */
export async function currentUser(request, env) {
  const s = await readSession(request, env.SESSION_SECRET);
  if (!s?.uid) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(s.uid).first();
  return u && u.status === "active" && u.email_verified && !demoExpired(u) ? u : null;
}

/** Wrap a handler so it only runs for a logged-in account; admin: true also requires the admin role. */
export const withUser = (handler, { admin = false } = {}) => async (ctx) => {
  if (!ctx.env.DB) return json({ error: "server not configured" }, 500);
  const user = await currentUser(ctx.request, ctx.env);
  if (!user) return json({ error: "login required" }, 401);
  if (admin && !isAdmin(ctx.env, user)) return json({ error: "forbidden" }, 403);
  return handler(ctx, user);
};

/** Does (first name, last name, licence) match a licensee in the FFCO index? -> display name or null. */
export async function checkLicensee(env, request, first, last, licence) {
  const lic = cleanLicence(licence);
  const key = nameKey(`${first} ${last}`);
  if (!lic || !key || lic.length > 12) return null;
  const bucket = /^\d+$/.test(lic) ? Math.floor(Number(lic) / 100) : 999999;
  const res = await env.ASSETS.fetch(new URL(`/auth/${bucket}.json`, request.url));
  const entry = (res.ok ? await res.json() : {})[lic];                // [sha256(nameKey), display name]
  return entry && entry[0] === await sha256hex(key) ? entry[1] : null;
}

export const siteUrl = (env) => String(env.SITE_URL || "").replace(/\/+$/, "");

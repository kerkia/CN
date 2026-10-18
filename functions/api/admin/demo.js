// Demo accounts (administrators only; owner, 2026-10-18): an account an administrator makes for a federation, a league or a
// club that wants to see the site — tied to no licence, read-only (the login gate refuses its changes: _middleware.js), valid
// until users.demo_until (Paris day), then refused at login and at the gate's hourly check. Its password is shown once, here.
//   GET  /api/admin/demo                                   { accounts: [{ id, email, label, until, created, lastLogin, status }] }
//   POST /api/admin/demo { label, email?, days, lang? }    a new one -> { account, password }
//   POST /api/admin/demo { id, action: "extend", days }     valid `days` more from today (or from its last day, if later)
//   POST /api/admin/demo { id, action: "password" }         a new password -> { password }
// Disable, enable and delete: /api/admin/user, as for any account.
import { cleanEmail, json, nowIso, parisToday, readBody, validEmail, withUser } from "../../_lib/api.js";
import { hashPassword, randomBytes } from "../../_lib/crypto.js";

const MAX_DAYS = 365;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** A password easy to read out and type: 4 groups of 4 letters and digits, no 0/O, 1/l/I. */
function newPassword() {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = randomBytes(16);
  return [...b].map((x, i) => A[x % A.length] + ((i % 4 === 3 && i < 15) ? "-" : "")).join("");
}
const shape = (u) => ({ id: u.id, email: u.email, label: u.display_name, until: u.demo_until, created: u.created_at,
  lastLogin: u.last_login, status: u.status, lang: u.lang });

export const onRequestGet = withUser(async ({ env }) => {
  const { results } = await env.DB.prepare("SELECT * FROM users WHERE demo_until IS NOT NULL ORDER BY created_at DESC").all();
  return json({ accounts: results.map(shape), today: parisToday() });
}, { admin: true });

export const onRequestPost = withUser(async ({ request, env }) => {
  const b = await readBody(request);
  if (!b) return json({ error: "bad request" }, 400);
  const days = Math.round(Number(b.days));
  if (b.id != null) {
    const u = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND demo_until IS NOT NULL").bind(Number(b.id)).first();
    if (!u) return json({ error: "not found" }, 404);
    if (b.action === "extend") {
      if (!(days >= 1 && days <= MAX_DAYS)) return json({ error: "bad request" }, 400);
      const from = u.demo_until > parisToday() ? u.demo_until : parisToday();
      await env.DB.prepare("UPDATE users SET demo_until = ?, status = 'active' WHERE id = ?").bind(addDays(from, days), u.id).run();
      return json({ ok: true });
    }
    if (b.action === "password") {
      const password = newPassword(), pw = await hashPassword(password, env);
      await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, u.id).run();
      return json({ password });
    }
    return json({ error: "bad request" }, 400);
  }
  const label = String(b.label || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!label || !(days >= 1 && days <= MAX_DAYS)) return json({ error: "bad request" }, 400);
  // the sign-in name: the one given, else made from the label on a domain that receives nothing (RFC 2606 .invalid)
  const slug = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "demo";
  const email = b.email ? cleanEmail(b.email) : `demo-${slug}@ocn.invalid`;
  if (!validEmail(email)) return json({ error: "email" }, 400);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return json({ error: "exists" }, 409);
  const password = newPassword(), pw = await hashPassword(password, env), now = nowIso();
  const lang = b.lang === "en" ? "en" : "fr";
  // no licence, no alert of any kind (nothing is ever sent to a demo account)
  await env.DB.prepare(`INSERT INTO users (email, pw_hash, pw_salt, pw_iter, first_name, last_name, licence, display_name, email_verified,
      status, notify, consent_at, created_at, lang, demo_until, push_starts, push_results)
    VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 'active', 0, ?, ?, ?, ?, 0, 0)`)
    .bind(email, pw.hash, pw.salt, pw.iter, label, "", label, now, now, lang, addDays(parisToday(), days)).run();
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json({ account: shape(u), password });
}, { admin: true });

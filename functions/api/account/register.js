// POST /api/account/register { email, password, first, last, licence, consent, website }
//
// Accepts the registration only if (first name, last name, licence) matches a licensee in
// the FFCO index (the same check as the historic login) and the visitor declares being one.
// The account then waits for the e-mail confirmation; it cannot log in before.

import { allow, cleanEmail, cleanLicence, checkLicensee, clientIp, json, nowIso, pause, readBody, validEmail } from "../../_lib/api.js";
import { hashPassword, newToken, sha256hex } from "../../_lib/crypto.js";
import { sendOrQueue } from "../../_lib/mail.js";
import { verifyMail } from "../../_lib/templates.js";

const DAY = 86400e3;

/**
 * A fresh e-mail confirmation link for `user`; returns "sent" | "queued". The link is valid for 24 h from the
 * moment the e-mail is sent (the mailer resets the expiry then), and replaces an older one still waiting.
 */
export async function sendVerification(env, user) {
  const token = newToken(), hash = await sha256hex(token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'verify'").bind(user.id),
    env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ? AND kind = 'verify'").bind(user.email),
    env.DB.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, 'verify', ?)")
      .bind(hash, user.id, Date.now() + DAY),
  ]);
  return sendOrQueue(env, { to: user.email, ...verifyMail(env, token, user.first_name), kind: "verify", priority: 1,
    token: { hash, ttl: DAY } });
}

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.DB) return json({ error: "server not configured" }, 500);
  if (env.REGISTRATION_OPEN !== "1") return json({ error: "closed" }, 503);
  const b = await readBody(request);
  if (!b) return json({ error: "bad request" }, 400);
  if (b.website) return json({ ok: true });                              // honeypot: bots fill every field
  if (!(await allow(env, `reg:${clientIp(request)}`, 8, 3600))) return json({ error: "rate" }, 429);

  const email = cleanEmail(b.email);
  const first = String(b.first || "").trim().slice(0, 60), last = String(b.last || "").trim().slice(0, 60);
  const licence = cleanLicence(b.licence);
  const password = String(b.password || "");
  if (!validEmail(email)) return json({ error: "email" }, 422);
  if (password.length < 10 || password.length > 200 || password.toLowerCase() === email) return json({ error: "password" }, 422);
  if (!first || !last || !licence) return json({ error: "fields" }, 422);
  if (b.consent !== true) return json({ error: "consent" }, 422);

  const display = await checkLicensee(env, request, first, last, licence);
  if (!display) { await pause(600); return json({ error: "mismatch" }, 422); }

  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (existing?.email_verified) return json({ error: "email_taken" }, 409);
  if (existing) {                                                         // never confirmed: just resend the link
    if (await allow(env, `resend:${email}`, 3, 3600)) await sendVerification(env, existing);
    return json({ ok: true });
  }
  const pw = await hashPassword(password, env);
  const row = await env.DB.prepare(
    `INSERT INTO users (email, pw_hash, pw_salt, pw_iter, first_name, last_name, licence, display_name, consent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).bind(email, pw.hash, pw.salt, pw.iter, first, last, licence, display, nowIso(), nowIso()).first();
  const mail = await sendVerification(env, row);
  return json({ ok: true, mail });
}

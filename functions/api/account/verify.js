// POST /api/account/verify { token } — confirms the e-mail address and activates the account.
// If other confirmed accounts claim the same licence, the administrator is alerted; the administrators who
// keep the new-account alert on (admin page) get an e-mail for each new account.

import { adminEmails, json, readBody } from "../../_lib/api.js";
import { sha256hex } from "../../_lib/crypto.js";
import { sendOrQueue } from "../../_lib/mail.js";
import { duplicateAlert, newUserMail } from "../../_lib/templates.js";

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  if (!b?.token) return json({ error: "bad request" }, 400);
  const hash = await sha256hex(String(b.token));
  const t = await env.DB.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'verify'").bind(hash).first();
  if (!t || t.used || t.expires_at < Date.now()) return json({ error: "invalid" }, 410);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(t.user_id).first();
  if (!user) return json({ error: "invalid" }, 410);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(user.id),
    env.DB.prepare("UPDATE tokens SET used = 1 WHERE token_hash = ?").bind(hash),
  ]);
  const { results } = await env.DB.prepare("SELECT * FROM users WHERE licence = ? AND email_verified = 1 ORDER BY id").bind(user.licence).all();
  if (results.length > 1 && env.ALERT_EMAIL) {
    await sendOrQueue(env, { to: env.ALERT_EMAIL, ...duplicateAlert(env, user.licence, results), kind: "alert", priority: 1 });
  }
  if (!user.email_verified) await signupAlert(env, user);              // a confirmed account is announced once
  return json({ ok: true });
}

/** An e-mail to each administrator who keeps the new-account alert on (their own choice, on the admin page). */
async function signupAlert(env, user) {
  const admins = adminEmails(env).filter((e) => e !== user.email);
  if (!admins.length) return;
  const { results: to } = await env.DB.prepare(
    `SELECT email FROM users WHERE email_verified = 1 AND status = 'active' AND signup_alert = 1
     AND email IN (${admins.map(() => "?").join(", ")})`).bind(...admins).all();
  if (!to.length) return;
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email_verified = 1").first();
  for (const a of to) await sendOrQueue(env, { to: a.email, ...newUserMail(env, user, total.n), kind: "alert", priority: 1 });
}

// POST /api/account/forgot { email } — mails a reset link (valid 1 h). Always answers ok.
import { allow, clientIp, cleanEmail, json, readBody } from "../../_lib/api.js";
import { newToken, sha256hex } from "../../_lib/crypto.js";
import { sendOrQueue } from "../../_lib/mail.js";
import { resetMail } from "../../_lib/templates.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "server not configured" }, 500);
  const b = await readBody(request);
  const email = cleanEmail(b?.email);
  if (email && (await allow(env, `forgot:${email}`, 3, 3600)) && (await allow(env, `forgotip:${clientIp(request)}`, 10, 3600))) {
    const u = await env.DB.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").bind(email).first();
    if (u) {
      // the link is valid for 1 h from the moment the e-mail is SENT (the mailer resets the expiry then, so a
      // message that had to wait for the quota is still good); a request replaces an older one still waiting
      const token = newToken(), hash = await sha256hex(token);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'reset'").bind(u.id),
        env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ? AND kind = 'reset'").bind(u.email),
        env.DB.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, 'reset', ?)")
          .bind(hash, u.id, Date.now() + 3600e3),
      ]);
      await sendOrQueue(env, { to: u.email, ...resetMail(env, token), kind: "reset", priority: 1, token: { hash, ttl: 3600e3 } });
    }
  }
  return json({ ok: true });
}

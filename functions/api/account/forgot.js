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
      const token = newToken();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'reset'").bind(u.id),
        env.DB.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, 'reset', ?)")
          .bind(await sha256hex(token), u.id, Date.now() + 3600e3),
      ]);
      await sendOrQueue(env, { to: u.email, ...resetMail(env, token), kind: "reset", priority: 1 });
    }
  }
  return json({ ok: true });
}

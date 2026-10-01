// POST /api/account/verify { token } — confirms the e-mail address and activates the account.
// If other confirmed accounts claim the same licence, the administrator is alerted.

import { json, readBody } from "../../_lib/api.js";
import { sha256hex } from "../../_lib/crypto.js";
import { sendOrQueue } from "../../_lib/mail.js";
import { duplicateAlert } from "../../_lib/templates.js";

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
  return json({ ok: true });
}

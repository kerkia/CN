// POST /api/account/reset { token, password } — sets a new password. Reading the mail proves
// ownership of the address, so it also confirms it.
import { json, readBody } from "../../_lib/api.js";
import { hashPassword, sha256hex } from "../../_lib/crypto.js";

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  const password = String(b?.password || "");
  if (!b?.token) return json({ error: "bad request" }, 400);
  if (password.length < 6 || password.length > 200) return json({ error: "password" }, 422);
  const hash = await sha256hex(String(b.token));
  const t = await env.DB.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'reset'").bind(hash).first();
  if (!t || t.used || t.expires_at < Date.now()) return json({ error: "invalid" }, 410);
  const pw = await hashPassword(password, env);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, email_verified = 1 WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, t.user_id),
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'reset'").bind(t.user_id),
  ]);
  return json({ ok: true });
}

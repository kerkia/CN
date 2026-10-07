// POST /api/account/delete { password } — erases the account and everything tied to it (GDPR).
import { allow, clearCookie, json, readBody, withUser } from "../../_lib/api.js";
import { checkPassword } from "../../_lib/crypto.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (!(await allow(env, `pwchange:${user.id}`, 8, 600))) return json({ error: "rate" }, 429);
  if (!(await checkPassword(String(b?.password || ""), user, env))) return json({ error: "invalid" }, 401);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notified WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
});

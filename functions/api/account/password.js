// POST /api/account/password { old, password } — change the password while logged in.
import { allow, json, readBody, withUser } from "../../_lib/api.js";
import { checkPassword, hashPassword } from "../../_lib/crypto.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  const next = String(b?.password || "");
  if (next.length < 10 || next.length > 200) return json({ error: "password" }, 422);
  if (!(await allow(env, `pwchange:${user.id}`, 8, 600))) return json({ error: "rate" }, 429);
  if (!(await checkPassword(String(b?.old || ""), user, env))) return json({ error: "invalid" }, 401);
  const pw = await hashPassword(next, env);
  await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, user.id).run();
  return json({ ok: true });
});

// POST /api/account/login { email, password } -> the user and a session cookie.

import { allow, cleanEmail, clientIp, json, nowIso, pause, publicUser, readBody, sessionCookie } from "../../_lib/api.js";
import { checkPassword, defaultIterations, hashPassword } from "../../_lib/crypto.js";

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET || !env.DB) return json({ error: "server not configured" }, 500);
  const b = await readBody(request);
  const email = cleanEmail(b?.email), password = String(b?.password || "");
  if (!email || !password || password.length > 200) return json({ error: "bad request" }, 400);
  if (!(await allow(env, `login:${clientIp(request)}`, 30, 600)) || !(await allow(env, `loginmail:${email}`, 8, 600))) {
    return json({ error: "rate" }, 429);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  // an unknown e-mail costs as much as a wrong password: no way to tell them apart
  const ok = user ? await checkPassword(password, user, env)
    : (await hashPassword(password, env), false);
  if (!ok) { await pause(500); return json({ error: "invalid" }, 401); }
  if (user.status !== "active") return json({ error: "disabled" }, 403);
  if (!user.email_verified) return json({ error: "unverified" }, 403);
  if (user.pw_iter !== defaultIterations(env)) {                         // the count was changed: upgrade the stored hash
    const pw = await hashPassword(password, env);
    await env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, user.id).run();
  }
  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(nowIso(), user.id).run();
  return json(publicUser(env, user), 200, { "Set-Cookie": await sessionCookie(env, user) });
}

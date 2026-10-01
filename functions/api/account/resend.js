// POST /api/account/resend { email } — a new confirmation link. Always answers ok (no account enumeration).
import { allow, clientIp, cleanEmail, json, readBody } from "../../_lib/api.js";
import { sendVerification } from "./register.js";

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  const email = cleanEmail(b?.email);
  if (email && (await allow(env, `resend:${email}`, 3, 3600)) && (await allow(env, `resendip:${clientIp(request)}`, 10, 3600))) {
    const u = await env.DB.prepare("SELECT * FROM users WHERE email = ? AND email_verified = 0").bind(email).first();
    if (u) await sendVerification(env, u);
  }
  return json({ ok: true });
}

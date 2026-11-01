// POST /api/guest { turnstile } -> { exp } and the guest pass's cookie (owner, 2026-11-01: « Entrer sans compte » opened the
// public data to any script, unlimited, on the Workers' daily quota shared by the whole account). A visit without an account
// passes Cloudflare Turnstile once (the browser's widget, invisible unless Cloudflare wants a click), and gets a signed cookie
// that the login gate asks for on every public read (_middleware.js `guestPass`): a scraper has to solve the challenge again
// every GUEST_HOURS. The cookie names nobody: { g: 1, exp }, signed with SESSION_SECRET|guest. Without Turnstile's keys the
// check is off: the pass is given, and the gate asks for none.
import { json, readBody, clientIp, allow } from "../_lib/api.js";
import { turnstileOk } from "../_lib/turnstile.js";
import { signSession, GUEST_COOKIE, GUEST_HOURS, guestSecret } from "../_middleware.js";

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET) return json({ error: "unavailable" }, 503);
  const ip = clientIp(request);
  // a few passes an hour from one address are plenty (a household, a club's wifi); more is a script
  if (env.DB && !(await allow(env, `guest:${ip}`, 60, 3600))) return json({ error: "too many" }, 429);
  const b = await readBody(request);
  if (!(await turnstileOk(env, b?.turnstile, ip))) return json({ error: "turnstile" }, 403);
  const exp = Date.now() + GUEST_HOURS * 3600e3;
  const token = await signSession({ g: 1, exp }, guestSecret(env));
  return json({ exp }, 200, {
    "Set-Cookie": `${GUEST_COOKIE}=${token}; Path=/; Max-Age=${GUEST_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`,
  });
}

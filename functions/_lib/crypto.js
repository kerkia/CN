// Password hashing and one-shot tokens (Web Crypto only, so it runs in Workers).
//
// Passwords are first run through HMAC-SHA256 keyed with a server-side pepper (the
// SESSION_SECRET), then PBKDF2-SHA256. The iteration count is deliberately modest
// (the free Workers plan allows ~10 ms of CPU per request); the pepper means a leaked
// database alone cannot be attacked offline. The count is stored per user so it can
// be raised later (and users are re-hashed at their next login).

const enc = new TextEncoder();

export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
/** A fresh unguessable token for an e-mail link. */
export const newToken = () => b64url(randomBytes(32));

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function derive(password, env, salt, iterations) {
  const hmac = await crypto.subtle.importKey("raw", enc.encode(`pw:${env.SESSION_SECRET}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const pre = await crypto.subtle.sign("HMAC", hmac, enc.encode(password));
  const key = await crypto.subtle.importKey("raw", pre, "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export const defaultIterations = (env) => Number(env.PBKDF2_ITER) || 15000;

/** { hash, salt, iter } ready to store. */
export async function hashPassword(password, env) {
  const salt = randomBytes(16);
  const iter = defaultIterations(env);
  return { hash: b64(await derive(password, env, salt, iter)), salt: b64(salt), iter };
}

/** Constant-time comparison against a stored { pw_hash, pw_salt, pw_iter }. */
export async function checkPassword(password, user, env) {
  const got = new Uint8Array(await derive(password, env, unb64(user.pw_salt), user.pw_iter));
  const want = unb64(user.pw_hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// Cloudflare Pages middleware: the login gate, enforced on the server.
//
// Public: the site's code (/, /assets/…), the headline statistics
// (/data/meta.json), the agenda of upcoming events (/data/agenda.json, all of it public
// on the FFCO site) and the login endpoints. Everything else needs the session
// cookie issued by /api/account/login; /auth (the licensee index the registration
// checks) is never served to anyone. It runs on every request (site/_routes.json) and
// judges the decoded path, so encoded spellings cannot slip past it.
//
// Needs one secret in the Pages project settings: SESSION_SECRET (any long
// random string). Changing it logs everyone out.

export const COOKIE = "cnx_session";
// Deny by default: only these (canonical) paths are served without a session.
// (/api/notify checks its own bearer secret; the /api/account and /api/admin endpoints check the session themselves)
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/assets\//, /^\/favicon\.[a-z]+$/, /^\/data\/meta\.json$/, /^\/data\/agenda\.json$/, /^\/api\/logout$/,
  /^\/api\/notify$/, /^\/api\/account\/(status|register|resend|verify|login|forgot|reset)$/];
const RECHECK_MS = 3600e3;       // how often a session is re-validated against the accounts database

/**
 * The path as the file server will resolve it: percent-decoding undone
 * ("/%61uth/…", "/data%2F…"), repeated slashes merged, case folded. Null for
 * anything with dot segments, backslashes or broken encoding — never served.
 */
function canonical(pathname) {
  let p = pathname;
  for (let i = 0; i < 4; i++) {
    let d;
    try { d = decodeURIComponent(p); } catch (e) { return null; }
    if (d === p) break;
    p = d;
  }
  if (/[\\\0]/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p) || p.includes("%")) return null;
  return p.replace(/\/{2,}/g, "/").toLowerCase();
}

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A signed token: base64url(JSON payload) + "." + base64url(HMAC). */
export async function signSession(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function readSession(request, secret) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m || !secret) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return p.exp > Date.now() ? p : null;
  } catch (e) {
    return null;
  }
}

/** Same rule as the browser (assets/js/auth.js) and the build (build_site.py). */
export function nameKey(name) {
  return (name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter(Boolean).sort().join(" ");
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const path = canonical(new URL(request.url).pathname);
  if (path === null) return new Response("Bad request", { status: 400 });
  if (path === "/auth" || path.startsWith("/auth/")) return new Response("Not found", { status: 404 });
  if (PUBLIC.some((re) => re.test(path))) return next();
  const s = await readSession(request, env.SESSION_SECRET);
  if (!s?.uid) {                      // only account sessions count (the name+licence login is gone)
    return new Response(JSON.stringify({ error: "login required" }), {
      status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  // Accounts (cookie carries a uid): at most once an hour, check the account still exists and
  // is not disabled, then re-sign the cookie.
  let refreshed = null;
  if (env.DB && Date.now() - (s.chk || 0) > RECHECK_MS) {
    const u = await env.DB.prepare("SELECT status, email_verified FROM users WHERE id = ?").bind(s.uid).first();
    if (!u || u.status !== "active" || !u.email_verified) {
      return new Response(JSON.stringify({ error: "login required" }), {
        status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
          "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    const token = await signSession({ ...s, chk: Date.now() }, env.SESSION_SECRET);
    refreshed = `${COOKIE}=${token}; Path=/; Max-Age=${Math.max(60, Math.floor((s.exp - Date.now()) / 1000))}; HttpOnly; Secure; SameSite=Lax`;
  }
  const res = await next();
  // private data must not sit in shared caches
  const out = new Response(res.body, res);
  // (the API endpoints set their own no-store: a cached /api/account/me showed stale settings)
  if (!path.startsWith("/api/")) out.headers.set("Cache-Control", "private, max-age=300");
  if (refreshed) out.headers.append("Set-Cookie", refreshed);
  return out;
}

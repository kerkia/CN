// Cloudflare Pages middleware: the login gate, enforced on the server.
//
// Public: the site's code (/, /assets/…), the headline statistics
// (/data/meta.json) and the login endpoints. Everything else needs the session
// cookie issued by /api/account/login; /auth (the licensee index the registration
// checks) is never served to anyone. It runs on every request (site/_routes.json) and
// judges the decoded path, so encoded spellings cannot slip past it.
//
// Needs one secret in the Pages project settings: SESSION_SECRET (any long
// random string). Changing it logs everyone out.

export const COOKIE = "cnx_session";
// Deny by default: only these (canonical) paths are served without a session.
// (/api/notify checks its own bearer secret; the /api/account and /api/admin endpoints check the session themselves)
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/robots\.txt$/, /^\/assets\//, /^\/favicon\.[a-z]+$/, /^\/data\/meta\.json$/, /^\/api\/logout$/,
  /^\/sw(-push)?\.js$/, /^\/manifest(\.en)?\.webmanifest$/, /^\/offline(\.html)?$/,
  /^\/api\/notify$/, /^\/api\/account\/(status|register|resend|verify|login|forgot|reset|handoff)$/];
const RECHECK_MS = 3600e3;       // how often a session is re-validated against the accounts database
// A demo account (admin page, « Démo »; 2026-10-18) only reads: any other method is refused, but for these
const DEMO_WRITES = [/^\/api\/track$/, /^\/api\/ask$/];
const parisToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
// What a session may read by its countries (`cc`, the accepted memberships; owner, 2026-10-20). Everything under /data/ is
// France's data — its licensees' names, results and CNs — except these, open to every account: the headline figures, the
// list of competitions and the agenda (public on FFCO's site), the study's aggregates (the Documentation), and the
// provisional results' copy without CN, scores or licences (prov/pub/). Deny by default: a new file is France's until listed.
const DATA_FOR_ALL = [/^\/data\/(meta|competitions|agenda|evaluation|validation)\.json$/, /^\/data\/prov\/pub\//];
// the endpoints that serve France's data: FFCO's own pages, « IA » (it queries the French tables), the relay's added runners
const FR_API = [/^\/api\/ffco-(cn|history)$/, /^\/api\/ask$/, /^\/api\/account\/relay$/];
/** Does a path need France? */
export const needsFrance = (path) => (path.startsWith("/data/") && !DATA_FOR_ALL.some((re) => re.test(path)))
  || FR_API.some((re) => re.test(path));

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
  return m ? readToken(m[1], secret) : null;
}

/** A token signed by signSession, checked and not expired -> its payload, or null. */
export async function readToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split(".");
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

/** The site's former addresses (wrangler.toml OLD_HOSTS), which send their visitors on to SITE_URL. */
export const oldHosts = (env) => String(env.OLD_HOSTS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);

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
  if (s.demo && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !DEMO_WRITES.some((re) => re.test(path))) {
    return new Response(JSON.stringify({ error: "demo" }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  // Accounts (cookie carries a uid): at most once an hour, check the account still exists and
  // is not disabled (nor a demo account past its day), then re-sign the cookie with its countries of now (`cc`, the
  // accepted memberships of user_countries; a demo account sees France; migration 0014 not applied: none read).
  // (a cookie of before the countries carries no `cc`: checked now)
  let refreshed = null, cc = Array.isArray(s.cc) ? s.cc : null;
  if (env.DB && (!cc || Date.now() - (s.chk || 0) > RECHECK_MS)) {
    const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(s.uid).first();
    if (!u || u.status !== "active" || !u.email_verified || (u.demo_until && u.demo_until < parisToday())) {
      return new Response(JSON.stringify({ error: "login required" }), {
        status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
          "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    cc = cc || (u.licence ? ["FR"] : []);
    try {
      const { results } = await env.DB.prepare("SELECT country FROM user_countries WHERE user_id = ? AND status = 'ok' ORDER BY added_at, rowid")
        .bind(s.uid).all();
      cc = u.demo_until ? ["FR"] : (results || []).map((r) => r.country);
    } catch (e) { /* no table yet: the cookie's own */ }
    const token = await signSession({ ...s, lic: u.licence, cc, chk: Date.now() }, env.SESSION_SECRET);
    refreshed = `${COOKIE}=${token}; Path=/; Max-Age=${Math.max(60, Math.floor((s.exp - Date.now()) / 1000))}; HttpOnly; Secure; SameSite=Lax`;
  }
  if (needsFrance(path) && !(cc || []).includes("FR")) {
    return new Response(JSON.stringify({ error: "country", need: "FR" }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(refreshed ? { "Set-Cookie": refreshed } : {}) },
    });
  }
  // the sites to follow up with (admin page, « Sites »): administrators only
  if (path === "/data/prov/blocked.json") {
    const u = env.DB && await env.DB.prepare("SELECT email, email_verified, status FROM users WHERE id = ?").bind(s.uid).first();
    const admins = String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (!u || u.status !== "active" || !u.email_verified || !admins.includes(u.email)) {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }
  const res = await next();
  // a WebSocket handshake (/ws/<race>, « En direct ») goes back as it is: a copy of the response would lose its socket
  if (res.status === 101 || res.webSocket) return res;
  // private data must not sit in shared caches
  const out = new Response(res.body, res);
  // (the API endpoints set their own no-store: a cached /api/account/me showed stale settings)
  if (!path.startsWith("/api/")) out.headers.set("Cache-Control", "private, max-age=300");
  if (refreshed) out.headers.append("Set-Cookie", refreshed);
  return out;
}

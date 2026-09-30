// POST /api/login  { name: "Prénom Nom", licence: "12345" }
// -> 200 { lic, nom } with a signed HttpOnly session cookie, or 401.
//
// The credentials index (/auth/{bucket}.json, written by build_site.py and
// never served publicly) maps each licence to the SHA-256 of its normalised
// name. Brute force is slowed by a fixed delay on failure; for more, add a
// Cloudflare rate-limiting rule on /api/login (one rule is free).

import { COOKIE, nameKey, sha256hex, signSession } from "../_middleware.js";

const DAYS = 30;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
});

export async function onRequestPost({ request, env }) {
  if (!env.SESSION_SECRET) return json({ error: "server not configured" }, 500);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "bad request" }, 400); }
  const lic = String(body.licence || "").replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
  const key = nameKey(body.name);
  if (!lic || !key || lic.length > 12) return json({ error: "bad request" }, 400);

  const bucket = /^\d+$/.test(lic) ? Math.floor(Number(lic) / 100) : 999999;
  const res = await env.ASSETS.fetch(new URL(`/auth/${bucket}.json`, request.url));
  const index = res.ok ? await res.json() : {};
  const entry = index[lic];                         // [sha256(nameKey), display name]
  if (!entry || entry[0] !== await sha256hex(key)) {
    await new Promise((r) => setTimeout(r, 800));   // make guessing slow
    return json({ error: "invalid" }, 401);
  }
  const token = await signSession({ lic, exp: Date.now() + DAYS * 86400e3 }, env.SESSION_SECRET);
  return json({ lic, nom: entry[1] }, 200, {
    "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  });
}

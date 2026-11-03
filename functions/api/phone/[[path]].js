// /api/phone — « Depuis mon téléphone » (owner, 2026-11-03): a computer shows a QR code, the phone that scans it sends a photo
// of the map or a trace file, and the computer takes it as a file dropped on the page. Nothing else goes through: the file
// waits in R2 (cn-state, binding BUCKET) under a one-time link and is deleted as soon as the computer has it, or with the link
// (LINK_MIN, then the next sweep). Two keys: the phone's (in the QR code: it may only send) and the computer's (returned to
// it alone: it may only read and delete). Neither names anyone; the phone needs no account.
//
//   POST   /api/phone                      { kind } -> { id, pk, dk, exp }   (a signed-in account, or a visitor with the guest pass)
//   GET    /api/phone/<id>                 X-Key: pk -> { kind, exp, n, alive }  (the phone: is the link alive? it is then « seen »)
//                                          X-Key: dk -> { exp, seen, files: [{ n, name, type, size }] }  (the computer, every few seconds)
//   PUT    /api/phone/<id>/file            X-Key: pk, X-Name (URI-encoded), the file as the body -> { n }
//   GET    /api/phone/<id>/file/<n>        X-Key: dk -> the file, deleted at once
//   DELETE /api/phone/<id>                 X-Key: dk -> the link and what it still holds
//
// Public in the login gate (_middleware.js PUBLIC): the keys are the permission; the link's creation checks the session or
// the guest pass itself.

import { allow, clientIp, currentUser, json, readBody } from "../../_lib/api.js";
import { randomBytes } from "../../_lib/crypto.js";
import { guestPass } from "../../_middleware.js";

const LINK_MIN = 15;                            // the link's life, minutes
const MAX_FILE = 60 * 1024 * 1024;              // a phone's photo is 2-15 MB; a map file at most what the analyses take
const MAX_FILES = 8;
const KINDS = ["map", "trace", "any"];
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
const newId = (n) => Array.from(randomBytes(n), (b) => ALPHA[b % 32]).join("");
const ID = /^[a-z2-9]{12}$/;
const metaKey = (id) => `phone/${id}.json`;
const fileKey = (id, n) => `phone/${id}/${n}`;
const noStore = { "Cache-Control": "no-store" };

async function readMeta(env, id) {
  const o = await env.BUCKET.get(metaKey(id));
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch (e) { return null; }
}
/** Equal keys, compared in constant time. */
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function dropLink(env, id, meta) {
  const keys = [metaKey(id), ...(meta?.files || []).map((f) => fileKey(id, f.n))];
  await env.BUCKET.delete(keys);
}
/** The links an hour past their end, and their files, deleted (a computer closed before it took them). */
async function sweep(env) {
  const old = Date.now() - (LINK_MIN + 60) * 60e3;
  const list = await env.BUCKET.list({ prefix: "phone/", limit: 500 });
  const gone = list.objects.filter((o) => o.uploaded.getTime() < old).map((o) => o.key);
  if (gone.length) await env.BUCKET.delete(gone);
}

export async function onRequest({ request, env, params }) {
  if (!env.BUCKET) return json({ error: "unavailable" }, 503);
  const parts = [].concat(params.path || []);
  const method = request.method;
  const key = request.headers.get("X-Key") || "";

  // a new link: an account, or a visitor holding the guest pass; a few a day
  if (!parts.length) {
    if (method !== "POST") return json({ error: "method" }, 405);
    const user = env.DB ? await currentUser(request, env) : null;
    if (!user && !(await guestPass(request, env))) return json({ error: "login required" }, 401);
    if (env.DB && !(await allow(env, `phone:${user ? `u${user.id}` : clientIp(request)}`, 40, 86400))) return json({ error: "too many" }, 429);
    const b = (await readBody(request)) || {};
    const id = newId(12), pk = newId(16), dk = newId(20), exp = Date.now() + LINK_MIN * 60e3;
    await env.BUCKET.put(metaKey(id), JSON.stringify({ kind: KINDS.includes(b.kind) ? b.kind : "any", pk, dk, exp, files: [] }),
      { httpMetadata: { contentType: "application/json" } });
    try { await sweep(env); } catch (e) { /* the next one */ }
    return json({ id, pk, dk, exp }, 200, noStore);
  }

  const id = parts[0];
  if (!ID.test(id)) return json({ error: "not found" }, 404);
  const meta = await readMeta(env, id);
  if (!meta) return json({ error: "gone" }, 410);
  const phone = same(key, meta.pk), desk = same(key, meta.dk);
  if (!phone && !desk) return json({ error: "forbidden" }, 403);
  const alive = meta.exp > Date.now();

  if (parts.length === 1) {
    if (method === "GET") {
      if (phone) {
        // the computer then says the phone is there (only the phone writes the link's record)
        if (!meta.seen && alive) { meta.seen = Date.now(); await env.BUCKET.put(metaKey(id), JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } }); }
        return json({ kind: meta.kind, exp: meta.exp, n: meta.files.length, alive }, 200, noStore);
      }
      return json({ exp: meta.exp, seen: !!meta.seen, files: meta.files.map(({ n, name, type, size }) => ({ n, name, type, size })) }, 200, noStore);
    }
    if (method === "DELETE" && desk) { await dropLink(env, id, meta); return json({ ok: true }, 200, noStore); }
    return json({ error: "method" }, 405);
  }

  if (parts[1] !== "file") return json({ error: "not found" }, 404);
  // the phone sends a file (one after the other: only the phone writes the link's record)
  if (parts.length === 2 && method === "PUT" && phone) {
    if (!alive) return json({ error: "expired" }, 410);
    if (meta.files.length >= MAX_FILES) return json({ error: "too many" }, 429);
    const size = Number(request.headers.get("Content-Length") || 0);
    if (!size) return json({ error: "empty" }, 400);
    if (size > MAX_FILE) return json({ error: "too large" }, 413);
    let name = "";
    try { name = decodeURIComponent(request.headers.get("X-Name") || ""); } catch (e) { /* none */ }
    name = name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").trim().slice(0, 120) || "photo.jpg";
    const type = String(request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim().slice(0, 100);
    const n = meta.files.reduce((m, f) => Math.max(m, f.n), 0) + 1;
    await env.BUCKET.put(fileKey(id, n), request.body, { httpMetadata: { contentType: "application/octet-stream" } });
    meta.files.push({ n, name, type, size, at: Date.now() });
    await env.BUCKET.put(metaKey(id), JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
    return json({ n }, 200, noStore);
  }
  // the computer takes a file: served once, then deleted
  if (parts.length === 3 && method === "GET" && desk) {
    const n = Number(parts[2]);
    const f = meta.files.find((x) => x.n === n);
    const o = f && await env.BUCKET.get(fileKey(id, n));
    if (!o) return json({ error: "gone" }, 410);
    const body = await o.arrayBuffer();
    await env.BUCKET.delete(fileKey(id, n));
    return new Response(body, { headers: { ...noStore, "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  }
  return json({ error: "method" }, 405);
}

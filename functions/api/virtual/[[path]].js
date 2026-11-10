// /api/virtual/<race>/<file> — « Virtually »'s race packages (games/virtually.js), administrators only for now (owner, 2026-11-10).
// A package is made offline from an OCAD map, the worldwide relief and a national LiDAR where there is one (the build scripts
// are kept outside the site) and put in R2 (cn-state) under virtual/<race>/: race.json, h.png, cls.png, veg.png, ground.jpg,
// feats.json, trees.bin (when LiDAR), map.ocd. The maps are their clubs': never served to anyone but an administrator.
import { json, withUser } from "../../_lib/api.js";

const FILE = /^([a-z0-9-]{1,40})\/(race\.json|h\.png|cls\.png|veg\.png|ground\.jpg|feats\.json|trees\.bin|map\.ocd)$/;
const TYPES = { json: "application/json", png: "image/png", jpg: "image/jpeg", bin: "application/octet-stream", ocd: "application/octet-stream" };

export const onRequestGet = withUser(async ({ request, env, params }) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const path = [].concat(params.path || []).join("/");
  const m = FILE.exec(path);
  if (!m) return json({ error: "bad request" }, 400);
  const etag = request.headers.get("If-None-Match");
  const o = await env.BUCKET.get(`virtual/${path}`, etag ? { onlyIf: { etagDoesNotMatch: etag.replace(/"/g, "") } } : undefined);
  if (!o) return json({ error: "not found" }, 404);
  const headers = { "Content-Type": TYPES[path.split(".").pop()], "Cache-Control": "private, max-age=3600", ETag: `"${o.etag}"` };
  if (!("body" in o) || !o.body) return new Response(null, { status: 304, headers });
  return new Response(o.body, { headers });
}, { admin: true });

// /api/lidarmap — generated orienteering maps (a prototype, 2026-11-01; administrators only): 1 km tiles of a map made
// from IGN's LiDAR HD by karttapullautin, with OpenStreetMap's roads, paths, buildings and water over it, and the
// ground's heights every 2 m. They are made by the GitHub workflow lidarmap.yml (mapgen/run.py), kept in R2 (cn-state):
//   lidarmap/t/<id>.png       the map, 2362 px a side, 0.42333 m a pixel, from the tile's north-west corner
//   lidarmap/t/<id>.dem.png   heights, Terrarium-encoded, 500 × 500 nodes every 2 m from that corner
//   lidarmap/t/<id>.json      { id, x0, y1, px, size, dem, lidar, osm, made } — or { none: true }: no LiDAR there yet
//   lidarmap/req/<id>.json    a request: { id, tiles, by, at, status: queued | done | failed, result }
// A tile's id is IGN's: its west and north edges in Lambert 93 kilometres ("0391_6819").
//   POST { tiles: [ids] }     the tiles' state; the missing ones are asked of the workflow → { req?, tiles: { id: state } }
//   GET ?req=<id>             a request's state (the page asks every ~15 s while it waits)
//   GET /t/<file>             a tile's file
// Nothing of the trace is sent: the page asks for the tiles its trace's area touches.
import { allow, json, nowIso, readBody, withUser } from "../../_lib/api.js";

const T = "lidarmap/t/", Q = "lidarmap/req/";
const ID = /^(\d{4})_(\d{4})$/;
const FILE = /^(\d{4}_\d{4})(\.dem\.png|\.png|\.json)$/;
const MAX_TILES = 12;
// metropolitan France and Corsica in Lambert 93 (km): IGN's LiDAR HD covers nothing else
const inFrance = (id) => { const m = ID.exec(id); return !!m && +m[1] >= 50 && +m[1] <= 1250 && +m[2] >= 6040 && +m[2] <= 7120; };

/** A tile's state: "ready", "none" (no LiDAR there yet) or "missing". */
async function tileState(env, id) {
  const o = await env.BUCKET.get(`${T}${id}.json`);
  if (!o) return "missing";
  const m = await o.json().catch(() => ({}));
  return m.none ? "none" : "ready";
}

/** The workflow started (GitHub workflow_dispatch); false without the token. */
async function startMaps(env) {
  if (!env.GH_DISPATCH_TOKEN) return false;
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO || "kerkia/CN"}/actions/workflows/lidarmap.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ozimut-lidarmap", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  return r.status === 204;
}

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!env.BUCKET) return json({ error: "server not configured" }, 500);
  const body = await readBody(request);
  const ids = [...new Set(Array.isArray(body?.tiles) ? body.tiles.map(String) : [])];
  if (!ids.length || ids.length > MAX_TILES || !ids.every(inFrance)) return json({ error: "bad tiles", max: MAX_TILES }, 400);
  const tiles = {};
  for (const id of ids) tiles[id] = await tileState(env, id);
  const missing = ids.filter((id) => tiles[id] === "missing");
  if (!missing.length) return json({ tiles });
  if (!(await allow(env, `lidarmap:${user.id}`, 20, 86400))) return json({ error: "too many requests" }, 429);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await env.BUCKET.put(`${Q}${id}.json`, JSON.stringify({ id, tiles: missing, by: user.id, at: nowIso(), status: "queued" }),
    { httpMetadata: { contentType: "application/json" } });
  for (const t of missing) tiles[t] = "queued";
  return json({ req: id, tiles, started: await startMaps(env) });
}, { admin: true });

export const onRequestGet = withUser(async ({ request, env, params }) => {
  if (!env.BUCKET) return json({ error: "server not configured" }, 500);
  const path = [].concat(params.path || []);
  if (path[0] === "t" && path.length === 2) {
    if (!FILE.test(path[1])) return json({ error: "not found" }, 404);
    const o = await env.BUCKET.get(T + path[1]);
    if (!o) return json({ error: "not found" }, 404);
    return new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || (path[1].endsWith(".json") ? "application/json" : "image/png"),
      "Cache-Control": path[1].endsWith(".json") ? "private, no-cache" : "private, max-age=604800" } });
  }
  const req = new URL(request.url).searchParams.get("req") || "";
  if (!/^[a-z0-9]{6,20}$/.test(req)) return json({ error: "bad request" }, 400);
  const o = await env.BUCKET.get(`${Q}${req}.json`);
  if (!o) return json({ error: "not found" }, 404);
  const r = await o.json();
  return json({ req: r.id, status: r.status, at: r.at, done: r.done || null, result: r.result || null });
}, { admin: true });

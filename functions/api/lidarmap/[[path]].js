// /api/lidarmap — generated orienteering maps (a prototype, 2026-11-01; every account since 2026-11-07 with Cartographier, the
// administrators 20 requests a day, the others 5): 1 km tiles of a map made
// from IGN's LiDAR HD by karttapullautin, with OpenStreetMap's roads, paths, buildings and water over it, and the
// ground's heights every 2 m. They are made by the GitHub workflow lidarmap.yml (mapgen/run.py), kept in R2 (cn-state):
//   lidarmap/t/<id>.png       the map, 2362 px a side, 0.42333 m a pixel, from the tile's north-west corner, in a forest
//                             map's symbols (ISOM); <id>.s.png the same in a sprint map's (ISSprOM)
//   lidarmap/t/<id>.dem.png   heights, Terrarium-encoded, 500 × 500 nodes every 2 m from that corner
//   lidarmap/t/<id>.json      { id, x0, y1, px, size, dem, styles, v: { style: version }, lidar, osm, made } — or
//                             { none: true }: no LiDAR there yet
//   lidarmap/req/<id>.json    a request: { id, tiles, style, by, at, status: queued | done | failed, result, progress: { stage:
//                             lidar | kp | osm | draw, frac, at } while the workflow makes it }
// Each style has its own karttapullautin render (the sprint one 2.5 m contours drawn at 1:4000), made only when asked.
// A tile's id is IGN's in France: its west and north edges in Lambert 93 kilometres ("0391_6819"). Beyond France (2026-11-06,
// mapgen/grids.py) it names its country and grid, by its west and south edges in km: "ch_2583_1219" (Switzerland, LV95),
// "nz_1571_5172" (New Zealand, NZTM2000), "us_13_0475_4427" / "ca_18_0433_5038" (the United States, Canada: UTM zone, WGS 84).
//   POST { tiles: [ids], style }   the tiles' state in that style ("forest" or "sprint"; a tile made in an older version
//                             of the style, STYLE_V, is made again); the missing ones are asked of the workflow
//                             → { req?, tiles: { id: state } }
//   GET ?req=<id>             a request's state (the page asks every ~15 s while it waits)
//   GET /t/<file>             a tile's file
// Nothing of the trace is sent: the page asks for the tiles its trace's area touches.
import { allow, isAdmin, json, nowIso, readBody, withUser } from "../../_lib/api.js";

const T = "lidarmap/t/", Q = "lidarmap/req/";
// the tile ids (mapgen/grids.py ID; keep the two in step)
const ID = /^(?:(\d{4})_(\d{4})|(ch|nz)_(\d{4})_(\d{4})|(us|ca)_(\d{1,2})_(\d{4})_(\d{4}))$/;
// a tile's files; the vectors and vegetation for Cartographier (2026-11-06)
const FILE = /^((?:\d{4}_\d{4}|(?:ch|nz)_\d{4}_\d{4}|(?:us|ca)_\d{1,2}_\d{4}_\d{4}))(\.dem\.png|\.s\.png|\.png|\.json|\.(?:forest|sprint)\.(?:vec\.json|vege\.png))$/;
const STYLES = ["forest", "sprint"];
// a style's version, as mapgen/run.py's STYLE_V (sprint 2: its own render, 2.5 m contours at 1:4000)
const STYLE_V = { forest: 1, sprint: 2 };
const MAX_TILES = 12;
// where each grid's numbers may lie (km; mapgen/grids.py RANGE, ZONES): France's metropolitan France and Corsica in Lambert 93
// (IGN's LiDAR HD covers nothing else), the others their countries
const RANGE = { fr: [[50, 1250], [6040, 7120]], ch: [[2480, 2840], [1070, 1300]], nz: [[1000, 2130], [4700, 6250]],
  us: [[100, 900], [1500, 7900]], ca: [[100, 900], [4500, 9400]] };
const ZONES = { us: [1, 20], ca: [7, 22] };
const inRange = ([lo, hi], v) => v >= lo && v <= hi;
/** A tile id the workflow can make: well formed, its numbers in its country's range (a UTM zone written without a leading 0). */
const validTile = (id) => {
  const m = ID.exec(id);
  if (!m) return false;
  if (m[1]) return inRange(RANGE.fr[0], +m[1]) && inRange(RANGE.fr[1], +m[2]);
  if (m[3]) return inRange(RANGE[m[3]][0], +m[4]) && inRange(RANGE[m[3]][1], +m[5]);
  return String(+m[7]) === m[7] && inRange(ZONES[m[6]], +m[7]) && inRange(RANGE[m[6]][0], +m[8]) && inRange(RANGE[m[6]][1], +m[9]);
};

/** The requests still queued before one (ids begin with their time in base 36, so they sort by time; only those of the last
 *  six hours are read: an older one still queued has been given up). */
async function aheadOf(env, id) {
  const t = parseInt(id.slice(0, 8), 36), since = (t - 6 * 3600e3).toString(36);
  let n = 0, cursor;
  do {
    const page = await env.BUCKET.list({ prefix: Q, startAfter: `${Q}${since}`, cursor, limit: 100 });
    for (const o of page.objects) {
      const k = o.key.slice(Q.length, -5);
      if (k >= id) continue;
      const v = await env.BUCKET.get(o.key).then((x) => x?.json()).catch(() => null);
      if (v?.status === "queued") n++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

/** A tile's state in a style: "ready", "none" (no LiDAR there yet) or "missing". */
async function tileState(env, id, style) {
  const o = await env.BUCKET.get(`${T}${id}.json`);
  if (!o) return "missing";
  const m = await o.json().catch(() => ({}));
  if (m.none) return "none";
  const v = m.v ? m.v[style] || 0 : (m.styles || ["forest"]).includes(style) ? 1 : 0;   // a record of before: version 1
  return v >= STYLE_V[style] ? "ready" : "missing";
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
  const style = STYLES.includes(body?.style) ? body.style : "forest";
  if (!ids.length || ids.length > MAX_TILES || !ids.every(validTile)) return json({ error: "bad tiles", max: MAX_TILES }, 400);
  const tiles = {};
  for (const id of ids) tiles[id] = await tileState(env, id, style);
  const missing = ids.filter((id) => tiles[id] === "missing");
  if (!missing.length) return json({ tiles });
  if (!(await allow(env, `lidarmap:${user.id}`, isAdmin(env, user) ? 20 : 5, 86400))) return json({ error: "too many requests" }, 429);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await env.BUCKET.put(`${Q}${id}.json`, JSON.stringify({ id, tiles: missing, style, by: user.id, at: nowIso(), status: "queued" }),
    { httpMetadata: { contentType: "application/json" } });
  for (const t of missing) tiles[t] = "queued";
  return json({ req: id, tiles, started: await startMaps(env) });
});

export const onRequestGet = withUser(async ({ request, env, params }) => {
  if (!env.BUCKET) return json({ error: "server not configured" }, 500);
  const path = [].concat(params.path || []);
  if (path[0] === "t" && path.length === 2) {
    if (!FILE.test(path[1])) return json({ error: "not found" }, 404);
    const o = await env.BUCKET.get(T + path[1]);
    if (!o) return json({ error: "not found" }, 404);
    return new Response(o.body, { headers: { "Content-Length": String(o.size), "Content-Type": o.httpMetadata?.contentType || (path[1].endsWith(".json") ? "application/json" : "image/png"),
      "Cache-Control": path[1].endsWith(".json") && !path[1].endsWith(".vec.json") ? "private, no-cache" : "private, max-age=604800" } });
  }
  const req = new URL(request.url).searchParams.get("req") || "";
  if (!/^[a-z0-9]{6,20}$/.test(req)) return json({ error: "bad request" }, 400);
  const o = await env.BUCKET.get(`${Q}${req}.json`);
  if (!o) return json({ error: "not found" }, 404);
  const r = await o.json();
  // progress: the workflow's stage and share done while it makes the tiles (mapgen/run.py Progress: stage, frac, country,
  // tiles, done / total, s, part), else null; ahead: while it waits unstarted, the requests still queued before it
  const waiting = r.status === "queued" && !r.progress;
  return json({ req: r.id, status: r.status, at: r.at, done: r.done || null, result: r.result || null, progress: r.status === "queued" ? r.progress || null : null,
    ahead: waiting ? await aheadOf(env, r.id) : 0 });
});

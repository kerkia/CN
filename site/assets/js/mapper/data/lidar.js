// IGN's LiDAR HD through karttapullautin as map objects (Cartographier): the generated maps' tiles (mapgen/run.py, made on
// GitHub by lidarmap.yml, kept in R2, read through /api/lidarmap; trace/lidarmap.js asks for them and waits) carry, beside
// their images, karttapullautin's own vectors in Lambert 93 (t/<id>.<style>.vec.json, mapgen/dxf.py): contours, index
// contours, form lines, cliffs, dot knolls and small depressions. They become objects — 101.0 contour, 102.0 index contour,
// 103.0 form line, 201.0 impassable cliff (karttapullautin's « cliff3 »), 202.0 cliff (« cliff2 »), 109.0 small knoll,
// 111.0 small depression — tagged { src: "lidar", srcId: "<tile>:<layer>", draft: true }; the contours cut at the tiles'
// edges joined again, the cliffs' short strokes gathered into lines. The vegetation stays a raster: a background per tile
// (its image's address and its world file in Lambert 93, its corners in map mm).

import { areaOfPoints, ask, waitFor, MAX_TILES, CREDIT_LIDAR, CREDITS, gridOfName } from "../../trace/lidarmap.js";
import { ocad, simplify, clipLine } from "./frame.js";

export { CREDIT_LIDAR };
const API = "/api/lidarmap";
const PX = 0.4233333333333334, SIZE = 2362;
/** karttapullautin's line layers → symbols (null: left out). */
export const LINE_SYM = { contour: 101000, contour_index: 102000, formline: 103000, small_depression: 101000, depression_intermed: 103000,
  cliff2: 202000, cliff3: 201000 };
/** Its point layers → symbols (the « ugly » ones are those karttapullautin leaves off its image for legibility). */
export const POINT_SYM = { dotknoll: 109000, uglydotknoll: 109000, udepression: 111000, uglyudepression: 111000 };
const CLIFFS = new Set(["cliff2", "cliff3"]);

/** The 1 km tiles a rectangle of the map ([x0, y0, x1, y1] mm) touches: { box, ids, km2 } (trace/lidarmap.js). */
export const tilesOf = (frame, rect) => areaOfPoints(frame.areaLatLon(rect).pts, 0, "auto");
/** A tile's grid from its id (France's 0450_6800, ch_2583_1219, us_13_0475_4427…: trace/lidarmap.js). */
export const gridOfTile = (id) => gridOfName(`ozimut-lidar-${id}`);
/** Its metres → the map's mm: straight when the map is in the tile's grid, else through lat/lon. */
export function toMm(frame, grid) {
  if (frame.epsg && frame.epsg === grid.epsg) return (X, Y) => frame.fromReal(X, Y);
  if (grid.epsg === 2154) return (X, Y) => frame.fromL93mm(X, Y);
  return (X, Y) => frame.fromLatLon(...grid.inv(X, Y));
}

/**
 * The tiles made in a style, asking for the missing ones and waiting for the workflow (trace/lidarmap.js make's way, without
 * putting an image together). say(key, vars, frac) as make's (keys an.gen.*); stop() true gives up. Resolves
 * { ready: [ids], none: [ids], failed: [ids] } or null when stopped.
 */
export async function ensureTiles(ids, style, say = () => {}, stop = () => false, share = 1) {
  say("an.gen.asking", {}, null);
  const r = await ask(ids, style);
  const w = await waitFor(r, { ...r.tiles }, say, stop, share);
  if (!w) return null;
  const tiles = w.tiles;
  const of = (s) => ids.filter((id) => tiles[id] === s);
  return { ready: of("ready"), none: of("none"), failed: ids.filter((id) => !["ready", "none"].includes(tiles[id])) };
}

async function getJson(url, f) {
  const r = await f(url, { credentials: "same-origin" });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
/** A JSON file read with its bytes counted as they come (onBytes(n) for each piece; a fetch without a body stream: at the end). */
async function getJsonCounted(url, f, onBytes) {
  const r = await f(url, { credentials: "same-origin" });
  if (!r.ok) return null;
  if (!r.body?.getReader) { const txt = await r.text(); onBytes(txt.length); return JSON.parse(txt); }
  const rd = r.body.getReader(), parts = [];
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); onBytes(value.length); }
  try { return JSON.parse(await new Blob(parts).text()); } catch (e) { return null; }
}
/**
 * Each tile's record and vectors in a style: [{ id, record, vec | null }] (vec null: a tile made before the vectors).
 * onProgress(done, total, bytes): the tiles read and the bytes received (a tile's vectors weigh up to tens of MB abroad).
 */
export async function fetchTiles(ids, style, f = fetch, onProgress = () => {}) {
  let done = 0, bytes = 0;
  onProgress(0, ids.length, 0);
  return Promise.all(ids.map(async (id) => {
    const record = await getJson(`${API}/t/${id}.json`, f);
    const vec = record?.vec?.[style] ? await getJsonCounted(`${API}/t/${id}.${style}.vec.json`, f, (n) => { bytes += n; onProgress(done, ids.length, bytes); }) : null;
    onProgress(++done, ids.length, bytes);
    return { id, record, vec };
  }));
}

/** A tile's vectors decoded: { lines: [{ layer, z, pts: [[X, Y]…] }], points: [{ layer, X, Y }] } in its grid's metres. */
export function decode(vec) {
  const { x0, y0, q } = vec, lines = [], points = [];
  for (const [layer, list] of Object.entries(vec.lines || {})) {
    for (const l of list) {
      const z = l[0] == null ? null : l[0] * q, pts = [];
      let x = l[1], y = l[2];
      pts.push([x0 + x * q, y0 + y * q]);
      for (let i = 3; i + 1 < l.length; i += 2) { x += l[i]; y += l[i + 1]; pts.push([x0 + x * q, y0 + y * q]); }
      lines.push({ layer, z, pts, tile: vec.id });
    }
  }
  for (const [layer, flat] of Object.entries(vec.points || {})) {
    let x = 0, y = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; points.push({ layer, X: x0 + x * q, Y: y0 + y * q, tile: vec.id }); }
  }
  return { lines, points };
}

const same = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
/** Lines of one layer and height whose ends meet (within tol m: the tiles' edges) joined into one. */
export function joinLines(lines, tol = 0.6) {
  const groups = new Map();
  for (const l of lines) { const k = `${l.layer}|${l.z}`; (groups.get(k) || groups.set(k, []).get(k)).push({ ...l, pts: l.pts.slice() }); }
  const out = [];
  for (const g of groups.values()) {
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < g.length && !merged; i++) {
        const a = g[i];
        if (same(a.pts[0], a.pts[a.pts.length - 1], 1e-6)) continue;            // a loop
        for (let j = 0; j < g.length; j++) {
          if (j === i) continue;
          const b = g[j], a0 = a.pts[0], a1 = a.pts[a.pts.length - 1], b0 = b.pts[0], b1 = b.pts[b.pts.length - 1];
          if (same(b0, b1, 1e-6)) continue;
          let pts = null;
          if (same(a1, b0, tol)) pts = a.pts.concat(b.pts.slice(1));
          else if (same(a1, b1, tol)) pts = a.pts.concat(b.pts.slice(0, -1).reverse());
          else if (same(a0, b1, tol)) pts = b.pts.concat(a.pts.slice(1));
          else if (same(a0, b0, tol)) pts = b.pts.slice().reverse().concat(a.pts.slice(1));
          if (!pts) continue;
          a.pts = pts;
          if (same(pts[0], pts[pts.length - 1], tol)) pts[pts.length - 1] = pts[0];
          g.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    out.push(...g);
  }
  return out;
}

/**
 * karttapullautin's cliffs are short strokes (2.9 m each, overlapping) at every steep spot: those of one cliff (a stroke's
 * end within `near` m of another's) gathered, ordered along the cliff (from one end, the nearest stroke next) and drawn as one
 * line through their middles, from the first stroke's outer end to the last's. A stroke alone stays as it is.
 */
export function cliffLines(strokes, near = 1.5) {
  const n = strokes.length, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cell = near, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  strokes.forEach((s, i) => { for (const p of [s[0], s[s.length - 1]]) { const k = key(...p); (grid.get(k) || grid.set(k, []).get(k)).push([i, p]); } });
  // each pair of ends once (the cell itself, then four of its eight neighbours), skipped when already joined
  const HALF = [[1, -1], [1, 0], [1, 1], [0, 1]], n2 = near * near;
  const meet = (i, p, j, q) => {
    if (i === j) return;
    const a = find(i), b = find(j);
    if (a !== b && (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= n2) parent[a] = b;
  };
  for (const [k, list] of grid) {
    const [cx, cy] = k.split(",").map(Number);
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) meet(list[u][0], list[u][1], list[v][0], list[v][1]);
    for (const [dx, dy] of HALF) {
      const other = grid.get(`${cx + dx},${cy + dy}`);
      if (other) for (const [i, p] of list) for (const [j, q] of other) meet(i, p, j, q);
    }
  }
  const comps = new Map();
  strokes.forEach((s, i) => { const r = find(i); (comps.get(r) || comps.set(r, []).get(r)).push(s); });
  const out = [];
  for (const segs of comps.values()) {
    if (segs.length === 1) { out.push(segs[0]); continue; }
    const mids = segs.map((s) => [(s[0][0] + s[s.length - 1][0]) / 2, (s[0][1] + s[s.length - 1][1]) / 2]);
    // the cliff's main direction (the middles' principal axis), its first stroke the one furthest back along it
    const mx = mids.reduce((a, p) => a + p[0], 0) / mids.length, my = mids.reduce((a, p) => a + p[1], 0) / mids.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of mids) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    const proj = (p) => (p[0] - mx) * ux + (p[1] - my) * uy;
    // from the first stroke, each time the nearest stroke left within 3 × near (a grid of the middles); none: the line ends and
    // the next starts at the stroke left furthest back along the axis
    const R = 3 * near, cells = new Map(), ck = (x, y) => `${Math.floor(x / R)},${Math.floor(y / R)}`;
    mids.forEach((p, i) => { const k = ck(...p); (cells.get(k) || cells.set(k, []).get(k)).push(i); });
    const byAxis = mids.map((_, i) => i).sort((i, j) => proj(mids[i]) - proj(mids[j]));
    const done = new Uint8Array(mids.length), order = [];
    let next = 0, cur = byAxis[0];
    for (;;) {
      done[cur] = 1; order.push(cur);
      const [x, y] = mids[cur], cx = Math.floor(x / R), cy = Math.floor(y / R);
      let best = -1, bd = R;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of cells.get(`${cx + dx},${cy + dy}`) || []) {
        if (done[j]) continue;
        const d = Math.hypot(mids[j][0] - x, mids[j][1] - y);
        if (d <= bd) { bd = d; best = j; }
      }
      if (best < 0) {
        out.push(...pathOf(order, segs, mids)); order.length = 0;
        while (next < byAxis.length && done[byAxis[next]]) next++;
        if (next >= byAxis.length) break;
        best = byAxis[next];
      }
      cur = best;
    }
  }
  return out;
}
function pathOf(order, segs, mids) {
  if (order.length === 1) return [segs[order[0]]];
  const pts = order.map((i) => mids[i]);
  // the line runs on to the outer ends of its first and last strokes
  const outer = (s, from) => (Math.hypot(s[0][0] - from[0], s[0][1] - from[1]) > Math.hypot(s[1][0] - from[0], s[1][1] - from[1]) ? s[0] : s[s.length - 1]);
  pts.unshift(outer(segs[order[0]], pts[1]));
  pts.push(outer(segs[order[order.length - 1]], pts[pts.length - 2]));
  return [simplify(pts, 0.3)];
}

/** Cliff strokes thinned where karttapullautin drew them by the tens of thousands a cell (50 m): France's tiles hold at most
 *  ~1 000 a cell; abroad steep ground, walls and a lake's shore gave 30 000 and more (2026-11-06), which made the joining
 *  quadratic and no line clearer. In such a cell every k-th stroke is kept (k to bring it under max): the strokes are short
 *  ticks along the cliff, so the line through their middles stays. Returns { kept, dropped }. */
export function sparse(strokes, cell = 50, max = DENSE) {
  const n = new Map(), seen = new Map(), k = (s) => `${Math.floor(s[0][0] / cell)},${Math.floor(s[0][1] / cell)}`;
  for (const s of strokes) n.set(k(s), (n.get(k(s)) || 0) + 1);
  const kept = strokes.filter((s) => {
    const key = k(s), c = n.get(key);
    if (c <= max) return true;
    const i = seen.get(key) || 0; seen.set(key, i + 1);
    return i % Math.ceil(c / max) === 0;
  });
  return { kept, dropped: strokes.length - kept.length };
}
const DENSE = 1200;   // strokes a 50 m cell: above France's densest (1 039)

/**
 * The objects of the tiles' vectors in the map's mm (each tile placed by its own grid: toMm), clipped to rect when given. opts: tolerance (mm,
 * Douglas-Peucker, 0.05), ugly (keep the knolls and depressions karttapullautin leaves off its image; true).
 * Returns { objects, counts: { <sym>: n }, dense: the cliff strokes thinned out (sparse) }.
 */
export function vectorObjects(vecs, frame, rect = null, opts = {}) {
  const tol = opts.tolerance ?? 0.05, ugly = opts.ugly ?? true;
  // the tiles joined in their own grid's metres (France's Lambert 93, LV95, a UTM zone…), each grid's lines then put in map mm
  const byGrid = new Map();
  for (const v of vecs) {
    const g = gridOfTile(v.id || ""), k = `${g.country}:${g.zone ?? ""}`;
    if (!byGrid.has(k)) byGrid.set(k, { grid: g, vecs: [] });
    byGrid.get(k).vecs.push(v);
  }
  const all = [], points = [];
  let dense = 0;
  for (const { grid, vecs: list } of byGrid.values()) {
    const mm = toMm(frame, grid), lines = [], strokes = { cliff2: [], cliff3: [] }, here = [];
    for (const v of list) {
      const d = decode(v);
      for (const l of d.lines) (CLIFFS.has(l.layer) ? strokes[l.layer].push(l.pts) : lines.push(l));
      here.push(...d.points);
    }
    const joined = joinLines(lines);
    for (const [layer, raw] of Object.entries(strokes)) {
      const { kept, dropped } = sparse(raw);
      dense += dropped;
      for (const pts of cliffLines(kept)) joined.push({ layer, z: null, pts });
    }
    for (const l of joined) all.push({ ...l, pts: l.pts.map(([X, Y]) => mm(X, Y)) });
    for (const p of here) { [p.x, p.y] = mm(p.X, p.Y); points.push(p); }
  }
  const objects = [], counts = {};
  const add = (o) => { objects.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  for (const l of all) {
    const sym = LINE_SYM[l.layer];
    if (!sym) continue;
    const mm = simplify(l.pts, tol);
    for (const piece of rect ? clipLine(mm, rect) : [mm]) {
      if (piece.length >= 2) add({ sym, otp: 2, ang: 0, coords: piece.map(([x, y]) => ocad(x, y)), src: "lidar", srcId: `lidar:${l.layer}`, draft: true });
    }
  }
  for (const p of points) {
    const sym = POINT_SYM[p.layer];
    if (!sym || (!ugly && p.layer.startsWith("ugly"))) continue;
    const { x, y } = p;
    if (rect && (x < rect[0] || x > rect[2] || y < rect[1] || y > rect[3])) continue;
    add({ sym, otp: 1, ang: 0, coords: [ocad(x, y)], src: "lidar", srcId: `${p.tile}:${p.layer}`, draft: true });
  }
  return { objects, counts, dense };
}

/**
 * The tiles' rasters as backgrounds: the vegetation image when the tile has it (1 m a pixel), else the generated map's own
 * image (0.42 m a pixel). Each { id, kind: "image", name, url, crs (the tile's grid, "EPSG:2154" in France), worldFile: [A, D, B, E, C, F] (the first
 * pixel's centre), w, h, cornersMm: [[x, y] × 4] (top-left, top-right, bottom-right, bottom-left) }.
 */
export function backgrounds(tiles, style, frame) {
  return tiles.filter((t) => t.record && !t.record.none).map(({ id, record }) => {
    const vege = !!record.vec?.[style], x0 = record.x0, y1 = record.y1;
    const px = vege ? 1 : PX, n = vege ? 1000 : SIZE;
    const url = vege ? `${API}/t/${id}.${style}.vege.png` : `${API}/t/${id}${style === "sprint" ? ".s.png" : ".png"}`;
    const ground = [[x0, y1], [x0 + n * px, y1], [x0 + n * px, y1 - n * px], [x0, y1 - n * px]];
    const grid = gridOfTile(id), mm = toMm(frame, grid);
    return { id, kind: "image", name: `LiDAR ${id}`, url, vege, crs: `EPSG:${record.crs || grid.epsg}`, w: n, h: n,
      worldFile: [px, 0, 0, -px, x0 + px / 2, y1 - px / 2], cornersMm: ground.map(([X, Y]) => mm(X, Y)) };
  });
}

/**
 * LiDAR objects and backgrounds for a rectangle of the map (map mm) in a style ("forest" | "sprint"): the tiles asked for
 * (at most MAX_TILES), waited for, read. Resolves { objects, counts, backgrounds, tiles: { ready, none, failed, noVectors },
 * credit } or null when stopped. Throws Error("tooLarge") past MAX_TILES tiles, Error("nogeo") without a georeference.
 */
export async function loadLidar(frame, rect, style = "forest", { say, stop, fetch: f = fetch, progress = () => {} } = {}) {
  if (!frame.geo) throw new Error("nogeo");
  const area = tilesOf(frame, rect);
  if (area.ids.length > MAX_TILES) throw new Error("tooLarge");
  // the bar: the workflow 80 %, the tiles' files 15 %, reading their vectors the rest (progress(key, vars, frac))
  const st = await ensureTiles(area.ids, style, say, stop, 0.8);
  if (!st) return null;
  const tiles = await fetchTiles(st.ready, style, f, (done, total, bytes) =>
    progress("map.data.lidar.fetching", { done, total, mb: (bytes / 1048576).toFixed(1) }, 0.8 + 0.15 * (total ? done / total : 1)));
  const vecs = tiles.filter((t) => t.vec).map((t) => t.vec);
  progress("map.data.lidar.reading", { total: vecs.length }, 0.95);
  await new Promise((res) => setTimeout(res, 30));          // the toast drawn before the vectors are read (a few seconds abroad)
  const r = vectorObjects(vecs, frame, rect);
  return { ...r, backgrounds: backgrounds(tiles, style, frame), credit: CREDITS[area.country] || CREDIT_LIDAR,
    tiles: { ...st, noVectors: tiles.filter((t) => !t.vec).map((t) => t.id) } };
}

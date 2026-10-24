// OCAD and OpenOrienteering Mapper maps for the route choices (administrators, a prototype; 2026-10-24): the map's own
// symbols, read by the Tracer's vector engine (tracer/vmap/, a port of Purple Pen's), say exactly what the terrain is where the
// colours of an image only suggest it — a dashed path is one line, a fence is not a path, a contour is nothing.
//
// The symbols are drawn into the layers trace/routechoice.js's cells read (`layers`), on the pixels of the map shown:
// - areas by their fill colour (or, with none, their hatching's or pattern's): the yellows, greens, blue (water, shallow water),
//   brown (paved), grey and black (buildings; light grey passable), olive or purple (out of bounds) — the colour, not the symbol
//   number, since ISOM 2000, ISOM 2017 and ISSprOM number them differently; drawn colour by colour from the bottom of the map's
//   colour table, so that a green over a yellow wins as on the map;
// - lines by their symbol number: roads, tracks and paths (501-508) are paths, solid even when the map dashes them; impassable
//   cliffs, walls and fences (201, 515, 518, and ISOM 2000's 521 and 524 when they are lines) block; passable walls, fences and
//   cliffs, vegetation boundaries are handrails; blue lines are streams.
// Contours, points, text and the course are not drawn. A map that is not the one shown is placed through both georeferences.

import { A, INK, kindOf } from "./routechoice.js";

export const isVectorName = (name) => /\.(ocd|omap|xmap)$/i.test(name || "");
export const VECTOR_ACCEPT = ".ocd,.omap,.xmap";

const PATHS = new Set([501, 502, 503, 504, 505, 506, 507, 508]);
const BLOCKS = new Set([201, 515, 518, 521, 524]);
const HANDRAILS = new Set([202, 416, 415, 513, 514, 516, 517, 519, 520, 522, 523]);

/**
 * Read a vector map: { map (VMap), format, version, scale, ox, oy, w, h (the frame in mm, as the Tracer opens it), geo (the
 * affine (lon, lat) → frame mm, or null), geoName }.
 */
export async function readVector(bytes, name = "") {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ocad = u8.length > 4 && u8[0] === 0xad && u8[1] === 0x0c;
  const mod = ocad ? await import("../tracer/vmap/ocad.js") : await import("../tracer/vmap/oom.js");
  const { map, version } = ocad ? mod.readOcad(u8) : mod.readOom(u8);
  const b = map.bounds(), M = 2;                       // the frame of tracer/mapsrc.js openVector: 2 mm around what is drawn
  const ox = Math.floor(b[0] - M), oy = Math.floor(b[1] - M), w = Math.max(10, Math.ceil(b[2] + M - ox)), h = Math.max(10, Math.ceil(b[3] + M - oy));
  let geo = null, geoName = "";
  try { const { geoFromVector } = await import("../tracer/vmap/georef.js"); const g = await geoFromVector(map, { ox, oy, w, h }); if (g) { geo = g.geo; geoName = g.name; } }
  catch (e) { console.warn(e); }
  return { map, format: ocad ? "ocad" : "oom", version, scale: map.scale, ox, oy, w, h, geo, geoName, name };
}

/** The map drawn as an image (the map shown when no image of it is given): { image (canvas), k (px per mm) }. */
export async function renderVector(bytes, name) {
  const { openMap } = await import("../tracer/mapsrc.js");
  const src = await openMap(bytes, "", name);
  return { image: src.image, k: src.pxW / src.w };
}

/** The frame's mm to [lat, lon] (the georeference's inverse), or null without one. */
export function latLonOf(v) {
  const g = v.geo;
  if (!g) return null;
  const det = g.a * g.e - g.b * g.d;
  return (x, y) => { const u = x - g.c, w = y - g.f; return [(g.a * w - g.d * u) / det, (g.e * u - g.b * w) / det]; };
}
/** The affine from the file's mm to the pixels of the image rendered at k px per mm (renderVector's). */
export const ownImage = (v, k) => ({ a: k, b: 0, c: -v.ox * k, d: 0, e: -k, f: (v.oy + v.h) * k });
/**
 * The affine from the file's mm to the pixels of another image of the map, through the vector map's georeference and the
 * image's toPx(lat, lon); null when the vector map has none.
 */
export function throughGeo(v, toPx) {
  const ll = latLonOf(v);
  if (!ll) return null;
  const src = [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h], [v.w / 2, v.h / 2]], dst = src.map(([x, y]) => toPx(...ll(x, y)));
  // least squares: px = a X + b Y + c, py = d X + e Y + f, X, Y the file's mm
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  src.forEach(([x, y], i) => { const r = [x + v.ox, y + v.oy, 1]; for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) S[p][q] += r[p] * r[q]; bx[p] += r[p] * dst[i][0]; by[p] += r[p] * dst[i][1]; } });
  const X = solve3(S, bx), Y = solve3(S, by);
  return X && Y ? { a: X[0], b: X[1], c: X[2], d: Y[0], e: Y[1], f: Y[2] } : null;
}
/** The share of a W × H image the vector map covers once placed by T (its frame's corners' box): under a fifth, it is another
 *  map, or a georeference gone wrong. */
export function cover(v, T, W, H) {
  const P = [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]].map(([x, y]) => [T.a * (x + v.ox) + T.b * (y + v.oy) + T.c, T.d * (x + v.ox) + T.e * (y + v.oy) + T.f]);
  const x0 = Math.max(0, Math.min(...P.map((p) => p[0]))), x1 = Math.min(W, Math.max(...P.map((p) => p[0])));
  const y0 = Math.max(0, Math.min(...P.map((p) => p[1]))), y1 = Math.min(H, Math.max(...P.map((p) => p[1])));
  return x1 > x0 && y1 > y0 ? ((x1 - x0) * (y1 - y0)) / (W * H) : 0;
}
function solve3(M, v) {
  const m = M.map((r, i) => [...r, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// ---- the symbols' meaning ----------------------------------------------------------------------------------------------------
const rgbOf = (c) => { const [C, M, Y, K] = c.cmyk || [0, 0, 0, 0]; return [255 * Math.max(0, 1 - C - K), 255 * Math.max(0, 1 - M - K), 255 * Math.max(0, 1 - Y - K)]; };
/** An area colour's class, or null (no meaning for the route). */
function colourClass(c) {
  if (!c?.cmyk) return null;
  const v = kindOf(...rgbOf(c)), [C, , , K] = c.cmyk;
  if (v < 20) return v;
  if (v === INK.BLUE) return C >= 0.65 ? A.WATER : A.SHALLOW;
  if (v === INK.BROWN) return A.PAVED;
  if (v === INK.GREY) return K >= 0.45 ? A.BUILDING : A.PAVED;     // a canopy, bare rock: passable
  if (v === INK.BLACK) return A.BUILDING;
  if (v === INK.OLIVE || v === INK.PURPLE) return A.OOB;
  return null;
}
/** An area symbol's class: its fill's, else its hatching's (blue: marsh, green: slow running, purple: out of bounds) or its
 *  pattern's (green or black dots: slow running). */
function areaClass(def, map) {
  if (def.partsDefs) { for (const p of def.partsDefs) if (p.kind === "area") { const c = areaClass(p, map); if (c != null) return c; } return null; }
  if (def.fill) return colourClass(def.fill);
  const hc = def.hatches?.[0]?.color || (def.patterns?.length ? map.colors.find((c) => def.patterns[0].glyph.hasColor?.(c)) : null);
  if (!hc?.cmyk) return null;
  const v = kindOf(...rgbOf(hc));
  if (v === INK.BLUE) return A.MARSH;
  if (v === INK.PURPLE || v === INK.OLIVE) return A.OOB;
  if (v === A.G1 || v === A.G2 || v === A.G3 || v === INK.BLACK || v === INK.GREY) return A.G1;
  return null;
}
/** The colour an area is drawn in, for its place among the map's colours (bottom to top). */
function areaColour(def, map) {
  if (def.partsDefs) { for (const p of def.partsDefs) if (p.kind === "area") { const c = areaColour(p, map); if (c) return c; } return null; }
  return def.fill || def.hatches?.[0]?.color || (def.patterns?.length ? map.colors.find((c) => def.patterns[0].glyph.hasColor?.(c)) : null) || null;
}
const lineColours = (def) => (def.partsDefs ? def.partsDefs.flatMap(lineColours) : [def.color, def.double?.fill, def.double?.left, def.second?.color].filter(Boolean));
/** A line symbol's role: "path", "block", "hand", "blue" or null. */
function lineRole(def) {
  const n = Math.floor(parseFloat(def.id));
  if (PATHS.has(n)) return "path";
  if (BLOCKS.has(n)) return "block";
  if (lineColours(def).some((c) => c.cmyk && kindOf(...rgbOf(c)) === INK.BLUE)) return "blue";
  if (HANDRAILS.has(n)) return "hand";
  return null;
}

// ---- drawing the layers ------------------------------------------------------------------------------------------------------
function path2d(cmds) {
  const p = new Path2D();
  for (const c of cmds) {
    if (c[0] === "M") p.moveTo(c[1], c[2]);
    else if (c[0] === "L") p.lineTo(c[1], c[2]);
    else if (c[0] === "C") p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === "Z") p.closePath();
  }
  return p;
}

/**
 * The layers of trace/routechoice.js on a W × H grid: T the affine from the file's mm to the grid's pixels. Returns { area,
 * path, blue, block, hand } (Uint8Array, one per pixel), and counts of what was drawn.
 */
export function layers(v, T, W, H) {
  const t0 = Date.now(), N = W * H, map = v.map;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = cv.getContext("2d", { willReadFrequently: true });
  const pxPerMm = Math.sqrt(Math.abs(T.a * T.e - T.b * T.d));
  const begin = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(T.a, T.d, T.b, T.e, T.c, T.f); g.fillStyle = "#000"; g.strokeStyle = "#000"; };
  const read = (into, value) => { const d = g.getImageData(0, 0, W, H).data; let n = 0; for (let i = 0; i < N; i++) if (d[4 * i + 3] > 110) { into[i] = value; n++; } return n; };
  const area = new Uint8Array(N), path = new Uint8Array(N), blue = new Uint8Array(N), block = new Uint8Array(N), hand = new Uint8Array(N);
  // the areas, colour by colour from the bottom of the colour table
  const z = new Map(map.colors.map((c, i) => [c, i]));
  const groups = new Map();
  const counts = { areas: 0, paths: 0, blocks: 0, hands: 0, streams: 0 };
  for (const d of map.symdefs) {
    if (!d.visible) continue;
    const isArea = d.kind === "area", isLine = d.kind === "line";
    if (!isArea && !isLine) continue;
    for (const s of d.symbols) {
      if (s.visible === false) continue;
      if (isArea && s.area) {
        const cls = areaClass(d, map), col = areaColour(d, map);
        if (cls == null || !col) continue;
        const key = `${z.get(col) ?? -1}|${cls}`;
        if (!groups.has(key)) groups.set(key, { z: z.get(col) ?? -1, cls, list: [] });
        groups.get(key).list.push(s.area);
        counts.areas++;
      } else if (isLine && s.path) {
        const role = lineRole(d);
        if (!role) continue;
        const key = `line|${role}`;
        if (!groups.has(key)) groups.set(key, { role, list: [] });
        groups.get(key).list.push({ path: s.path, width: Math.max(d.maxThick || d.width || 0.25, 0.1) });
        counts[{ path: "paths", block: "blocks", hand: "hands", blue: "streams" }[role]]++;
      }
    }
  }
  for (const grp of [...groups.values()].filter((x) => x.cls != null).sort((a, b) => a.z - b.z)) {
    begin();
    for (const ar of grp.list) g.fill(path2d(ar.commands()), "evenodd");
    read(area, grp.cls);
  }
  // the lines, each at least one and a half pixels wide
  const minMm = 1.5 / pxPerMm;
  for (const [role, into] of [["path", path], ["block", block], ["hand", hand], ["blue", blue]]) {
    const grp = groups.get(`line|${role}`);
    if (!grp) continue;
    begin(); g.lineCap = "round"; g.lineJoin = "round";
    for (const l of grp.list) { g.lineWidth = Math.max(l.width, minMm); g.stroke(path2d(l.path.commands())); }
    read(into, 1);
  }
  return { area, path, blue, block, hand, counts, ms: Date.now() - t0 };
}

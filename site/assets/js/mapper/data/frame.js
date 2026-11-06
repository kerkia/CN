// The map's frame for open data (Cartographier): map millimetres (OCAD's, y up, from the map's origin) to the map's grid —
// OCAD's real-world coordinates: the paper's mm × scale / 1000 × the grid's scale factor, turned by the grid's angle, moved
// to the grid's coordinates of the origin, as tracer/vmap/georef.js reads an OCAD map (Purple Pen's convention) — and the
// grid to latitude and longitude by proj4js (vendored). The grid comes from the document's EPSG code, OCAD's grid-and-zone
// id (Purple Pen's table) or a PROJ.4 text, all in /assets/tracer/crs.json. Without proj4js, Lambert 93 (France's case) is
// computed here both ways.

import { projector, guessCrs, LAMBERT93 } from "../../trace/georef.js";
import { PROJ4 } from "../../vendor.js";

/** An OCAD coordinate pair from map mm: { x, y }, hundredths of a mm shifted by 8 bits, the low byte the point's flags. */
export const ocad = (xmm, ymm, fx = 0, fy = 0) => ({ x: (Math.round(xmm * 100) << 8) | fx, y: (Math.round(ymm * 100) << 8) | fy });
export const mmX = (c) => (c.x >> 8) / 100;
export const mmY = (c) => (c.y >> 8) / 100;
/** OCAD's flags: y 2 the first point of a hole. */
export const HOLE = 2;

// ---- the grid's definition --------------------------------------------------------------------------------------------
let tableP = null, projP = null;
/** The CRS table (OCAD's grid ids and EPSG codes → proj4 texts). */
export const crsTable = () => (tableP ||= fetch("/assets/tracer/crs.json").then((r) => (r.ok ? r.json() : { ocad: {}, epsg: {} }))
  .catch(() => { tableP = null; return { ocad: {}, epsg: {} }; }));
/** proj4js, loaded once (a classic script setting window.proj4). */
export const proj4lib = () => (projP ||= new Promise((res, rej) => {
  if (globalThis.proj4) { res(globalThis.proj4); return; }
  if (typeof document === "undefined") { projP = null; rej(new Error("proj4")); return; }
  const s = document.createElement("script"); s.src = PROJ4; s.onload = () => res(window.proj4); s.onerror = () => { projP = null; rej(new Error("proj4")); };
  document.head.appendChild(s);
}));

const isL93 = (s) => /\+proj=lcc/.test(s) && /lat_0=46\.5\b/.test(s) && /lon_0=3\b/.test(s) && /x_0=700000\b/.test(s) && /y_0=6600000\b/.test(s);
export const L93_DEF = "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m";

/** The grid of the document's realWorld as { def (proj4 text), name, epsg }, or null when it names none. */
export function gridDef(rw, table) {
  if (!rw) return null;
  let s = rw.proj4 || "", name = "", epsg = rw.epsg || null;
  const init = /\+init=epsg:(\d+)/i.exec(s);
  if (init) { s = table.epsg?.[init[1]] || ""; epsg = +init[1]; }
  if (!s && rw.epsg) { s = table.epsg?.[String(rw.epsg)] || (rw.epsg === 2154 ? L93_DEF : ""); name = `EPSG:${rw.epsg}`; }
  if (!s && rw.zone) { s = table.ocad?.[String(rw.zone)] || ""; name = `OCAD ${rw.zone}`; }
  if (!s) return null;
  if (isL93(s)) { name = "Lambert 93"; epsg = 2154; }
  else if (!name) name = /\+proj=utm/.test(s) ? `UTM ${/\+zone=(\d+)/.exec(s)?.[1] || ""}` : "PROJ";
  return { def: s, name, epsg };
}

// ---- Lambert 93 forward (trace/georef.js's projector inverts it) ---------------------------------------------------------
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), E = Math.sqrt(E2), rad = (d) => (d * Math.PI) / 180;
const mOf = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const tOf = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2);
const LN = Math.log(mOf(rad(44)) / mOf(rad(49))) / Math.log(tOf(rad(44)) / tOf(rad(49)));
const LF = mOf(rad(44)) / (LN * Math.pow(tOf(rad(44)), LN)), RHO0 = A * LF * Math.pow(tOf(rad(46.5)), LN);
/** [lat, lon] → [X, Y] in Lambert 93. */
export function toL93(lat, lon) {
  const rho = A * LF * Math.pow(tOf(rad(lat)), LN), th = LN * rad(lon - 3);
  return [700000 + rho * Math.sin(th), 6600000 + RHO0 - rho * Math.cos(th)];
}
/** [X, Y] in Lambert 93 → [lat, lon]. */
export const fromL93 = projector(LAMBERT93);

/**
 * The frame of a document, given its grid (gridDef) and proj4js (or none: Lambert 93 alone, computed here). Returns
 * { scale, name, epsg, geo, toReal, fromReal, toLatLon, fromLatLon, fromL93mm, areaLatLon }:
 *   toReal(x, y) → [X, Y] in the grid; fromReal(X, Y) → [x, y] in map mm;
 *   toLatLon(x, y) → [lat, lon]; fromLatLon(lat, lon) → [x, y]   (geo false: they throw);
 *   fromL93mm(X, Y) → [x, y] from Lambert 93 metres (LiDAR tiles), straight when the grid is Lambert 93;
 *   areaLatLon([x0, y0, x1, y1]) → { s, w, n, e, pts } the rectangle's extent in degrees (its corners and sides sampled).
 */
export function makeFrame(doc, grid, p4 = null) {
  const rw = doc.realWorld || {}, scale = doc.scale || 10000;
  const k = (scale / 1000) * (rw.gridScale || 1), a = (-(rw.angle || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const ox = rw.x || 0, oy = rw.y || 0;
  const toReal = (x, y) => { const X = x * k, Y = y * k; return [X * ca - Y * sa + ox, X * sa + Y * ca + oy]; };
  const fromReal = (X, Y) => { const dx = X - ox, dy = Y - oy; return [(dx * ca + dy * sa) / k, (-dx * sa + dy * ca) / k]; };
  let toLL = null, fromLL = null, name = grid?.name || "", epsg = grid?.epsg || null;
  const l93 = grid ? isL93(grid.def) : false;
  if (grid && p4 && !l93) {
    try { const f = p4(grid.def, "WGS84"); toLL = (X, Y) => { const [lon, lat] = f.forward([X, Y]); return [lat, lon]; }; fromLL = (lat, lon) => f.inverse([lon, lat]); }
    catch (e) { toLL = null; }
  }
  if (!toLL && (l93 || (!grid && (ox || oy)))) {
    // Lambert 93 by name, or, without any grid named, numbers that can only be Lambert 93 (as vmap/georef.js decides)
    const c = l93 ? LAMBERT93 : guessCrs(...toReal(0, 0), 0);
    if (c === LAMBERT93) { toLL = fromL93; fromLL = toL93; name = "Lambert 93"; epsg = 2154; }
  }
  const geo = !!toLL;
  const toLatLon = (x, y) => { if (!geo) throw new Error("nogeo"); return toLL(...toReal(x, y)); };
  const fromLatLon = (lat, lon) => { if (!geo) throw new Error("nogeo"); return fromReal(...fromLL(lat, lon)); };
  const fromL93mm = epsg === 2154 ? (X, Y) => fromReal(X, Y) : (X, Y) => fromLatLon(...fromL93(X, Y));
  function areaLatLon([x0, y0, x1, y1]) {
    const pts = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (i % 4 === 0 || j % 4 === 0) pts.push(toLatLon(x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * j) / 4));
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    return { s: Math.min(...la), n: Math.max(...la), w: Math.min(...lo), e: Math.max(...lo), pts };
  }
  return { scale, name, epsg, geo, toReal, fromReal, toLatLon, fromLatLon, fromL93mm, areaLatLon };
}

/** The frame of a document, its grid looked up and proj4js loaded as needed (opts.table, opts.proj4: given in tests). */
export async function frameOf(doc, opts = {}) {
  const table = opts.table || (await crsTable());
  const grid = gridDef(doc.realWorld, table);
  let p4 = opts.proj4 || null;
  if (!p4 && grid && !isL93(grid.def)) p4 = await proj4lib().catch(() => null);
  return makeFrame(doc, grid, p4);
}

/** The extent of the document's objects in map mm [x0, y0, x1, y1], else its print area, else null. */
export function docExtent(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of doc.objects || []) for (const c of o.coords || []) {
    const x = mmX(c), y = mmY(c);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 > x0 && y1 > y0) return [x0, y0, x1, y1];
  const p = doc.printArea;
  return p && p[2] !== p[0] ? [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])] : null;
}

// ---- shared geometry for the data modules ----------------------------------------------------------------------------
/** Douglas-Peucker on [[x, y]…] with tolerance tol; a closed ring (first = last) keeps its closing point. */
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, bd = t2;
    for (let q = i + 1; q < j; q++) {
      const [px, py] = pts[q];
      let d;
      if (!L) d = (px - ax) ** 2 + (py - ay) ** 2;
      else { const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); d = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2; }
      if (d > bd) { bd = d; best = q; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out = pts.filter((_, q) => keep[q]);
  // a ring simplified to a segment: its farthest point back
  if (out.length < 4 && pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    const m = Math.floor(pts.length / 3);
    return [pts[0], pts[m], pts[2 * m], pts[0]];
  }
  return out;
}
/** A line's points [[x, y]…] (map mm) as OCAD coordinates. */
export const lineCoords = (pts) => pts.map(([x, y]) => ocad(x, y));
/** An area's rings (the first the outer one, the others holes) as OCAD coordinates, each ring closed. */
export function areaCoords(rings) {
  const out = [];
  rings.forEach((r, i) => {
    const q = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]];
    q.forEach(([x, y], k) => out.push(ocad(x, y, 0, i > 0 && k === 0 ? HOLE : 0)));
  });
  return out;
}
/** A line clipped to a rectangle [x0, y0, x1, y1]: the pieces inside (Liang-Barsky segment by segment). */
export function clipLine(pts, [x0, y0, x1, y1]) {
  const out = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
    const s = [ax + t0 * dx, ay + t0 * dy], e = [ax + t1 * dx, ay + t1 * dy];
    if (!cur || t0 > 0) { if (cur) out.push(cur); cur = [s]; }
    cur.push(e);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.length >= 2);
}
/** A ring clipped to a rectangle (Sutherland-Hodgman): the part inside, closed, or null. */
export function clipRing(ring, [x0, y0, x1, y1]) {
  let p = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  const edges = [[(q) => q[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(q) => q[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(q) => q[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(q) => q[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]]];
  for (const [inside, cut] of edges) {
    if (!p.length) return null;
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    p = out;
  }
  return p.length >= 3 ? [...p, p[0]] : null;
}
/** A ring's signed area (positive counter-clockwise, y up). */
export const ringArea = (r) => { let s = 0; for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return s / 2; };
/** Whether a point is inside a ring (even-odd). */
export function inRing([x, y], r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

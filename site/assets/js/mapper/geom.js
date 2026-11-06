// Cartographier's geometry on OCAD's records (docs/mapper/model.md): coordinates are OCAD's integers — x >> 8 and y >> 8 in
// hundredths of a millimetre, y up, the low byte the point's flags. Helpers to read and write them in mm, to walk a record's
// paths (Bézier controls included, holes apart), to flatten curves, and the distances, areas and simplifications the tools need.

export const F = {                       // flags (x low byte: bits 0-3; y low byte: bits 8-11 once packed by `flags`)
  CTRL1: 1, CTRL2: 2, NOLEFT: 4, NOMAIN: 8,               // on x
  CORNER: 0x100, HOLE: 0x200, NORIGHT: 0x400, DASH: 0x800, // on y (shifted by 8 here)
};
export const mmX = (c) => (c.x >> 8) / 100;
export const mmY = (c) => (c.y >> 8) / 100;
export const flags = (c) => (c.x & 0xff) | ((c.y & 0xff) << 8);
/** An OCAD coordinate from mm and packed flags. */
export const pt = (x, y, f = 0) => ({ x: (Math.round(x * 100) << 8) | (f & 0xff), y: (Math.round(y * 100) << 8) | ((f >> 8) & 0xff) });
export const isCtrl = (c) => (c.x & 3) !== 0;
export const isHole = (c) => (c.y & 2) !== 0;
export const withFlags = (c, f) => pt(mmX(c), mmY(c), f);
export const moved = (c, dx, dy) => ({ x: c.x + (Math.round(dx * 100) << 8), y: c.y + (Math.round(dy * 100) << 8) });

/** A record's rings or lines: [{ pts: [[x, y, flags]…], hole }], the main path first. */
export function partsOf(coords) {
  const out = [];
  let cur = null;
  for (const c of coords || []) {
    if (!cur || (isHole(c) && !isCtrl(c))) { cur = { pts: [], hole: !!out.length }; out.push(cur); }
    cur.pts.push([mmX(c), mmY(c), flags(c)]);
  }
  return out;
}
/** Back to OCAD's coordinates. */
export function coordsOf(parts) {
  const out = [];
  parts.forEach((p, i) => p.pts.forEach(([x, y, f], j) => out.push(pt(x, y, j === 0 && i > 0 ? (f | F.HOLE) : (j === 0 ? f & ~F.HOLE : f)))));
  return out;
}

/** A path (Bézier controls marked CTRL1/CTRL2) as a polyline, curves cut into steps of about `tol` mm. */
export function flatten(pts, tol = 0.05) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[2] & F.CTRL1 && i + 2 < pts.length && out.length) {
      const a = out[out.length - 1], c1 = p, c2 = pts[i + 1], b = pts[i + 2];
      const len = Math.hypot(c1[0] - a[0], c1[1] - a[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(b[0] - c2[0], b[1] - c2[1]);
      const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
          u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1], k === n ? b[2] : 0]);
      }
      i += 2;
    } else if (!(p[2] & (F.CTRL1 | F.CTRL2))) out.push([p[0], p[1], p[2]]);
  }
  return out;
}
export function bboxOf(list, b = [Infinity, Infinity, -Infinity, -Infinity]) {
  for (const p of list) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
  return b;
}
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t, x: ax + t * dx, y: ay + t * dy };
}
/** The nearest point of a polyline: { d, i (segment), t, x, y }. */
export function nearestOn(poly, x, y, closed = false) {
  let best = { d: Infinity, i: -1, t: 0, x, y };
  const n = poly.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % n], r = segDist(x, y, a[0], a[1], b[0], b[1]);
    if (r.d < best.d) best = { ...r, i };
  }
  if (n === 1) best = { d: Math.hypot(x - poly[0][0], y - poly[0][1]), i: 0, t: 0, x: poly[0][0], y: poly[0][1] };
  return best;
}
export function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return s / 2;
}
export function polyLength(poly) { let s = 0; for (let i = 1; i < poly.length; i++) s += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); return s; }

/** Douglas-Peucker on a polyline of [x, y, f] (corners and dash points kept). */
export function simplify(poly, tol) {
  if (poly.length < 3) return poly.slice();
  const keep = new Uint8Array(poly.length); keep[0] = keep[poly.length - 1] = 1;
  poly.forEach((p, i) => { if (p[2] & (F.CORNER | F.DASH)) keep[i] = 1; });
  const stack = [[0, poly.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(poly[i][0], poly[i][1], poly[a][0], poly[a][1], poly[b][0], poly[b][1]).d; if (d > md) { md = d; mi = i; } }
    if (mi > 0 && md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return poly.filter((_, i) => keep[i]);
}
/** A polyline turned into Bézier curves through its points (Catmull-Rom tangents, `k` their tension): a smooth line. */
export function smoothCurve(poly, closed = false, k = 1 / 6) {
  if (poly.length < 3) return poly.map((p) => [p[0], p[1], p[2] & ~(F.CTRL1 | F.CTRL2)]);
  const n = poly.length, out = [[poly[0][0], poly[0][1], poly[0][2] & ~(F.CTRL1 | F.CTRL2)]];
  const at = (i) => poly[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    if (p1[2] & F.CORNER || p2[2] & F.CORNER) { out.push([p2[0], p2[1], p2[2] & ~(F.CTRL1 | F.CTRL2)]); continue; }
    out.push([p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, F.CTRL1]);
    out.push([p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, F.CTRL2]);
    out.push([p2[0], p2[1], p2[2] & ~(F.CTRL1 | F.CTRL2)]);
  }
  return out;
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Geometry for the vector maps (OCAD, OpenOrienteering Mapper): a port of Purple Pen's Graphics2D helpers (Matrix,
// Bezier, Geometry), BSD licence, Copyright (c) 2006-2008 Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt.
// Coordinates are map millimetres, y up. Matrices follow .NET's row-vector form and its default « prepend » order:
// the operation added last is applied first to a point, as with a canvas's translate/rotate/scale.

export class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f; }
  static of(m) { return new Matrix(m.a, m.b, m.c, m.d, m.e, m.f); }
  clone() { return new Matrix(this.a, this.b, this.c, this.d, this.e, this.f); }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }
  /** this = m × this: m is applied first. */
  prepend(m) {
    const { a, b, c, d, e, f } = this;
    this.a = m.a * a + m.b * c; this.b = m.a * b + m.b * d;
    this.c = m.c * a + m.d * c; this.d = m.c * b + m.d * d;
    this.e = m.e * a + m.f * c + e; this.f = m.e * b + m.f * d + f;
    return this;
  }
  /** this = this × m: m is applied last. */
  append(m) {
    const { a, b, c, d, e, f } = this;
    this.a = a * m.a + b * m.c; this.b = a * m.b + b * m.d;
    this.c = c * m.a + d * m.c; this.d = c * m.b + d * m.d;
    this.e = e * m.a + f * m.c + m.e; this.f = e * m.b + f * m.d + m.f;
    return this;
  }
  translate(x, y) { return this.prepend(new Matrix(1, 0, 0, 1, x, y)); }
  scale(sx, sy) { return this.prepend(new Matrix(sx, 0, 0, sy, 0, 0)); }
  rotate(deg) { const t = (deg * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t); return this.prepend(new Matrix(co, si, -si, co, 0, 0)); }
  rotateAt(deg, cx, cy) { this.translate(cx, cy); this.rotate(deg); return this.translate(-cx, -cy); }
  invert() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return this;
    const { a, b, c, d, e, f } = this;
    this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det;
    this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det;
    return this;
  }
  x(x, y) { return x * this.a + y * this.c + this.e; }
  y(x, y) { return x * this.b + y * this.d + this.f; }
  /** The scale of a distance (the mean of both axes). */
  get scaleFactor() { return Math.sqrt(Math.abs(this.a * this.d - this.b * this.c)); }
}

export const MITER_LIMIT = 5;
export const KAPPA = 0.5522847498;
export function miterFactor(subtended) {
  const s = Math.abs(subtended);
  return s > 0 && s < 180 ? Math.abs(1 / Math.sin((s * Math.PI) / 360)) : 1;
}
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
/** OCAD's « Bizzarro » metric for dashes and text along lines: the larger delta plus half the smaller. */
export function bizarro(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  return Math.max(dx, dy) + Math.min(dx, dy) / 2;
}
export const euclid = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// ---- rectangles: [l, b, r, t] (min x, min y, max x, max y) ------------------------------------------------------------
export const rectUnion = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
export const rectsMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
export const inflate = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
export function transformRect(r, m) {
  const xs = [m.x(r[0], r[1]), m.x(r[2], r[1]), m.x(r[0], r[3]), m.x(r[2], r[3])];
  const ys = [m.y(r[0], r[1]), m.y(r[2], r[1]), m.y(r[0], r[3]), m.y(r[2], r[3])];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export function rotatedRect(r, cx, cy, deg) { return transformRect(r, new Matrix().rotateAt(deg, cx, cy)); }

export function closestOnSegment(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (!l2) return [x1, y1];
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [x1 + t * dx, y1 + t * dy];
}
export function distFromSegment(x1, y1, x2, y2, px, py) { const [x, y] = closestOnSegment(x1, y1, x2, y2, px, py); return Math.hypot(px - x, py - y); }

// ---- Bezier: flattening (Antigrain's adaptive subdivision, as Purple Pen) and splitting -------------------------------------
/** Flatten the bezier (x1,y1)…(x4,y4) into `out` (pairs pushed, the end points included). */
export function flattenBezier(x1, y1, x2, y2, x3, y3, x4, y4, error, out) {
  out.push(x1, y1);
  rec(x1, y1, x2, y2, x3, y3, x4, y4, error * 2.5, out, 1);
  out.push(x4, y4);
}
function rec(x1, y1, x2, y2, x3, y3, x4, y4, tol, out, level) {
  let d = 0, t;
  t = x1 + x3 - x2 - x2; d += t < 0 ? -t : t;
  t = y1 + y3 - y2 - y2; d += t < 0 ? -t : t;
  t = x2 + x4 - x3 - x3; d += t < 0 ? -t : t;
  t = y2 + y4 - y3 - y3; d += t < 0 ? -t : t;
  if (d <= tol || level > 20) return;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2, x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2, x34 = (x3 + x4) / 2, y34 = (y3 + y4) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2, x234 = (x23 + x34) / 2, y234 = (y23 + y34) / 2;
  const x1234 = (x123 + x234) / 2, y1234 = (y123 + y234) / 2;
  rec(x1, y1, x12, y12, x123, y123, x1234, y1234, tol, out, level + 1);
  out.push(x1234, y1234);
  rec(x1234, y1234, x234, y234, x34, y34, x4, y4, tol, out, level + 1);
}
/** Split a bezier [e1, c1, c2, e2] (each [x, y]) at t into two. */
export function splitBezier([e1, c1, c2, e2], t) {
  const s = 1 - t, L = (p, q) => [s * p[0] + t * q[0], s * p[1] + t * q[1]];
  const f00t = L(e1, c1), f01t = L(c1, c2), f11t = L(c2, e2), f0tt = L(f00t, f01t), f1tt = L(f01t, f11t), fttt = L(f0tt, f1tt);
  return [[e1, f00t, f0tt, fttt], [fttt, f1tt, f11t, e2]];
}
const isFlat = ([e1, c1, c2, e2], err) => distFromSegment(e1[0], e1[1], e2[0], e2[1], c1[0], c1[1]) < err && distFromSegment(e1[0], e1[1], e2[0], e2[1], c2[0], c2[1]) < err;
/** The parameter t of a point on (or within `err` of) a bezier, or NaN. */
export function bezierCoefficient(bez, [px, py], err, c1 = 0, c2 = 1, depth = 0) {
  if (isFlat(bez, err) || depth > 30) {
    const [e1, , , e2] = bez;
    const [qx, qy] = closestOnSegment(e1[0], e1[1], e2[0], e2[1], px, py);
    const d = Math.hypot(qx - px, qy - py);
    if (d > err * 4) return { t: NaN, d };
    let u;
    if (e1[0] === e2[0] && e1[1] === e2[1]) u = 0;
    else if (Math.abs(e2[0] - e1[0]) > Math.abs(e2[1] - e1[1])) u = (qx - e1[0]) / (e2[0] - e1[0]);
    else u = (qy - e1[1]) / (e2[1] - e1[1]);
    return { t: c1 + u * (c2 - c1), d };
  }
  const [b1, b2] = splitBezier(bez, 0.5), c3 = (c1 + c2) / 2;
  const near = (b) => { const xs = b.map((p) => p[0]), ys = b.map((p) => p[1]); return px >= Math.min(...xs) - err && px <= Math.max(...xs) + err && py >= Math.min(...ys) - err && py <= Math.max(...ys) + err; };
  const r1 = near(b1) ? bezierCoefficient(b1, [px, py], err, c1, c3, depth + 1) : { t: NaN, d: Infinity };
  const r2 = near(b2) ? bezierCoefficient(b2, [px, py], err, c3, c2, depth + 1) : { t: NaN, d: Infinity };
  return !Number.isNaN(r1.t) && (Number.isNaN(r2.t) || r1.d < r2.d) ? r1 : r2;
}

// ---- colours ---------------------------------------------------------------------------------------------------------------
/** CMYK (0-1) to RGB (0-1) for the screen, as OCAD and Purple Pen show a map: red = 1 − (cyan + black)… (a 50 % black darkens
 *  a colour by half, not by half of what is left). Printing keeps the CMYK as it is. */
export function cmykToRgb(c, m, y, k) { return [Math.max(0, 1 - (c + k)), Math.max(0, 1 - (m + k)), Math.max(0, 1 - (y + k))]; }
export function cmykToCss(c, m, y, k, alpha = 1) {
  const [r, g, b] = cmykToRgb(c, m, y, k);
  const R = Math.round(r * 255), G = Math.round(g * 255), B = Math.round(b * 255);
  return alpha < 1 ? `rgba(${R},${G},${B},${alpha})` : `rgb(${R},${G},${B})`;
}
/** HSV (each 0-1) of a CMYK colour: Purple Pen's purple and green tests. */
export function cmykToHsv(c, m, y, k) {
  const [r, g, b] = cmykToRgb(c, m, y, k);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}

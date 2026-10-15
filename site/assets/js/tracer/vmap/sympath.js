// Paths of the vector maps: a port of Purple Pen's SymPath and SymPathWithHoles (BSD licence, Copyright (c) 2006-2008
// Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt). A path is a series of points (map mm, y up), each with a kind:
// Normal, BezierControl (always two in a row: a cubic bezier), Corner, Dash; optional start/stop flags per segment cut the
// path into sub-paths for the main line and each side of a double line (OCAD's « gaps »).

import { flattenBezier, bizarro, euclid, miterFactor, splitBezier, bezierCoefficient, KAPPA } from "./geom.js";

export const K = { Normal: 0, Bezier: 1, Corner: 2, Dash: 3, Interpolated: 4 };
export const FLAG_LEFT = 1, FLAG_RIGHT = 2, FLAG_MAIN = 4;
const FLATTEN = 0.01;

export class SymPath {
  /** p: [x0, y0, x1, y1…] (any array), k: kinds (one per point), ss: start/stop flags (one per segment) or null. */
  constructor(p, k, ss = null, lastSynth = false) {
    const n = k.length;
    if (n < 2) throw new Error("path: two points at least");
    this.p = p instanceof Float64Array ? p : Float64Array.from(p);
    this.k = k instanceof Uint8Array ? k : Uint8Array.from(k);
    this.ss = ss && Array.prototype.some.call(ss, (v) => v) ? (ss instanceof Uint8Array ? ss : Uint8Array.from(ss)) : null;
    this.lastSynth = lastSynth;
    let l = Infinity, b = Infinity, r = -Infinity, t = -Infinity, zero = true, anyBez = false;
    const P = this.p;
    for (let i = 0; i < n; i++) {
      const x = P[2 * i], y = P[2 * i + 1];
      if (x < l) l = x; if (x > r) r = x; if (y < b) b = y; if (y > t) t = y;
      if (zero && (x !== P[0] || y !== P[1])) zero = false;
      if (this.k[i] === K.Bezier) anyBez = true;
    }
    this.n = n; this.bbox = [l, b, r, t]; this.zero = zero; this.anyBez = anyBez;
    this.closed = P[0] === P[2 * n - 2] && P[1] === P[2 * n - 1];
  }
  x(i) { return this.p[2 * i]; }
  y(i) { return this.p[2 * i + 1]; }
  get first() { return [this.p[0], this.p[1]]; }
  get last() { return [this.p[2 * this.n - 2], this.p[2 * this.n - 1]]; }

  /** The flattened path (beziers as lines): this.fp, this.fk, this.fss (lazy). */
  flat() {
    if (this.fp) return this;
    if (!this.anyBez) { this.fp = this.p; this.fk = this.k; this.fss = this.ss; return this; }
    const P = this.p, Kd = this.k, pts = [], kinds = [], ss = this.ss ? [] : null;
    let i = 0, flag = 0;
    while (i < this.n) {
      pts.push(P[2 * i], P[2 * i + 1]); kinds.push(Kd[i]);
      if (ss && i !== this.n - 1) { flag = this.ss[i]; ss.push(flag); }
      if (i + 1 < this.n && Kd[i + 1] === K.Bezier) {
        pts.length -= 2;
        const tmp = [];
        flattenBezier(P[2 * i], P[2 * i + 1], P[2 * i + 2], P[2 * i + 3], P[2 * i + 4], P[2 * i + 5], P[2 * i + 6], P[2 * i + 7], FLATTEN, tmp);
        tmp.length -= 2;                                               // the end point comes as the next point
        for (let j = 0; j < tmp.length; j++) pts.push(tmp[j]);
        while (kinds.length < pts.length / 2) { kinds.push(K.Interpolated); if (ss) ss.push(flag); }
        i += 3;
      } else i++;
    }
    this.fp = Float64Array.from(pts); this.fk = Uint8Array.from(kinds); this.fss = ss ? Uint8Array.from(ss) : null;
    return this;
  }
  get fn() { return this.flat().fk.length; }

  lengthWith(metric) {
    this.flat();
    const F = this.fp, n = F.length / 2;
    let acc = 0;
    for (let i = 1; i < n; i++) acc += metric(F[2 * i - 2], F[2 * i - 1], F[2 * i], F[2 * i + 1]);
    return acc;
  }
  get length() { return this._len ?? (this._len = this.lengthWith(euclid)); }
  get bizarroLength() { return this._blen ?? (this._blen = this.lengthWith(bizarro)); }
  lengthBy(metric) { return metric === bizarro ? this.bizarroLength : this.length; }

  /** The point at a length along the path (the last point beyond the end). */
  pointAtLength(len, metric = euclid) {
    if (len <= 0) return [this.p[0], this.p[1]];
    this.flat();
    const F = this.fp, n = F.length / 2;
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const x0 = F[2 * i - 2], y0 = F[2 * i - 1], x1 = F[2 * i], y1 = F[2 * i + 1], d = metric(x0, y0, x1, y1);
      if (acc < len && acc + d >= len) { const f = (len - acc) / d; return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]; }
      acc += d;
    }
    return [F[2 * n - 2], F[2 * n - 1]];
  }

  /** Points (and their angles in degrees) at successive distances (each a delta from the previous). */
  pointsAlong(deltas, metric = euclid) {
    this.flat();
    const F = this.fp, n = F.length / 2, pts = [], angles = [];
    if (!deltas.length || n < 2) return { pts, angles };
    let next = deltas[0], cur = 0, i = 1, px = F[0], py = F[1];
    while (i < n) {
      const nx = F[2 * i], ny = F[2 * i + 1], dx = nx - px, dy = ny - py, d = metric(px, py, nx, ny);
      if (next < d) {
        let f = d ? next / d : 0; if (f < 0) f = 0; if (f > 1) f = 1;
        pts.push([px + dx * f, py + dy * f]); angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
        if (++cur >= deltas.length) break;
        next += deltas[cur];
      } else { px = nx; py = ny; next -= d; i++; }
    }
    while (pts.length < deltas.length) {
      const j = n - 1;
      pts.push([F[2 * j], F[2 * j + 1]]);
      angles.push((Math.atan2(F[2 * j + 1] - F[2 * j - 1], F[2 * j] - F[2 * j - 2]) * 180) / Math.PI);
    }
    return { pts, angles };
  }

  /** Split at a length along the path into two paths (either may be null). */
  splitAtLength(len, metric = euclid) {
    const P = this.p, Kd = this.k, n = this.n;
    let acc = 0, i = 0;
    while (i < n - 1) {
      const bez = Kd[i + 1] === K.Bezier, j = bez ? i + 3 : i + 1;
      let seg;
      if (bez) { const tmp = []; flattenBezier(P[2 * i], P[2 * i + 1], P[2 * i + 2], P[2 * i + 3], P[2 * i + 4], P[2 * i + 5], P[2 * i + 6], P[2 * i + 7], FLATTEN, tmp); seg = tmp; }
      else seg = [P[2 * i], P[2 * i + 1], P[2 * j], P[2 * j + 1]];
      let segLen = 0;
      for (let q = 2; q < seg.length; q += 2) segLen += metric(seg[q - 2], seg[q - 1], seg[q], seg[q + 1]);
      if (acc + segLen >= len) {
        // inside this segment: the split point on its flattened line, then the bezier's parameter
        let rem = len - acc, sx = seg[seg.length - 2], sy = seg[seg.length - 1];
        for (let q = 2; q < seg.length; q += 2) {
          const d = metric(seg[q - 2], seg[q - 1], seg[q], seg[q + 1]);
          if (rem <= d) { const f = d ? rem / d : 0; sx = seg[q - 2] + (seg[q] - seg[q - 2]) * f; sy = seg[q - 1] + (seg[q + 1] - seg[q - 1]) * f; break; }
          rem -= d;
        }
        return this.splitAt(i, j, sx, sy, bez);
      }
      acc += segLen; i = j;
    }
    return [this, null];
  }
  splitAt(i, j, sx, sy, bez) {
    const P = this.p, Kd = this.k, n = this.n, ss = this.ss;
    const ptsA = [], kA = [], ssA = ss ? [] : null, ptsB = [], kB = [], ssB = ss ? [] : null;
    for (let q = 0; q <= i; q++) { ptsA.push(P[2 * q], P[2 * q + 1]); kA.push(Kd[q]); if (ss && q < i) ssA.push(ss[q]); }
    if (bez) {
      const b = [[P[2 * i], P[2 * i + 1]], [P[2 * i + 2], P[2 * i + 3]], [P[2 * i + 4], P[2 * i + 5]], [P[2 * j], P[2 * j + 1]]];
      let { t } = bezierCoefficient(b, [sx, sy], FLATTEN);
      if (Number.isNaN(t)) t = 0.5;
      const [b1, b2] = splitBezier(b, t);
      ptsA.push(...b1[1], ...b1[2], ...b1[3]); kA.push(K.Bezier, K.Bezier, K.Normal); if (ss) ssA.push(ss[i], 0, 0);
      ptsB.push(...b2[0], ...b2[1], ...b2[2]); kB.push(K.Normal, K.Bezier, K.Bezier); if (ss) ssB.push(ss[i], 0, 0);
    } else {
      if (sx !== P[2 * i] || sy !== P[2 * i + 1]) { ptsA.push(sx, sy); kA.push(K.Normal); if (ss) ssA.push(ss[i]); }
      ptsB.push(sx, sy); kB.push(K.Normal); if (ss) ssB.push(ss[i]);
    }
    for (let q = j; q < n; q++) { ptsB.push(P[2 * q], P[2 * q + 1]); kB.push(Kd[q]); if (ss && q < n - 1) ssB.push(ss[q]); }
    if (ss) { ssA.length = kA.length - 1; ssB.length = kB.length - 1; }
    const A = kA.length >= 2 ? new SymPath(ptsA, kA, ssA) : null, B = kB.length >= 2 ? new SymPath(ptsB, kB, ssB) : null;
    return [A, B];
  }
  /** A path shortened at both ends (null when nothing is left). */
  shorten(start, end, metric = euclid) {
    if (start <= 0 && end <= 0) return this;
    let endAt = this.lengthBy(metric) - end;
    if (endAt <= start) return null;
    let path = this;
    if (start > 0) { path = this.splitAtLength(start, metric)[1]; endAt -= start; if (!path) return null; }
    if (end > 0) path = path.splitAtLength(endAt, metric)[0];
    return path;
  }

  /** Corner (or dash) points with the perpendicular angle on the right and the angle the path makes there. */
  cornerOrDashPoints(kind, ignoreEnds) {
    const first = ignoreEnds ? 1 : 0, end = ignoreEnds ? this.n - 1 : this.n, out = [];
    for (let i = first; i < end; i++) if (this.k[i] === kind) {
      const { perp, sub } = anglesAt(this.p, this.n, i, this.closed);
      out.push({ pt: [this.p[2 * i], this.p[2 * i + 1]], perp, sub });
    }
    return out;
  }
  get maxMiter() {
    if (this._miter) return this._miter;
    let m = 1;
    for (const c of this.cornerOrDashPoints(K.Corner, true)) m = Math.max(m, miterFactor(c.sub));
    return (this._miter = m);
  }
  /** Lengths of the parts between corner and dash points, and the kinds at the ends of those parts. */
  cornerAndDashDistances(metric = euclid) {
    this.flat();
    const F = this.fp, Fk = this.fk, n = F.length / 2, distances = [], kinds = [K.Corner];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) acc += metric(F[2 * i - 2], F[2 * i - 1], F[2 * i], F[2 * i + 1]);
      if ((i !== 0 && Fk[i] === K.Corner) || i === n - 1) { distances.push(acc); acc = 0; kinds.push(K.Corner); }
      else if (i !== 0 && Fk[i] === K.Dash) { distances.push(acc); acc = 0; kinds.push(K.Dash); }
    }
    return { distances, kinds };
  }
  /** The sub-paths left by one start/stop flag (the whole path when none is set). */
  subpaths(flag) {
    if (!this.ss) return [this];
    const ss = this.ss, Kd = this.k;
    let any = false;
    for (let i = 0; i < ss.length; i++) if (Kd[i] !== K.Bezier && ss[i] & flag) { any = true; break; }
    if (!any) return [this];
    const out = [];
    let prev = true, start = 0;
    for (let i = 0; i < this.n; i++) {
      if (Kd[i] === K.Bezier) continue;
      const cur = i === ss.length || (ss[i] & flag) !== 0;
      if (prev && !cur) start = i;
      else if (cur && !prev) out.push(new SymPath(this.p.slice(2 * start, 2 * i + 2), Kd.slice(start, i + 1)));
      prev = cur;
    }
    return out;
  }
  /** The path offset to the right (negative: left), as straight segments. */
  offsetRight(amount, miterLimit) {
    if (!amount) return this;
    this.flat();
    return new SymPath(offsetPoints(this.fp, amount, miterLimit), this.fk, this.fss);
  }
  transform(m) {
    if (m.isIdentity) return this;
    const P = this.p, out = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 2) { out[i] = m.x(P[i], P[i + 1]); out[i + 1] = m.y(P[i], P[i + 1]); }
    return new SymPath(out, this.k, this.ss, this.lastSynth);
  }
  isInside(x, y) {
    const [l, b, r, t] = this.bbox;
    if (x < l || x > r || y < b || y > t) return false;
    this.flat();
    const F = this.fp, n = F.length / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = F[2 * i], yi = F[2 * i + 1], xj = F[2 * j], yj = F[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  maxDistance(x, y) { let m = 0; for (let i = 0; i < this.n; i++) m = Math.max(m, Math.hypot(this.p[2 * i] - x, this.p[2 * i + 1] - y)); return m; }
  centroid() {
    this.flat();
    const F = this.fp, n = F.length / 2, lim = this.closed ? n - 1 : n;
    let sum = 0, cx = 0, cy = 0;
    for (let i = 0; i < lim; i++) {
      const j = (i + 1) % n, a = F[2 * i] * F[2 * j + 1] - F[2 * i + 1] * F[2 * j];
      sum += a; cx += (F[2 * i] + F[2 * j]) * a; cy += (F[2 * i + 1] + F[2 * j + 1]) * a;
    }
    sum /= 2;
    return sum ? [cx / (sum * 6), cy / (sum * 6)] : [this.p[0], this.p[1]];
  }
  /** Path commands ([["M", x, y], ["L", x, y], ["C", …], ["Z"]]), with an optional point transform. */
  commands(out = [], close = false, m = null) {
    const P = this.p, Kd = this.k, n = this.n;
    const X = m ? (i) => m.x(P[2 * i], P[2 * i + 1]) : (i) => P[2 * i], Y = m ? (i) => m.y(P[2 * i], P[2 * i + 1]) : (i) => P[2 * i + 1];
    out.push(["M", X(0), Y(0)]);
    for (let i = 1; i < n;) {
      if (Kd[i] === K.Bezier && i + 2 < n) { out.push(["C", X(i), Y(i), X(i + 1), Y(i + 1), X(i + 2), Y(i + 2)]); i += 3; }
      else { out.push(["L", X(i), Y(i)]); i++; }
    }
    if (close || this.closed) out.push(["Z"]);
    return out;
  }
  /** Dashes along the path (dash, gap, dash… lengths, wrapping), each dash as flat points, optionally offset. */
  dashes(lengths, metric, offsetRight = 0, miterLimit = 1, emit) {
    this.flat();
    const F = this.fp, n = F.length / 2;
    if (!n) return;
    let next = lengths[0], cur = 0, inDash = true, px = F[0], py = F[1], lx = px, ly = py, li = 1, i = 1;
    const out = (pts) => emit(offsetRight ? offsetPoints(pts, offsetRight, miterLimit) : pts);
    while (i < n) {
      const nx = F[2 * i], ny = F[2 * i + 1], dx = nx - px, dy = ny - py, d = metric(nx, ny, px, py);
      if (next < d) {
        const f = next / d, x = px + dx * f, y = py + dy * f;
        if (inDash) {
          const pts = [lx, ly];
          for (let q = li; q < i; q++) pts.push(F[2 * q], F[2 * q + 1]);
          pts.push(x, y);
          out(Float64Array.from(pts));
        }
        lx = x; ly = y; li = i; inDash = !inDash;
        if (++cur >= lengths.length) cur = 0;
        next += lengths[cur];
      } else { px = nx; py = ny; next -= d; i++; }
    }
    if (inDash) {
      const pts = [lx, ly];
      for (let q = li; q < n; q++) pts.push(F[2 * q], F[2 * q + 1]);
      out(Float64Array.from(pts));
    }
  }

  static rect([l, b, r, t]) {
    return new SymPath([l, b, r, b, r, t, l, t, l, b], [K.Corner, K.Corner, K.Corner, K.Corner, K.Corner]);
  }
  /** A rectangle (location = its corner, size w×h, as OCAD's rectangle symbols) with rounded corners. */
  static roundedRect(x, y, w, h, radius) {
    if (w < radius * 2) radius = w / 2;
    if (h < radius * 2) radius = h / 2;
    let p, k;
    if (w === 0) { p = [0, 0, 0, h]; k = [K.Corner, K.Corner]; }
    else if (h === 0) { p = [0, 0, w, 0]; k = [K.Corner, K.Corner]; }
    else if (!radius) { p = [0, 0, 0, h, w, h, w, 0, 0, 0]; k = [K.Corner, K.Corner, K.Corner, K.Corner, K.Corner]; }
    else {
      const q = (1 - KAPPA) * radius, B = K.Bezier, N = K.Normal;
      p = [radius, 0, w - radius, 0, w - q, 0, w, q, w, radius, w, h - radius, w, h - q, w - q, h, w - radius, h, radius, h, q, h, 0, h - q, 0, h - radius, 0, radius, 0, q, q, 0, radius, 0];
      k = [N, N, B, B, N, N, B, B, N, N, B, B, N, N, B, B, N];
    }
    for (let i = 0; i < p.length; i += 2) { p[i] += x; p[i + 1] += y; }
    return new SymPath(p, k);
  }
  static ellipse(cx, cy, rx, ry) {
    const ax = KAPPA * rx, ay = KAPPA * ry, B = K.Bezier, N = K.Normal;
    return new SymPath([cx, cy + ry, cx - ax, cy + ry, cx - rx, cy + ay, cx - rx, cy, cx - rx, cy - ay, cx - ax, cy - ry, cx, cy - ry, cx + ax, cy - ry, cx + rx, cy - ay, cx + rx, cy, cx + rx, cy + ay, cx + ax, cy + ry, cx, cy + ry],
      [N, B, B, N, B, B, N, B, B, N, B, B, N]);
  }
}

/** The angle a path makes into and out of point i (degrees), or NaN at an open end. */
function angleInto(P, n, i, closed) {
  let j = i - 1;
  while (j !== i) {
    if (j < 0) { if (closed && i !== n - 1) j = n - 1; else break; }
    if (P[2 * j] !== P[2 * i] || P[2 * j + 1] !== P[2 * i + 1]) return (Math.atan2(P[2 * i + 1] - P[2 * j + 1], P[2 * i] - P[2 * j]) * 180) / Math.PI;
    j--;
  }
  return NaN;
}
function angleOut(P, n, i, closed) {
  let j = i + 1;
  while (j !== i) {
    if (j === n) { if (closed && i !== 0) j = 0; else break; }
    if (P[2 * j] !== P[2 * i] || P[2 * j + 1] !== P[2 * i + 1]) return (Math.atan2(P[2 * j + 1] - P[2 * i + 1], P[2 * j] - P[2 * i]) * 180) / Math.PI;
    j++;
  }
  return NaN;
}
/** The perpendicular angle (on the right) at point i and the angle the path makes there. */
export function anglesAt(P, n, i, closed) {
  let a = angleInto(P, n, i, closed), b = angleOut(P, n, i, closed);
  if (Number.isNaN(a)) return { perp: Number.isNaN(b) ? 0 : b - 90, sub: 180 };
  if (Number.isNaN(b)) return { perp: a - 90, sub: 180 };
  if (a - 180 > b) a -= 360; else if (b - 180 > a) b -= 360;
  return { perp: (a + b) / 2 - 90, sub: 180 - Math.abs(a - b) };
}
export function offsetPoints(P, amount, miterLimit) {
  const n = P.length / 2, out = new Float64Array(P.length);
  const closed = P[0] === P[2 * n - 2] && P[1] === P[2 * n - 1];
  for (let i = 0; i < n; i++) {
    const { perp, sub } = anglesAt(P, n, i, closed);
    const d = Math.min(miterLimit, miterFactor(sub)) * amount, a = (perp * Math.PI) / 180;
    out[2 * i] = P[2 * i] + Math.cos(a) * d; out[2 * i + 1] = P[2 * i + 1] + Math.sin(a) * d;
  }
  return out;
}

export class PathWithHoles {
  constructor(main, holes = null) {
    this.main = main; this.holes = holes && holes.length ? holes : null;
    let bb = main.bbox;
    if (this.holes) for (const h of this.holes) bb = [Math.min(bb[0], h.bbox[0]), Math.min(bb[1], h.bbox[1]), Math.max(bb[2], h.bbox[2]), Math.max(bb[3], h.bbox[3])];
    this.bbox = bb;
  }
  isInside(x, y) {
    let inside = this.main.isInside(x, y);
    if (this.holes) for (const h of this.holes) if (h.isInside(x, y)) inside = !inside;
    return inside;
  }
  transform(m) { return m.isIdentity ? this : new PathWithHoles(this.main.transform(m), this.holes?.map((h) => h.transform(m)) || null); }
  commands(m = null) {
    const out = this.main.commands([], !!this.holes, m);
    if (this.holes) for (const h of this.holes) h.commands(out, true, m);
    return out;
  }
  maxDistance(x, y) { let d = this.main.maxDistance(x, y); if (this.holes) for (const h of this.holes) d = Math.max(d, h.maxDistance(x, y)); return d; }
}

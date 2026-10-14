// Plane geometry for the Analyse page: the transforms between the trace's metres and the map's pixels (a similarity
// fitted by least squares, or an affine one for georeferenced maps), a polyline simplifier, a distance field and a
// spatial hash over the trace, and a small linear solver.

/** Least-squares similarity w = s·z + t (s complex): metres (src) -> pixels (dst). Two points at least. */
export function fitSimilarity(src, dst) {
  const n = src.length;
  if (n < 2) return null;
  let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; ux += dst[i][0]; uy += dst[i][1]; }
  mx /= n; my /= n; ux /= n; uy /= n;
  let zz = 0, re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const zx = src[i][0] - mx, zy = src[i][1] - my, wx = dst[i][0] - ux, wy = dst[i][1] - uy;
    zz += zx * zx + zy * zy; re += zx * wx + zy * wy; im += zx * wy - zy * wx;
  }
  if (!zz) return null;
  const a = re / zz, b = im / zz;
  const f = { kind: "similarity", m11: a, m12: -b, m21: b, m22: a, tx: ux - (a * mx - b * my), ty: uy - (b * mx + a * my), n };
  return finish(f, src, dst);
}
/** Least-squares affine (six parameters): three points at least, not aligned. */
export function fitAffine(src, dst) {
  const n = src.length;
  if (n < 3) return null;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, bx1 = 0, bx2 = 0, bx3 = 0, by1 = 0, by2 = 0, by3 = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    bx1 += x * u; bx2 += y * u; bx3 += u; by1 += x * v; by2 += y * v; by3 += v;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const px = solve3(M, [bx1, bx2, bx3]), py = solve3(M, [by1, by2, by3]);
  if (!px || !py) return null;
  return finish({ kind: "affine", m11: px[0], m12: px[1], tx: px[2], m21: py[0], m22: py[1], ty: py[2], n }, src, dst);
}
function finish(f, src, dst) {
  f.scale = Math.sqrt(Math.abs(f.m11 * f.m22 - f.m12 * f.m21));
  f.rotation = Math.atan2(f.m21, f.m11);
  let ss = 0;
  for (let i = 0; i < src.length; i++) { const [px, py] = toPx(f, src[i][0], src[i][1]); ss += (px - dst[i][0]) ** 2 + (py - dst[i][1]) ** 2; }
  f.rms = Math.sqrt(ss / src.length);
  return f;
}
export const toPx = (f, x, y) => [f.m11 * x + f.m12 * y + f.tx, f.m21 * x + f.m22 * y + f.ty];
export function toM(f, px, py) {
  const d = f.m11 * f.m22 - f.m12 * f.m21, wx = px - f.tx, wy = py - f.ty;
  return [(f.m22 * wx - f.m12 * wy) / d, (f.m11 * wy - f.m21 * wx) / d];
}
/** A similarity from two matching pairs: p1->q1, p2->q2. */
export function similarityFrom2(p1, p2, q1, q2) {
  const dpx = p2[0] - p1[0], dpy = p2[1] - p1[1], dqx = q2[0] - q1[0], dqy = q2[1] - q1[1];
  const L = dpx * dpx + dpy * dpy;
  if (!L) return null;
  const a = (dpx * dqx + dpy * dqy) / L, b = (dpx * dqy - dpy * dqx) / L;      // s = (a + ib) = dq / dp
  const f = { kind: "similarity", m11: a, m12: -b, m21: b, m22: a, tx: 0, ty: 0, n: 2 };
  f.tx = q1[0] - (a * p1[0] - b * p1[1]); f.ty = q1[1] - (b * p1[0] + a * p1[1]);
  f.scale = Math.hypot(a, b); f.rotation = Math.atan2(b, a); f.rms = 0;
  return f;
}

/** Gaussian elimination with partial pivoting on a 3×3 system; null when singular. */
export function solve3(M, b) {
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 4; j++) A[r][j] -= k * A[c][j];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

/** Douglas-Peucker: the indices of the points kept within eps of the polyline. */
export function simplify(x, y, n, eps) {
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = x[a], ay = y[a], dx = x[b] - ax, dy = y[b] - ay, L2 = dx * dx + dy * dy;
    let best = -1, bestD = 0;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (!L2) d = Math.hypot(x[i] - ax, y[i] - ay);
      else { const tt = Math.max(0, Math.min(1, ((x[i] - ax) * dx + (y[i] - ay) * dy) / L2)); d = Math.hypot(x[i] - ax - tt * dx, y[i] - ay - tt * dy); }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** The distance (metres) from any point of the plane to the polyline, on a grid (chamfer 3-4), with lookup(x, y). */
export function distanceField(x, y, n, cell = 2.5, pad = 80) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i]; }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let c = cell;
  while (((x1 - x0) / c) * ((y1 - y0) / c) > 4e6) c *= 1.5;
  const w = Math.ceil((x1 - x0) / c) + 1, h = Math.ceil((y1 - y0) / c) + 1;
  const INF = 1e9, g = new Float32Array(w * h).fill(INF);
  for (let i = 1; i < n; i++) {
    const L = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]), steps = Math.max(1, Math.ceil(L / (c / 2)));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps, gx = Math.round((x[i - 1] + f * (x[i] - x[i - 1]) - x0) / c), gy = Math.round((y[i - 1] + f * (y[i] - y[i - 1]) - y0) / c);
      g[gy * w + gx] = 0;
    }
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    let v = g[k];
    if (i) v = Math.min(v, g[k - 1] + 3);
    if (j) { v = Math.min(v, g[k - w] + 3); if (i) v = Math.min(v, g[k - w - 1] + 4); if (i < w - 1) v = Math.min(v, g[k - w + 1] + 4); }
    g[k] = v;
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    let v = g[k];
    if (i < w - 1) v = Math.min(v, g[k + 1] + 3);
    if (j < h - 1) { v = Math.min(v, g[k + w] + 3); if (i < w - 1) v = Math.min(v, g[k + w + 1] + 4); if (i) v = Math.min(v, g[k + w - 1] + 4); }
    g[k] = v;
  }
  const k = c / 3;
  return { lookup: (xm, ym) => {
    const gx = Math.round((xm - x0) / c), gy = Math.round((ym - y0) / c);
    return gx < 0 || gy < 0 || gx >= w || gy >= h ? INF : g[gy * w + gx] * k;
  } };
}

/** The nearest point of a set within maxD, by a hash of cells of that size: nearest(x, y) -> index or -1. */
export function spatialHash(x, y, n, maxD) {
  const cells = new Map();
  const key = (gx, gy) => gy * 1048576 + gx;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(x[i] / maxD) + 524288, Math.floor(y[i] / maxD) + 524288);
    const a = cells.get(k);
    if (a) a.push(i); else cells.set(k, [i]);
  }
  return { nearest: (xm, ym) => {
    const gx = Math.floor(xm / maxD) + 524288, gy = Math.floor(ym / maxD) + 524288;
    let best = -1, bd = maxD * maxD;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = cells.get(key(gx + dx, gy + dy));
      if (!a) continue;
      for (const i of a) { const d = (x[i] - xm) ** 2 + (y[i] - ym) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  }, dist: (xm, ym, i) => Math.hypot(x[i] - xm, y[i] - ym) };
}

/**
 * Point-set registration by RANSAC on pairs, then ICP: a similarity src -> dst such that most src points land within
 * tol of a dst point. opts: scaleRange [lo, hi], rotRange (radians, around 0; null = any), yFlip (dst y axis down
 * against src up: handled by the caller mirroring src). Returns { fit, matches: [[i, j]], inliers } or null.
 */
export function registerPoints(src, dst, tol, { scaleRange = [1e-4, 1e4], rotRange = null, minInliers = 3 } = {}) {
  const hash = spatialHash(dst.map((p) => p[0]), dst.map((p) => p[1]), dst.length, tol);
  const score = (f) => { let n = 0, s = 0; for (const p of src) { const [u, v] = toPx(f, p[0], p[1]); const j = hash.nearest(u, v); if (j >= 0) { n++; s += hash.dist(u, v, j); } } return [n, s]; };
  let best = null;
  for (let i = 0; i < src.length; i++) for (let j = i + 1; j < src.length; j++) {
    const Lp = Math.hypot(src[j][0] - src[i][0], src[j][1] - src[i][1]);
    if (Lp < 1e-6) continue;
    for (let a = 0; a < dst.length; a++) for (let b = 0; b < dst.length; b++) {
      if (a === b) continue;
      const Lq = Math.hypot(dst[b][0] - dst[a][0], dst[b][1] - dst[a][1]), sc = Lq / Lp;
      if (sc < scaleRange[0] || sc > scaleRange[1]) continue;
      const f = similarityFrom2(src[i], src[j], dst[a], dst[b]);
      if (!f) continue;
      if (rotRange != null && Math.abs(f.rotation) > rotRange) continue;
      const [n, s] = score(f);
      if (!best || n > best.n || (n === best.n && s < best.s)) best = { f, n, s };
    }
  }
  if (!best || best.n < minInliers) return null;
  let f = best.f, matches = [];
  for (let it = 0; it < 8; it++) {
    const S = [], D = [];
    matches = [];
    for (let i = 0; i < src.length; i++) { const [u, v] = toPx(f, src[i][0], src[i][1]); const j = hash.nearest(u, v); if (j >= 0) { S.push(src[i]); D.push(dst[j]); matches.push([i, j]); } }
    if (S.length < 2) break;
    const g = fitSimilarity(S, D);
    if (!g) break;
    f = g;
  }
  return matches.length >= minInliers ? { fit: f, matches, inliers: matches.length } : null;
}

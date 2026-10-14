// Laying the trace on the map without split times: the similarity (rotation, scale, translation) that makes the
// trace run through the controls read on the map.
// RANSAC: two of the trace's corners (Douglas-Peucker vertices) matched to two controls give a similarity; the
// controls are brought back to the trace's metres and looked up in a distance field of the trace (a chamfer grid):
// the hypothesis with the most controls within 20 m wins, after the best forty are refined by ICP (each control to
// its nearest trace point, least squares, eight rounds). The scale is bounded by the circle's radius (2 to 3.5 mm on
// a map at 1:3000 to 1:15000), the rotation by ± 30° when the map is north up.
// visitOrder: once the geometry is known, the controls' passing times (the closest approach), their visiting order,
// the start's departure and the finish's arrival.

import { toM, fitSimilarity, fitAffine, similarityFrom2, simplify, distanceField, spatialHash } from "./geom.js";
import { finishArrival } from "./track.js";

const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** pts: [{ x, y, kind }] in image px, unordered. Returns { fit, inliers, rms, rotationDeg, pxPerM } or null. */
export function alignTrack(track, pts, { rStar = null, northUp = true, tol = 20 } = {}) {
  const n = track.n;
  if (n < 10 || pts.length < 3) return null;
  let V = simplify(track.x, track.y, n, 12);
  if (V.length > 130) {                              // the sharpest corners
    const turn = (k) => { const i = V[k], a = V[k - 1], b = V[k + 1];
      return Math.abs(angleDiff(Math.atan2(track.y[i] - track.y[a], track.x[i] - track.x[a]), Math.atan2(track.y[b] - track.y[i], track.x[b] - track.x[i]))); };
    const kept = V.slice(1, -1).map((i, k) => [turn(k + 1), i]).sort((a, b) => b[0] - a[0]).slice(0, 128).map((x) => x[1]).sort((a, b) => a - b);
    V = [V[0], ...kept, V[V.length - 1]];
  }
  const D = distanceField(track.x, track.y, n, 2.5);
  const Q = pts.map((p) => [p.x, p.y]);
  let sLo, sHi;
  if (rStar) { sLo = rStar / 60; sHi = rStar / 5; }
  else {
    const ext = (A, k) => Math.max(...A.map((p) => p[k])) - Math.min(...A.map((p) => p[k]));
    const diagQ = Math.hypot(ext(Q, 0), ext(Q, 1));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of V) { x0 = Math.min(x0, track.x[i]); x1 = Math.max(x1, track.x[i]); y0 = Math.min(y0, track.y[i]); y1 = Math.max(y1, track.y[i]); }
    const s0 = diagQ / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    sLo = s0 / 6; sHi = s0 * 6;
  }
  const rotMax = northUp ? (30 * Math.PI) / 180 : Infinity;
  const K = 40, top = [];
  const consider = (inl, sum, h) => {
    if (top.length === K && (inl < top[K - 1].inl || (inl === top[K - 1].inl && sum >= top[K - 1].sum))) return;
    let k = top.length;
    while (k > 0 && (top[k - 1].inl < inl || (top[k - 1].inl === inl && top[k - 1].sum > sum))) k--;
    top.splice(k, 0, { inl, sum, h });
    if (top.length > K) top.pop();
  };
  for (let ii = 0; ii < V.length; ii++) for (let jj = ii + 1; jj < V.length; jj++) {
    const i = V[ii], j = V[jj], px0 = track.x[i], py0 = track.y[i], dpx = track.x[j] - px0, dpy = track.y[j] - py0, Lp = Math.hypot(dpx, dpy);
    if (Lp < 25) continue;
    const angP = Math.atan2(dpy, dpx);
    for (let a = 0; a < Q.length; a++) for (let b = 0; b < Q.length; b++) {
      if (a === b) continue;
      const dqx = Q[b][0] - Q[a][0], dqy = Q[b][1] - Q[a][1], sc = Math.hypot(dqx, dqy) / Lp;
      if (sc < sLo || sc > sHi) continue;
      const rot = angleDiff(angP, Math.atan2(dqy, dqx));
      if (Math.abs(rot) > rotMax) continue;
      const c = Math.cos(rot) / sc, s = Math.sin(rot) / sc;        // the inverse: m = R(-rot)(q - q_a)/sc + p_i
      let inl = 0, sum = 0;
      for (let k = 0; k < Q.length; k++) {
        const wx = Q[k][0] - Q[a][0], wy = Q[k][1] - Q[a][1];
        const d = D.lookup(c * wx + s * wy + px0, -s * wx + c * wy + py0);
        if (d <= tol) { inl++; sum += d; }
      }
      if (inl >= 3) consider(inl, sum, [i, j, a, b]);
    }
  }
  if (!top.length) return null;
  const hash = spatialHash(track.x, track.y, n, tol * 1.5);
  let best = null;
  for (const { h } of top) {
    let f = similarityFrom2([track.x[h[0]], track.y[h[0]]], [track.x[h[1]], track.y[h[1]]], Q[h[2]], Q[h[3]]);
    if (!f) continue;
    let res = null;
    for (let it = 0; it < 8; it++) {
      const S = [], T = [];
      for (const q of Q) { const [mx, my] = toM(f, q[0], q[1]); const k = hash.nearest(mx, my); if (k >= 0) { S.push([track.x[k], track.y[k]]); T.push(q); } }
      if (S.length < 2) break;
      const g = fitSimilarity(S, T);
      if (!g) break;
      f = g;
      let inl = 0;
      for (const q of Q) { const [mx, my] = toM(f, q[0], q[1]); const k = hash.nearest(mx, my); if (k >= 0 && hash.dist(mx, my, k) <= tol) inl++; }
      res = { f, inl, rms: g.rms };
    }
    if (res && (!best || res.inl > best.inl || (res.inl === best.inl && res.rms < best.rms))) best = res;
  }
  if (!best || best.inl < Math.max(3, Math.ceil(0.5 * pts.length))) return null;
  // a photographed or scanned map is slightly skewed: with enough controls, an affine fit absorbs it
  if (best.inl >= 6) {
    const S = [], T = [];
    for (const q of Q) { const [mx, my] = toM(best.f, q[0], q[1]); const k = hash.nearest(mx, my); if (k >= 0 && hash.dist(mx, my, k) <= tol) { S.push([track.x[k], track.y[k]]); T.push(q); } }
    const g = S.length >= 6 ? fitAffine(S, T) : null;
    if (g) {
      let inl = 0;
      for (const q of Q) { const [mx, my] = toM(g, q[0], q[1]); const k = hash.nearest(mx, my); if (k >= 0 && hash.dist(mx, my, k) <= tol) inl++; }
      if (inl >= best.inl && g.rms <= best.rms) best = { f: g, inl, rms: g.rms };
    }
  }
  return { fit: best.f, inliers: best.inl, rms: best.rms, rotationDeg: (best.f.rotation * 180) / Math.PI, pxPerM: best.f.scale };
}

/**
 * The passes of the trace at each point, once the geometry is known: for every point, the local minima of its
 * distance along the trace (within 1.5 tol), each with its time; the controls' visiting order (their closest pass);
 * the start's departure (the last pass before the first control, left when the trace leaves tol) and the finish's
 * arrival (after the last control found, the pass that ends the race: `finishArrival`). pts: [{ x, y, kind }].
 */
export function visitOrder(track, fit, pts, tol = 20) {
  const n = track.n;
  const passes = pts.map((p) => {
    const [mx, my] = toM(fit, p.x, p.y), d = new Float32Array(n);
    for (let k = 0; k < n; k++) d[k] = Math.hypot(track.x[k] - mx, track.y[k] - my);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (d[k] > 1.5 * tol) continue;
      if ((k === 0 || d[k] < d[k - 1]) && (k === n - 1 || d[k] <= d[k + 1])) {
        const last = out[out.length - 1];
        if (last && track.t[k] - last.t < 20) { if (d[k] < last.d) { last.k = k; last.d = d[k]; last.t = track.t[k]; } }
        else out.push({ k, d: d[k], t: track.t[k] });
      }
    }
    return { d, out };
  });
  const inlier = (i) => passes[i].out.some((p) => p.d <= 1.5 * tol);           // a hand-placed point on a photo is rough
  // the heading change around a point (over ± 10 s), in degrees: a runner punching turns away, a passer-by does not
  const turnAt = (k) => {
    const a = Math.max(0, k - 10), b = Math.min(n - 1, k + 10);
    if (a === k || b === k) return 0;
    const h1 = Math.atan2(track.y[k] - track.y[a], track.x[k] - track.x[a]), h2 = Math.atan2(track.y[b] - track.y[k], track.x[b] - track.x[k]);
    let d = Math.abs(h2 - h1); if (d > Math.PI) d = 2 * Math.PI - d;
    return (d * 180) / Math.PI;
  };
  const cost = (p) => p.d - 0.15 * Math.min(120, turnAt(p.k));
  const controls = pts.map((p, i) => i).filter((i) => pts[i].kind === "control" && inlier(i))
    .map((i) => { const best = passes[i].out.filter((p) => p.d <= 1.5 * tol).reduce((a, p) => (cost(p) < cost(a) ? p : a)); return { i, t: best.t, k: best.k, d: best.d }; })
    .sort((a, b) => a.t - b.t);
  const firstT = controls.length ? controls[0].t : Infinity, lastT = controls.length ? controls[controls.length - 1].t : -Infinity;
  let startT = null, finishT = null;
  const si = pts.findIndex((p) => p.kind === "start"), fi = pts.findIndex((p) => p.kind === "finish");
  if (si >= 0) {
    const before = passes[si].out.filter((p) => p.d <= 1.5 * tol && p.t < firstT);
    if (before.length) {
      let k = before[before.length - 1].k;
      while (k + 1 < n && passes[si].d[k + 1] <= 1.5 * tol && track.t[k + 1] < firstT) k++;      // the departure
      startT = track.t[k];
    }
  }
  if (fi >= 0) {
    // the controls found may be the first few only: a pass by the finish after them is the arrival only if it ends the race
    let k0 = 0;
    while (k0 < n && track.t[k0] < lastT) k0++;
    const k = finishArrival(track, passes[fi].d, k0, 1.5 * tol);
    if (k >= 0) finishT = track.t[k];
  }
  const pass = new Map(controls.map((c) => [c.i, c.t]));
  if (startT != null) pass.set(si, startT);
  if (finishT != null) pass.set(fi, finishT);
  return { order: controls.map((c) => c.i), pass, startT, finishT, inliers: pts.map((p, i) => i).filter(inlier) };
}

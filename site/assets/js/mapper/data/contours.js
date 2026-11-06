// Contours from a terrain model (Cartographier): a grid of heights laid square in the map's millimetres — IGN's RGE ALTI in
// France through its elevation service, else the AWS terrain tiles (trace/terrain.js loadGrid) —, cut by marching squares at
// every interval (2.5 or 5 m), the pieces joined into long lines, lightly smoothed and simplified (Douglas-Peucker in map mm),
// then turned into line objects: 101.0 contour, 102.0 index contour (every fifth), 103.0 form line (half an interval, only
// where the ground is gentle). A closed contour too small to be drawn as a loop becomes a point: 109.0 small knoll or
// 111.0 small depression. Every object is { sym, otp, ang, coords, src: "dem", draft: true } (the document gives ids).

import { ocad, simplify } from "./frame.js";
import { loadGrid, CREDIT } from "../../trace/terrain.js";

export const SYM = { contour: 101000, index: 102000, form: 103000, knoll: 109000, depression: 111000 };
export { CREDIT };

const DEFAULTS = {
  interval: 5,          // m
  indexEvery: 5,
  formLines: false,
  formSpacing: 3,       // mm on the map: form lines where the contours lie further apart than this
  formMinLength: 4,     // mm: a form line shorter than this is left out
  minLoop: 1.5,         // mm: a closed contour smaller across than this becomes a knoll or a depression point
  minRelief: 0.8,       // m: a knoll or a depression lower or shallower than this is noise, left out
  minLine: 1.5,         // mm: an open contour shorter than this is left out (a grid's edge effect)
  tolerance: 0.05,      // mm: Douglas-Peucker
  smooth: 1,            // passes of a [1/4, 1/2, 1/4] smoothing
};

/**
 * The contour lines of a grid at levels base + k × interval: [{ level, k, closed, pts: [[x, y]…] }] in the grid's
 * coordinates (column i, row j). z is row by row (nx a row); NaN marks no data. Lines run with the higher ground on their
 * right (in a frame with y down: the grid's), closed ones repeat their first point.
 */
export function isolines(z, nx, ny, interval, base = 0) {
  const byLevel = new Map();                          // k → { from: Map(edgeId → segment), segs: [[a, b, pa, pb]] }
  const at = (i, j) => z[j * nx + i];
  // edge ids: 2 × node for the edge to the right of node (i, j), 2 × node + 1 for the edge below it
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];     // corners clockwise from the top left
    if (v.some(Number.isNaN)) continue;
    const lo = Math.min(...v), hi = Math.max(...v);
    const k0 = Math.ceil((lo - base) / interval), k1 = Math.floor((hi - base) / interval);
    for (let k = k0; k <= k1; k++) {
      const L = base + k * interval;
      const up = v.map((h) => h >= L);
      const code = (up[0] ? 8 : 0) | (up[1] ? 4 : 0) | (up[2] ? 2 : 0) | (up[3] ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const n = j * nx + i;
      // cell edges: 0 top (n, right edge), 1 right (node i+1: below), 2 bottom (node below: right), 3 left (n: below)
      const eid = [2 * n, 2 * (n + 1) + 1, 2 * (n + nx), 2 * n + 1];
      const corners = [[0, 1], [1, 2], [3, 2], [0, 3]];        // each edge's two corners (index into v)
      const cpos = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const point = (e) => {
        const [a, b] = corners[e], t = Math.min(1 - 1e-6, Math.max(1e-6, (L - v[a]) / (v[b] - v[a])));
        return [cpos[a][0] + (cpos[b][0] - cpos[a][0]) * t, cpos[a][1] + (cpos[b][1] - cpos[a][1]) * t];
      };
      const crossed = [0, 1, 2, 3].filter((e) => up[corners[e][0]] !== up[corners[e][1]]);
      let pairs;
      if (crossed.length === 2) pairs = [crossed];
      else {
        // a saddle: the centre's height decides which diagonal is joined; the two other corners are cut off (corner 1
        // lies between the top and right edges, 3 between the bottom and left ones, 0 top and left, 2 right and bottom)
        const centre = (v[0] + v[1] + v[2] + v[3]) / 4 >= L;
        pairs = up[0] === centre ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
      }
      let lv = byLevel.get(k);
      if (!lv) byLevel.set(k, (lv = { from: new Map(), segs: [] }));
      for (let [e1, e2] of pairs) {
        let p = point(e1), q = point(e2);
        // orientation: the higher ground on the right of p → q (y down). The corner shared by both edges, else corner 0.
        const shared = corners[e1].find((c) => corners[e2].includes(c));
        const c = shared ?? 0, cp = cpos[c];
        const cross = (q[0] - p[0]) * (cp[1] - p[1]) - (q[1] - p[1]) * (cp[0] - p[0]);
        // in a y-down frame, cross > 0 means the corner lies to the right of p → q
        if ((cross > 0) !== up[c]) { [e1, e2] = [e2, e1]; [p, q] = [q, p]; }
        const s = lv.segs.length;
        lv.segs.push([eid[e1], eid[e2], p, q]);
        lv.from.set(eid[e1], s);
      }
    }
  }
  const out = [];
  for (const [k, { from, segs }] of byLevel) {
    const used = new Uint8Array(segs.length), to = new Set(segs.map((s) => s[1]));
    const walk = (s0) => {
      const pts = [segs[s0][2]];
      let s = s0;
      for (;;) {
        used[s] = 1;
        pts.push(segs[s][3]);
        const nx2 = from.get(segs[s][1]);
        if (nx2 === undefined) return { pts, closed: false };
        if (nx2 === s0) return { pts, closed: true };
        if (used[nx2]) return { pts, closed: false };
        s = nx2;
      }
    };
    // open lines first (from a segment nothing leads to), then the loops
    for (let s = 0; s < segs.length; s++) if (!used[s] && !to.has(segs[s][0])) out.push({ level: base + k * interval, k, ...walk(s) });
    for (let s = 0; s < segs.length; s++) if (!used[s]) out.push({ level: base + k * interval, k, ...walk(s) });
  }
  return out;
}

const smooth1 = (pts, closed) => {
  const n = pts.length;
  if (n < 3) return pts;
  const out = pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return p;
    const a = pts[closed && i === 0 ? n - 2 : i - 1], b = pts[closed && i === n - 1 ? 1 : i + 1];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
  });
  if (closed) out[n - 1] = out[0];
  return out;
};
const lengthOf = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/**
 * Contour objects from a grid { z, nx, ny, x0, y0, step }: node (i, j) at map mm (x0 + i × step, y0 − j × step) — row 0 at
 * the top, step in map mm —, heights in metres. opts: interval, indexEvery, formLines, scale (the map's, for the form lines'
 * gentleness), and DEFAULTS' others. Returns { objects, counts }.
 */
export function contourObjects(grid, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { z, nx, ny, x0, y0, step } = grid;
  const scale = o.scale || 10000, stepM = (step * scale) / 1000;
  const toMm = ([i, j]) => [x0 + i * step, y0 - j * step];
  const objects = [], counts = { contour: 0, index: 0, form: 0, knoll: 0, depression: 0, dropped: 0 };
  const hAt = (i, j) => z[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const bilinear = (x, y) => {
    const i = Math.max(0, Math.min(nx - 1.0001, x)), j = Math.max(0, Math.min(ny - 1.0001, y)), i0 = Math.floor(i), j0 = Math.floor(j), fx = i - i0, fy = j - j0;
    return (1 - fy) * ((1 - fx) * hAt(i0, j0) + fx * hAt(i0 + 1, j0)) + fy * ((1 - fx) * hAt(i0, j0 + 1) + fx * hAt(i0 + 1, j0 + 1));
  };
  const finish = (pts, closed) => simplify(smoothN(pts, closed).map(toMm), o.tolerance);
  const smoothN = (pts, closed) => { let p = pts; for (let s = 0; s < o.smooth; s++) p = smooth1(p, closed); return p; };
  const line = (sym, pts) => objects.push({ sym, otp: 2, ang: 0, coords: pts.map(([x, y]) => ocad(x, y)), src: "dem", draft: true });
  const point = (sym, [x, y]) => objects.push({ sym, otp: 1, ang: 0, coords: [ocad(x, y)], src: "dem", draft: true });

  for (const c of isolines(z, nx, ny, o.interval)) {
    const mm = finish(c.pts, c.closed);
    if (c.closed) {
      // a loop's size across (map mm) and what it holds: a knoll's top or a depression's bottom
      let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
      for (const [i, j] of c.pts) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      const across = Math.max(i1 - i0, j1 - j0) * step;
      if (across < o.minLoop) {
        let ext = -Infinity, low = Infinity;
        for (let j = Math.ceil(j0); j <= Math.floor(j1); j++) for (let i = Math.ceil(i0); i <= Math.floor(i1); i++) { const h = hAt(i, j); ext = Math.max(ext, h); low = Math.min(low, h); }
        const cx = (i0 + i1) / 2, cy = (j0 + j1) / 2, knoll = bilinear(cx, cy) >= c.level;
        // its relief against the ground round it: the mean height on a box twice the loop's size (a knoll on a slope too)
        const r = Math.max(2, i1 - i0, j1 - j0);
        let sum = 0, n = 0;
        for (let q = 0; q <= 16; q++) {
          const u = -r + (2 * r * q) / 16;
          for (const [x, y] of [[cx + u, cy - r], [cx + u, cy + r], [cx - r, cy + u], [cx + r, cy + u]]) { const h = bilinear(x, y); if (Number.isFinite(h)) { sum += h; n++; } }
        }
        const around = n ? sum / n : c.level, relief = knoll ? ext - around : around - low;
        if (Number.isFinite(relief) && relief >= o.minRelief) {
          // where the feature is: its top or bottom node, else the loop's middle
          let best = [cx, cy], bv = knoll ? -Infinity : Infinity;
          for (let j = Math.ceil(j0); j <= Math.floor(j1); j++) for (let i = Math.ceil(i0); i <= Math.floor(i1); i++) {
            const h = hAt(i, j);
            if (knoll ? h > bv : h < bv) { bv = h; best = [i, j]; }
          }
          point(knoll ? SYM.knoll : SYM.depression, toMm(best));
          counts[knoll ? "knoll" : "depression"]++;
        } else counts.dropped++;
        continue;
      }
    } else if (lengthOf(mm) < o.minLine) { counts.dropped++; continue; }
    const index = o.indexEvery > 0 && c.k % o.indexEvery === 0;
    line(index ? SYM.index : SYM.contour, mm);
    counts[index ? "index" : "contour"]++;
  }

  if (o.formLines) {
    // the gradient (m per m) at a grid point; form lines kept where the contours lie further apart than formSpacing mm
    const grad = (x, y) => {
      const gx = (bilinear(x + 1, y) - bilinear(x - 1, y)) / (2 * stepM), gy = (bilinear(x, y + 1) - bilinear(x, y - 1)) / (2 * stepM);
      return Math.hypot(gx, gy);
    };
    const gentle = (x, y) => { const g = grad(x, y); return g <= 0 || ((o.interval / g) * 1000) / scale > o.formSpacing; };
    for (const c of isolines(z, nx, ny, o.interval, o.interval / 2)) {
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const mm = finish(run, false);
          if (lengthOf(mm) >= o.formMinLength) { line(SYM.form, mm); counts.form++; }
        }
        run = [];
      };
      for (const p of c.pts) { if (gentle(p[0], p[1])) run.push(p); else flush(); }
      if (c.closed && run.length === c.pts.length) {
        // a whole gentle loop: kept closed unless too small (form lines make no knolls)
        const mm = finish(c.pts, true);
        if (lengthOf(mm) >= o.formMinLength) { line(SYM.form, mm); counts.form++; }
        run = [];
      } else flush();
    }
  }
  return { objects, counts };
}

/**
 * Contours for a rectangle of the map ([x0, y0, x1, y1] in map mm) through the frame (frame.js): the heights asked of
 * IGN (France) or the terrain tiles every opts.stepM metres (2 by default; coarser when the grid would pass maxNodes), then
 * contourObjects. Resolves { objects, counts, source, credit, grid: { nx, ny, stepM } }. onProgress(f) from 0 to 1.
 */
export async function loadContours(frame, rect, opts = {}) {
  const [x0, y0, x1, y1] = rect, scale = frame.scale;
  const maxNodes = opts.maxNodes || 250000;
  let stepM = opts.stepM || 2;
  const wm = ((x1 - x0) * scale) / 1000, hm = ((y1 - y0) * scale) / 1000;
  stepM = Math.max(stepM, Math.sqrt((wm * hm) / maxNodes));
  const step = (stepM * 1000) / scale, nx = Math.floor((x1 - x0) / step) + 1, ny = Math.floor((y1 - y0) / step) + 1;
  const node = (i, j) => frame.toLatLon(x0 + i * step, y1 - j * step);
  const key = `mapper:${frame.name}:${rect.map((v) => v.toFixed(1)).join(",")}`;
  const g = await loadGrid({ key, nx, ny, step: stepM, node, onProgress: opts.onProgress });
  const r = contourObjects({ z: g.z, nx, ny, x0, y0: y1, step }, { ...opts, scale });
  return { ...r, source: g.source, credit: CREDIT[g.source] || CREDIT.tiles, grid: { nx, ny, stepM } };
}

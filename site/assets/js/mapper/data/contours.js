// Contours from a terrain model (Cartographier): a grid of heights laid square in the map's millimetres — IGN's RGE ALTI in
// France through its elevation service, the national LiDAR models of Switzerland (swissALTI3D), the USA (3DEP), Canada (HRDEM)
// and New Zealand (LINZ) since 2026-11-06, else the AWS terrain tiles (trace/terrain.js loadGrid, whose CREDIT names each
// source: `credit` below) —, cut by marching squares at
// every interval (2.5 or 5 m), the pieces joined into long lines, lightly smoothed and simplified (Douglas-Peucker in map mm),
// then turned into line objects: 101.0 contour, 102.0 index contour (every fifth), 103.0 form line (half an interval, only
// where the ground is gentle). A closed contour too small to be drawn as a loop becomes a point: 109.0 small knoll or
// 111.0 small depression. Every object is { sym, otp, ang, coords, src: "dem", draft: true } (the document gives ids).
// The lines are Bézier curves through their points (a mapper's review, 2026-11-12: a contour bends on the ground; `curve`).
// A sprint map's follow the town plan's rules (sprintObjects: smoothed over 4 m, rounded, dropped or kept whole, cut at buildings).

import { ocad, simplify, bezier } from "./frame.js";
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
  curve: true,          // the lines as Bézier curves through their points
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

// ---- a sprint map's contours (owner, 2026-11-12): the town plan's rules (tools/virtually/town_map.py, its contours) — a town's
// ground holds kerbs, walls, embankments and the model's gaps, whose raw isolines follow every one of them ----------------------
export const SPRINT = {
  smoothM: 4,           // m: the ground smoothed over 4 m (a Gaussian, σ)
  chaikin: 2,           // passes of Chaikin's corner cutting
  tolM: 0.3,            // m: Douglas-Peucker after it
  minLoopM2: 600,       // m²: a closed contour smaller than this is dropped whole (no knoll or depression point)
  minLineM: 40,         // m: an open contour shorter than this is dropped whole
  minPieceM: 3,         // m: a piece left between two buildings shorter than this is left out
};

/** z smoothed by a Gaussian of σ cells (separable, the missing nodes left out of each mean). */
export function gaussian(z, nx, ny, sigma) {
  if (!(sigma > 0.3)) return z;
  const r = Math.ceil(3 * sigma), w = [];
  for (let d = -r; d <= r; d++) w.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  const pass = (src, horiz) => {
    const out = new Float64Array(src.length);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0, ws = 0;
      for (let d = -r; d <= r; d++) {
        const ii = horiz ? i + d : i, jj = horiz ? j : j + d;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const v = src[jj * nx + ii];
        if (Number.isNaN(v)) continue;
        s += w[d + r] * v; ws += w[d + r];
      }
      out[j * nx + i] = Number.isNaN(src[j * nx + i]) || !ws ? NaN : s / ws;
    }
    return out;
  };
  return pass(pass(z, true), false);
}

/** Chaikin's corner cutting, n passes (a closed line repeats its first point, and keeps doing so). As town_map.py's chaikin. */
export function chaikin(pts, n = 2, closed = false) {
  let p = pts;
  for (let k = 0; k < n && p.length > 2; k++) {
    const mid = [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      mid.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = closed ? [...mid, mid[0]] : [p[0], ...mid, p[p.length - 1]];
  }
  return p;
}

/**
 * Areas (each [[x, y]…] rings, the first outer, the others holes; even-odd) made ready for cutting lines: their edges in a grid of
 * cells, their boxes. cell in map mm.
 */
export function areaIndex(areas, cell = 2) {
  const polys = [], cells = new Map(), key = (i, j) => `${i},${j}`;
  for (const rings of areas) {
    const rs = rings.filter((r) => r.length >= 3);
    if (!rs.length) continue;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rs) for (const [x, y] of r) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    const pi = polys.push({ rings: rs, b }) - 1;
    for (const r of rs) for (let k = 0; k < r.length; k++) {
      const a = r[k], c = r[(k + 1) % r.length];
      if (a[0] === c[0] && a[1] === c[1]) continue;
      const i0 = Math.floor(Math.min(a[0], c[0]) / cell), i1 = Math.floor(Math.max(a[0], c[0]) / cell);
      const j0 = Math.floor(Math.min(a[1], c[1]) / cell), j1 = Math.floor(Math.max(a[1], c[1]) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) (cells.get(key(i, j)) || cells.set(key(i, j), []).get(key(i, j))).push([a, c, pi]);
    }
  }
  const inside = (x, y) => polys.some(({ rings, b }) => {
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    let c = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  });
  return { polys, cells, cell, inside, empty: !polys.length };
}

/** A line [[x, y]…] less the areas of an areaIndex: the pieces outside, cut exactly at the areas' edges. */
export function cutLine(pts, idx) {
  if (idx.empty || pts.length < 2) return [pts];
  const out = [];
  let cur = null;
  const keep = (a, b) => {
    if (cur && cur[cur.length - 1][0] === a[0] && cur[cur.length - 1][1] === a[1]) cur.push(b);
    else { if (cur) out.push(cur); cur = [a, b]; }
  };
  for (let s = 1; s < pts.length; s++) {
    const a = pts[s - 1], b = pts[s], dx = b[0] - a[0], dy = b[1] - a[1];
    // the edges near the segment: their crossings' parameters along it
    const c = idx.cell, ts = [0, 1], seen = new Set();
    const i0 = Math.floor(Math.min(a[0], b[0]) / c), i1 = Math.floor(Math.max(a[0], b[0]) / c);
    const j0 = Math.floor(Math.min(a[1], b[1]) / c), j1 = Math.floor(Math.max(a[1], b[1]) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const e of idx.cells.get(`${i},${j}`) || []) {
      if (seen.has(e)) continue;
      seen.add(e);
      const [p, q] = e, ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den, u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1], t1 = ts[k];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      if (idx.inside(a[0] + dx * tm, a[1] + dy * tm)) { if (cur) { out.push(cur); cur = null; } continue; }
      const at = (t) => (t === 0 ? a : t === 1 ? b : [a[0] + dx * t, a[1] + dy * t]);   // the line's own points kept exact: pieces join
      keep(at(t0), at(t1));
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * A sprint map's contours from the grid (contourObjects' grid): the ground smoothed over 4 m, each line rounded (Chaikin), a
 * line dropped or kept whole — no closed loop under 600 m², no open line under 40 m —, then cut exactly at the buildings'
 * outlines (opts.buildings: [[ring…]…] in map mm), so that a contour ends only at a building or the map's edge. No form lines,
 * knolls or depressions. Returns { objects, counts }.
 */
function sprintObjects(grid, o) {
  const { z, nx, ny, x0, y0, step } = grid, S = { ...SPRINT, ...(o.sprintRules || {}) };
  const scale = o.scale || 4000, mPerMm = scale / 1000, stepM = step * mPerMm;
  const sm = gaussian(z, nx, ny, S.smoothM / stepM);
  const idx = areaIndex(o.buildings || [], Math.max(1, 4 / mPerMm));
  const toMm = ([i, j]) => [x0 + i * step, y0 - j * step];
  const objects = [], counts = { contour: 0, index: 0, form: 0, knoll: 0, depression: 0, dropped: 0, cut: 0 };
  for (const c of isolines(sm, nx, ny, o.interval)) {
    if (c.pts.length < 6) { counts.dropped++; continue; }
    let mm = c.pts.map(toMm);
    if (c.closed) {
      let a = 0;
      for (let i = 1; i < mm.length; i++) a += mm[i - 1][0] * mm[i][1] - mm[i][0] * mm[i - 1][1];
      if ((Math.abs(a) / 2) * mPerMm * mPerMm < S.minLoopM2) { counts.dropped++; continue; }
    }
    mm = simplify(chaikin(mm, S.chaikin, c.closed), S.tolM / mPerMm);
    if (!c.closed && lengthOf(mm) * mPerMm < S.minLineM) { counts.dropped++; continue; }
    const index = o.indexEvery > 0 && c.k % o.indexEvery === 0, sym = index ? SYM.index : SYM.contour;
    const pieces = cutLine(mm, idx);
    if (pieces.length !== 1 || pieces[0].length !== mm.length) counts.cut++;
    for (const p of pieces) {
      if (lengthOf(p) * mPerMm < S.minPieceM) continue;
      objects.push({ sym, otp: 2, ang: 0, coords: o.curve ? bezier(p) : p.map(([x, y]) => ocad(x, y)), src: "dem", draft: true });
      counts[index ? "index" : "contour"]++;
    }
  }
  return { objects, counts };
}

/**
 * Contour objects from a grid { z, nx, ny, x0, y0, step }: node (i, j) at map mm (x0 + i × step, y0 − j × step) — row 0 at
 * the top, step in map mm —, heights in metres. opts: interval, indexEvery, formLines, scale (the map's, for the form lines'
 * gentleness), and DEFAULTS' others; sprint true: a town's sprint map's rules (sprintObjects, opts.buildings). Returns
 * { objects, counts }.
 */
export function contourObjects(grid, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (o.sprint) return sprintObjects(grid, o);
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
  const line = (sym, pts) => objects.push({ sym, otp: 2, ang: 0, coords: o.curve ? bezier(pts) : pts.map(([x, y]) => ocad(x, y)), src: "dem", draft: true });
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
 * IGN (France), a national model (terrain.js sourcesAt) or the terrain tiles every opts.stepM metres (2 by default; coarser when the grid would pass maxNodes), then
 * contourObjects (opts.sprint, opts.buildings: a sprint map's rules). Resolves { objects, counts, source, credit, grid: { nx, ny, stepM } }. onProgress(f) from 0 to 1.
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

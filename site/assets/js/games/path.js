// Shortest and fastest ways across a generated map: a cost grid from the map's type raster (ground cost, climb),
// Dijkstra over it (8 neighbours), the straightened path, and the cost of any polyline.

import { COST, IMPASSABLE, typeAt, clearLine, dist } from "./mapgen.js";

/**
 * The grid: cell × cell map units per node; cost per node (1 = white forest), height per node, blocked nodes.
 * climb / descent: the equivalent flat metres per metre climbed / descended.
 */
export function costGrid(map, raster = map.raster, { cell = 2, climb = 8, descent = 1.5 } = {}) {
  const gw = Math.ceil(map.w / cell), gh = Math.ceil(map.h / cell);
  const cost = new Float32Array(gw * gh), hgt = new Float32Array(gw * gh), blocked = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let sum = 0, n = 0, bad = false;
    for (let y = j * cell; y < Math.min((j + 1) * cell, map.h); y++) for (let x = i * cell; x < Math.min((i + 1) * cell, map.w); x++) {
      const t = raster[y * map.w + x];
      if (t >= IMPASSABLE) bad = true;
      else { sum += COST[t - (t % 16)] ?? 1; n++; }
    }
    const k = j * gw + i;
    blocked[k] = bad || !n ? 1 : 0;
    cost[k] = n ? sum / n : 1;
    hgt[k] = map.field ? map.field.at((i + 0.5) * cell, (j + 0.5) * cell) : 0;
  }
  return { map, gw, gh, cell, cost, hgt, blocked, climb, descent };
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** Binary heap of [key, value]. */
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/** The node of a map point. */
const node = (g, p) => [Math.min(g.gw - 1, Math.max(0, Math.floor(p[0] / g.cell))), Math.min(g.gh - 1, Math.max(0, Math.floor(p[1] / g.cell)))];

/**
 * The cheapest way from a to b (map points): {cost, pts (cell centres), simple (straightened), length} or null.
 * extra(k): an added cost per node (to push a route away from another, for alternatives).
 */
export function dijkstra(g, a, b, { extra = null, pull = true } = {}) {
  const [ax, ay] = node(g, a), [bx, by] = node(g, b);
  const N = g.gw * g.gh, start = ay * g.gw + ax, goal = by * g.gw + bx;
  const D = new Float64Array(N).fill(Infinity), P = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  D[start] = 0;
  const h = new Heap(); h.push(0, start);
  while (h.size) {
    const [d, k] = h.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const x = k % g.gw, y = (k - x) / g.gw;
    for (const [dx, dy, s] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.gw || ny >= g.gh) continue;
      const nk = ny * g.gw + nx;
      if (g.blocked[nk] || done[nk]) continue;
      // a diagonal step must not squeeze between two blocked cells
      if (dx && dy && g.blocked[y * g.gw + nx] && g.blocked[ny * g.gw + x]) continue;
      const dh = g.hgt[nk] - g.hgt[k];
      const step = s * g.cell * (g.cost[k] + g.cost[nk]) / 2 + (dh > 0 ? g.climb * dh : -g.descent * dh) + (extra ? extra(nk) : 0);
      const nd = d + step;
      if (nd < D[nk]) { D[nk] = nd; P[nk] = k; h.push(nd, nk); }
    }
  }
  if (!isFinite(D[goal])) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = P[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => [((k % g.gw) + 0.5) * g.cell, (Math.floor(k / g.gw) + 0.5) * g.cell]);
  pts[0] = [a[0], a[1]]; pts[pts.length - 1] = [b[0], b[1]];
  const simple = pull ? stringPull(g.map, pts) : simplify(pts, 2.5);
  return { cost: D[goal], pts, simple, length: simple.reduce((s, p, i) => (i ? s + dist(simple[i - 1], p) : 0), 0) };
}

/** Straightens a path where the straight line stays passable (the shortest route in a street map). */
export function stringPull(map, pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(map, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Douglas–Peucker. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0, wi = 0;
  const L = dist(a, b) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (d > worst) { worst = d; wi = i; }
  }
  if (worst <= tol) return [a, b];
  return simplify(pts.slice(0, wi + 1), tol).slice(0, -1).concat(simplify(pts.slice(wi), tol));
}

/** The cost of running along a polyline: flat-equivalent metres (ground cost × metres, plus the climb). */
export function routeCost(map, pts, { climb = 8, descent = 1.5 } = {}) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = dist(a, b), n = Math.max(1, Math.ceil(d));
    let hp = map.field ? map.field.at(a[0], a[1]) : 0;
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const ty = typeAt(map, x, y);
      total += (d / n) * (ty >= IMPASSABLE ? 6 : COST[ty - (ty % 16)] ?? 1);
      if (map.field) { const h = map.field.at(x, y); const dh = h - hp; total += dh > 0 ? climb * dh : -descent * dh; hp = h; }
    }
  }
  return total;
}

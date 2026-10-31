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

const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBY = [0, 0, 1, -1, 1, -1, 1, -1], NBS = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
/** The cheapest ground of a grid (A*'s lower bound). */
function minOf(cost, blocked) { let m = Infinity; for (let k = 0; k < cost.length; k++) if (!blocked[k] && cost[k] < m) m = cost[k]; return isFinite(m) ? m : 1; }

/** Binary heap of (key, value) pairs in two flat arrays: no object per entry (Edge without its JIT is ten times slower). */
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const K = this.k, V = this.v;
    let i = K.length;
    K.push(key); V.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  /** Takes the value of the smallest key. */
  pop() {
    const K = this.k, V = this.v, top = V[0];
    const key = K.pop(), val = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1, mk = key;
        if (l < n && K[l] < mk) { m = l; mk = K[l]; }
        if (r < n && K[r] < mk) { m = r; mk = K[r]; }
        if (m < 0) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
  get size() { return this.k.length; }
}

/** The node of a map point. */
const node = (g, p) => [Math.min(g.gw - 1, Math.max(0, Math.floor(p[0] / g.cell))), Math.min(g.gh - 1, Math.max(0, Math.floor(p[1] / g.cell)))];

/**
 * The cheapest way from a to b (map points): {cost, pts (cell centres), simple (straightened), length} or null.
 * extra: an added cost per node (to push a route away from another, for alternatives), a function of the node or an array.
 * A* (2026-10-31): the octile distance at the grid's cheapest ground is a lower bound of what is left, so the cost found is
 * Dijkstra's, with far fewer nodes looked at.
 */
export function dijkstra(g, a, b, { extra = null, pull = true } = {}) {
  const [ax, ay] = node(g, a), [bx, by] = node(g, b);
  const N = g.gw * g.gh, start = ay * g.gw + ax, goal = by * g.gw + bx, gw = g.gw, gh = g.gh;
  const D = new Float64Array(N).fill(Infinity), P = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const blocked = g.blocked, cost = g.cost, hgt = g.hgt, cell = g.cell, climb = g.climb, descent = g.descent;
  const xf = typeof extra === "function" ? extra : null, xa = extra && !xf ? extra : null;
  const low = cell * (g.minCost ??= minOf(cost, blocked)), SQ = Math.SQRT2 - 1;
  const hOf = (x, y) => { const dx = Math.abs(x - bx), dy = Math.abs(y - by); return low * (dx > dy ? dx + SQ * dy : dy + SQ * dx); };
  D[start] = 0;
  const h = new Heap(); h.push(hOf(ax, ay), start);
  while (h.size) {
    const k = h.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const d = D[k], x = k % gw, y = (k - x) / gw, ck = cost[k], hk = hgt[k];
    for (let q = 0; q < 8; q++) {
      const dx = NBX[q], dy = NBY[q], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const nk = ny * gw + nx;
      if (blocked[nk] || done[nk]) continue;
      // a diagonal step must not squeeze between two blocked cells
      if (dx && dy && blocked[y * gw + nx] && blocked[ny * gw + x]) continue;
      const dh = hgt[nk] - hk;
      const step = NBS[q] * cell * (ck + cost[nk]) / 2 + (dh > 0 ? climb * dh : -descent * dh) + (xf ? xf(nk) : xa ? xa[nk] : 0);
      const nd = d + step;
      if (nd < D[nk]) { D[nk] = nd; P[nk] = k; h.push(nd + hOf(nx, ny), nk); }
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

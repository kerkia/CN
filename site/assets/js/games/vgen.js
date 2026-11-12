// Pixel's invented terrain (owner, 2026-11-12: « realistic invented forests by terrain type » and « generation in the browser »):
// one world model from a seed, from which both the orienteering map (ISOM 2017-2 objects) and the 3D world's package (heights,
// ground classes, vegetation densities, the ground's colours, rocks, cliffs, features) are drawn, so that they agree by
// construction. Shared by the browser (games/vgenworker.js, Training's « Terrain imaginaire » and « Carte du jour ») and the
// offline races (tools/virtually/gen.mjs, then course.py as for any package).
//
// The rules that keep map and world together:
// - the relief is the world's first: a height field on a 2 m grid, the 1 m ground its bilinear interpolation, the contours traced on
//   that grid (marching squares), so a contour lies where the ground has its height;
// - every area (vegetation, marsh, water, rock) is the region where a smooth field is above zero, traced the same way: its polygon
//   on the map and its cells in the world are the same region;
// - features are objects first: a knoll, a pit, a boulder, a cliff exists as an object, added to the ground or to the rocks, and
//   drawn on the map as its ISOM symbol; paths are polylines routed on the ground, drawn on the map and stamped into the classes.
//
// Deterministic by design (the « Carte du jour »: everyone must get the same world from one seed, whatever their browser): only
// + − × ÷, Math.sqrt, Math.floor and integer hashing decide the world (JavaScript engines may differ in the last bit of sin, exp,
// pow, atan2…, which are used only to draw, never to decide). No time budget anywhere.

// ---- the ground classes and speeds (tools/virtually/build.py's, same order: the game and course.py read them by index) ----------
export const CL = ["forest", "open", "open_t", "rough", "rough_t", "slow", "slow_vis", "walk", "walk_vis", "fight", "paved", "rock",
  "building", "path", "road", "stony", "bfield", "water", "track", "marsh", "marsh_x", "shallow", "cliff", "oob", "cultivated", "stream",
  "rockstep", "outside", "block", "small_path", "stairs"];
const C = Object.fromEntries(CL.map((n, i) => [n, i]));
export const SPEED = { forest: 0.82, open: 1.0, open_t: 0.95, rough: 0.78, rough_t: 0.74, slow: 0.6, slow_vis: 0.68, walk: 0.4, walk_vis: 0.46,
  fight: 0.2, paved: 1.05, rock: 0.7, path: 1.0, road: 1.05, stony: 0.62, bfield: 0.42, track: 1.02, marsh: 0.5, shallow: 0.3, cultivated: 0.8,
  stream: 0.55, rockstep: 0.3, small_path: 0.95, stairs: 0.55, building: 0, water: 0, marsh_x: 0, cliff: 0, oob: 0, outside: 0, block: 0 };
// vegetation densities per m² by class (build.py's), and the factors that pack them into bytes
const TREE = { forest: 1 / 42, open_t: 1 / 450, rough_t: 1 / 260, slow: 1 / 38, slow_vis: 1 / 42, walk: 1 / 32, walk_vis: 1 / 38, fight: 1 / 28,
  marsh: 1 / 500, stony: 1 / 70, bfield: 1 / 120, rock: 1 / 400, cultivated: 1 / 900 };
const BUSH = { forest: 1 / 400, rough: 1 / 160, rough_t: 1 / 140, slow: 1 / 9, walk: 1 / 4.5, fight: 1 / 2.2, marsh: 1 / 90, stony: 1 / 200, open_t: 1 / 600 };
const LOW = { forest: 1 / 35, open: 1 / 18, open_t: 1 / 14, rough: 1 / 2.6, rough_t: 1 / 2.8, slow_vis: 1 / 1.6, walk_vis: 1 / 0.9, marsh: 1 / 1.8,
  marsh_x: 1 / 1.2, slow: 1 / 6, walk: 1 / 5, cultivated: 1 / 25 };
export const VEG_K = [255 / 0.05, 255 / 0.5, 255 / 1.2];
const COL = { forest: [98, 82, 58], open: [176, 168, 96], open_t: [166, 160, 92], rough: [150, 136, 92], rough_t: [142, 128, 88], slow: [86, 84, 54],
  slow_vis: [92, 92, 58], walk: [74, 78, 48], walk_vis: [80, 86, 52], fight: [64, 72, 44], paved: [110, 108, 104], rock: [150, 146, 138],
  path: [196, 178, 140], small_path: [170, 150, 112], road: [90, 90, 92], stony: [140, 134, 120], bfield: [148, 144, 134], water: [52, 74, 86],
  track: [186, 168, 130], marsh: [84, 96, 70], marsh_x: [70, 88, 74], shallow: [78, 98, 104], cliff: [132, 128, 120], cultivated: [150, 156, 90],
  stream: [70, 90, 96], rockstep: [140, 136, 128], outside: [110, 104, 86] };
// a rock's size and how far it is sunk, by kind (build.py's ROCK)
const ROCK = { boulder: [1.0, 0.25], bigboulder: [2.4, 0.4], cluster: [0.9, 0.2], bfield: [0.7, 0.2], stony: [0.35, 0.08], giant: [5.0, 0.6] };

export const TYPES = ["moraine", "karst", "sandrock", "valley", "pine"];
/** The terrain types' look (games/vworld.js's biome: ground colours by class, leaves, conifers' share, rocks, sky, haze, sun). */
export const BIOMES = {
  moraine: { name: "Boreal moraine: pine, spruce and birch on moss", conifer: 0.7, crown: "broadleaf",
    ground: { forest: [84, 82, 56], open: [150, 150, 88], rough: [128, 126, 78], marsh: [96, 104, 64], bfield: [150, 148, 136], stony: [134, 130, 116] },
    leaf: ["#5f8a3c", "#6b9443", "#557e36", "#79a14e"], leafDry: 0.03, trunk: "#cfc9bc", trunk2: "#6a5c4c",
    coniferLeaf: ["#2a4a2c", "#2f5232", "#24402a", "#35583a"], rock: ["#a9a69d", "#b4b0a5", "#9c9990", "#bdb9ae"],
    bush: ["#4c6c31", "#557638", "#3f5f2a"], low: ["#6e8c3e", "#7a9446", "#62803a", "#8a9a50"], fog: "#d3dbe0", zenith: "#7da2c8", sun: [-0.5, 0.55, 0.62] },
  karst: { name: "Beech and fir on limestone", conifer: 0.45, crown: "broadleaf",
    ground: { forest: [88, 80, 58], open: [132, 150, 80], rough: [126, 132, 76], rock: [184, 180, 168], stony: [156, 150, 134] },
    leaf: ["#4e7034", "#5a7d3b", "#46682f", "#62843f"], leafDry: 0.05, trunk: "#8a8478", trunk2: "#6a6156",
    coniferLeaf: ["#24402a", "#2b4930", "#203a25"], rock: ["#cdc8ba", "#c1bbac", "#d6d2c6", "#b6af9f"],
    bush: ["#4a6a30", "#557538", "#3f5f2a"], low: ["#6a8a40", "#75944a", "#5f7f3a", "#82964e"], fog: "#cfdae4", zenith: "#7299c6", sun: [-0.45, 0.7, 0.55] },
  sandrock: { name: "Scots pine and birch on sand and sandstone", conifer: 0.75, crown: "broadleaf",
    ground: { forest: [132, 112, 80], open: [196, 178, 128], rough: [176, 156, 108], rock: [170, 160, 140], bfield: [176, 166, 146], cliff: [164, 156, 138] },
    leaf: ["#6b8a3e", "#7a9446", "#5f7f3a"], leafDry: 0.1, trunk: "#9a6e4e", trunk2: "#6e5440",
    coniferLeaf: ["#3a5a34", "#46663a", "#33522f"], rock: ["#b5aa94", "#c2b7a0", "#a89c86", "#cbbfa6"],
    bush: ["#5a6f34", "#647a3a", "#4f6530"], low: ["#8a8a50", "#94925a", "#7f8048", "#a09a62"], fog: "#dcdcd4", zenith: "#7ea4cc", sun: [-0.4, 0.75, 0.5] },
  valley: { name: "Mixed broadleaf forest on steep slopes", conifer: 0.3, crown: "broadleaf",
    ground: { forest: [92, 78, 54], open: [140, 152, 82], rough: [128, 130, 76], rock: [160, 156, 146], rockstep: [160, 156, 146] },
    leaf: ["#4f7434", "#5b803a", "#476a2e", "#668a42"], leafDry: 0.08, trunk: "#7e786c", trunk2: "#62584c",
    coniferLeaf: ["#26432b", "#2d4c31"], rock: ["#a8a49a", "#b3aea2", "#9c978c"],
    bush: ["#4a6a30", "#557538", "#3f5f2a"], low: ["#6a8a40", "#75944a", "#5f7f3a"], fog: "#cbd5dc", zenith: "#6f98c4", sun: [-0.5, 0.6, 0.6] },
  pine: { name: "Maritime pine plantation on sand", conifer: 0.97, crown: "broadleaf",
    ground: { forest: [138, 118, 82], open: [190, 176, 120], rough: [170, 150, 96], slow: [118, 106, 70], walk: [104, 98, 64], marsh: [110, 110, 74] },
    leaf: ["#6b8a3e", "#5f7f3a"], leafDry: 0.05, trunk: "#7a5a42", trunk2: "#6a4e3a",
    coniferLeaf: ["#3d5c33", "#46663a", "#34522e", "#4f6e40"], rock: ["#b0a690"],
    bush: ["#5d7134", "#677c3a", "#526830"], low: ["#8a8a50", "#94925a", "#7f8048", "#9a945c"], fog: "#dedcd2", zenith: "#82a8cc", sun: [-0.35, 0.8, 0.45] },
};
// what each type is made of: base relief (m, per octave), contour interval, features per km² at detail 1, ground cover
const RECIPES = {
  moraine: { relief: [7, 5, 2.5, 1.1], scales: [520, 230, 95, 38], interval: 2.5, knolls: 70, pits: 30, depressions: 10, boulders: 120, giants: 0,
    clusters: 18, lakes: 3, marsh: 0.42, open: 0.18, green: 0.35, rock: 0, stony: 0.06, eskers: 2, dolines: 0, hubs: 10 },
  karst: { relief: [16, 9, 3, 1], scales: [600, 260, 110, 45], interval: 5, knolls: 15, pits: 35, depressions: 12, boulders: 30, giants: 0,
    clusters: 6, lakes: 0, marsh: 0, open: 0.3, green: 0.3, rock: 0.08, stony: 0.14, eskers: 0, dolines: 34, hubs: 10 },
  sandrock: { relief: [10, 7, 3, 1], scales: [560, 240, 100, 40], interval: 5, knolls: 20, pits: 12, depressions: 6, boulders: 110, giants: 26,
    clusters: 28, lakes: 0, marsh: 0, open: 0.22, green: 0.28, rock: 0.2, stony: 0.1, eskers: 0, dolines: 0, hubs: 14, ridges: 18 },
  valley: { relief: [14, 6, 2.2, 0.8], scales: [520, 220, 90, 36], interval: 5, knolls: 14, pits: 6, depressions: 4, boulders: 40, giants: 0,
    clusters: 8, lakes: 0, marsh: 0, open: 0.2, green: 0.36, rock: 0.1, stony: 0.08, eskers: 0, dolines: 0, hubs: 9, valleys: 70 },
  pine: { relief: [2.2, 1.6, 0.8, 0.4], scales: [500, 220, 90, 36], interval: 2.5, knolls: 20, pits: 14, depressions: 6, boulders: 0, giants: 0,
    clusters: 0, lakes: 0, marsh: 0.3, open: 0.12, green: 0.4, rock: 0, stony: 0, eskers: 0, dolines: 0, hubs: 6, parcels: true },
};

// ---- deterministic numbers ----------------------------------------------------------------------------------------------------
/** mulberry32: 32-bit integer steps, the result an exact binary fraction. */
export function prng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  return f;
}
/** A seed from text (a date, a name): FNV-1a. */
export function seedOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const hash2 = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** Value noise in [-1, 1] at (x, y) on a unit lattice, smooth (quintic fade). */
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fade(fx), v = fade(fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** A field on a grid of nx × ny nodes `step` m apart: sum of value noises (scale m, amplitude), seeded. */
function noiseField(nx, ny, step, octaves, seed) {
  const F = new Float32Array(nx * ny);
  octaves.forEach(([scale, amp], k) => {
    const s = (seed + k * 7919) | 0, f = step / scale, ox = hash2(k, 1, seed) * 97, oy = hash2(k, 2, seed) * 97;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[j * nx + i] += amp * vnoise(i * f + ox, j * f + oy, s);
  });
  return F;
}
const smoothstep = (e0, e1, x) => { const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0); return t * t * (3 - 2 * t); };
const bump = (d2, r2) => (d2 >= r2 ? 0 : (1 - d2 / r2) * (1 - d2 / r2));
/** A box blur of a grid (radius in nodes), three passes ≈ a Gaussian. */
function blur(F, nx, ny, r) {
  let a = Float32Array.from(F), b = new Float32Array(F.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < ny; j++) { let s = 0, n = 0; const o = j * nx;
      for (let i = -r; i < nx + r; i++) {
        if (i + r < nx) { s += a[o + Math.min(nx - 1, Math.max(0, i + r))]; n++; }
        if (i - r - 1 >= 0) { s -= a[o + i - r - 1]; n--; }
        if (i >= 0 && i < nx) b[o + i] = s / n;
      } }
    for (let i = 0; i < nx; i++) { let s = 0, n = 0;
      for (let j = -r; j < ny + r; j++) {
        if (j + r < ny) { s += b[Math.min(ny - 1, Math.max(0, j + r)) * nx + i]; n++; }
        if (j - r - 1 >= 0) { s -= b[(j - r - 1) * nx + i]; n--; }
        if (j >= 0 && j < ny) a[j * nx + i] = s / n;
      } }
  }
  return a;
}
/** Bilinear value of a grid at (x, y) in node units. */
function sample(F, nx, ny, x, y) {
  x = Math.max(0, Math.min(nx - 1.000001, x)); y = Math.max(0, Math.min(ny - 1.000001, y));
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, o = j * nx + i;
  return F[o] * (1 - u) * (1 - v) + F[o + 1] * u * (1 - v) + F[o + nx] * (1 - u) * v + F[o + nx + 1] * u * v;
}

/** A binary min-heap of node indices keyed by `key` (a Float64Array the caller fills). */
function heap(key, cap) {
  const a = new Int32Array(cap); let n = 0;
  return {
    get size() { return n; },
    push(q) { if (n === a.length) return; let k = n++; while (k) { const p = (k - 1) >> 1; if (key[a[p]] <= key[q]) break; a[k] = a[p]; k = p; } a[k] = q; },
    pop() {
      const top = a[0], last = a[--n]; let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = -1, mk = key[last];
        if (l < n && key[a[l]] < mk) { m = l; mk = key[a[l]]; } if (r < n && key[a[r]] < mk) m = r;
        if (m < 0) break; a[k] = a[m]; k = m; }
      a[k] = last; return top;
    },
  };
}

// ---- marching squares ---------------------------------------------------------------------------------------------------------
/** The isolines of a grid at `level`: polylines of [x, y] in node units; closed rings repeat their first point. */
export function isolines(F, nx, ny, level, cells = null) {
  const pts = new Map(), segs = [], byEdge = new Map();
  const at = (j, i) => F[j * nx + i];
  const edgePt = (id) => {
    if (pts.has(id)) return pts.get(id);
    const e = id >> 1, j = Math.floor(e / nx), i = e - j * nx;
    let p;
    if (!(id & 1)) { const a = at(j, i), b = at(j, i + 1); p = [i + (level - a) / (b - a), j]; }
    else { const a = at(j, i), b = at(j + 1, i); p = [i, j + (level - a) / (b - a)]; }
    pts.set(id, p); return p;
  };
  const add = (e1, e2) => { const k = segs.length; segs.push([e1, e2]); for (const e of [e1, e2]) { const l = byEdge.get(e); if (l) l.push(k); else byEdge.set(e, [k]); } };
  const nc = cells ? cells.length : (nx - 1) * (ny - 1);
  for (let k = 0; k < nc; k++) {
    const cell = cells ? cells[k] : k, j = Math.floor(cell / (nx - 1)), i = cell - j * (nx - 1);
    const a = at(j, i), b = at(j, i + 1), c = at(j + 1, i + 1), d = at(j + 1, i);
    const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = (j * nx + i) * 2, R = (j * nx + i + 1) * 2 + 1, B = ((j + 1) * nx + i) * 2, L = (j * nx + i) * 2 + 1;
    const mid = (a + b + c + d) / 4 > level;
    switch (idx) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(T, L); break;
      case 5: if (mid) { add(L, T); add(B, R); } else { add(T, R); add(L, B); } break;
      case 10: if (mid) { add(T, R); add(L, B); } else { add(L, T); add(B, R); } break;
    }
  }
  const used = new Uint8Array(segs.length), out = [];
  const walk = (k0, from) => {
    const line = [edgePt(from)];
    let k = k0, e = from;
    for (;;) {
      used[k] = 1;
      const [p, q] = segs[k], next = p === e ? q : p;
      line.push(edgePt(next));
      const l = byEdge.get(next), n = l && l.find((s) => !used[s]);
      if (n == null) break;
      k = n; e = next;
    }
    return line;
  };
  for (const [e, l] of byEdge) if (l.length === 1 && !used[l[0]]) out.push(walk(l[0], e));       // open lines, from an end
  for (let k = 0; k < segs.length; k++) if (!used[k]) out.push(walk(k, segs[k][0]));              // closed rings
  return out;
}
const ringArea = (r) => { let s = 0; for (let k = 0; k < r.length - 1; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; return s / 2; };
function inPoly(r, x, y) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
/** Douglas-Peucker (tolerance in the line's units); a closed ring is split at its point farthest from its start. */
function simplify(p, tol) {
  if (p.length < 3) return p;
  const n = p.length - 1;
  if (p[0][0] === p[n][0] && p[0][1] === p[n][1]) {
    let far = 0, fd = -1;
    for (let k = 1; k < n; k++) { const dx = p[k][0] - p[0][0], dy = p[k][1] - p[0][1], d = dx * dx + dy * dy; if (d > fd) { fd = d; far = k; } }
    if (far === 0) return p;
    return dp(p.slice(0, far + 1), tol).concat(dp(p.slice(far), tol).slice(1));
  }
  return dp(p, tol);
}
function dp(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let dm = 0, im = -1;
    const [ax, ay] = p[a], dx = p[b][0] - ax, dy = p[b][1] - ay, L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((p[k][0] - ax) * dy - (p[k][1] - ay) * dx) / L; if (d > dm) { dm = d; im = k; } }
    if (dm > tol) { keep[im] = 1; st.push([a, im], [im, b]); }
  }
  return p.filter((_, k) => keep[k]);
}
/** Chaikin's corner cutting, n rounds; a closed ring stays closed. */
function chaikin(p, n = 2) {
  const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  for (let r = 0; r < n; r++) {
    const q = closed ? [] : [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const [ax, ay] = p[k], [bx, by] = p[k + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    if (closed) q.push(q[0]); else q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
const polyLen = (p) => { let s = 0; for (let k = 1; k < p.length; k++) { const dx = p[k][0] - p[k - 1][0], dy = p[k][1] - p[k - 1][1]; s += Math.sqrt(dx * dx + dy * dy); } return s; };

// ---- the generator ------------------------------------------------------------------------------------------------------------
/**
 * One world. opts: type (TYPES), seed (uint32), size (m, the square's side), detail, relief, green, paths (each 0 … 1, 0.5 the
 * terrain type's own), onStep(name, share) for a progress bar. Returns { W, H, h (Float32), cls (Uint8), veg (Uint8 × 3),
 * ground (Uint8 RGBA), feats, objects (ISOM: { sym, otp, pts: [[x, z]…] | rings, ang }), features, junctions, interval, biome, gen }.
 */
export function generate({ type = "moraine", seed = 1, size = 1200, detail = 0.5, relief = 0.5, green = 0.5, paths = 0.5, onStep = () => {} } = {}) {
  const R = RECIPES[type] || RECIPES.moraine;
  const rnd = prng(seed ^ 0x9e3779b9);
  const W = Math.round(size / 2) * 2, H = W, S = 2, nx = W / S + 1, ny = H / S + 1, N = nx * ny;
  const km2 = (W * H) / 1e6, dk = 0.4 + 1.2 * detail, rk = 0.5 + relief, gk = green - 0.5, pk = 0.3 + 1.4 * paths;
  const count = (n) => Math.round(n * km2 * dk);
  const xyOf = (q) => [(q % nx) * S, Math.floor(q / nx) * S];
  onStep("relief", 0);

  // ---- the relief: octaves, then the type's own shapes ----
  const h = noiseField(nx, ny, S, R.scales.map((s, k) => [s, R.relief[k] * rk]), seed);
  const feats = [];                                        // { k, x, z, r, a }: the objects added to the ground
  const addBump = (x, z, r, a, ex = 0, ez = 0, len = 0) => {
    // a round bump (len 0) or an elongated one along (ex, ez), unit vector, half-length len
    const R2 = r * r, ext = r + len;
    for (let j = Math.max(0, Math.floor((z - ext) / S)); j <= Math.min(ny - 1, Math.ceil((z + ext) / S)); j++)
      for (let i = Math.max(0, Math.floor((x - ext) / S)); i <= Math.min(nx - 1, Math.ceil((x + ext) / S)); i++) {
        let dx = i * S - x, dz = j * S - z;
        if (len) { const t = Math.max(-len, Math.min(len, dx * ex + dz * ez)); dx -= t * ex; dz -= t * ez; }
        h[j * nx + i] += a * bump(dx * dx + dz * dz, R2);
      }
  };
  const somewhere = (m = 40) => [rnd.range(m, W - m), rnd.range(m, H - m)];
  const unit = () => { for (;;) { const u = rnd.range(-1, 1), v = rnd.range(-1, 1), l = Math.sqrt(u * u + v * v); if (l > 0.2 && l <= 1) return [u / l, v / l]; } };
  const spaced = (list, x, z, d) => list.every((f) => (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) >= d * d);
  if (R.valleys) {                                          // steep valleys: a ridged field carves V-shaped valleys
    const v = noiseField(nx, ny, S, [[420, 1], [190, 0.45]], seed + 11);
    const vb = blur(v, nx, ny, 3);                           // the valleys' floors a little rounded
    for (let q = 0; q < N; q++) h[q] += R.valleys * rk * (Math.abs(vb[q]) - 0.35);
  }
  if (R.ridges) {                                           // sandstone ridges: long crests, east to west
    const v = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = vnoise(i * S / 520 + 3.1, j * S / 140 + 1.7, seed + 23) + 0.35 * vnoise(i * S / 200, j * S / 60, seed + 29);
    for (let q = 0; q < N; q++) { const a = 1 - Math.abs(v[q]); h[q] += R.ridges * rk * a * a; }
    h.crest = v;
  }
  for (let e = 0; e < R.eskers; e++) {                      // eskers: winding gravel ridges
    let [x, z] = somewhere(100), [ux, uz] = unit();
    const steps = rnd.int(30, 55);
    for (let s = 0; s < steps; s++) {
      addBump(x, z, rnd.range(10, 14), rnd.range(2.6, 4.2) * rk);
      const [wx, wz] = unit(); ux = ux * 0.85 + wx * 0.15; uz = uz * 0.85 + wz * 0.15; const l = Math.sqrt(ux * ux + uz * uz); ux /= l; uz /= l;
      x += ux * 9; z += uz * 9; if (x < 30 || z < 30 || x > W - 30 || z > H - 30) break;
    }
  }
  for (let d = 0; d < count(R.dolines); d++) {              // dolines: round hollows of the limestone
    const [x, z] = somewhere(30), r = rnd.range(12, 32);
    if (!spaced(feats, x, z, r + 10)) continue;
    addBump(x, z, r, -rnd.range(2.5, 6.5) * rk); feats.push({ k: "depression", x, z, r });
  }
  for (let n = 0; n < count(R.knolls); n++) {
    const [x, z] = somewhere(25), r = rnd.range(7, 15);
    if (!spaced(feats, x, z, 30)) continue;
    const elong = rnd() < 0.3, [ex, ez] = unit();
    addBump(x, z, r, rnd.range(1.8, 3.6) * rk, ex, ez, elong ? rnd.range(6, 14) : 0);
    feats.push({ k: elong ? "eknoll" : "knoll", x, z, r, ex, ez });
  }
  for (let n = 0; n < count(R.depressions); n++) {
    const [x, z] = somewhere(25), r = rnd.range(6, 10);
    if (!spaced(feats, x, z, 30)) continue;
    addBump(x, z, r, -rnd.range(1.4, 2.4)); feats.push({ k: "depression", x, z, r });
  }
  for (let n = 0; n < count(R.pits); n++) {
    const [x, z] = somewhere(25), r = rnd.range(3, 4.5);
    if (!spaced(feats, x, z, 25)) continue;
    addBump(x, z, r, -rnd.range(1.2, 1.8)); feats.push({ k: "pit", x, z, r });
  }
  onStep("relief", 0.5);
  // the small, unmapped roughness of real ground (well under a contour's interval)
  const micro = noiseField(nx, ny, S, [[14, 0.25 * rk], [6, 0.12]], seed + 3);
  for (let q = 0; q < N; q++) h[q] += micro[q];

  // ---- water: lakes in the lowest hollows, streams down the valleys ----
  const big = blur(h, nx, ny, 18);
  const water = new Float32Array(N).fill(-1), marshF = new Float32Array(N).fill(-1);
  const lakes = [];
  for (let l = 0; l < R.lakes; l++) {
    let best = -1;
    for (let t = 0; t < 40; t++) { const [x, z] = somewhere(80), q = Math.round(z / S) * nx + Math.round(x / S); if (best < 0 || big[q] < big[best]) best = q; }
    // descend to the hollow's bottom
    for (let s = 0; s < 400; s++) {
      const i = best % nx, j = Math.floor(best / nx); let nb = best;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj; if (ii < 20 || jj < 20 || ii >= nx - 20 || jj >= ny - 20) continue;
        const q = jj * nx + ii; if (h[q] < h[nb]) nb = q;
      }
      if (nb === best) break; best = nb;
    }
    const [x, z] = xyOf(best);
    if (!spaced(lakes, x, z, 200)) continue;
    const lvl = h[best] + rnd.range(1.2, 2.4), r = rnd.range(45, 95);
    lakes.push({ x, z });
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const dx = i * S - x, dz = j * S - z, d2 = dx * dx + dz * dz; if (d2 > r * r) continue;
      const q = j * nx + i, v = (lvl - h[q]) * (1 - d2 / (r * r));
      if (v > water[q]) water[q] = v;
    }
  }
  const streams = [];
  if (R.valleys) {
    // streams: from high ground, down the steepest way, until a border or a hollow (a small pond there)
    const n = Math.max(2, Math.round(3 * km2));
    for (let s = 0; s < n * 6 && streams.length < n; s++) {
      const [x0, z0] = somewhere(60); let q = Math.round(z0 / S) * nx + Math.round(x0 / S);
      if (big[q] < 0) continue;
      const line = [xyOf(q)];
      for (let k = 0; k < 3000; k++) {
        const i = q % nx, j = Math.floor(q / nx); let nb = q, low = big[q] * 0.6 + h[q] * 0.4;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const qq = jj * nx + ii, v = big[qq] * 0.6 + h[qq] * 0.4; if (v < low) { low = v; nb = qq; }
        }
        if (nb === q) break;
        q = nb; if (k % 3 === 0) line.push(xyOf(q));
        const i2 = q % nx, j2 = Math.floor(q / nx); if (i2 === 0 || j2 === 0 || i2 === nx - 1 || j2 === ny - 1) break;
      }
      if (polyLen(line) > 220 && streams.every((o) => !o.some(([a, b]) => Math.abs(a - line[0][0]) < 30 && Math.abs(b - line[0][1]) < 30))) streams.push(line);
    }
    // the streams cut a little into the ground
    for (const line of streams) for (const [x, z] of line) addBump(x, z, 5, -0.6);
  }
  // marshes: in the hollows (the ground lower than its 60 m surroundings), where the type has them
  if (R.marsh) {
    const loc = blur(h, nx, ny, 14), mn = noiseField(nx, ny, S, [[160, 1]], seed + 5);
    for (let q = 0; q < N; q++) marshF[q] = Math.min((loc[q] - h[q]) - (1.3 - R.marsh), mn[q] + 0.2 - R.marsh * 0.4);
  }
  for (let q = 0; q < N; q++) if (water[q] > 0) marshF[q] = Math.min(marshF[q], -water[q]);
  onStep("relief", 1);

  // ---- ground cover: open land, three greens, rock and stony ground, each a smooth field ----
  onStep("cover", 0);
  const fOpen = noiseField(nx, ny, S, [[260, 1], [90, 0.45], [30, 0.12]], seed + 41);
  const fRough = noiseField(nx, ny, S, [[120, 1]], seed + 43);
  const fGreen = noiseField(nx, ny, S, [[200, 1], [70, 0.5], [24, 0.15]], seed + 47);
  const fVis = noiseField(nx, ny, S, [[150, 1]], seed + 53);
  const fRock = noiseField(nx, ny, S, [[110, 1], [36, 0.4]], seed + 59);
  const fStony = noiseField(nx, ny, S, [[90, 1], [30, 0.35]], seed + 61);
  // thresholds from the type's shares (an approximate quantile of a sum of noises) and the sliders
  const thr = (share) => 1.15 - 2.3 * share;
  const tOpen = thr(R.open), tG1 = thr(R.green + gk * 0.35), tG2 = tG1 + 0.42, tG3 = tG1 + 0.78;
  const slope = new Float32Array(N);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const q = j * nx + i, gx = (h[q + 1] - h[q - 1]) / (2 * S), gz = (h[q + nx] - h[q - nx]) / (2 * S); slope[q] = Math.sqrt(gx * gx + gz * gz);
  }
  const AREA = {};                                         // class name -> field (> 0 inside), drawn in this order (later wins)
  const field = () => new Float32Array(N);
  const notWet = (q) => -Math.max(water[q], marshF[q] > 0 ? marshF[q] : -1);
  const parcels = R.parcels ? makeParcels() : null;
  if (parcels) {
    for (const [name, F] of Object.entries(parcels.fields)) AREA[name] = F;
  } else {
    const open = field(), rough = field(), g1 = field(), g2 = field(), g3 = field(), rock = field(), stony = field();
    for (let q = 0; q < N; q++) {
      const o = fOpen[q] - tOpen, notOpen = -o, dry = notWet(q);
      open[q] = Math.min(o, -fRough[q] - 0.1, dry); rough[q] = Math.min(o, fRough[q] + 0.1, dry);
      const g = fGreen[q];
      g1[q] = Math.min(g - tG1, notOpen, dry); g2[q] = Math.min(g - tG2, notOpen, dry); g3[q] = Math.min(g - tG3, notOpen, dry);
      // rock on steep ground and crests, stony ground beside it
      const steep = R.rock ? slope[q] * 1.6 - 0.75 : -1, crest = h.crest ? (1 - Math.abs(h.crest[q])) * 2 - 1.55 : -1;
      rock[q] = R.rock ? Math.min(Math.max(steep, crest) + (fRock[q] - thr(R.rock)) * 0.5, dry) : -1;
      stony[q] = R.stony ? Math.min(fStony[q] - thr(R.stony), dry, -rock[q]) : -1;
    }
    // good visibility (the lighter, striped ISOM greens) where fVis is high
    AREA.open = open; AREA.rough = rough;
    AREA.slow = g1; AREA.walk = g2; AREA.fight = g3;
    AREA.stony = stony; AREA.rock = rock;
    AREA._vis = fVis;
  }
  AREA.marsh = marshF; AREA.water = water;
  onStep("cover", 1);

  function makeParcels() {
    // a plantation: straight tracks in a grid turned a little, each parcel one age of pines, firebreaks and clear-cuts; in the grid's
    // frame u = (x − W/2) cos + (z − H/2) sin, v = −(x − W/2) sin + (z − H/2) cos, the tracks at u = k sp and v = k sp
    const ang = rnd.range(-0.25, 0.25), a2 = ang * ang, ca = 1 - a2 / 2 + (a2 * a2) / 24, sa = ang - (ang * a2) / 6 + (ang * a2 * a2) / 120;
    const sp = rnd.range(320, 420), tracks = [], cross = [];
    const fields = { open: field(), rough: field(), slow: field(), walk: field(), slow_vis: field() };
    for (const F of Object.values(fields)) F.fill(-1);
    const kinds = ["forest", "forest", "forest", "forest", "forest", "slow", "walk", "rough", "slow_vis", "open"], pick = new Map();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * S - W / 2, z = j * S - H / 2, u = x * ca + z * sa, v = -x * sa + z * ca;
      const cu = Math.floor(u / sp), cv = Math.floor(v / sp), key = cu * 1000 + cv;
      if (!pick.has(key)) pick.set(key, kinds[Math.floor(prng(seed + key * 31 + 7)() * kinds.length)]);
      const k = pick.get(key);
      if (k === "forest") continue;
      const du = Math.min(u - cu * sp, (cu + 1) * sp - u), dv = Math.min(v - cv * sp, (cv + 1) * sp - v);
      fields[k][j * nx + i] = Math.min(du, dv) - 6;            // inside the parcel beyond the track's margin
    }
    const toXZ = (u, v) => [W / 2 + u * ca - v * sa, H / 2 + u * sa + v * ca];
    const inside = ([x, z]) => x >= 0 && z >= 0 && x <= W && z <= H;
    const lim = Math.ceil(W / sp) + 1;
    for (let k = -lim; k <= lim; k++) for (const dir of [0, 1]) {
      const pts = [];
      for (let s_ = -W; s_ <= W; s_ += 10) { const p = dir ? toXZ(k * sp, s_) : toXZ(s_, k * sp); if (inside(p)) pts.push(p); }
      // one line in three is a ride (a narrow firebreak), the others tracks
      if (pts.length > 4) tracks.push({ kind: ((k % 3) + 3) % 3 === 1 ? "ride" : "track", pts });
      if (dir) for (let m = -lim; m <= lim; m++) { const p = toXZ(k * sp, m * sp); if (inside(p) && p[0] > 40 && p[1] > 40 && p[0] < W - 40 && p[1] < H - 40) cross.push(p); }
    }
    return { fields, tracks, cross };
  }

  // ---- the 1 m classes from the fields (the same regions the map's polygons enclose) ----
  onStep("classes", 0);
  const cls = new Uint8Array(W * H).fill(C.forest);
  const order = ["open", "rough", "slow_vis", "slow", "walk", "fight", "stony", "rock", "marsh", "water"];
  const vis = AREA._vis;
  const fl = order.filter((n) => AREA[n]).map((n) => [C[n], AREA[n]]);
  for (let z = 0; z < H; z++) {
    const j = z >> 1, v = (z & 1) ? 0.75 : 0.25;
    for (let x = 0; x < W; x++) {
      const i = x >> 1, u = (x & 1) ? 0.75 : 0.25, o = j * nx + i, w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
      let c = C.forest;
      for (const [k, F] of fl) if (F[o] * w00 + F[o + 1] * w10 + F[o + nx] * w01 + F[o + nx + 1] * w11 > 0) c = k;
      // the greens with good visibility where the visibility field is high (ISOM 407 / 409)
      if (vis && (c === C.slow || c === C.walk) && vis[o] * w00 + vis[o + 1] * w10 + vis[o + nx] * w01 + vis[o + nx + 1] * w11 > 0.55) c = c === C.slow ? C.slow_vis : C.walk_vis;
      cls[z * W + x] = c;
    }
  }
  onStep("classes", 1);

  // ---- rocks: boulders, clusters, boulder fields, gigantic boulders ----
  const rocks = [], points = [];
  const clsAt = (x, z) => cls[Math.min(H - 1, Math.max(0, Math.floor(z))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  const dryAt = (x, z) => { const c = clsAt(x, z); return c !== C.water && c !== C.marsh; };
  const hAt = (x, z) => sample(h, nx, ny, x / S, z / S);
  const rockAt = (x, z, kind, n = 1, spread = 0) => {
    const [size, sink] = ROCK[kind];
    for (let k = 0; k < n; k++) {
      const s = size * rnd.range(0.75, 1.25), hh = s * rnd.range(0.55, 0.85) * (kind === "giant" ? 0.8 : 1);
      rocks.push([+(x + rnd.range(-spread, spread)).toFixed(2), +(z + rnd.range(-spread, spread)).toFixed(2), +s.toFixed(2), +hh.toFixed(2),
        +rnd.range(0, 6.28).toFixed(2), sink, kind === "giant" || kind === "bigboulder" || (kind === "boulder" && s > 1.1) ? 1 : 0]);
    }
  };
  const nB = count(R.boulders);
  for (let n = 0; n < nB * 3 && points.filter((p) => p.k === "boulder" || p.k === "bigboulder").length < nB; n++) {
    let [x, z] = somewhere(20);
    // on rocky crests and steep ground first, where the type has them
    if (h.crest && (1 - Math.abs(sample(h.crest, nx, ny, x / S, z / S))) < 0.7 && rnd() < 0.7) continue;
    if (!dryAt(x, z) || !spaced(points, x, z, 18) || !spaced(feats, x, z, 14)) continue;
    const big_ = rnd() < 0.2;
    rockAt(x, z, big_ ? "bigboulder" : "boulder"); points.push({ k: big_ ? "bigboulder" : "boulder", x, z });
  }
  for (let n = 0; n < count(R.clusters); n++) {
    const [x, z] = somewhere(20);
    if (!dryAt(x, z) || !spaced(points, x, z, 25) || !spaced(feats, x, z, 18)) continue;
    rockAt(x, z, "cluster", 4, 2.5); points.push({ k: "cluster", x, z });
  }
  const giants = [];
  for (let n = 0; n < count(R.giants) * 3 && giants.length < count(R.giants); n++) {
    const [x, z] = somewhere(30);
    if (h.crest && (1 - Math.abs(sample(h.crest, nx, ny, x / S, z / S))) < 0.75) continue;
    if (!dryAt(x, z) || !spaced(points, x, z, 25) || !spaced(feats, x, z, 18)) continue;
    const r = rnd.range(2.6, 4.2);
    rockAt(x, z, "giant"); rocks[rocks.length - 1][2] = +(r * 2).toFixed(2); rocks[rocks.length - 1][3] = +(r * 1.25).toFixed(2);
    giants.push({ x, z, r }); points.push({ k: "bigboulder", x, z, giant: r });
  }
  // the boulder fields' and stony ground's scattered stones, for the 3D only (the map has the area)
  for (let z = 4; z < H; z += 7) for (let x = 4; x < W; x += 7) {
    const c = cls[z * W + x];
    if (c === C.stony && rnd() < 0.45) rockAt(x + rnd.range(-3, 3), z + rnd.range(-3, 3), "stony", 2, 1.5);
    else if (c === C.rock && rnd() < 0.18) rockAt(x + rnd.range(-3, 3), z + rnd.range(-3, 3), "bfield", 2, 2);
  }

  // ---- cliffs: on the steepest ground, short rock faces across the slope ----
  const walls = [], cliffs = [];
  if (R.rock || R.giants) {
    const tries = Math.round(28 * km2 * dk);
    for (let n = 0; n < tries * 4 && cliffs.length < tries; n++) {
      const [x, z] = somewhere(30), q = Math.round(z / S) * nx + Math.round(x / S);
      if (slope[q] < 0.42 || !dryAt(x, z) || !cliffs.every((c) => (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) > 40 * 40)) continue;
      // along the contour: perpendicular to the gradient
      const gx = (h[q + 1] - h[q - 1]) / (2 * S), gz = (h[q + nx] - h[q - nx]) / (2 * S), l = Math.sqrt(gx * gx + gz * gz) || 1;
      const tx = -gz / l, tz = gx / l, len = rnd.range(10, 26), hh = rnd.range(1.6, 4.2);
      const pts = [];
      for (let s = -len / 2; s <= len / 2 + 0.01; s += len / 4) pts.push([x + tx * s + rnd.range(-1, 1), z + tz * s + rnd.range(-1, 1)]);
      cliffs.push({ x, z, pts, h: hh, imp: hh > 2.6 });
      walls.push({ pts: pts.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), kind: hh > 2.6 ? "cliff" : "rockface", h: +hh.toFixed(2) });
      // its foot: a control site (downhill side)
      const fx = x + (gx / l) * -2.5, fz = z + (gz / l) * -2.5;
      feats.push({ k: "rockface", x: fx, z: fz, r: 0, map: false });
      for (const [a, b] of pts) for (let t = -1; t <= 1; t++) {
        const px = Math.floor(a + t * tx), pz = Math.floor(b + t * tz);
        if (px >= 0 && pz >= 0 && px < W && pz < H) cls[pz * W + px] = hh > 2.6 ? C.cliff : C.rockstep;
      }
    }
  }
  // a gigantic boulder's ground is impassable (ISOM 206)
  for (const g of giants) for (let z = Math.floor(g.z - g.r); z <= g.z + g.r; z++) for (let x = Math.floor(g.x - g.r); x <= g.x + g.r; x++)
    if (x >= 0 && z >= 0 && x < W && z < H && (x + 0.5 - g.x) * (x + 0.5 - g.x) + (z + 0.5 - g.z) * (z + 0.5 - g.z) < g.r * g.r) cls[z * W + x] = C.cliff;
  onStep("paths", 0);

  // ---- paths: a network routed on the ground (tracks first, then paths joining it, then a few small paths) ----
  const G = 4, gw = Math.floor(W / G), gh = Math.floor(H / G), net = new Uint8Array(gw * gh);
  const cost = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * G + 2, z = j * G + 2, c = cls[Math.floor(z) * W + Math.floor(x)], sp = SPEED[CL[c]];
    const q = Math.round(z / S) * nx + Math.round(x / S);
    // a path may cross a marsh (dearly), never water, a cliff or a gigantic boulder
    cost[j * gw + i] = sp > 0 ? (c === C.marsh ? 8 : 1 / sp) * (1 + slope[q] * 6) : 1e4;
  }
  const lines = [];                                         // { kind, pts (world m) }
  const route = (from, toNet, to) => {
    // Dijkstra on the 4 m grid from `from` to the network (toNet) or to `to`; a binary heap of node indices
    const dist = new Float64Array(gw * gh).fill(Infinity), prev = new Int32Array(gw * gh).fill(-1), done = new Uint8Array(gw * gh);
    const hp = heap(dist, gw * gh * 4), push = (q) => hp.push(q), pop = () => hp.pop();
    const s = Math.min(gh - 1, Math.floor(from[1] / G)) * gw + Math.min(gw - 1, Math.floor(from[0] / G));
    const tgt = to ? Math.min(gh - 1, Math.floor(to[1] / G)) * gw + Math.min(gw - 1, Math.floor(to[0] / G)) : -1;
    dist[s] = 0; push(s); let end = -1;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142135623730951], [-1, 1, 1.4142135623730951], [1, -1, 1.4142135623730951], [-1, -1, 1.4142135623730951]];
    while (hp.size) {
      const q = pop(); if (done[q]) continue; done[q] = 1;
      const i = q % gw, j = Math.floor(q / gw);
      if ((toNet && net[q] && q !== s) || q === tgt) { end = q; break; }
      for (const [di, dj, w] of D) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const qq = jj * gw + ii, nd = dist[q] + w * (cost[q] + cost[qq]) / 2;
        if (nd < dist[qq]) { dist[qq] = nd; prev[qq] = q; push(qq); }
      }
    }
    if (end < 0 || dist[end] > 9e3) return null;
    const pts = []; for (let q = end; q >= 0; q = prev[q]) pts.push([(q % gw) * G + 2, Math.floor(q / gw) * G + 2]);
    return { pts: pts.reverse(), joined: toNet ? end : -1 };
  };
  const mark = (pts) => { for (const [x, z] of pts) net[Math.min(gh - 1, Math.floor(z / G)) * gw + Math.min(gw - 1, Math.floor(x / G))] = 1; };
  const edgePt = () => { const s = rnd.int(0, 3), u = rnd.range(0.15, 0.85); return s === 0 ? [u * W, 2] : s === 1 ? [W - 2, u * H] : s === 2 ? [u * W, H - 2] : [2, u * H]; };
  const junctions = [];
  if (parcels) {
    for (const tr of parcels.tracks) { lines.push({ kind: tr.kind, pts: tr.pts }); mark(tr.pts); }
    for (const [x, z] of parcels.cross) junctions.push({ k: "junction", x, z });
  } else {
    // a track across the map (another pair of ends while one fails: a lake or a cliff in the way)
    for (let t = 0; t < 10; t++) { const main = route(edgePt(), false, edgePt()); if (main) { lines.push({ kind: "track", pts: main.pts }); mark(main.pts); break; } }
  }
  const nHubs = Math.round(R.hubs * km2 * pk);
  for (let k = 0; k < nHubs + Math.round(2 * pk); k++) {
    const from = k < nHubs ? somewhere(60) : edgePt();
    const r = route(from, true);
    if (!r || r.pts.length < 6) continue;
    lines.push({ kind: k % 4 === 3 ? "small" : "path", pts: r.pts }); mark(r.pts);
    const [jx, jz] = r.pts[r.pts.length - 1];
    if (spaced(junctions, jx, jz, 25)) junctions.push({ k: "junction", x: jx, z: jz });
  }
  // features beside the paths (a boulder, or in a plantation a pit), the easy courses' control sites
  {
    const onPath = [];
    for (const l of lines) for (let k = 2; k < l.pts.length - 2; k += 3) onPath.push(l.pts[k]);
    const want = Math.round(14 * km2 * dk);
    for (let t = 0, got = 0; t < want * 6 && got < want && onPath.length; t++) {
      const [px, pz] = onPath[Math.floor(rnd() * onPath.length)], [ux, uz] = unit(), d = rnd.range(5, 11), x = px + ux * d, z = pz + uz * d;
      if (x < 30 || z < 30 || x > W - 30 || z > H - 30 || !dryAt(x, z) || !spaced(points, x, z, 20) || !spaced(feats, x, z, 20)) continue;
      if (type === "pine") { addBump(x, z, 3.5, -1.4); feats.push({ k: "pit", x, z, r: 3.5 }); }
      else { rockAt(x, z, "boulder"); points.push({ k: "boulder", x, z }); }
      got++;
    }
  }
  // streams are lines too (not paths): ISOM 305 small crossable watercourse
  for (const s of streams) lines.push({ kind: "stream", pts: s });
  // smooth the lines as a mapper draws them, then stamp them into the classes
  for (const l of lines) l.pts = chaikin(simplify(l.pts, 1.2), 3);
  const WIDTH = { track: [C.track, 3], path: [C.path, 1.6], small: [C.small_path, 1.0], ride: [C.small_path, 1.2], stream: [C.stream, 1.2] };
  for (const l of lines) {
    const [c, w] = WIDTH[l.kind], r = w / 2;
    for (let k = 1; k < l.pts.length; k++) {
      const [ax, az] = l.pts[k - 1], [bx, bz] = l.pts[k], dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz), n = Math.ceil(L / 0.5);
      for (let s = 0; s <= n; s++) {
        const x = ax + (dx * s) / n, z = az + (dz * s) / n;
        for (let oz = Math.floor(z - r); oz <= z + r; oz++) for (let ox = Math.floor(x - r); ox <= x + r; ox++) {
          if (ox < 0 || oz < 0 || ox >= W || oz >= H) continue;
          const ddx = ox + 0.5 - x, ddz = oz + 0.5 - z;
          if (ddx * ddx + ddz * ddz > r * r + 0.25) continue;
          const q = oz * W + ox, old = cls[q];
          if (old === C.water || old === C.cliff || old === C.rockstep || (c === C.stream && (old === C.track || old === C.path))) continue;
          cls[q] = c;
        }
      }
    }
  }
  onStep("paths", 1);

  // ---- the ground under the lakes, flat at the water's level (the 3D draws the surface there) ----
  // ---- the 1 m heights (bilinear of the grid: the contours are traced on that same surface) ----
  const hm = new Float32Array(W * H);
  const bil = (F, x, z) => { const i = x >> 1, j = z >> 1, u = (x & 1) ? 0.75 : 0.25, v = (z & 1) ? 0.75 : 0.25, o = j * nx + i;
    return F[o] * (1 - u) * (1 - v) + F[o + 1] * u * (1 - v) + F[o + nx] * (1 - u) * v + F[o + nx + 1] * u * v; };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) hm[z * W + x] = bil(h, x, z);
  let base = Infinity; for (let q = 0; q < hm.length; q++) if (hm[q] < base) base = hm[q];
  base = Math.floor(base);

  // ---- vegetation densities, the ground's colours ----
  onStep("ground", 0);
  const biome = BIOMES[type] || BIOMES.moraine;
  const lut = (tab) => { const a = new Float32Array(CL.length); for (const [k, v] of Object.entries(tab)) a[C[k]] = v; return a; };
  const lt = lut(TREE), lb = lut(BUSH), ll = lut(LOW);
  const gcol = CL.map((n) => (biome.ground?.[n] || COL[n] || COL.forest));
  const vn = noiseField(nx, ny, S, [[60, 0.5], [16, 0.3], [5, 0.2]], seed + 71);
  const veg = new Uint8Array(W * H * 3), ground = new Uint8ClampedArray(W * H * 4);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const q = z * W + x, c = cls[q], v = bil(vn, x, z), f = 1 + 0.18 * v;
    // a little variation of each density, with the same noise as the colours (denser where darker)
    const k = 1 - 0.25 * v;
    veg[q * 3] = Math.min(255, Math.round(lt[c] * k * VEG_K[0]));
    veg[q * 3 + 1] = Math.min(255, Math.round(lb[c] * k * VEG_K[1]));
    veg[q * 3 + 2] = Math.min(255, Math.round(ll[c] * k * VEG_K[2]));
    const col = gcol[c];
    ground[q * 4] = col[0] * f; ground[q * 4 + 1] = col[1] * f; ground[q * 4 + 2] = col[2] * f; ground[q * 4 + 3] = 255;
  }
  onStep("ground", 1);

  // ---- the map's objects (ISOM 2017-2), in world metres (x right, z down) ----
  onStep("map", 0);
  const objects = [];
  const toW = (line) => line.map(([i, j]) => [i * S, j * S]);
  const inWater = (x, z) => { const c = clsAt(x, z); return c === C.water; };
  // contours, index contours every fifth, cut where they cross a lake; a depression's closed contour gets a slope tick
  const E = R.interval;
  let hmin = Infinity, hmax = -Infinity; for (let q = 0; q < N; q++) { if (h[q] < hmin) hmin = h[q]; if (h[q] > hmax) hmax = h[q]; }
  const hs = blur(h, nx, ny, 1);
  const rings = [];
  // each grid cell listed under the levels it spans, so that a level looks at its own cells only
  const k0 = Math.ceil(hmin / E), nl = Math.max(0, Math.floor(hmax / E) - k0 + 1), cnt = new Int32Array(nl + 1);
  const span = (c) => { const j = Math.floor(c / (nx - 1)), i = c - j * (nx - 1), o = j * nx + i, a = hs[o], b = hs[o + 1], d = hs[o + nx], e = hs[o + nx + 1];
    return [Math.max(0, Math.ceil(Math.min(a, b, d, e) / E) - k0), Math.min(nl - 1, Math.floor(Math.max(a, b, d, e) / E) - k0)]; };
  const NC = (nx - 1) * (ny - 1);
  for (let c = 0; c < NC; c++) { const [l0, l1] = span(c); for (let l = l0; l <= l1; l++) cnt[l + 1]++; }
  for (let l = 0; l < nl; l++) cnt[l + 1] += cnt[l];
  const cellsOf = new Int32Array(cnt[nl]), fill = cnt.slice();
  for (let c = 0; c < NC; c++) { const [l0, l1] = span(c); for (let l = l0; l <= l1; l++) cellsOf[fill[l]++] = c; }
  for (let l = 0; l < nl; l++) {
    const lv = (k0 + l) * E, index = (k0 + l) % 5 === 0;
    for (const raw of isolines(hs, nx, ny, lv, cellsOf.subarray(cnt[l], cnt[l + 1]))) {
      let line = toW(raw);
      const closed = line.length > 3 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
      if (polyLen(line) < (closed ? 28 : 20)) continue;
      line = chaikin(simplify(line, 0.6), 1);
      // pieces outside the water
      let cur = [];
      const pieces = [];
      for (const p of line) { if (inWater(p[0], p[1])) { if (cur.length > 1) pieces.push(cur); cur = []; } else cur.push(p); }
      if (cur.length > 1) pieces.push(cur);
      for (const p of pieces) objects.push({ sym: index ? 102000 : 101000, otp: 2, pts: p });
      if (closed && pieces.length === 1) rings.push({ line, lv });
    }
  }
  // slope ticks on the closed contours round a hollow (the ground inside lower than the line)
  for (const { line, lv } of rings) {
    let cx = 0, cz = 0; for (const p of line) { cx += p[0]; cz += p[1]; } cx /= line.length; cz /= line.length;
    if (!inPoly(line, cx, cz) || hAt(cx, cz) > lv) continue;
    // at the ring's point nearest the centre, pointing to it (downhill)
    let best = line[0], bd = Infinity; for (const p of line) { const d = (p[0] - cx) * (p[0] - cx) + (p[1] - cz) * (p[1] - cz); if (d < bd) { bd = d; best = p; } }
    const a = Math.atan2(-(cz - best[1]), cx - best[0]) * 180 / Math.PI;           // map angle (y up), drawing only
    objects.push({ sym: 101009, otp: 1, pts: [best], ang: Math.round((a - 90) * 10) });
  }
  // areas: each class's region traced as polygons with their holes
  const AREA_SYM = { open: 401000, rough: 403000, slow: 406000, slow_vis: 407000, walk: 408000, walk_vis: 409000, fight: 410000,
    stony: 210000, rock: 214000, marsh: 308000, water: 301000 };
  const areaOf = (F, sym, tol = 0.6) => {
    const pad = new Float32Array((nx + 2) * (ny + 2)).fill(-1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pad[(j + 1) * (nx + 2) + i + 1] = F[j * nx + i];
    const lines_ = isolines(pad, nx + 2, ny + 2, 0).map((l) => l.map(([i, j]) => [(i - 1) * S, (j - 1) * S]));
    const outers = [], holes = [];
    for (let r of lines_) {
      if (r.length < 4) continue;
      r = simplify(r, tol); if (r.length < 4) continue;
      const a = ringArea(r);
      if (Math.abs(a) < 60) continue;
      // which side is inside: the field just to the left of the first segment
      const [ax, az] = r[0], [bx, bz] = r[1], dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz) || 1;
      const px = (ax + bx) / 2 - (dz / L) * 0.3, pz = (az + bz) / 2 + (dx / L) * 0.3;
      const leftIn = inPoly(r, px, pz), leftAbove = sample(pad, nx + 2, ny + 2, px / S + 1, pz / S + 1) > 0;
      (leftIn === leftAbove ? outers : holes).push({ r, a: Math.abs(a) });
    }
    outers.sort((p, q) => p.a - q.a);
    const out = outers.map((o) => ({ sym, otp: 3, rings: [o.r] }));
    for (const hl of holes) { const k = outers.findIndex((o) => o.a > hl.a && inPoly(o.r, hl.r[0][0], hl.r[0][1])); if (k >= 0) out[k].rings.push(hl.r); }
    return out;
  };
  for (const name of ["open", "rough", "slow", "walk", "fight", "stony", "rock", "marsh", "water"]) {
    const F = AREA[name]; if (!F) continue;
    // a green with good visibility: drawn as its own symbol where the visibility field is high
    if (vis && (name === "slow" || name === "walk")) {
      const lo = new Float32Array(N), hi = new Float32Array(N);
      for (let q = 0; q < N; q++) { lo[q] = Math.min(F[q], 0.55 - vis[q]); hi[q] = Math.min(F[q], vis[q] - 0.55); }
      objects.push(...areaOf(lo, AREA_SYM[name]), ...areaOf(hi, AREA_SYM[name === "slow" ? "slow_vis" : "walk_vis"]));
    } else objects.push(...areaOf(F, AREA_SYM[name], parcels ? 0.3 : 0.6));
  }
  if (parcels?.fields.slow_vis) objects.push(...areaOf(parcels.fields.slow_vis, AREA_SYM.slow_vis, 0.3));
  // the water's bank line
  for (const o of objects.filter((o) => o.sym === 301000)) for (const r of o.rings) objects.push({ sym: 301009, otp: 2, pts: r });
  // gigantic boulders (206 areas), cliffs
  for (const g of giants) {
    const r = []; for (let k = 0; k <= 10; k++) { const a = (k % 10) / 10; const [cx_, cz_] = circ(a); r.push([g.x + g.r * cx_, g.z + g.r * cz_]); }
    objects.push({ sym: 206000, otp: 3, rings: [r] });
  }
  for (const c of cliffs) objects.push({ sym: c.imp ? 201000 : 202000, otp: 2, pts: c.pts });
  // lines: tracks, paths, small paths, rides, streams
  const LINE_SYM = { track: 504000, path: 505000, small: 506000, ride: 508000, stream: 305000 };
  for (const l of lines) objects.push({ sym: LINE_SYM[l.kind], otp: 2, pts: l.pts });
  // point features: knolls, depressions, pits, boulders (a feature a contour ring already draws keeps no symbol)
  const ringed = (x, z, r) => rings.some(({ line }) => { let mx = Infinity, Mx = -Infinity, mz = Infinity, Mz = -Infinity;
    for (const p of line) { if (p[0] < mx) mx = p[0]; if (p[0] > Mx) Mx = p[0]; if (p[1] < mz) mz = p[1]; if (p[1] > Mz) Mz = p[1]; }
    return Mx - mx < 4 * r + 10 && Mz - mz < 4 * r + 10 && inPoly(line, x, z); });
  const PT = { knoll: 109000, eknoll: 110000, depression: 111000, pit: 112000, boulder: 204000, bigboulder: 205000, cluster: 207000 };
  for (const f of feats) {
    if (f.map === false || inWater(f.x, f.z)) continue;
    if ((f.k === "knoll" || f.k === "depression") && ringed(f.x, f.z, f.r)) continue;
    if (f.k === "eknoll") {
      const a = Math.atan2(-f.ez, f.ex) * 180 / Math.PI;                              // drawing only
      objects.push({ sym: PT.eknoll, otp: 1, pts: [[f.x, f.z]], ang: Math.round(a * 10) });
    } else objects.push({ sym: PT[f.k], otp: 1, pts: [[f.x, f.z]] });
  }
  for (const p of points) if (!p.giant) objects.push({ sym: PT[p.k], otp: 1, pts: [[p.x, p.z]] });
  // magnetic north lines every 300 m (30 mm at 1:10 000)
  for (let x = 150; x < W; x += 300) objects.push({ sym: 601000, otp: 2, pts: [[x, 0], [x, H]] });
  onStep("map", 1);

  // ---- what the course setter and the description sheet read ----
  const features = [...feats.filter((f) => !inWater(f.x, f.z)).map((f) => ({ k: f.k, x: +f.x.toFixed(1), z: +f.z.toFixed(1) })),
    ...points.map((p) => ({ k: p.k, x: +p.x.toFixed(1), z: +p.z.toFixed(1) })), ...junctions.map((p) => ({ k: "junction", x: +p.x.toFixed(1), z: +p.z.toFixed(1) }))];
  return { W, H, base, h: hm, cls, veg, ground, interval: E, biome, objects, features,
    feats: { rocks, walls, points: [], features },
    gen: { type, seed, size: W, detail, relief, green, paths } };
}
// a point of the unit circle at a turn's fraction a, by a polynomial (deterministic: no Math.sin)
function circ(a) {
  const t = a * 2 * Math.PI - Math.PI;                       // −π … π
  const t2 = t * t, s = t * (1 - t2 / 6 * (1 - t2 / 20 * (1 - t2 / 42 * (1 - t2 / 72)))), c = 1 - t2 / 2 * (1 - t2 / 12 * (1 - t2 / 30 * (1 - t2 / 56 * (1 - t2 / 90))));
  return [-c, -s];
}

/** The race.json of a generated world (games/vworld.js's frame: world = (mm − mm0) × k, z down). */
export function raceOf(world, { id, scale = 10000, courses = [] } = {}) {
  const k = scale / 1000;
  return { id, scale, std: "ISOM 2017-2", W: world.W, H: world.H, res: 1, base: world.base, mm0: [0, world.H / k], k,
    interval: world.interval, source: "gen", lidarTrees: null, classes: CL, speed: CL.map((n) => SPEED[n]), vegK: VEG_K,
    biome: world.biome, map: "ocd", gen: world.gen, courses };
}

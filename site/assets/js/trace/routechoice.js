// Route choices computed on a map image (a prototype, administrators only; 2026-10-24): the fastest ways between two
// controls, a few distinct variants, each with its length, climb and an estimated time. Pure functions, run in a worker
// (trace/routeworker.js), steered by trace/routeplan.js.
//
// 1. The map read by colour (`classify`): each pixel an area (white forest, open land, rough open, the three greens, out
//    of bounds) or an ink (purple overprint, black, grey, brown, blue). Inks are lines drawn over an area, so they are
//    split by thickness — an opening by a square a little wider than the map's black line width: what survives is an
//    area of its own (black: a building or a big cliff, grey: a building in sprint or bare rock, brown: a paved area,
//    blue: water); thin black lines long enough are the paths' layer, thin blue the streams and marshes' lines; the rest
//    (contours, the course itself, text, dots) is painted over with the nearest area underneath.
// 2. Cells of about 1.5 m: each the most frequent area of its pixels, a path flag, a share of blue lines (`cells`).
// 3. A cost per cell from the settings (`costs`): the time multiplier of its terrain against white runnable forest,
//    blocked when impassable, and a navigation weight — off the handrails (paths, streams, vegetation and open-land
//    edges, water's banks), deep in the forest, a careful runner slows down; the « prudence » setting scales it.
// 4. A* on 16 neighbours over an ellipse around the leg, the climb from the ground's heights (`slopeFactor`), then the
//    variants by penalising the corridors of the routes already found, each pulled tight without the penalty and kept
//    only when distinct and locally optimal (`legRoutes`, `locallyOptimal`). Documented in content/guide.*.js « routes ».

export const A = { WHITE: 0, OPEN: 1, ROUGH: 2, G1: 3, G2: 4, G3: 5, WATER: 6, SHALLOW: 7, PAVED: 8, OOB: 9, BUILDING: 10, GREY: 11, MARSH: 12 };
export const N_CLASSES = 13;
const UNKNOWN = 255;
// pixel kinds: the areas are their class; the inks above them
const I_PURPLE = 20, I_BLACK = 21, I_GREY = 22, I_BROWN = 23, I_BLUE = 24, I_OLIVE = 25;
export const INK = { PURPLE: I_PURPLE, BLACK: I_BLACK, GREY: I_GREY, BROWN: I_BROWN, BLUE: I_BLUE, OLIVE: I_OLIVE };

/** The default settings: speeds in % of white runnable forest's, the climb's cost in flat metres per metre up. */
export const DEFAULTS = {
  map: "forest",            // "forest" | "sprint"
  black: "auto",            // what thin black lines are: "auto" (paths in forest, obstacles in sprint), "paths", "neutral", "obstacles"
  risk: 20,                 // navigation caution, 0-100 %
  climb: 8,                 // 1 m climbed costs as many metres on the flat
  variants: 3,              // routes shown per leg, 1-4
  extra: 25,                // a variant is kept up to this % slower than the best
  pace: 0,                  // seconds per km in white runnable forest on the flat; 0 = automatic
  speeds: { path: 125, open: 110, rough: 100, g1: 75, g2: 45, g3: 20, marsh: 65, paved: 120, grey: 80, shallow: 30 },
};

// ---- 1. pixels ---------------------------------------------------------------------------------------------------------
/** A colour's kind: an area (A.*) or an ink (INK.*). */
export function kindOf(r, g, b) {
  const max = r > g ? (r > b ? r : b) : (g > b ? g : b), min = r < g ? (r < b ? r : b) : (g < b ? g : b), span = max - min;
  // the course's purple, as trace/course.js reads it (the dark plum of a photo included)
  if (max >= 40 && g === min && span) {
    const hue = max === r ? 360 - (60 * (b - g)) / span : max === b ? 240 + (60 * (r - g)) / span : 0;
    if (hue >= 255 && hue <= 345 && ((max >= 60 && span >= 0.3 * max) || (max <= 150 && r - g >= 12 && b - g >= 6 && r - g >= 0.2 * max))) return I_PURPLE;
  }
  if (max < 95 && span < 60) return I_BLACK;
  if (span < 24) return min > 220 ? A.WHITE : max < 95 ? I_BLACK : I_GREY;
  let hue = max === r ? 60 * ((g - b) / span) : max === g ? 60 * ((b - r) / span + 2) : 60 * ((r - g) / span + 4);
  if (hue < 0) hue += 360;
  if (hue >= 170 && hue < 260) return I_BLUE;
  if (hue >= 70 && hue < 170) {                        // the greens by their depth: the lighter red and blue, the lighter green
    const t = (255 - (r + b) / 2) / 255;
    return t < 0.12 ? A.WHITE : t < 0.36 ? A.G1 : t < 0.52 ? A.G2 : A.G3;
  }
  if (hue >= 36 && hue < 70) {
    if (max >= 200) { const y = (max - b) / max; return y > 0.55 ? A.OPEN : y > 0.15 ? A.ROUGH : A.WHITE; }
    return span > 50 ? I_OLIVE : I_GREY;                 // olive green: out of bounds (an area once thick)
  }
  if (hue < 36) return min > 215 ? A.WHITE : I_BROWN;
  return I_PURPLE;                                       // pinks and violets the test above missed: the overprint's edges
}

/** The width of the mask's lines in pixels: the lower quartile of the shorter run through its pixels (as course.js). */
function lineWidth(mask, w, h, value) {
  const runs = [];
  for (let i = 0; i < mask.length; i += 7) {
    if (mask[i] !== value) continue;
    const x = i % w, y = (i - x) / w;
    let a = x, b = x, c = y, d = y;
    while (a > 0 && mask[i - (x - a) - 1] === value) a--;
    while (b < w - 1 && mask[i + (b - x) + 1] === value) b++;
    while (c > 0 && mask[i - (y - c) * w - w] === value) c--;
    while (d < h - 1 && mask[i + (d - y) * w + w] === value) d++;
    runs.push(Math.min(b - a + 1, d - c + 1));
    if (runs.length > 20000) break;
  }
  if (!runs.length) return 2;
  runs.sort((p, q) => p - q);
  return Math.max(1, runs[Math.floor(runs.length / 4)]);
}

/** Erosion (all) or dilation (any) of a binary mask by a (2k + 1) square, separable, with running counts (outside = 0). */
function morph(m, w, h, k, erode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), win = 2 * k + 1;
  const pass = (src, dst, len, count, at) => {
    for (let line = 0; line < count; line++) {
      let n = 0;
      for (let x = 0; x < Math.min(k, len); x++) n += src[at(line, x)];
      for (let x = 0; x < len; x++) {
        if (x + k < len) n += src[at(line, x + k)];
        if (x - k - 1 >= 0) n -= src[at(line, x - k - 1)];
        dst[at(line, x)] = erode ? (n === win ? 1 : 0) : n > 0 ? 1 : 0;
      }
    }
  };
  pass(m, tmp, w, h, (y, x) => y * w + x);
  pass(tmp, out, h, w, (x, y) => y * w + x);
  return out;
}

/** Connected components (8-neighbours) of a binary mask: labels (0 = none) and, per label, size and bounding box. */
function components(m, w, h) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [null];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    const id = comps.length;
    let top = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (m[j] && !lab[j]) { lab[j] = id; stack[top++] = j; }
      }
    }
    comps.push({ n, x0, y0, x1, y1 });
  }
  return { lab, comps };
}

/**
 * The map read: per pixel its area (A.*, inks painted over) and the line layers. rgba: the image's bytes; mpp: metres per
 * pixel. Returns { area, path, blue, lw, ms }.
 */
export function classify(rgba, w, h, mpp) {
  const t0 = Date.now(), N = w * h;
  const kind = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) kind[i] = rgba[p + 3] < 128 ? A.WHITE : kindOf(rgba[p], rgba[p + 1], rgba[p + 2]);
  const lw = lineWidth(kind, w, h, I_BLACK);
  const k = Math.max(1, Math.round(0.5 * lw + 0.5));
  const minArea = Math.max(9, (6 / mpp) ** 2);           // an area of ink smaller than 6 × 6 m is a point symbol, not an area
  const area = new Uint8Array(N).fill(UNKNOWN);
  for (let i = 0; i < N; i++) if (kind[i] < 20) area[i] = kind[i];
  // the thick parts of each ink: areas of their own
  // an ink's own line width counts too (a blurred scan's contours are thicker than its thinnest black), within 3 k: a
  // sprint map's brown is mostly paved areas, whose runs are no line width
  const kOf = (v) => Math.min(3 * k, Math.max(k, Math.ceil(lineWidth(kind, w, h, v))));
  const thickOf = (test, decide, kk = k) => {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (test(kind[i])) m[i] = 1;
    const open = morph(morph(m, w, h, kk, true), w, h, kk, false);
    for (let i = 0; i < N; i++) open[i] &= m[i];
    const { lab, comps } = components(open, w, h);
    const stats = comps.map(() => [0, 0, 0]);
    for (let i = 0; i < N; i++) if (lab[i]) { const s = stats[lab[i]]; s[0]++; if (kind[i] === I_BLACK) s[1]++; s[2] += rgba[4 * i]; }
    const cls = comps.map((c, id) => (id && c.n >= minArea ? decide(stats[id]) : UNKNOWN));
    for (let i = 0; i < N; i++) if (lab[i] && cls[lab[i]] !== UNKNOWN) area[i] = cls[lab[i]];
    return open;
  };
  const darkThick = thickOf((v) => v === I_BLACK || v === I_GREY, (s) => (s[1] > 0.5 * s[0] ? A.BUILDING : A.GREY));
  thickOf((v) => v === I_BROWN, () => A.PAVED, kOf(I_BROWN));
  thickOf((v) => v === I_BLUE, (s) => (s[2] / s[0] > 150 ? A.SHALLOW : A.WATER), kOf(I_BLUE));
  thickOf((v) => v === I_OLIVE, () => A.OOB);
  // thin black lines: a path when long (30 m across), or a dash of a dashed path — 4 m across at least, with another
  // piece of line close to its end (a gap well under its own length); an isolated short line (a small cliff, a ruin, a
  // fence's stretch) and dots (a vegetation boundary, stony ground) are not. Paths, and also fences, walls, long cliffs —
  // what they are is the settings' choice
  const thin = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (kind[i] === I_BLACK && !darkThick[i] && area[i] === UNKNOWN) thin[i] = 1;
  const { lab, comps } = components(thin, w, h);
  const ext = comps.map((c) => (c ? Math.hypot(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1) * mpp : 0));
  const long = ext.map((e) => e >= 30);
  const S = Math.max(4, Math.round(30 / mpp)), buckets = new Map(), keyOf = (x, y) => Math.floor(x / S) * 65536 + Math.floor(y / S);
  comps.forEach((c, id) => { if (c && ext[id] >= 2) { const k = keyOf((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(id); } });
  comps.forEach((c, id) => {
    if (!c || long[id] || ext[id] < 4) return;
    const g = Math.max(3, 0.4 * ext[id]) / mpp, cx = Math.floor((c.x0 + c.x1) / 2 / S), cy = Math.floor((c.y0 + c.y1) / 2 / S);
    for (let bx = cx - 1; bx <= cx + 1 && !long[id]; bx++) for (let by = cy - 1; by <= cy + 1 && !long[id]; by++) {
      for (const o of buckets.get(bx * 65536 + by) || []) {
        if (o === id) continue;
        const d = comps[o];
        if (d.x0 <= c.x1 + g && d.x1 >= c.x0 - g && d.y0 <= c.y1 + g && d.y1 >= c.y0 - g) { long[id] = true; break; }
      }
    }
  });
  const path = new Uint8Array(N), blue = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (lab[i] && long[lab[i]]) path[i] = 1;
    if (kind[i] === I_BLUE && area[i] === UNKNOWN) blue[i] = 1;
  }
  // the inks painted over: each unknown pixel takes the nearest area (a breadth-first fill from every known pixel)
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (area[i] !== UNKNOWN) q[qt++] = i;
  if (!qt) area.fill(A.WHITE);
  while (qh < qt) {
    const i = q[qh++], x = i % w, v = area[i];
    if (x > 0 && area[i - 1] === UNKNOWN) { area[i - 1] = v; q[qt++] = i - 1; }
    if (x < w - 1 && area[i + 1] === UNKNOWN) { area[i + 1] = v; q[qt++] = i + 1; }
    if (i >= w && area[i - w] === UNKNOWN) { area[i - w] = v; q[qt++] = i - w; }
    if (i + w < N && area[i + w] === UNKNOWN) { area[i + w] = v; q[qt++] = i + w; }
  }
  return { area, path, blue, lw, ms: Date.now() - t0 };
}

// ---- 2. cells -----------------------------------------------------------------------------------------------------------
/**
 * The cells: cs × cs pixels each. Returns { cs, nx, ny, cls (most frequent area), path (any path pixel), blue (share of blue
 * line pixels, 0-255) }, a cell full of marsh lines becoming A.MARSH.
 */
export function cells(px, w, h, cs) {
  const nx = Math.ceil(w / cs), ny = Math.ceil(h / cs), M = nx * ny;
  const cls = new Uint8Array(M), path = new Uint8Array(M), blue = new Uint8Array(M), count = new Int32Array(N_CLASSES);
  // a vector map's own layers (trace/vectorroutes.js): lines that block, handrails
  const vector = !!px.block, block = vector ? new Uint8Array(M) : null, hand = vector ? new Uint8Array(M) : null;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    count.fill(0);
    let p = 0, b = 0, n = 0, bl = 0, ha = 0;
    for (let y = j * cs; y < Math.min(h, (j + 1) * cs); y++) for (let x = i * cs; x < Math.min(w, (i + 1) * cs); x++) {
      const k = y * w + x;
      count[px.area[k]]++; p |= px.path[k]; b += px.blue[k]; n++;
      if (vector) { bl |= px.block[k]; ha |= px.hand[k]; }
    }
    let best = 0;
    for (let c = 1; c < N_CLASSES; c++) if (count[c] > count[best]) best = c;
    // an impassable area wins only when it fills half the cell: a building's corner does not close a street
    const k = j * nx + i;
    cls[k] = best; path[k] = p; blue[k] = Math.round((255 * b) / Math.max(1, n));
    if (vector) { block[k] = bl; hand[k] = ha; }
  }
  // a dashed path's gaps: a cell between two path cells is one
  const fill = [];
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i;
    if (path[k]) continue;
    if ((path[k - 1] && path[k + 1]) || (path[k - nx] && path[k + nx]) || (path[k - nx - 1] && path[k + nx + 1]) || (path[k - nx + 1] && path[k + nx - 1])) fill.push(k);
  }
  for (const k of fill) path[k] = 1;
  // marsh: blue lines over a fifth of the 5 × 5 cells around
  const marsh = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let b = Math.max(0, j - 2); b <= Math.min(ny - 1, j + 2); b++) for (let a = Math.max(0, i - 2); a <= Math.min(nx - 1, i + 2); a++) { s += blue[b * nx + a]; n++; }
    const k = j * nx + i;
    if (s / n > 0.2 * 255 && blue[k] && cls[k] <= A.G3) marsh.push(k);
  }
  for (const k of marsh) cls[k] = A.MARSH;
  return { cs, nx, ny, cls, path, blue, vector, block, hand };
}

// ---- 3. costs -------------------------------------------------------------------------------------------------------------
const VIS = [1, 0.3, 0.5, 1.2, 1.4, 1.4, 0, 0.8, 0.2, 0, 0, 0.6, 0.8];        // how hard each area is to navigate in (risk weight)
const GROUP = [1, 2, 2, 1, 3, 3, 0, 0, 2, 0, 0, 2, 3];                        // visibility groups: their edges are handrails

/** The blackness setting resolved: what thin black lines are. */
export const blackMode = (s) => (s.black && s.black !== "auto" ? s.black : s.map === "sprint" ? "obstacles" : "paths");

/**
 * Per cell: f (time multiplier against white forest on the flat; Infinity = impassable) and r (navigation risk factor
 * ≥ 1). G: the cells; mpc: metres per cell.
 */
export function costs(G, s, mpc) {
  const { nx, ny, cls, path } = G, M = nx * ny, sp = { ...DEFAULTS.speeds, ...(s.speeds || {}) };
  const inv = (v) => 100 / Math.max(1, v);
  const F = new Float32Array(N_CLASSES);
  F[A.WHITE] = 1; F[A.OPEN] = inv(sp.open); F[A.ROUGH] = inv(sp.rough); F[A.G1] = inv(sp.g1); F[A.G2] = inv(sp.g2); F[A.G3] = inv(sp.g3);
  F[A.WATER] = Infinity; F[A.SHALLOW] = inv(sp.shallow); F[A.PAVED] = inv(sp.paved); F[A.OOB] = Infinity; F[A.BUILDING] = Infinity;
  F[A.GREY] = s.map === "sprint" ? Infinity : inv(sp.grey); F[A.MARSH] = inv(sp.marsh);
  const bm = G.vector ? "paths" : blackMode(s), fPath = inv(sp.path);     // a vector map's paths are paths
  const f = new Float32Array(M), hand = new Uint8Array(M);
  for (let k = 0; k < M; k++) {
    let v = G.block?.[k] ? Infinity : F[cls[k]];
    // a path crosses a wall or a fence (a gate), never an area out of bounds
    if (path[k] && cls[k] !== A.OOB) { if (bm === "paths") v = Math.min(v, fPath); else if (bm === "obstacles") v = Infinity; }
    f[k] = v;
  }
  // the handrails: paths (or black lines), streams, the edges between areas seen differently, the banks of what blocks
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (path[k] || G.blue[k] > 25 || G.hand?.[k] || G.block?.[k]) { hand[k] = 1; continue; }
    const g = GROUP[cls[k]];
    if ((i < nx - 1 && GROUP[cls[k + 1]] !== g) || (j < ny - 1 && GROUP[cls[k + nx]] !== g)) { hand[k] = 1; if (i < nx - 1) hand[k + 1] = 1; if (j < ny - 1) hand[k + nx] = 1; }
  }
  // the distance to the nearest handrail (chamfer, two passes), in metres
  const d = new Float32Array(M).fill(1e9);
  for (let k = 0; k < M; k++) if (hand[k]) d[k] = 0;
  const D = Math.SQRT2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) { v = Math.min(v, d[k - nx] + 1); if (i > 0) v = Math.min(v, d[k - nx - 1] + D); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D); }
    d[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < ny - 1) { v = Math.min(v, d[k + nx] + 1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D); if (i > 0) v = Math.min(v, d[k + nx - 1] + D); }
    d[k] = v;
  }
  const R = Math.max(0, Math.min(100, s.risk ?? DEFAULTS.risk)) / 100, r = new Float32Array(M);
  for (let k = 0; k < M; k++) r[k] = 1 + (path[k] && bm === "paths" ? 0 : R * VIS[cls[k]] * Math.min(1, (d[k] * mpc) / RISK_DIST));
  return { f, r, fMin: Math.min(fPath, ...[...F].filter((v) => v > 0)) };
}
export const RISK_DIST = 50;                              // metres from a handrail at which the risk is full

/** The time multiplier of a grade (rise over run): uphill climb metres per metre; downhill faster when gentle, then slower. */
export function slopeFactor(g, climb) {
  if (g >= 0) return 1 + climb * g;
  const a = -g;
  return a <= 0.15 ? 1 - 0.6 * a : 0.91 + 2.5 * (a - 0.15);
}

// ---- 4. routes ------------------------------------------------------------------------------------------------------------
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

/** A binary heap of (key, value) in typed arrays, grown as needed (stale entries skipped by the caller). */
class Heap {
  constructor(n = 1 << 16) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) { const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v; }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], key = K[--this.n], val = V[this.n];
    let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= this.n) break; if (c + 1 < this.n && K[c + 1] < K[c]) c++; if (K[c] >= key) break; K[i] = K[c]; V[i] = V[c]; i = c; }
    K[i] = key; V[i] = val;
    this.topKey = K[0];
    return top;
  }
}

/**
 * The context of one map for the searches: G (cells), C (costs), h (height per cell, metres, or null), em: the metres of a
 * cell step [ex, ey] (vectors), s (settings).
 */
export function context(G, C, h, em, s) {
  const len = NB.map(([dx, dy]) => Math.hypot(dx * em[0][0] + dy * em[1][0], dx * em[0][1] + dy * em[1][1]));
  return { G, C, h, em, s, len, mpc: Math.min(Math.hypot(...em[0]), Math.hypot(...em[1])) };
}

/** The physical time (at 1 s per metre of white forest on the flat), the cost (with the navigation risk) of a step. */
function step(X, a, b, n, mul = null) {
  const { f, r } = X.C;
  let fa = f[a], fb = f[b];
  if (!(fa < Infinity) || !(fb < Infinity)) return null;
  const L = X.len[n], g = X.h ? (X.h[b] - X.h[a]) / L : 0;
  const tm = L * ((fa + fb) / 2) * slopeFactor(g, X.s.climb ?? DEFAULTS.climb);
  return [tm, tm * ((r[a] + r[b]) / 2) * (mul ? (mul[a] + mul[b]) / 2 : 1)];
}

/** A* from cell a to cell b within the region { i0, j0, i1, j1, rw, inside (per region cell) }; mul: an extra cost per
 *  cell (variants). The search's arrays are the region's size. */
function astar(X, a, b, reg, mul) {
  const { nx } = X.G, { i0, j0, i1, j1, rw } = reg, RN = rw * (j1 - j0 + 1);
  const loc = (k) => { const i = k % nx; return ((k - i) / nx - j0) * rw + (i - i0); };
  const g = new Float64Array(RN).fill(Infinity), from = new Int32Array(RN).fill(-1), done = new Uint8Array(RN);
  const bi = b % nx, bj = (b - bi) / nx, fmin = X.C.fMin * 0.9;
  const hOf = (k) => { const i = k % nx, j = (k - i) / nx, dx = bi - i, dy = bj - j; return fmin * Math.hypot(dx * X.em[0][0] + dy * X.em[1][0], dx * X.em[0][1] + dy * X.em[1][1]); };
  const H = new Heap();
  g[loc(a)] = 0; H.push(hOf(a), a);
  while (H.n) {
    const k = H.pop(), lk = loc(k);
    if (done[lk]) continue;
    done[lk] = 1;
    if (k === b) break;
    const i = k % nx, j = (k - i) / nx;
    for (let n = 0; n < 16; n++) {
      const [dx, dy] = NB[n], I = i + dx, J = j + dy;
      if (I < i0 || J < j0 || I > i1 || J > j1) continue;
      const q = J * nx + I, lq = (J - j0) * rw + (I - i0);
      if (done[lq] || !reg.inside[lq]) continue;
      // a diagonal never squeezes between two blocked cells; a knight's move never jumps over one
      if (n >= 4 && n < 8 && !(X.C.f[j * nx + I] < Infinity) && !(X.C.f[J * nx + i] < Infinity)) continue;
      if (n >= 8) { const sx = Math.sign(dx), sy = Math.sign(dy), m1 = Math.abs(dx) === 2 ? j * nx + i + sx : (j + sy) * nx + i, m2 = (j + sy) * nx + i + sx; if (!(X.C.f[m1] < Infinity) || !(X.C.f[m2] < Infinity)) continue; }
      const st = step(X, k, q, n, mul);
      if (!st) continue;
      const v = g[lk] + st[1];
      if (v < g[lq]) { g[lq] = v; from[lq] = k; H.push(v + hOf(q), q); }
    }
  }
  if (!(g[loc(b)] < Infinity)) return null;
  const out = [];
  for (let k = b; k !== -1; k = from[loc(k)]) out.push(k);
  return out.reverse();
}

/** The cells of a route measured: time, cost, length, climb and descent, the share on paths. */
function measure(X, path) {
  const { nx } = X.G;
  let time = 0, cost = 0, len = 0, onPath = 0, up = 0, down = 0;
  const cum = new Float64Array(path.length);
  for (let q = 1; q < path.length; q++) {
    const a = path[q - 1], b = path[q], ai = a % nx, bi = b % nx, dx = bi - ai, dy = (b - bi) / nx - (a - ai) / nx;
    const n = NB.findIndex(([x, y]) => x === dx && y === dy);
    const st = step(X, a, b, n) || [X.len[n] * 4, X.len[n] * 4];
    time += st[0]; cost += st[1]; len += X.len[n]; cum[q] = cost;
    if (X.G.path[a] && X.G.path[b]) onPath += X.len[n];
  }
  if (X.h) {                                             // the climb on heights smoothed over ~5 cells (the model's noise)
    const hs = path.map((k, i) => { let s = 0, n = 0; for (let d = -2; d <= 2; d++) { const p = path[i + d]; if (p != null) { s += X.h[p]; n++; } } return s / n; });
    for (let i = 1; i < hs.length; i++) { const d = hs[i] - hs[i - 1]; if (d > 0) up += d; else down -= d; }
  }
  return { time, cost, len, up, down, onPath: len ? onPath / len : 0, cum };
}

/** Douglas-Peucker on [x, y] points. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > bd) { bd = d; best = i; } }
    if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Cells within r cells of the route's cells (a disc around each, the route sampled every r / 2). */
function near(X, path, r, into) {
  const { nx, ny } = X.G, rr = Math.ceil(r);
  for (let q = 0; q < path.length; q += Math.max(1, Math.floor(r / 2))) {
    const k = path[q], i = k % nx, j = (k - i) / nx;
    for (let b = Math.max(0, j - rr); b <= Math.min(ny - 1, j + rr); b++) for (let a = Math.max(0, i - rr); a <= Math.min(nx - 1, i + rr); a++) if ((a - i) ** 2 + (b - j) ** 2 <= r * r) into(b * nx + a);
  }
}

/** The metres between two cells. */
function cellMetres(X, a, b) {
  const { nx } = X.G, ai = a % nx, bi = b % nx, di = bi - ai, dj = (b - bi) / nx - (a - ai) / nx;
  return Math.hypot(di * X.em[0][0] + dj * X.em[1][0], di * X.em[0][1] + dj * X.em[1][1]);
}
/** A search region: the cells whose distances to a and b add up to 2 semi metres at most. */
function ellipse(X, a, b, semi) {
  const { nx, ny } = X.G, ai = a % nx, aj = (a - ai) / nx, bi = b % nx, bj = (b - bi) / nx;
  const mOf = (di, dj) => Math.hypot(di * X.em[0][0] + dj * X.em[1][0], di * X.em[0][1] + dj * X.em[1][1]);
  const R = Math.ceil(semi / X.mpc), ci = (ai + bi) / 2, cj = (aj + bj) / 2;
  const reg = { i0: Math.max(0, Math.floor(ci - R)), j0: Math.max(0, Math.floor(cj - R)), i1: Math.min(nx - 1, Math.ceil(ci + R)), j1: Math.min(ny - 1, Math.ceil(cj + R)) };
  reg.rw = reg.i1 - reg.i0 + 1;
  reg.inside = new Uint8Array(reg.rw * (reg.j1 - reg.j0 + 1));
  for (let j = reg.j0; j <= reg.j1; j++) for (let i = reg.i0; i <= reg.i1; i++) reg.inside[(j - reg.j0) * reg.rw + i - reg.i0] = mOf(i - ai, j - aj) + mOf(i - bi, j - bj) <= 2 * semi ? 1 : 0;
  return reg;
}
/** A search region: the cells within r cells of a route. */
function around(X, path, r) {
  const { nx } = X.G, rr = Math.ceil(r);
  let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
  for (const k of path) { const i = k % nx, j = (k - i) / nx; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
  const reg = { i0: Math.max(0, i0 - rr), j0: Math.max(0, j0 - rr), i1: Math.min(nx - 1, i1 + rr), j1: Math.min(X.G.ny - 1, j1 + rr) };
  reg.rw = reg.i1 - reg.i0 + 1;
  reg.inside = new Uint8Array(reg.rw * (reg.j1 - reg.j0 + 1));
  near(X, path, r, (k) => { const i = k % nx, j = (k - i) / nx; if (i >= reg.i0 && i <= reg.i1 && j >= reg.j0 && j <= reg.j1) reg.inside[(j - reg.j0) * reg.rw + i - reg.i0] = 1; });
  return reg;
}
/** Whether a route is locally optimal: every stretch of 30 % of its length (seven tested) costs at most 1 % (and 3 m) more
 *  than the best way between its ends — a bend of over ~16° in open ground fails. cum: the route's cost, cell by cell. */
function locallyOptimal(X, path, cum) {
  const total = cum[cum.length - 1], T = 0.3 * total;
  for (let w = 1; w <= 7; w++) {
    const mid = (w / 8) * total;
    let u = 0, v = path.length - 1;
    while (u < path.length - 1 && cum[u] < mid - T / 2) u++;
    while (v > 0 && cum[v] > mid + T / 2) v--;
    if (v - u < 4) continue;
    const reg = ellipse(X, path[u], path[v], 0.6 * cellMetres(X, path[u], path[v]) + 3 * X.mpc);
    const q = astar(X, path[u], path[v], reg, null);
    if (q && measure(X, q).cost * 1.01 + 3 < cum[v] - cum[u]) return false;
  }
  return true;
}

/**
 * The routes between map pixels pa and pb (cell coordinates come from G.cs): up to s.variants routes, the best first, each
 * { pts (map px), time (s at 1 s/m), cost, len, up, down, onPath, side } — side: -1 left of the straight line, 1 right,
 * 0 along it. null when no way was found.
 */
export function legRoutes(X, pa, pb) {
  const { nx, ny, cs } = X.G, M = nx * ny;
  const cell = (p) => Math.min(ny - 1, Math.max(0, Math.floor(p[1] / cs))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(p[0] / cs)));
  const a = cell(pa), b = cell(pb);
  const L = cellMetres(X, a, b);
  // the region: an ellipse around the leg, wide enough for a detour round a lake
  const reg = ellipse(X, a, b, 0.65 * L + 90);
  // the controls' own cells always passable: a control on a boulder, by a wall
  const saved = [];
  for (const k0 of [a, b]) near(X, [k0], 3, (k) => { if (!(X.C.f[k] < Infinity)) { saved.push([k, X.C.f[k]]); X.C.f[k] = 2; } });
  try {
    const wantN = Math.max(1, Math.min(4, X.s.variants ?? DEFAULTS.variants)), extra = 1 + (X.s.extra ?? DEFAULTS.extra) / 100;
    const corridor = Math.max(20, 0.12 * L) / X.mpc;
    const mul = new Float32Array(M).fill(1), seen = new Uint8Array(M);
    const routes = [];
    const best = astar(X, a, b, reg, null);
    if (!best) return null;
    routes.push({ cells: best, ...measure(X, best) });
    near(X, best, corridor, (k) => { seen[k] = 1; mul[k] = 6; });
    // the variants: the penalty method proposes a route away from those found; it is relaxed (searched again without the
    // penalty, within a band around itself) and kept only if it stays apart from the others and is locally optimal — no
    // stretch of a quarter of it can be cut short — so that a mere arc through uniform forest is not offered as a choice
    const until = Date.now() + 4000;                    // the variants' search stops after 4 s
    for (let tries = 0; tries < wantN + 2 && routes.length < wantN && Date.now() < until; tries++) {
      const p = astar(X, a, b, reg, mul);
      if (!p) break;
      near(X, p, corridor, (k) => { mul[k] = Math.min(mul[k] * 2, 12); });
      const band = around(X, p, 1.5 * corridor);
      const q = astar(X, a, b, band, null) || p;
      const m = measure(X, q);
      if (m.cost > routes[0].cost * extra) continue;
      let out = 0;
      for (const k of q) if (!seen[k]) out++;
      if (out / q.length < 0.3 || !locallyOptimal(X, q, m.cum)) continue;
      routes.push({ cells: q, ...m });
      near(X, q, corridor, (k) => { seen[k] = 1; mul[k] = Math.max(mul[k], 6); });
    }
    if (!routes.length) return null;
    routes.sort((x, y) => x.cost - y.cost);
    return routes.map((r) => {
      const pts = simplify(r.cells.map((k) => { const i = k % nx; return [(i + 0.5) * cs, ((k - i) / nx + 0.5) * cs]; }), 0.7 * cs);
      pts[0] = [pa[0], pa[1]]; pts[pts.length - 1] = [pb[0], pb[1]];
      // the side: the signed area between the route and the straight line, against the leg's length squared
      let area = 0, dev = 0;
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], l2 = ux * ux + uy * uy || 1;
      for (let i = 1; i < pts.length; i++) {
        const c1 = ((pts[i - 1][0] - pa[0]) * uy - (pts[i - 1][1] - pa[1]) * ux), c2 = ((pts[i][0] - pa[0]) * uy - (pts[i][1] - pa[1]) * ux);
        const t1 = ((pts[i - 1][0] - pa[0]) * ux + (pts[i - 1][1] - pa[1]) * uy) / l2, t2 = ((pts[i][0] - pa[0]) * ux + (pts[i][1] - pa[1]) * uy) / l2;
        area += ((c1 + c2) / 2) * (t2 - t1);
        dev = Math.max(dev, Math.abs(c2) / Math.sqrt(l2));
      }
      const side = dev < 0.08 * Math.sqrt(l2) || Math.abs(area) / l2 < 0.02 ? 0 : area > 0 ? -1 : 1;
      return { pts, time: r.time, cost: r.cost, len: r.len, up: r.up, down: r.down, onPath: r.onPath, side };
    });
  } finally { for (const [k, v] of saved) X.C.f[k] = v; }
}

/**
 * Any route (a runner's, in map px) measured on the same model: time (s at 1 s/m), cost, len, up, down. An impassable cell
 * crossed (a misread colour, the GPS's noise) counts as four times white forest.
 */
export function lineRoute(X, pts) {
  const { nx, ny, cs } = X.G, climb = X.s.climb ?? DEFAULTS.climb;
  const at = (x, y) => Math.min(ny - 1, Math.max(0, Math.floor(y / cs))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(x / cs)));
  const m = (dx, dy) => { const u = dx / cs, v = dy / cs; return Math.hypot(u * X.em[0][0] + v * X.em[1][0], u * X.em[0][1] + v * X.em[1][1]); };
  let time = 0, cost = 0, len = 0, up = 0, down = 0, hPrev = null;
  const hs = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = m(x1 - x0, y1 - y0);
    if (!d) continue;
    const n = Math.max(1, Math.ceil(d / (X.mpc / 2)));
    for (let s = 0; s < n; s++) {
      const xa = x0 + ((x1 - x0) * s) / n, ya = y0 + ((y1 - y0) * s) / n, xb = x0 + ((x1 - x0) * (s + 1)) / n, yb = y0 + ((y1 - y0) * (s + 1)) / n;
      const ka = at(xa, ya), kb = at(xb, yb), L = d / n;
      const fa = Math.min(4, X.C.f[ka]), fb = Math.min(4, X.C.f[kb]);
      const g = X.h ? (X.h[kb] - X.h[ka]) / L : 0;
      const tm = L * ((fa + fb) / 2) * slopeFactor(Math.max(-1, Math.min(1, g)), climb);
      time += tm; cost += tm * ((X.C.r[ka] + X.C.r[kb]) / 2); len += L;
      if (X.h) hs.push(X.h[kb]);
    }
  }
  for (let i = 0; i < hs.length; i++) {
    let s = 0, n = 0;
    for (let d = -4; d <= 4; d++) { const v = hs[i + d]; if (v != null) { s += v; n++; } }
    const v = s / n;
    if (hPrev != null) { if (v > hPrev) up += v - hPrev; else down += hPrev - v; }
    hPrev = v;
  }
  return { time, cost, len, up, down };
}

/** The colours of the terrain as read, for a picture of the cells (RGBA, one pixel a cell). */
export const CLASS_RGB = [[255, 255, 255], [250, 200, 60], [253, 232, 160], [200, 235, 185], [140, 210, 120], [60, 160, 70], [60, 140, 230], [150, 200, 240], [215, 170, 120], [140, 140, 20], [40, 40, 40], [160, 160, 160], [110, 180, 200]];
export function picture(X) {
  const { nx, ny, cls, path } = X.G, out = new Uint8ClampedArray(nx * ny * 4);
  for (let k = 0; k < nx * ny; k++) {
    const c = path[k] ? (X.C.f[k] < Infinity ? [0, 0, 0] : [200, 0, 0]) : CLASS_RGB[cls[k]];
    out[4 * k] = c[0]; out[4 * k + 1] = c[1]; out[4 * k + 2] = c[2]; out[4 * k + 3] = 255;
  }
  return out;
}

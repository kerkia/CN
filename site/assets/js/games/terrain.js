// Generated relief for the games: a height field (a few hills and hollows plus a little noise), its contour lines
// (marching squares, the same as the header's), the height profile along a line and what a leg does (up, down…).

import { range, int } from "./rng.js";

/** Smooth value noise on a coarse lattice, in [-1, 1]. */
function valueNoise(r, nx, ny) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  return (u, v) => {           // u, v in lattice units
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const s = (t) => t * t * (3 - 2 * t);
    const at = (a, b) => g[((b % ny) + ny) % ny * nx + ((a % nx) + nx) % nx];
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    const su = s(fu), sv = s(fv);
    return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
  };
}

/**
 * A height field over a w × h map (map units ~ metres), sampled every `cell` units.
 * opts: hills (number), relief (amplitude in m), noise (m).
 */
export function heightField(r, w, h, { hills = 8, relief = 25, noise = 2.5, cell = 4, bumps = [] } = {}) {
  const H = [];
  for (let k = 0; k < hills; k++) {
    H.push({ x: range(r, -0.1, 1.1) * w, y: range(r, -0.1, 1.1) * h, rx: range(r, 60, 220), ry: range(r, 60, 220),
      a: range(r, 0.3, 1) * relief * (r() < 0.3 ? -1 : 1), rot: range(r, 0, Math.PI) });
  }
  const nz = valueNoise(r, 16, 16);
  const nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1;
  const V = new Float32Array(nx * ny);
  const f = (x, y) => {
    let v = 0;
    for (const o of H) {
      const dx = x - o.x, dy = y - o.y, c = Math.cos(o.rot), s = Math.sin(o.rot);
      const u = (dx * c + dy * s) / o.rx, t = (-dx * s + dy * c) / o.ry;
      v += o.a * Math.exp(-(u * u + t * t));
    }
    for (const b of bumps) {          // knolls, pits: small round bumps the map's symbols sit on
      const dx = (x - b.x) / b.r, dy = (y - b.y) / b.r;
      v += b.a * Math.exp(-(dx * dx + dy * dy) * 1.5);
    }
    return v + noise * nz(x / 40, y / 40) + 0.4 * noise * nz(x / 12 + 7, y / 12 + 3);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[j * nx + i] = f(i * cell, j * cell);
  const field = {
    w, h, cell, nx, ny, V, hills: H,
    /** Height at (x, y), bilinear. */
    at(x, y) {
      const u = Math.min(Math.max(x / cell, 0), nx - 1.001), v = Math.min(Math.max(y / cell, 0), ny - 1.001);
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const a = V[j * nx + i], b = V[j * nx + i + 1], c = V[(j + 1) * nx + i], d = V[(j + 1) * nx + i + 1];
      return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
    },
    /** The gradient at (x, y): [dh/dx, dh/dy] in m per m. */
    grad(x, y) {
      const e = cell;
      return [(field.at(x + e, y) - field.at(x - e, y)) / (2 * e), (field.at(x, y + e) - field.at(x, y - e)) / (2 * e)];
    },
    min: Math.min(...V), max: Math.max(...V),
  };
  return field;
}

const SEG = { 1: [["L", "B"]], 2: [["B", "R"]], 3: [["L", "R"]], 4: [["T", "R"]], 5: [["T", "R"], ["L", "B"]], 6: [["T", "B"]], 7: [["T", "L"]],
  8: [["T", "L"]], 9: [["T", "B"]], 10: [["T", "L"], ["R", "B"]], 11: [["T", "R"]], 12: [["L", "R"]], 13: [["R", "B"]], 14: [["L", "B"]] };

/** The contour lines every `interval` m: [{level, index, segs: [x1, y1, x2, y2, …]}]. */
export function contours(field, interval = 5) {
  const { nx, ny, V, cell } = field;
  const out = [];
  const first = Math.ceil(field.min / interval), last = Math.floor(field.max / interval);
  for (let n = first; n <= last; n++) {
    const L = n * interval, segs = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = V[j * nx + i], b = V[j * nx + i + 1], cc = V[(j + 1) * nx + i + 1], d = V[(j + 1) * nx + i];
      const s = SEG[(a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0)];
      if (!s) continue;
      const x0 = i * cell, y0 = j * cell;
      const P = { T: [x0 + cell * (L - a) / (b - a), y0], R: [x0 + cell, y0 + cell * (L - b) / (cc - b)],
        B: [x0 + cell * (L - d) / (cc - d), y0 + cell], L: [x0, y0 + cell * (L - a) / (d - a)] };
      for (const [p, q] of s) segs.push(P[p][0], P[p][1], P[q][0], P[q][1]);
    }
    if (segs.length) out.push({ level: L, index: n % 5 === 0, segs });
  }
  return out;
}

/** Heights sampled along the segment (x1, y1) → (x2, y2). */
export function profile(field, x1, y1, x2, y2, n = 60) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(field.at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t));
  }
  return out;
}

/**
 * The significant moves of a profile, ignoring wobbles under `prominence` m: e.g. ["up", "down"].
 */
export function moves(prof, prominence = 4) {
  const out = [];
  let anchor = prof[0], extreme = prof[0], dir = 0;
  for (const v of prof) {
    if (dir === 0) {
      if (v - anchor >= prominence) { dir = 1; extreme = v; } else if (anchor - v >= prominence) { dir = -1; extreme = v; }
    } else if (dir === 1) {
      if (v > extreme) extreme = v;
      else if (extreme - v >= prominence) { out.push("up"); anchor = extreme; extreme = v; dir = -1; }
    } else {
      if (v < extreme) extreme = v;
      else if (v - extreme >= prominence) { out.push("down"); anchor = extreme; extreme = v; dir = 1; }
    }
  }
  if (dir === 1) out.push("up"); else if (dir === -1) out.push("down");
  return out;
}

/** Total climb and descent of a profile. */
export function climb(prof) {
  let up = 0, down = 0;
  for (let i = 1; i < prof.length; i++) {
    const d = prof[i] - prof[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  return { up, down };
}

/** A random point of the map, `margin` units from its edges. */
export const point = (r, w, h, margin = 30) => [range(r, margin, w - margin), range(r, margin, h - margin)];
export { int };

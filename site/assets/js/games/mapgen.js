// Generated orienteering maps for the games: a forest map (relief, vegetation, marshes, paths, point features), a
// sprint map (streets, blocks of buildings, impassable walls with gaps, parks) and a maze. The games keep the
// features as data (to alter one, to place a control on one) and draw them on a canvas in the map's colours.
// Map units are metres; the maps are 600 × 600 by default. North is up.

import { rng, int, range, pick, shuffle } from "./rng.js";
import { heightField, contours, point as randomPoint } from "./terrain.js";
import { dijkstra, costGrid } from "./path.js";

export const COL = {
  white: "#ffffff", open: "#f7c948", roughOpen: "#fbe59a", green1: "#cbe8b8", green2: "#9ad987", green3: "#4fae55",
  marsh: "#5aa9e8", water: "#86c8f2", waterEdge: "#2c8ed8", contour: "#c27a33", black: "#111111", brown: "#b8672a",
  building: "#6d6a66", paved: "#ece5d8", olive: "#a9ad4c", wall: "#111111", course: "#b000c8", tree: "#3f9b3f",
};
// the type raster's codes (one per ground type; the impassable ones last, from 200)
export const T = { white: 0, open: 16, rough: 32, green1: 48, green2: 64, green3: 80, marsh: 96, paved: 112, path: 128, road: 144,
  olive: 200, water: 208, cliff: 216, building: 224, wall: 240 };
export const IMPASSABLE = 190;
/** The running cost of a ground type (1 = white forest; the climb is added by the cost grid). */
export const COST = { 0: 1, 16: 0.9, 32: 1.05, 48: 1.25, 64: 1.7, 80: 2.8, 96: 1.6, 112: 0.85, 128: 0.72, 144: 0.68 };

/** A blob: a circle whose radius wobbles. */
export function blob(r, cx, cy, radius, n = 28) {
  const a1 = range(r, 0, 7), a2 = range(r, 0, 7), k1 = range(r, 0.2, 0.4), k2 = range(r, 0.1, 0.25);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const rr = radius * (1 + k1 * Math.sin(3 * th + a1) + k2 * Math.sin(5 * th + a2));
    pts.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th)]);
  }
  return pts;
}

/** Point in polygon (ray casting). */
export function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * A forest map. opts.features: how many point features (more for the puzzles that alter one).
 */
export function forestMap(seed, { w = 600, h = 600, features = 1, relief = 25, paths = 3 } = {}) {
  const r = rng(seed);
  const map = { w, h, seed, kind: "forest", areas: [], lines: [], points: [], buildings: [], walls: [] };
  // knolls and pits first: they bump the relief the contours are drawn from
  const bumps = [];
  const nKnoll = int(r, 3, 6) * features, nPit = int(r, 2, 4) * features;
  for (let i = 0; i < nKnoll; i++) { const [x, y] = randomPoint(r, w, h, 20); bumps.push({ x, y, r: range(r, 7, 11), a: range(r, 2.5, 4) }); map.points.push({ type: "knoll", x, y }); }
  for (let i = 0; i < nPit; i++) { const [x, y] = randomPoint(r, w, h, 20); bumps.push({ x, y, r: range(r, 5, 8), a: -range(r, 2, 3) }); map.points.push({ type: "pit", x, y }); }
  map.field = heightField(r, w, h, { hills: int(r, 6, 10), relief, noise: 2.5, bumps });
  map.contours = contours(map.field, 5);
  // vegetation: open land, thickets of three densities, marshes in the hollows, perhaps a pond at the lowest point
  for (let i = 0; i < int(r, 2, 4); i++) { const [x, y] = randomPoint(r, w, h, 0); map.areas.push({ type: r() < 0.3 ? "rough" : "open", poly: blob(r, x, y, range(r, 35, 90)) }); }
  for (let i = 0; i < int(r, 5, 9); i++) { const [x, y] = randomPoint(r, w, h, 0); map.areas.push({ type: pick(r, ["green1", "green1", "green2", "green2", "green3"]), poly: blob(r, x, y, range(r, 18, 55)) }); }
  const lows = [];
  for (let i = 0; i < 40; i++) { const p = randomPoint(r, w, h, 40); lows.push([map.field.at(p[0], p[1]), p]); }
  lows.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < int(r, 1, 2); i++) { const [, p] = lows[i + 1]; map.areas.push({ type: "marsh", poly: blob(r, p[0], p[1], range(r, 15, 35)) }); }
  if (r() < 0.4) { const [, p] = lows[0]; map.areas.push({ type: "water", poly: blob(r, p[0], p[1], range(r, 14, 30)) }); }
  // point features: boulders anywhere, cliffs where it is steep (along the contour), distinctive trees in the open
  const water = map.areas.filter((a) => a.type === "water");
  const dry = (x, y) => !water.some((a) => inside(a.poly, x, y));
  for (let i = 0; i < int(r, 8, 14) * features; i++) { const [x, y] = randomPoint(r, w, h, 12); if (dry(x, y)) map.points.push({ type: "boulder", x, y, big: r() < 0.25 }); }
  const steep = [];
  for (let i = 0; i < 300; i++) { const [x, y] = randomPoint(r, w, h, 25); const g = map.field.grad(x, y); steep.push([Math.hypot(g[0], g[1]), x, y, g]); }
  steep.sort((a, b) => b[0] - a[0]);
  let cliffs = 0;
  for (const [s, x, y, g] of steep) {
    if (cliffs >= int(r, 3, 5) * features || s < 0.18) break;
    if (map.points.some((p) => p.type === "cliff" && Math.hypot(p.x - x, p.y - y) < 40)) continue;
    map.points.push({ type: "cliff", x, y, ang: Math.atan2(g[1], g[0]) + Math.PI / 2, down: Math.atan2(g[1], g[0]) + Math.PI, len: range(r, 10, 20) });
    cliffs++;
  }
  for (let i = 0; i < int(r, 2, 4) * features; i++) { const [x, y] = randomPoint(r, w, h, 12); if (dry(x, y)) map.points.push({ type: "tree", x, y }); }
  for (let i = 0; i < int(r, 0, 2) * features; i++) { const [x, y] = randomPoint(r, w, h, 12); if (dry(x, y)) map.points.push({ type: "depression", x, y }); }
  // paths: cheap ways across the map (valleys, saddles), a road perhaps
  map.raster = typeRaster(map);                 // without the paths yet: they are routed over it
  const grid = costGrid(map, map.raster, { climb: 6, descent: 6, cell: 4 });
  const edge = () => { const s = int(r, 0, 3), t = range(r, 0.1, 0.9); return s === 0 ? [t * w, 4] : s === 1 ? [w - 4, t * h] : s === 2 ? [t * w, h - 4] : [4, t * h]; };
  for (let i = 0; i < paths + (r() < 0.5 ? 1 : 0); i++) {
    const a = edge(); let b = edge();
    for (let k = 0; k < 5 && dist(a, b) < 300; k++) b = edge();
    const res = dijkstra(grid, a, b, { pull: false });
    if (res) map.lines.push({ type: i === 0 && r() < 0.5 ? "road" : "path", pts: res.simple });
  }
  map.raster = typeRaster(map);
  return map;
}

/** A sprint map: streets, blocks of buildings with courtyards, walls with gaps, parks and private gardens. */
export function sprintMap(seed, { w = 600, h = 600 } = {}) {
  const r = rng(seed);
  const map = { w, h, seed, kind: "sprint", areas: [{ type: "paved", poly: [[0, 0], [w, 0], [w, h], [0, h]] }], lines: [], points: [], buildings: [], walls: [] };
  const cuts = (n) => { const c = [0]; let x = 0; while (x < n - 70) { x += range(r, 70, 140); if (x < n - 40) c.push(x); } c.push(n); return c; };
  const xs = cuts(w), ys = cuts(h), street = 11;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const bx = xs[i] + (i ? street / 2 : 0), by = ys[j] + (j ? street / 2 : 0);
    const bw = xs[i + 1] - (i + 1 < xs.length - 1 ? street / 2 : 0) - bx, bh = ys[j + 1] - (j + 1 < ys.length - 1 ? street / 2 : 0) - by;
    if (bw < 30 || bh < 30) continue;
    const kind = r();
    if (kind < 0.14) {                       // a park: grass, a few trees, perhaps a thicket
      map.areas.push({ type: "open", poly: [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]] });
      for (let k = 0; k < int(r, 1, 4); k++) map.points.push({ type: "tree", x: range(r, bx + 6, bx + bw - 6), y: range(r, by + 6, by + bh - 6) });
      if (r() < 0.5) map.areas.push({ type: "green2", poly: blob(r, range(r, bx + 10, bx + bw - 10), range(r, by + 10, by + bh - 10), Math.min(bw, bh) * range(r, 0.15, 0.3)) });
      continue;
    }
    // an urban block: a grid of plots, most of them built, the rest courtyards; some plots merged into one building
    const nx = Math.max(1, Math.round(bw / range(r, 24, 40))), ny = Math.max(1, Math.round(bh / range(r, 24, 40)));
    const cw = bw / nx, ch = bh / ny;
    const built = [];
    for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) built.push(r() < 0.62);
    const taken = new Set();
    for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
      const k = a * ny + b;
      if (taken.has(k)) continue;
      if (!built[k]) { if (r() < 0.12) map.areas.push({ type: "olive", poly: rect(bx + a * cw + 1, by + b * ch + 1, cw - 2, ch - 2) }); continue; }
      let span = 1;
      while (r() < 0.35 && a + span < nx && built[(a + span) * ny + b] && !taken.has((a + span) * ny + b)) { taken.add((a + span) * ny + b); span++; }
      const inset = range(r, 1.5, 3);
      map.buildings.push({ poly: rect(bx + a * cw + inset, by + b * ch + inset, cw * span - 2 * inset, ch - 2 * inset), hgt: range(r, 5, 10) });
    }
    // a wall around the block with a gap or two: the courtyards are reached only through them
    if (r() < 0.4 && built.some((v) => !v)) {
      const peri = [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]];
      const gaps = int(r, 1, 2);
      const sides = shuffle(r, [0, 1, 2, 3]).slice(0, gaps);
      for (let s = 0; s < 4; s++) {
        const p = peri[s], q = peri[(s + 1) % 4];
        if (!sides.includes(s)) { map.walls.push({ pts: [p, q] }); continue; }
        const t = range(r, 0.25, 0.75), gw = 7 / dist(p, q);
        map.walls.push({ pts: [p, lerp(p, q, t - gw / 2)] });
        map.walls.push({ pts: [lerp(p, q, t + gw / 2), q] });
      }
    }
  }
  // a few barriers along streets, with a gap: they force a choice
  for (let k = 0; k < int(r, 2, 4); k++) {
    const vertical = r() < 0.5;
    const line = vertical ? pick(r, xs.slice(1, -1)) : pick(r, ys.slice(1, -1));
    if (line == null) break;
    const from = range(r, 0.1, 0.5), to = Math.min(0.95, from + range(r, 0.25, 0.45)), gap = range(r, from + 0.08, to - 0.08);
    const P = (t) => (vertical ? [line, t * h] : [t * w, line]);
    map.walls.push({ pts: [P(from), P(gap - 0.01)] });
    map.walls.push({ pts: [P(gap + 0.01), P(to)] });
  }
  map.raster = typeRaster(map);
  return map;
}

/** A maze of n × n cells (recursive backtracker); the walls are impassable lines. */
export function mazeMap(seed, n = 8, { w = 600, h = 600 } = {}) {
  const r = rng(seed);
  const cw = w / n, chh = h / n;
  const open = new Set();                 // "x,y,d": the wall of cell (x, y) on side d (0 top, 1 right, 2 bottom, 3 left) is open
  const seen = new Uint8Array(n * n), stack = [[int(r, 0, n - 1), int(r, 0, n - 1)]];
  seen[stack[0][1] * n + stack[0][0]] = 1;
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = shuffle(r, [0, 1, 2, 3]).map((d) => [d, x + D[d][0], y + D[d][1]]).find(([, nx, ny]) => nx >= 0 && ny >= 0 && nx < n && ny < n && !seen[ny * n + nx]);
    if (!next) { stack.pop(); continue; }
    const [d, nx, ny] = next;
    open.add(`${x},${y},${d}`); open.add(`${nx},${ny},${(d + 2) % 4}`);
    seen[ny * n + nx] = 1;
    stack.push([nx, ny]);
  }
  const map = { w, h, seed, kind: "maze", n, cw, ch: chh, open, areas: [{ type: "paved", poly: [[0, 0], [w, 0], [w, h], [0, h]] }], lines: [], points: [], buildings: [], walls: [] };
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    if (!open.has(`${x},${y},0`)) map.walls.push({ pts: [[x * cw, y * chh], [(x + 1) * cw, y * chh]] });
    if (!open.has(`${x},${y},3`)) map.walls.push({ pts: [[x * cw, y * chh], [x * cw, (y + 1) * chh]] });
  }
  map.walls.push({ pts: [[0, h], [w, h]] }, { pts: [[w, 0], [w, h]] });
  map.raster = typeRaster(map);
  return map;
}

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// ---- drawing -----------------------------------------------------------------------------------------------

const AREA_COL = { open: COL.open, rough: COL.roughOpen, green1: COL.green1, green2: COL.green2, green3: COL.green3, marsh: COL.marsh, water: COL.water, paved: COL.paved, olive: COL.olive };

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * Draws the map on ctx. view = {x, y, scale}: the map point (x, y) lands at the canvas origin; one map unit
 * is `scale` px. The canvas' logical size (w, h) clips the drawing.
 */
export function drawMap(ctx, map, view, { w, h, contours: withContours = true } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = COL.white; ctx.fillRect(0, 0, w, h);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.x, -view.y);
  for (const a of map.areas) {
    if (a.type === "marsh") { stripes(ctx, a.poly, COL.marsh); continue; }
    if (a.type === "rough") { ctx.fillStyle = COL.roughOpen; poly(ctx, a.poly); ctx.fill(); continue; }
    ctx.fillStyle = AREA_COL[a.type]; poly(ctx, a.poly); ctx.fill();
    if (a.type === "water") { ctx.strokeStyle = COL.waterEdge; ctx.lineWidth = 0.8; ctx.stroke(); }
  }
  if (withContours && map.contours) {
    for (const c of map.contours) {
      ctx.beginPath();
      for (let i = 0; i < c.segs.length; i += 4) { ctx.moveTo(c.segs[i], c.segs[i + 1]); ctx.lineTo(c.segs[i + 2], c.segs[i + 3]); }
      ctx.strokeStyle = COL.contour; ctx.lineWidth = c.index ? 1.6 : 0.9; ctx.stroke();
    }
  }
  for (const l of map.lines) {
    ctx.beginPath();
    l.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = COL.black; ctx.lineCap = "round";
    if (l.type === "road") { ctx.lineWidth = 2.6; ctx.setLineDash([]); ctx.stroke(); ctx.strokeStyle = COL.roughOpen; ctx.lineWidth = 1.2; ctx.stroke(); }
    else { ctx.lineWidth = 1.3; ctx.setLineDash([6, 2.5]); ctx.stroke(); ctx.setLineDash([]); }
  }
  for (const b of map.buildings) { ctx.fillStyle = COL.building; poly(ctx, b.poly); ctx.fill(); ctx.strokeStyle = COL.black; ctx.lineWidth = 0.6; ctx.stroke(); }
  for (const wl of map.walls) { ctx.beginPath(); ctx.moveTo(...wl.pts[0]); ctx.lineTo(...wl.pts[1]); ctx.strokeStyle = COL.wall; ctx.lineWidth = map.kind === "maze" ? 3.2 : 2.2; ctx.lineCap = "square"; ctx.stroke(); }
  for (const p of map.points) drawPoint(ctx, p);
  ctx.restore();
}

function stripes(ctx, pts, col) {
  ctx.save();
  poly(ctx, pts); ctx.clip();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  ctx.strokeStyle = col; ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let y = y0; y < y1; y += 3.2) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
  ctx.restore();
}

export function drawPoint(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  switch (p.type) {
    case "boulder": ctx.fillStyle = COL.black; ctx.beginPath(); ctx.arc(0, 0, p.big ? 3.4 : 2.5, 0, 7); ctx.fill(); break;
    case "knoll": ctx.fillStyle = COL.brown; ctx.beginPath(); ctx.arc(0, 0, 2.3, 0, 7); ctx.fill(); break;
    case "pit": ctx.strokeStyle = COL.brown; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-3.2, -2.6); ctx.lineTo(0, 2.8); ctx.lineTo(3.2, -2.6); ctx.stroke(); break;
    case "depression": ctx.strokeStyle = COL.brown; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-3.8, -1.8); ctx.quadraticCurveTo(0, 5.5, 3.8, -1.8); ctx.stroke(); break;
    case "tree": ctx.strokeStyle = COL.tree; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, 7); ctx.stroke(); ctx.fillStyle = COL.tree; ctx.beginPath(); ctx.arc(0, 0, 1.1, 0, 7); ctx.fill(); break;
    case "cliff": {
      ctx.rotate(p.ang);
      ctx.strokeStyle = COL.black; ctx.lineWidth = 1.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-p.len / 2, 0); ctx.lineTo(p.len / 2, 0); ctx.stroke();
      // the tags point downhill: the downhill direction relative to the cliff's own axis
      const side = Math.sin(p.down - p.ang) >= 0 ? 1 : -1;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let x = -p.len / 2 + 3; x <= p.len / 2 - 2; x += 4) { ctx.moveTo(x, 0); ctx.lineTo(x, side * 3.2); }
      ctx.stroke();
      break;
    }
    case "flag": {                         // a control flag drawn as a map symbol (the maze and trail-O only)
      ctx.fillStyle = "#ff7a1a"; ctx.fillRect(-3, -3, 6, 6); break;
    }
  }
  ctx.restore();
}

/** The course overprint: a start triangle, control circles and the lines between. pts: [[x, y], …]. */
export function drawCourse(ctx, pts, view, { w, h, numbers = true, finish = true, lines = true, radius = 9, color = COL.course, lineWidth = 1.7, alpha = 0.85 } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = lineWidth; ctx.lineJoin = "round";
  const R = radius;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i === 0) {
      const nx = pts[1] || [x, y - 1];
      const a = Math.atan2(nx[1] - y, nx[0] - x);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { const th = a + (k * 2 * Math.PI) / 3; ctx.lineTo(x + R * 1.25 * Math.cos(th), y + R * 1.25 * Math.sin(th)); }
      ctx.closePath(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
      if (finish && i === pts.length - 1) { ctx.beginPath(); ctx.arc(x, y, R * 0.68, 0, 7); ctx.stroke(); }
      else if (numbers) { ctx.font = `bold ${R * 1.3}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = "left"; ctx.fillText(String(i), x + R * 0.9, y - R * 0.9); }
    }
    if (i > 0 && lines) {
      const [px, py] = pts[i - 1], d = Math.hypot(x - px, y - py);
      if (d > 2 * R + 2) {
        const ux = (x - px) / d, uy = (y - py) / d, r0 = i === 1 ? R * 1.25 : R;
        ctx.beginPath(); ctx.moveTo(px + ux * r0, py + uy * r0); ctx.lineTo(x - ux * R, y - uy * R); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** A path (a route drawn, a solution) in map units. */
export function drawPath(ctx, pts, view, { w, h, color = "#2255ff", lineWidth = 2.2, alpha = 0.8, dash = null } = {}) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = lineWidth; ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

// ---- the type raster: what ground each metre is (costs, passability, the photos' colours) ----------------------

/** A w × h Uint8Array of ground codes (T), one per map unit; drawn with the canvas, so edges blend a little. */
export function typeRaster(map) {
  const c = document.createElement("canvas");
  c.width = map.w; c.height = map.h;
  const g = c.getContext("2d", { willReadFrequently: true });
  const code = (t) => `rgb(${t},${t},${t})`;
  g.fillStyle = code(map.kind === "forest" ? T.white : T.paved); g.fillRect(0, 0, map.w, map.h);
  for (const a of map.areas) { g.fillStyle = code(T[a.type] ?? T.white); poly(g, a.poly); g.fill(); }
  for (const l of map.lines) {
    g.beginPath(); l.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = code(l.type === "road" ? T.road : T.path); g.lineWidth = l.type === "road" ? 4 : 3; g.lineCap = "round"; g.stroke();
  }
  for (const p of map.points) {
    if (p.type !== "cliff") continue;
    g.save(); g.translate(p.x, p.y); g.rotate(p.ang);
    g.strokeStyle = code(T.cliff); g.lineWidth = 3; g.beginPath(); g.moveTo(-p.len / 2, 0); g.lineTo(p.len / 2, 0); g.stroke();
    g.restore();
  }
  for (const b of map.buildings) { g.fillStyle = code(T.building); poly(g, b.poly); g.fill(); }
  for (const wl of map.walls) { g.beginPath(); g.moveTo(...wl.pts[0]); g.lineTo(...wl.pts[1]); g.strokeStyle = code(T.wall); g.lineWidth = 3; g.lineCap = "square"; g.stroke(); }
  const d = g.getImageData(0, 0, map.w, map.h).data;
  const out = new Uint8Array(map.w * map.h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}

/** The ground code at (x, y) (the nearest metre), impassable outside the map. */
export const typeAt = (map, x, y) => {
  const i = Math.round(x), j = Math.round(y);
  if (i < 0 || j < 0 || i >= map.w || j >= map.h) return T.wall;
  return map.raster[j * map.w + i];
};
export const passable = (map, x, y) => typeAt(map, x, y) < IMPASSABLE;
/** Whether the straight segment stays on passable ground. */
export function clearLine(map, a, b) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d));
  for (let i = 0; i <= n; i++) { const t = i / n; if (!passable(map, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
  return true;
}
/** A view of `size` map units around (cx, cy) drawn on a px × px canvas. */
export const viewAround = (cx, cy, size, px) => ({ x: cx - size / 2, y: cy - size / 2, scale: px / size });
/** The length of a polyline. */
export const length = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
export { dist, lerp, rect };

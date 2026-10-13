// Drawn « photos » of a generated map: the ground seen from a point in a direction, with its relief, vegetation,
// the trees scattered through the forest, the map's boulders, cliffs, buildings, and control flags. A height-field
// renderer (one column of the picture at a time, near to far, each pixel painted once), the objects as shapes of
// a given height on the ground. Good enough to recognise a control site, not a photograph.

import { hash2 } from "./rng.js";
import { T, IMPASSABLE, inside } from "./mapgen.js";

const GROUND = { [T.white]: [127, 154, 90], [T.open]: [184, 201, 90], [T.rough]: [165, 177, 92], [T.green1]: [108, 140, 82], [T.green2]: [96, 130, 74],
  [T.green3]: [84, 118, 66], [T.marsh]: [95, 138, 110], [T.paved]: [181, 176, 168], [T.path]: [168, 148, 104], [T.road]: [154, 146, 132],
  [T.olive]: [138, 154, 74], [T.water]: [95, 159, 208], [T.cliff]: [110, 104, 96], [T.building]: [150, 145, 138], [T.wall]: [150, 145, 138] };
const HAZE = [207, 217, 227];
const SKY_TOP = [122, 176, 232], SKY_BOT = [218, 230, 242];

/** The objects standing on the map (trees by a hash of each metre, the map's point features, the flags). */
function objects(map, flags) {
  const key = flags.map((f) => `${f.x | 0},${f.y | 0}`).join(";");
  if (map._scene && map._scene.key === key) return map._scene;
  const objs = [null];
  const grid = new Int32Array(map.w * map.h);
  const put = (o, test, x0, y0, x1, y1) => {
    const i = objs.push(o) - 1;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(map.h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(map.w - 1, Math.ceil(x1)); x++) if (test(x, y)) grid[y * map.w + x] = i;
  };
  const circle = (o) => put(o, (x, y) => (x - o.x) ** 2 + (y - o.y) ** 2 <= o.r * o.r, o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r);
  if (map.kind === "forest" || map.kind === "sprint") {
    const DENS = { [T.white]: 0.013, [T.open]: 0.003, [T.rough]: 0.008, [T.green1]: 0.035, [T.green2]: 0.08, [T.green3]: 0.14, [T.marsh]: 0.008 };
    for (let y = 1; y < map.h - 1; y += 1) for (let x = 1; x < map.w - 1; x += 1) {
      const t = map.raster[y * map.w + x], tt = t - (t % 16), d = DENS[tt] || 0;
      if (!d || hash2(x, y, map.seed) >= d) continue;
      const u = hash2(x, y, map.seed + 1), v = hash2(x, y, map.seed + 2);
      const bush = tt >= T.green1 && tt <= T.green3;
      circle({ kind: bush ? "bush" : "tree", x: x + u - 0.5, y: y + v - 0.5, r: bush ? 1.1 + u : 2 + 1.4 * u, h: bush ? 1.8 + 2.2 * v + (tt === T.green3 ? 1 : 0) : 7 + 5 * v, tone: hash2(x, y, map.seed + 3) });
    }
  }
  for (const p of map.points) {
    if (p.type === "boulder") circle({ kind: "rock", x: p.x, y: p.y, r: p.big ? 1.7 : 1.1, h: p.big ? 1.9 : 1.1 });
    else if (p.type === "tree") circle({ kind: "tree", x: p.x, y: p.y, r: 4.6, h: 12, tone: 0.5, lone: true });
    else if (p.type === "cliff") {
      const c = Math.cos(p.ang), s = Math.sin(p.ang), L = p.len / 2;
      const ax = p.x - c * L, ay = p.y - s * L, bx = p.x + c * L, by = p.y + s * L;
      const o = { kind: "cliff", x: p.x, y: p.y, h: 3.4, down: p.down };
      put(o, (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (4 * L * L)));
        return Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)) <= 1.3;
      }, Math.min(ax, bx) - 2, Math.min(ay, by) - 2, Math.max(ax, bx) + 2, Math.max(ay, by) + 2);
    }
  }
  for (const b of map.buildings) {
    const xs = b.poly.map((q) => q[0]), ys = b.poly.map((q) => q[1]);
    put({ kind: "building", h: b.hgt || 7 }, (x, y) => inside(b.poly, x + 0.5, y + 0.5), Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  for (const f of flags) circle({ kind: "flag", x: f.x, y: f.y, r: 0.45, h: 1.55, letter: f.letter });
  return (map._scene = { key, objs, grid });
}

/**
 * Draws the view from cam {x, y, heading} (heading in radians, 0 = north, clockwise) on the canvas.
 * flags: [{x, y, letter?}] control flags to show. Returns the screen positions of the flags' letters.
 */
export function renderScene(canvas, map, cam, { flags = [], W = 400, H = 260, fov = 1.15, far = 230 } = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H), px = img.data;
  const done = new Uint8Array(W * H);
  const f = (W / 2) / Math.tan(fov / 2), horizon = H * 0.44;
  const field = map.field;
  const hAt = (x, y) => (field ? field.at(x, y) : 0);
  const eye = hAt(cam.x, cam.y) + 1.75;
  const fx = Math.sin(cam.heading), fy = -Math.cos(cam.heading), rx = Math.cos(cam.heading), ry = Math.sin(cam.heading);
  const sc = objects(map, flags);
  const L = [-0.45, -0.55, 0.7], Ln = Math.hypot(...L); L[0] /= Ln; L[1] /= Ln; L[2] /= Ln;
  const yPrev = new Float32Array(W).fill(H);
  // sky
  for (let y = 0; y < Math.ceil(horizon) + 1; y++) {
    const t = y / horizon;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = SKY_TOP[0] + (SKY_BOT[0] - SKY_TOP[0]) * t; px[i + 1] = SKY_TOP[1] + (SKY_BOT[1] - SKY_TOP[1]) * t; px[i + 2] = SKY_TOP[2] + (SKY_BOT[2] - SKY_TOP[2]) * t; px[i + 3] = 255; }
  }
  const paint = (col, yTop, yBot, c) => {        // the unpainted pixels of the column between the two screen rows
    const y0 = Math.max(0, Math.ceil(yTop)), y1 = Math.min(H, Math.ceil(yBot));
    for (let y = y0; y < y1; y++) {
      const k = y * W + col;
      if (done[k]) continue;
      done[k] = 1;
      const i = k * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  };
  const fog = (c, z) => { const t = Math.min(0.62, Math.max(0, (z - 35) / 300)); return [c[0] + (HAZE[0] - c[0]) * t, c[1] + (HAZE[1] - c[1]) * t, c[2] + (HAZE[2] - c[2]) * t]; };
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const sy = (h, z) => horizon + ((eye - h) * f) / z;
  for (let z = 1.2; z < far; z += 0.3 + z * 0.013) {
    for (let col = 0; col < W; col++) {
      const lat = ((col - W / 2) / f) * z;
      const gx = cam.x + fx * z + rx * lat, gy = cam.y + fy * z + ry * lat;
      const gh = hAt(gx, gy);
      const inMap = gx >= 0 && gy >= 0 && gx < map.w && gy < map.h;
      const ix = Math.round(gx), iy = Math.round(gy);
      let t = inMap ? map.raster[iy * map.w + ix] : T.white;
      t -= t % 16;
      let base = GROUND[t] || GROUND[T.white];
      let light = 0.95;
      if (field) { const g = field.grad(gx, gy); const n = [-g[0], -g[1], 1], nn = Math.hypot(...n); light = 0.55 + 0.55 * Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nn); }
      const yg = sy(gh, z);
      if (yg < yPrev[col]) { paint(col, yg, yPrev[col], fog(shade(base, light), z)); yPrev[col] = yg; }
      const oi = inMap ? sc.grid[iy * map.w + ix] : 0;
      if (!oi) continue;
      const o = sc.objs[oi];
      if ((o.kind === "tree" || o.kind === "bush") && Math.hypot(o.x - cam.x, o.y - cam.y) < 3) continue;   // not from inside a crown
      if (o.kind === "building" || o.kind === "cliff") {
        const top = gh + o.h, c = o.kind === "cliff" ? [94, 90, 84] : [201, 194, 184];
        const yt = sy(top, z);
        if (o.kind === "building") paint(col, yt, sy(top - 0.5, z), fog([120, 112, 104], z));
        paint(col, yt, Math.max(yg, yt), fog(shade(c, 0.8 + 0.35 * Math.min(1, (eye - 1.75 + 3 - gh) / 6)), z));
      } else if (o.kind === "tree" || o.kind === "bush") {
        const dc = Math.hypot(gx - o.x, gy - o.y) / o.r;
        const top = gh + o.h * (1 - 0.45 * dc * dc), bot = o.kind === "bush" ? gh : gh + o.h * (0.4 + 0.15 * dc * dc);
        const tone = o.kind === "bush" ? [79, 138, 58] : [59, 122, 51];
        const c = shade(tone, 0.72 + 0.3 * o.tone + 0.25 * (1 - dc));
        paint(col, sy(top, z), sy(bot, z), fog(c, z));
        if (o.kind === "tree" && dc < (o.lone ? 0.09 : 0.14)) paint(col, sy(bot, z), yg, fog([107, 77, 51], z));
      } else if (o.kind === "rock") {
        const dc = Math.hypot(gx - o.x, gy - o.y) / o.r;
        const top = gh + o.h * Math.sqrt(Math.max(0, 1 - dc * dc));
        paint(col, sy(top, z), yg, fog(shade([150, 148, 140], 0.7 + 0.45 * (1 - dc)), z));
      } else if (o.kind === "flag") {
        const dx = gx - o.x, dy = gy - o.y, dc = Math.hypot(dx, dy) / o.r;
        if (dc < 0.75) {
          const u = (dx * rx + dy * ry) / o.r;          // across the kite, from the viewer's left to right
          const split = 0.95 + 0.55 * (u + 1) / 2;
          paint(col, sy(gh + 1.55, z), sy(gh + split, z), fog([246, 246, 242], z));
          paint(col, sy(gh + split, z), sy(gh + 0.95, z), fog([255, 108, 0], z));
        }
        if (dc < 0.22) paint(col, sy(gh + 0.95, z), yg, fog([120, 112, 100], z));
      }
    }
  }
  // what is left under the horizon is the far ground in the haze
  for (let y = Math.floor(horizon) - 1; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (!done[k]) { const i = k * 4; px[i] = HAZE[0] - 20; px[i + 1] = HAZE[1] - 12; px[i + 2] = HAZE[2] - 24; px[i + 3] = 255; } }
  ctx.putImageData(img, 0, 0);
  // the flags' letters
  const labels = [];
  for (const o of sc.objs) {
    if (!o || o.kind !== "flag" || !o.letter) continue;
    const dx = o.x - cam.x, dy = o.y - cam.y, z = dx * fx + dy * fy, lat = dx * rx + dy * ry;
    if (z < 1) continue;
    const x = W / 2 + (lat * f) / z, y = sy(hAt(o.x, o.y) + 1.55, z) - 10;
    if (x < -10 || x > W + 10) continue;
    labels.push({ letter: o.letter, x, y });
    ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.beginPath(); ctx.roundRect(x - 9, y - 9, 18, 18, 4); ctx.fill();
    ctx.fillStyle = "#111"; ctx.fillText(o.letter, x, y + 0.5);
  }
  return labels;
}

/** The camera `d` metres before the point (x, y), looking at it with `heading` (radians, 0 = looking north). */
export function cameraTowards(x, y, heading, d) {
  return { x: x - Math.sin(heading) * d, y: y + Math.cos(heading) * d, heading };
}
export const passableHere = (map, x, y) => map.raster[Math.round(y) * map.w + Math.round(x)] < IMPASSABLE;

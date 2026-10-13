// Helpers shared by the games: a canvas showing a window of a map, a labelled frame around a picture, a height
// profile drawing, a few generators of courses and legs.

import { html } from "../util.js";
import { drawMap, drawCourse, viewAround, passable, dist } from "./mapgen.js";
import { makeCanvas } from "./quiz.js";
import { range } from "./rng.js";

/** A canvas of `px` px showing `size` map units around (cx, cy): [canvas, ctx, view, opts]. */
export function mapCanvas(map, cx, cy, size, px = 360, { contours = true } = {}) {
  const [c, ctx] = makeCanvas(px, px, px);
  const view = viewAround(cx, cy, size, px);
  drawMap(ctx, map, view, { w: px, h: px, contours });
  return [c, ctx, view, { w: px, h: px }];
}

/** The square window holding the points, with a margin, as [cx, cy, size]. */
export function windowOf(pts, margin = 30, minSize = 120) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin, y0 = Math.min(...ys) - margin, y1 = Math.max(...ys) + margin;
  const size = Math.max(minSize, x1 - x0, y1 - y0);
  return [(x0 + x1) / 2, (y0 + y1) / 2, size];
}

/** A picture in a frame with a letter (or any caption) over it. */
export function framed(el, caption, extraClass = "") {
  const box = document.createElement("div");
  box.className = `g-frame ${extraClass}`;
  box.innerHTML = html`<div class="g-caption">${caption}</div>`;
  box.append(el);
  return box;
}

/** A grid of frames. */
export function grid(stage, items, cols = 2) {
  const g = document.createElement("div");
  g.className = `g-grid g-cols-${cols}`;
  g.append(...items);
  stage.append(g);
  return g;
}

/** A height profile on a canvas; lo/hi give the shared vertical scale; the ends are labelled. */
export function drawProfile(prof, { w = 220, h = 96, lo, hi, labels = ["X", "Y"], color = "#b000c8" } = {}) {
  const [c, ctx] = makeCanvas(w, h, w);
  const pad = 10, top = 16, bottom = h - 12;
  const y = (v) => bottom - ((v - lo) / Math.max(1e-6, hi - lo)) * (bottom - top);
  const x = (i) => pad + (i / (prof.length - 1)) * (w - 2 * pad);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  // a few height lines
  ctx.strokeStyle = "#e3dfd6"; ctx.lineWidth = 1;
  const step = hi - lo > 40 ? 10 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { ctx.beginPath(); ctx.moveTo(pad, y(v)); ctx.lineTo(w - pad, y(v)); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x(0), bottom);
  prof.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(prof.length - 1), bottom); ctx.closePath();
  ctx.fillStyle = "rgba(194, 122, 51, .22)"; ctx.fill();
  ctx.beginPath(); prof.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = "#8a5a2b"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = color; ctx.font = "bold 12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(labels[0], x(0), h - 2); ctx.fillText(labels[1], x(prof.length - 1), h - 2);
  return c;
}

/** A random passable point of the map, `margin` from the edges, `away` from the given points. */
export function freePoint(r, map, { margin = 30, away = 0, from = [] } = {}) {
  for (let k = 0; k < 200; k++) {
    const p = [range(r, margin, map.w - margin), range(r, margin, map.h - margin)];
    if (!passable(map, p[0], p[1])) continue;
    if (from.some((q) => dist(p, q) < away)) continue;
    return p;
  }
  return null;
}

/** A leg: two passable points `lo` to `hi` units apart. */
export function leg(r, map, lo, hi, margin = 30) {
  for (let k = 0; k < 200; k++) {
    const a = freePoint(r, map, { margin });
    if (!a) continue;
    const ang = range(r, 0, Math.PI * 2), d = range(r, lo, hi);
    const b = [a[0] + Math.cos(ang) * d, a[1] + Math.sin(ang) * d];
    if (b[0] < margin || b[1] < margin || b[0] > map.w - margin || b[1] > map.h - margin || !passable(map, b[0], b[1])) continue;
    return [a, b];
  }
  return null;
}

export { drawCourse };

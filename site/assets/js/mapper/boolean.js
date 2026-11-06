// Cartographier's operations on areas — union, difference, intersection, cutting by a line — through polygon-clipping (MIT,
// vendored). Curves are flattened first (to a twentieth of a mm) and the result simplified back to a tenth of that: the outline
// keeps its shape, as OCAD's own « union » does, its Bézier points become plain ones.

import { POLYCLIP } from "../vendor.js";
import * as G from "./geom.js";

let lib = null;
async function load() {
  if (lib) return lib;
  if (!window.polygonClipping) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = POLYCLIP; s.onload = res; s.onerror = () => rej(new Error("polygon-clipping")); document.head.appendChild(s); });
  return (lib = window.polygonClipping);
}
const TOL = 0.05;
/** An area record's coordinates as polygon-clipping's polygon: [outer ring, holes…], each ring closed [[x, y]…]. */
export function toPoly(coords) {
  return G.partsOf(coords).map((p) => {
    const r = G.flatten(p.pts, TOL).map((q) => [q[0], q[1]]);
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0].slice());
    return r;
  }).filter((r) => r.length >= 4);
}
/** polygon-clipping's multipolygon → a list of area coordinates (one record per polygon). */
export function fromMulti(multi) {
  return multi.map((poly) => G.coordsOf(poly.map((ring, i) => {
    let pts = ring.slice(0, -1).map(([x, y]) => [x, y, 0]);
    pts = G.simplify([...pts, pts[0]], TOL / 2).slice(0, -1);
    return { pts, hole: i > 0 };
  }))).filter((c) => c.length >= 3);
}
export async function union(list) { const P = await load(); return fromMulti(P.union(...list.map(toPoly))); }
export async function difference(a, ...others) { const P = await load(); return fromMulti(P.difference(toPoly(a), ...others.map(toPoly))); }
export async function intersection(list) { const P = await load(); return fromMulti(P.intersection(...list.map(toPoly))); }
export async function xor(list) { const P = await load(); return fromMulti(P.xor(...list.map(toPoly))); }
/** An area cut in two (or more) along a line drawn across it: the line widened to a thin strip, taken out. */
export async function cutByLine(coords, line, gap = 0.01) {
  const P = await load();
  const strip = [];
  const l = G.flatten(line, TOL);
  if (l.length < 2) return null;
  // a thin polygon along the line (both sides), extended a little beyond its ends
  const left = [], right = [];
  for (let i = 0; i < l.length; i++) {
    const a = l[Math.max(0, i - 1)], b = l[Math.min(l.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, nx = -dy / n * gap, ny = dx / n * gap;
    let [x, y] = l[i];
    if (i === 0) { x -= dx / n * 0.5; y -= dy / n * 0.5; }
    if (i === l.length - 1) { x += dx / n * 0.5; y += dy / n * 0.5; }
    left.push([x + nx, y + ny]); right.push([x - nx, y - ny]);
  }
  strip.push(...left, ...right.reverse(), left[0]);
  const res = fromMulti(P.difference(toPoly(coords), [strip]));
  return res.length > 1 ? res : null;
}
export const ready = load;

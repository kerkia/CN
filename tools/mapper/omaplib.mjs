// Helpers of the Node tests of Cartographier's Mapper conversions (t_omap.mjs): a recording graphics target, statistics of a
// vector map, a document's records compiled by ocad.js, readOcad's records as a document.
import { makeContext, compileSymbol, compileObject } from "../../site/assets/js/tracer/vmap/ocad.js";
import { Matrix } from "../../site/assets/js/tracer/vmap/geom.js";
import { kids } from "../../site/assets/js/mapper/fromomap.js";

export const TOL = 0.01, TEXT_TOL = 0.05;
// ---- helpers -----------------------------------------------------------------------------------------------------------------
export const union = (a, b) => (!a ? b.slice() : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
export const dev = (a, b) => (!a && !b ? 0 : !a || !b ? Infinity : Math.max(...a.map((v, i) => Math.abs(v - b[i]))));
export const fin = (b) => b && b.every(Number.isFinite);
/** A text with nothing to draw (its box is no ink): left out of the bounds compared. */
export const emptyText = (s) => Array.isArray(s.text) && !s.text.join("").trim();
/** A recording graphics target: the extent of what is drawn in each colour (map mm), and the number of drawing calls. */
export class Recorder {
  constructor() { this.stack = [new Matrix()]; this.ink = new Map(); this.calls = new Map(); this.clips = []; }
  get m() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.m.clone().prepend(m)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); }
  /** A shape's extent (points in the current frame, widened by r) cut to the clip's box, added to its colour's ink. */
  shape(color, pts, r = 0) {
    const m = this.m, R = r * m.scaleFactor;
    let b = null;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const X = m.x(pts[i], pts[i + 1]), Y = m.y(pts[i], pts[i + 1]);
      if (Number.isFinite(X) && Number.isFinite(Y)) b = union(b, [X - R, Y - R, X + R, Y + R]);
    }
    if (!b) return;
    const c = this.clips[this.clips.length - 1];
    if (c) { b = [Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.min(b[2], c[2]), Math.min(b[3], c[3])]; if (b[0] > b[2] || b[1] > b[3]) return; }
    this.ink.set(color.id, union(this.ink.get(color.id), b));
    this.calls.set(color.id, (this.calls.get(color.id) || 0) + 1);
  }
  cmds(cmds, color, r) { const pts = []; for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) pts.push(c[i], c[i + 1]); this.shape(color, pts, r); }
  stroke(cmds, pen) { if (pen.width > 0) this.cmds(cmds, pen.color, pen.width / 2); }
  fill(cmds, color) { this.cmds(cmds, color, 0); }
  polyline(pts, closed, pen) { if (pen.width > 0) this.shape(pen.color, pts, pen.width / 2); }
  ellipse(cx, cy, rx, ry, pen, fill) {
    const c = pen?.color || fill;
    if (c) this.shape(c, [cx - rx, cy - ry, cx + rx, cy + ry, cx - rx, cy + ry, cx + rx, cy - ry], (pen?.width || 0) / 2);
  }
  arc(cx, cy, r, s, sw, pen) { this.ellipse(cx, cy, r, r, pen, null); }
  fillRect([l, b, r, t], color) { this.shape(color, [l, b, r, t], 0); }
  /** A clip: its box (what is drawn under it is cut to the box: the extent of hatching and patterns as they show). */
  clip(cmds) {
    let b = null;
    const m = this.m;
    for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) { const X = m.x(c[i], c[i + 1]), Y = m.y(c[i], c[i + 1]); b = union(b, [X, Y, X, Y]); }
    const p = this.clips[this.clips.length - 1];
    if (b && p) b = [Math.max(b[0], p[0]), Math.max(b[1], p[1]), Math.min(b[2], p[2]), Math.min(b[3], p[3])];
    this.clips.push(b || p || [0, 0, 0, 0]);
  }
  unclip() { this.clips.pop(); }
  blend() {} flush() {} image() {}
  text(str, m, color, x, y) { const w = m.width(str); this.shape(color, [x, y, x + w, y + m.ascent + m.descent], 0); }
  textOutline(str, m, pen, x, y) { const w = m.width(str); this.shape(pen.color, [x, y, x + w, y + m.ascent + m.descent], pen.width / 2); }
}
export function inkOf(map) {
  const g = new Recorder();
  map.draw(g, map.bounds(), { minRes: 0.001 });
  return g;
}
/** Each colour's ink compared: the largest deviation of its extent, the colours inked on one side only. */
export function compareInk(a, b, ids = (x) => x) {
  let worst = 0, which = null;
  const miss = [];
  for (const [id, ea] of a.ink) {
    const eb = b.ink.get(ids(id));
    if (!eb) { miss.push(id); continue; }
    const d = dev(ea, eb);
    if (d > worst) { worst = d; which = id; }
  }
  for (const id of b.ink.keys()) if (![...a.ink.keys()].some((x) => ids(x) === id)) miss.push(`+${id}`);
  return { worst, which, miss };
}
/** Per symbol (code|name): objects drawn, bounds; per colour: the symbols with objects drawing in it. */
export function oomStats(map) {
  const syms = new Map(), perColor = new Map();
  for (const d of map.symdefs) {
    if (!d.symbols.length) continue;
    const key = `${d.id}|${d.name}`, e = syms.get(key) || { n: 0, b: null, text: d.kind === "text" };
    e.n += d.symbols.length;
    for (const s of d.symbols) if (fin(s.bbox) && !emptyText(s)) e.b = union(e.b, s.bbox);
    syms.set(key, e);
    if (!d.visible) continue;
    for (const c of map.colors) if (d.hasColor(c)) { if (!perColor.has(c.id)) perColor.set(c.id, new Set()); perColor.get(c.id).add(key); }
  }
  return { syms, perColor };
}
/** Mapper's symbols by id: their code|name key. */
export function mapperKeys(bytes) {
  const x = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  const keys = new Map();
  (function walk(el) {
    for (const c of kids(el)) {
      if (c.localName === "barrier") walk(c);
      else if (c.localName === "symbols") for (const s of kids(c, "symbol")) keys.set(Number(s.getAttribute("id")), `${s.getAttribute("code") || ""}|${s.getAttribute("name") || ""}`);
    }
  })(x.documentElement);
  return keys;
}
/** Compile a document's records with ocad.js (areas and texts after the others, as readOcad does). */
export function compileDoc(doc, version = 2018) {
  const ctx = makeContext(version, doc.colors);
  for (const s of doc.symbols) if (s.otp !== 3 && s.otp !== 4) compileSymbol(s, ctx);
  for (const s of doc.symbols) if (s.otp === 3 || s.otp === 4) compileSymbol(s, ctx);
  const inst = [];
  for (const o of doc.objects) { let i = null; try { i = compileObject(o.e || {}, o, ctx); } catch (e) { i = null; } inst.push(i); }
  return { ctx, map: ctx.map, inst };
}
export function cmpSyms(A, B) {
  let countOk = 0, countBad = [], bOk = 0, bBad = [], textDev = 0;
  for (const [k, a] of A.syms) {
    const b = B.syms.get(k);
    if (!b || b.n !== a.n) { countBad.push(`${k}: ${a.n}≠${b ? b.n : 0}`); continue; }
    countOk++;
    const d = dev(a.b, b.b);
    if (a.text) { textDev = Math.max(textDev, d); if (d <= TEXT_TOL) bOk++; else bBad.push(`${k} (text) ${d.toFixed(3)}`); }
    else if (d <= TOL) bOk++; else bBad.push(`${k} ${d.toFixed(3)}`);
  }
  for (const k of B.syms.keys()) if (!A.syms.has(k)) countBad.push(`${k}: 0≠${B.syms.get(k).n}`);
  return { countOk, countBad, bOk, bBad, textDev };
}
export function cmpColors(A, B) {
  const bad = [];
  for (const [id, set] of A.perColor) {
    const o = B.perColor.get(id) || new Set();
    const missing = [...set].filter((k) => !o.has(k)), extra = [...o].filter((k) => !set.has(k));
    if (missing.length || extra.length) bad.push(`colour ${id}: −[${missing.join(", ")}] +[${extra.join(", ")}]`);
  }
  for (const id of B.perColor.keys()) if (!A.perColor.has(id)) bad.push(`colour ${id} only in the second`);
  return bad;
}
export const show = (label, list, n = 4) => (list.length ? `${label} ${list.length}: ${list.slice(0, n).join("; ")}${list.length > n ? " …" : ""}` : "");

/** readOcad's records as a document (model.md), for OCAD 9 and later. */
export function ocadDoc(r) {
  const m = r.map;
  return {
    format: "ozimut-map", version: 1, title: "", ocad: { version: r.version, header: r.records.header },
    scale: m.scale, printScale: m.printScale || m.scale, printArea: m.printArea || null, realWorld: m.realWorld || null, declination: 0,
    colors: m.colors.map((c) => ({ num: c.id, name: c.name, cmyk: c.cmyk, overprint: c.overprint })),
    symbols: r.records.symbols, params: r.records.params, parts: [{ id: "p1", name: "", hidden: false, locked: false }],
    objects: r.records.objects.map((x, i) => ({ id: i + 1, ...x.o, e: x.e, part: "p1" })),
  };
}

// Checks Cartographier's symbol sets (site/assets/js/mapper/sets/*.json, made by docs/mapper/sets.mjs): every record compiles
// with ocad.js's makeContext + compileSymbol (areas and texts after the others), and a contact sheet per set and group (1xx…7xx)
// is drawn — a sample object per symbol (a point, a line with corners and a curve, a polygon, a text) through compileObject and
// VMap.draw — into SVG files, for a human to compare with isom.js's swatches.
// Run: node --import ./tools/mapper/shim.mjs tools/mapper/t_sets.mjs [out folder]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeContext, compileSymbol, compileObject, symId } from "../../site/assets/js/tracer/vmap/ocad.js";
import { Matrix } from "../../site/assets/js/tracer/vmap/geom.js";
import { cssFamily } from "../../site/assets/js/tracer/fonts.js";

const SETS = new URL("../../site/assets/js/mapper/sets/", import.meta.url);
const OUT = process.argv[2] || "sets-out";
const VERSION = 2018;
mkdirSync(OUT, { recursive: true });

/** A graphics target (target.js's interface, as VMap.draw and the symbol definitions call it) writing SVG in device pixels. */
class SvgTarget {
  constructor(base, minRes) { this.stack = [Matrix.of(base)]; this.out = []; this.defs = []; this.n = 0; this.minRes = minRes; }
  get cur() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.cur.clone().prepend(m)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); }
  d(cmds, m = this.cur) {
    const f = (x, y) => `${m.x(x, y).toFixed(2)},${m.y(x, y).toFixed(2)}`;
    return cmds.map((c) => (c[0] === "Z" ? "Z" : c[0] === "C" ? `C${f(c[1], c[2])} ${f(c[3], c[4])} ${f(c[5], c[6])}` : `${c[0]}${f(c[1], c[2])}`)).join("");
  }
  penAttrs(pen) {
    const w = Math.max(pen.width * this.cur.scaleFactor, 0.5);
    return `fill="none" stroke="${pen.color.css}" stroke-width="${w.toFixed(2)}" stroke-linecap="${pen.cap || "butt"}" stroke-linejoin="${pen.join || "miter"}" stroke-miterlimit="${pen.miter || 5}"`;
  }
  stroke(cmds, pen) { if (pen.width > 0) this.out.push(`<path d="${this.d(cmds)}" ${this.penAttrs(pen)}/>`); }
  fill(cmds, color, evenOdd = true) { this.out.push(`<path d="${this.d(cmds)}" fill="${color.css}" fill-rule="${evenOdd ? "evenodd" : "nonzero"}"/>`); }
  fillRect([l, b, r, t], color) { this.fill([["M", l, b], ["L", r, b], ["L", r, t], ["L", l, t], ["Z"]], color, false); }
  polyline(pts, closed, pen) {
    if (!(pen.width > 0) || pts.length < 4) return;
    const cmds = [];
    for (let i = 0; i < pts.length; i += 2) cmds.push([i ? "L" : "M", pts[i], pts[i + 1]]);
    if (closed) cmds.push(["Z"]);
    this.stroke(cmds, pen);
  }
  ellipse(cx, cy, rx, ry, pen, fillColor) {
    const k = 0.5522847498, c = [["M", cx + rx, cy], ["C", cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry], ["C", cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
      ["C", cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry], ["C", cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy], ["Z"]];
    if (fillColor) this.fill(c, fillColor, false);
    if (pen && pen.width > 0) this.stroke(c, pen);
  }
  arc(cx, cy, r, startDeg, sweepDeg, pen) {
    const n = Math.max(4, Math.ceil(Math.abs(sweepDeg) / 5)), cmds = [];
    for (let i = 0; i <= n; i++) { const a = ((startDeg + (sweepDeg * i) / n) * Math.PI) / 180; cmds.push([i ? "L" : "M", cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    this.stroke(cmds, pen);
  }
  clip(cmds) { const id = `c${++this.n}`; this.defs.push(`<clipPath id="${id}"><path d="${this.d(cmds)}" clip-rule="evenodd"/></clipPath>`); this.out.push(`<g clip-path="url(#${id})">`); }
  unclip() { this.out.push("</g>"); }
  blend() {}
  flush() {}
  image() {}
  text(str, m, color, x, y) { this.textCore(str, m, x, y, `fill="${color.css}"`); }
  textOutline(str, m, pen, x, y) { this.textCore(str, m, x, y, `fill="none" stroke="${pen.color.css}" stroke-width="${(pen.width * this.cur.scaleFactor).toFixed(2)}"`); }
  textCore(str, m, x, y, paint) {
    const c = this.cur, s = c.scaleFactor;
    const esc = String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    this.out.push(`<text transform="matrix(${c.a / s} ${c.b / s} ${c.c / s} ${c.d / s} ${c.e} ${c.f})" x="${(x * s).toFixed(2)}" y="${((y + m.ascent) * s).toFixed(2)}" font-family="${cssFamily(m.fam).replace(/"/g, "'")}" font-size="${(m.size * s).toFixed(2)}" ${m.bold ? 'font-weight="700"' : ""} ${paint}>${esc}</text>`);
  }
}

// ---- sample objects -------------------------------------------------------------------------------------------------------------
const P = (x, y, fx = 0, fy = 0) => ({ x: (Math.round(x * 100) << 8) | fx, y: (Math.round(y * 100) << 8) | fy });
const CW = 16, CH = 11, LABEL = 2.2, COLS = 6;      // a cell, mm (the label's band at its top)
function sample(s, x0, y0) {                          // (x0, y0): the cell's top-left, y up
  const cx = x0 + CW / 2, cy = y0 - LABEL - (CH - LABEL) / 2;
  if (s.otp === 1) return { otp: 1, coords: [P(cx, cy)] };
  if (s.otp === 4) return { otp: 4, coords: [P(cx, cy)], text: "123" };
  if (s.otp === 2) return { otp: 2, coords: [P(x0 + 1, cy - 2.5), P(x0 + 4.5, cy + 1.5, 0, 1), P(x0 + 6.5, cy + 3.5, 1), P(x0 + 9.5, cy - 3.5, 2), P(x0 + 11.5, cy - 1.5, 0, 1), P(x0 + 15, cy + 2.5)] };
  return { otp: 3, coords: [P(x0 + 1, cy + 3.3), P(x0 + 15, cy + 3.3), P(x0 + 15, cy - 2.3), P(x0 + 9, cy - 4), P(x0 + 1, cy - 2.6), P(x0 + 1, cy + 3.3)] };
}

let failures = 0;
for (const file of ["isom2017-2.json", "issprom2019-2.json"]) {
  const set = JSON.parse(readFileSync(new URL(file, SETS), "utf8"));
  const ctx = makeContext(VERSION, set.colors);
  for (const s of set.symbols) if (s.otp !== 3 && s.otp !== 4) compileSymbol(s, ctx);
  for (const s of set.symbols) if (s.otp === 3 || s.otp === 4) compileSymbol(s, ctx);
  const bad = set.symbols.filter((s) => !ctx.symdefs.get(symId(s.sym, VERSION)));
  failures += bad.length + ctx.map.notes.length;
  console.log(file, set.symbols.length, "records,", bad.length, "not compiled,", ctx.map.notes.length, "notes", ctx.map.notes.slice(0, 5).join(" | "));
  // a contact sheet per group: a fresh map for each, holding that group's samples
  const groups = new Map();
  for (const s of set.symbols) { const g = Math.floor(s.sym / 100000); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  for (const [g, list] of groups) {
    const gctx = makeContext(VERSION, set.colors);
    for (const s of set.symbols) if (s.otp !== 3 && s.otp !== 4) compileSymbol(s, gctx);
    for (const s of set.symbols) if (s.otp === 3 || s.otp === 4) compileSymbol(s, gctx);
    const labels = [], whites = new Set(set.colors.filter((x) => /^White over/.test(x.name)).map((x) => x.num));
    list.forEach((s, i) => {
      const x0 = (i % COLS) * CW, y0 = -Math.floor(i / COLS) * CH;
      const o = { sym: s.sym, ang: 0, col: 0, lineWidth: 0, diamFlags: 0, text: null, ...sample(s, x0, y0) };
      if (!compileObject({ objIndex: i + 1 }, o, gctx)) { failures++; console.log("  object not made:", s.sym); }
      // a symbol drawn only in a « White over … » colour (512.3's stripes) is shown over a brown ground
      const onlyWhite = s.otp === 3 && !s.fillOn && !!s.hatchMode && whites.has(s.hatchColor);
      labels.push({ x0, y0, t: `${Math.floor(s.sym / 1000)}${s.sym % 1000 ? "." + (s.sym % 1000) : ""} ${s.description}`, note: !!s.note, ground: onlyWhite });
    });
    const rows = Math.ceil(list.length / COLS), PX = 30;
    const l = 0, t = 0, W = COLS * CW, Hh = rows * CH;
    const g2 = new SvgTarget(new Matrix(PX, 0, 0, -PX, -l * PX, t * PX), 1 / PX);
    gctx.map.draw(g2, [l, -Hh, W, t], { minRes: 1 / PX });
    const grid = labels.map(({ x0, y0, t: txt, note }) => `<rect x="${x0 * PX}" y="${-y0 * PX}" width="${CW * PX}" height="${CH * PX}" fill="none" stroke="#ccc"/>`
      + `<text x="${x0 * PX + 4}" y="${-y0 * PX + 14}" font-family="Arial" font-size="12" fill="${note ? "#a0522d" : "#333"}">${txt.replace(/&/g, "&amp;").slice(0, 52)}</text>`).join("");
    const grounds = labels.filter((x) => x.ground).map(({ x0, y0 }) => `<rect x="${x0 * PX}" y="${(-y0 + LABEL) * PX}" width="${CW * PX}" height="${(CH - LABEL) * PX}" fill="#c08a5a"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * PX}" height="${Hh * PX}" viewBox="0 0 ${W * PX} ${Hh * PX}"><rect width="100%" height="100%" fill="#fff"/>${grounds}<defs>${g2.defs.join("")}</defs>${g2.out.join("")}${grid}</svg>`;
    const name = `${file.replace(".json", "")}-${g}xx.svg`;
    writeFileSync(join(OUT, name), svg);
  }
}
console.log(failures ? `FAILURES: ${failures}` : "all records compile, every sample drawn");
process.exit(failures ? 1 : 0);

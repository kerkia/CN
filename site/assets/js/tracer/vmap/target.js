// Graphics targets for the vector maps (map.js, symdefs.js draw through them): a canvas for the screen and the images, the
// operators of a PDF page (pdf-lib) for printing, in CMYK. Coordinates handed to a target are map mm (y up) under a stack of
// matrices (push/pop: the matrix pushed last applies first, as Purple Pen's PushTransform); clips nest with the matrices.
// A pen: { color, width (mm), cap, join, miter }; a colour: a VColor (map.js), whose CMYK is printed as is.

import { Matrix } from "./geom.js";
import { cssFamily, textRuns } from "../fonts.js";

const CAP_PDF = { butt: 0, round: 1, square: 2 }, JOIN_PDF = { miter: 0, round: 1, bevel: 2 };

export class CanvasTarget {
  /** ctx: a 2D context; base: the matrix from map mm to canvas pixels. Strokes, and circles, of one style are gathered into
   *  one path in device pixels and drawn together (one colour is painted at a time: their order does not matter), which keeps a
   *  map of ten thousand objects and its area patterns fast; fills of areas are drawn one by one (holes, overlaps). */
  constructor(ctx, base, { minRes = null } = {}) {
    this.ctx = ctx; this.stack = [Matrix.of(base)]; this.clips = 0; this.batches = new Map();
    this.minRes = minRes ?? 1 / base.scaleFactor;
  }
  get cur() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.cur.clone().prepend(m)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); }
  /** Commands transformed to device pixels, added to a path. */
  addCmds(p, cmds, m = this.cur) {
    for (const c of cmds) {
      if (c[0] === "M") p.moveTo(m.x(c[1], c[2]), m.y(c[1], c[2]));
      else if (c[0] === "L") p.lineTo(m.x(c[1], c[2]), m.y(c[1], c[2]));
      else if (c[0] === "C") p.bezierCurveTo(m.x(c[1], c[2]), m.y(c[1], c[2]), m.x(c[3], c[4]), m.y(c[3], c[4]), m.x(c[5], c[6]), m.y(c[5], c[6]));
      else if (c[0] === "Z") p.closePath();
    }
    return p;
  }
  batch(key, make) { let b = this.batches.get(key); if (!b) { b = make(); b.path = new Path2D(); this.batches.set(key, b); } return b; }
  strokeBatch(pen) {
    // a line is at least a pixel wide on the screen, as OCAD shows it (a 0.07 mm edge would fade to grey)
    const w = Math.max(pen.width * this.cur.scaleFactor, 1), cap = pen.cap || "butt", join = pen.join || "miter";
    return this.batch(`s|${pen.color.css}|${w.toFixed(3)}|${cap}|${join}`, () => ({ stroke: true, css: pen.color.css, w, cap, join, miter: pen.miter || 5 }));
  }
  flush() {
    if (!this.batches.size) return;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const b of this.batches.values()) {
      if (b.stroke) { g.strokeStyle = b.css; g.lineWidth = b.w; g.lineCap = b.cap; g.lineJoin = b.join; g.miterLimit = b.miter; g.stroke(b.path); }
      else { g.fillStyle = b.css; g.fill(b.path, "nonzero"); }
    }
    this.batches.clear();
  }
  stroke(cmds, pen) { if (!(pen.width > 0)) return; this.addCmds(this.strokeBatch(pen).path, cmds); }
  fill(cmds, color, evenOdd = true) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = color.css;
    g.fill(this.addCmds(new Path2D(), cmds), evenOdd ? "evenodd" : "nonzero");
  }
  polyline(pts, closed, pen) {
    if (!(pen.width > 0) || pts.length < 4) return;
    const p = this.strokeBatch(pen).path, m = this.cur;
    p.moveTo(m.x(pts[0], pts[1]), m.y(pts[0], pts[1]));
    for (let i = 2; i < pts.length; i += 2) p.lineTo(m.x(pts[i], pts[i + 1]), m.y(pts[i], pts[i + 1]));
    if (closed) p.closePath();
  }
  /** A circle or an ellipse (in the current frame: a rotated or scaled frame keeps it an ellipse). */
  ellipse(cx, cy, rx, ry, pen, fillColor) {
    const m = this.cur, s = m.scaleFactor;
    const x = m.x(cx, cy), y = m.y(cx, cy);
    const conformal = (Math.abs(m.a - m.d) < 1e-9 && Math.abs(m.b + m.c) < 1e-9) || (Math.abs(m.a + m.d) < 1e-9 && Math.abs(m.b - m.c) < 1e-9);
    const draw = (p) => {
      if (conformal && rx === ry) { p.moveTo(x + Math.max(rx * s, 0), y); p.arc(x, y, Math.max(rx * s, 0), 0, Math.PI * 2); }
      else { const sub = new Path2D(); sub.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2); p.addPath(sub, new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f])); }
    };
    if (fillColor) draw(this.batch(`f|${fillColor.css}`, () => ({ stroke: false, css: fillColor.css })).path);
    if (pen && pen.width > 0) draw(this.strokeBatch(pen).path);
  }
  arc(cx, cy, r, startDeg, sweepDeg, pen) {
    const sub = new Path2D(), a = (startDeg * Math.PI) / 180, m = this.cur;
    sub.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    sub.arc(cx, cy, r, a, a + (sweepDeg * Math.PI) / 180, false);
    this.strokeBatch(pen).path.addPath(sub, new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]));
  }
  fillRect([l, b, r, t], color) { this.fill([["M", l, b], ["L", r, b], ["L", r, t], ["L", l, t], ["Z"]], color, false); }
  /**
   * Fill an area with a structure pattern as a repeating tile (Purple Pen's pattern brushes, for the screen): p the pattern
   * (symdefs.AreaSymDef), m the pattern's frame. False when the tile would be too coarse: the caller draws each element.
   */
  patternFill(cmds, p, color, m) {
    const MAX = 80, MIN = 10, pw = p.width, th = p.offsetRows ? p.height * 2 : p.height;
    let ps = this.minRes;
    if (ps < pw / MAX || ps < p.height / MAX) return false;            // the pattern is large on screen: drawn element by element
    ps = Math.min(ps, pw / MIN, p.height / MIN);
    const W = Math.max(1, Math.round(pw / ps)), H = Math.max(1, Math.round(th / ps)), psx = pw / W, psy = th / H;
    p._tiles ||= new Map();
    const key = `${color.id}|${color.css}|${W}|${H}`;
    let tile = p._tiles.get(key);
    if (!tile) {
      if (p._tiles.size > 24) p._tiles.clear();
      tile = makeTile(p, color, W, H, psx, psy);
      p._tiles.set(key, tile);
    }
    const D = this.cur.clone().prepend(m).prepend(new Matrix(psx, 0, 0, -psy, -pw / 2, th - p.height / 2));
    const g = this.ctx, pat = g.createPattern(tile, "repeat");
    if (!pat) return false;
    pat.setTransform(new DOMMatrix([D.a, D.b, D.c, D.d, D.e, D.f]));
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = pat;
    g.fill(this.addCmds(new Path2D(), cmds), "evenodd");
    return true;
  }
  clip(cmds) { this.flush(); const g = this.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clip(this.addCmds(new Path2D(), cmds), "evenodd"); this.clips++; }
  unclip() { this.flush(); if (this.clips > 0) { this.ctx.restore(); this.clips--; } }
  blend(on) { this.flush(); this.ctx.globalCompositeOperation = on ? "darken" : "source-over"; }
  /** Text in a y-down frame (a symbol's flipped one), its top-left at (x, y): the metrics (symdefs.faceMetrics) give the face. */
  text(str, m, color, x, y) { this.textCore(str, m, x, y, (g, s, px, py) => { g.fillStyle = color.css; g.fillText(str, px, py); }); }
  textOutline(str, m, pen, x, y) {
    this.textCore(str, m, x, y, (g, s, px, py) => {
      g.strokeStyle = pen.color.css; g.lineWidth = pen.width * s; g.lineJoin = pen.join || "miter"; g.miterLimit = 5; g.strokeText(str, px, py);
    });
  }
  textCore(str, m, x, y, paint) {
    const c = this.cur, s = c.scaleFactor;
    if (!(s > 0) || m.size * s < 0.4) return;
    const g = this.ctx;
    g.setTransform(c.a / s, c.b / s, c.c / s, c.d / s, c.e, c.f);
    g.font = `${m.italic ? "italic " : ""}${m.bold ? "700" : "400"} ${m.size * s}px ${cssFamily(m.fam)}`;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    paint(g, s, x * s, (y + m.ascent) * s);
  }
  image(img, [l, b, r, t]) {
    this.flush();
    const m = this.cur, g = this.ctx;
    g.save(); g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); g.transform(1, 0, 0, -1, 0, b + t); g.drawImage(img, l, b, r - l, t - b); g.restore();
  }
}

/** One cell of a pattern (two rows when alternate rows are offset), with the parts of its neighbours that reach into it. */
function makeTile(p, color, W, H, psx, psy) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const pw = p.width, ph = p.height, th = p.offsetRows ? ph * 2 : ph;
  const t = new CanvasTarget(c.getContext("2d"), new Matrix(1 / psx, 0, 0, -1 / psy, pw / 2 / psx, (th - ph / 2) / psy), { minRes: Math.min(psx, psy) });
  const nc = Math.ceil(p.glyph.radius / pw) + 1, nr = Math.ceil(p.glyph.radius / ph) + 2;
  for (let j = -nr; j <= nr + 1; j++) {
    const shift = p.offsetRows && Math.abs(j) % 2 === 1 ? -pw / 2 : 0;
    for (let i = -nc; i <= nc + 1; i++) p.glyph.draw(t, i * pw + shift, j * ph, -p.angle, null, null, color);
  }
  t.flush();
  return c;
}

/** A PDF page as a target: operators collected, then pushed (pdf-lib). fonts: makeFonts' runs(). */
export class PdfTarget {
  constructor(L, page, base, { rgb = false, fonts = null, darken = null, minRes = 0.01 } = {}) {
    this.L = L; this.page = page; this.ops = []; this.rgb = rgb; this.fonts = fonts; this.darken = darken; this.minRes = minRes;
    this.texts = [];                                          // text runs wait for their fonts (async): placed in order
    this.ops.push(L.pushGraphicsState(), L.concatTransformationMatrix(base.a, base.b, base.c, base.d, base.e, base.f));
    this.depth = 1;
  }
  push(m) { this.ops.push(this.L.pushGraphicsState(), this.L.concatTransformationMatrix(m.a, m.b, m.c, m.d, m.e, m.f)); this.depth++; }
  pop() { this.ops.push(this.L.popGraphicsState()); this.depth--; }
  color(c, fill) {
    const L = this.L, k = c.cmyk || [0, 0, 0, 1];
    if (this.rgb) { const [r, g, b] = [(1 - k[0]) * (1 - k[3]), (1 - k[1]) * (1 - k[3]), (1 - k[2]) * (1 - k[3])]; this.ops.push(fill ? L.setFillingRgbColor(r, g, b) : L.setStrokingRgbColor(r, g, b)); }
    else this.ops.push(fill ? L.setFillingCmykColor(...k) : L.setStrokingCmykColor(...k));
  }
  pathOps(cmds) {
    const L = this.L;
    for (const c of cmds) {
      if (c[0] === "M") this.ops.push(L.moveTo(c[1], c[2]));
      else if (c[0] === "L") this.ops.push(L.lineTo(c[1], c[2]));
      else if (c[0] === "C") this.ops.push(L.appendBezierCurve(c[1], c[2], c[3], c[4], c[5], c[6]));
      else if (c[0] === "Z") this.ops.push(L.closePath());
    }
  }
  setPen(p) { const L = this.L; this.color(p.color, false); this.ops.push(L.setLineWidth(p.width), L.setLineCap(CAP_PDF[p.cap] ?? 0), L.setLineJoin(JOIN_PDF[p.join] ?? 0)); }
  stroke(cmds, pen) { if (!(pen.width > 0)) return; this.setPen(pen); this.pathOps(cmds); this.ops.push(this.L.stroke()); }
  fill(cmds, color, evenOdd = true) { this.color(color, true); this.pathOps(cmds); this.ops.push(evenOdd ? this.L.PDFOperator.of("f*") : this.L.fill()); }
  polyline(pts, closed, pen) {
    if (!(pen.width > 0) || pts.length < 4) return;
    const cmds = [["M", pts[0], pts[1]]];
    for (let i = 2; i < pts.length; i += 2) cmds.push(["L", pts[i], pts[i + 1]]);
    if (closed) cmds.push(["Z"]);
    this.stroke(cmds, pen);
  }
  ellipse(cx, cy, rx, ry, pen, fillColor) {
    const k = 0.5522847498, ax = k * rx, ay = k * ry;
    const cmds = [["M", cx + rx, cy], ["C", cx + rx, cy + ay, cx + ax, cy + ry, cx, cy + ry], ["C", cx - ax, cy + ry, cx - rx, cy + ay, cx - rx, cy],
      ["C", cx - rx, cy - ay, cx - ax, cy - ry, cx, cy - ry], ["C", cx + ax, cy - ry, cx + rx, cy - ay, cx + rx, cy], ["Z"]];
    if (fillColor) this.fill(cmds, fillColor, false);
    if (pen) this.stroke(cmds, pen);
  }
  arc(cx, cy, r, startDeg, sweepDeg, pen) {
    // bezier pieces of at most 90°
    const cmds = [], n = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 90)), step = ((sweepDeg / n) * Math.PI) / 180;
    let a = (startDeg * Math.PI) / 180;
    cmds.push(["M", cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    for (let i = 0; i < n; i++) {
      const b = a + step, h = (4 / 3) * Math.tan(step / 4) * r;
      cmds.push(["C", cx + r * Math.cos(a) - h * Math.sin(a), cy + r * Math.sin(a) + h * Math.cos(a), cx + r * Math.cos(b) + h * Math.sin(b), cy + r * Math.sin(b) - h * Math.cos(b), cx + r * Math.cos(b), cy + r * Math.sin(b)]);
      a = b;
    }
    this.stroke(cmds, pen);
  }
  fillRect([l, b, r, t], color) { this.fill([["M", l, b], ["L", r, b], ["L", r, t], ["L", l, t], ["Z"]], color, false); }
  clip(cmds) { this.ops.push(this.L.pushGraphicsState()); this.pathOps(cmds); this.ops.push(this.L.PDFOperator.of("W*"), this.L.endPath()); this.depth++; }
  unclip() { this.ops.push(this.L.popGraphicsState()); this.depth--; }
  blend(on) {
    if (!this.darken) return;
    if (on) { this.ops.push(this.L.pushGraphicsState(), this.L.setGraphicsState(this.darken)); this.depth++; }
    else { this.ops.push(this.L.popGraphicsState()); this.depth--; }
  }
  /** Text: a slot in the operators, filled once the fonts are ready (finish()). */
  text(str, m, color, x, y) { this.textSlot(str, m, x, y, { color }); }
  textOutline(str, m, pen, x, y) { this.textSlot(str, m, x, y, { pen }); }
  textSlot(str, m, x, y, how) {
    const slot = [];
    this.ops.push(slot);
    this.texts.push({ slot, str, m, x, y, how });
  }
  image() { /* layout bitmaps are not printed */ }
  /** Resolve the text slots and push everything onto the page. */
  async finish() {
    const L = this.L;
    for (const t of this.texts) {
      const runs = this.fonts ? await this.fonts.runs(t.str, t.m.fam, t.m.bold, t.m.italic) : [];
      if (!runs.length) continue;
      const ops = t.slot;
      ops.push(L.pushGraphicsState(), L.concatTransformationMatrix(1, 0, 0, -1, t.x, t.y + t.m.ascent));
      if (t.how.color) this.colorInto(ops, t.how.color, true);
      else { this.colorInto(ops, t.how.pen.color, false); ops.push(L.setLineWidth(t.how.pen.width), L.setLineJoin(JOIN_PDF[t.how.pen.join] ?? 0)); }
      ops.push(L.beginText(), L.setTextRenderingMode(t.how.color ? L.TextRenderingMode.Fill : L.TextRenderingMode.Outline));
      let x = 0;
      for (const r of runs) {
        ops.push(L.setFontAndSize(this.page.node.newFontDictionary(r.font.name, r.font.ref), t.m.size), L.setTextMatrix(1, 0, 0, 1, x, 0), L.showText(r.font.encodeText(r.text)));
        x += r.font.widthOfTextAtSize(r.text, t.m.size);
      }
      ops.push(L.endText(), L.popGraphicsState());
    }
    while (this.depth > 0) { this.ops.push(L.popGraphicsState()); this.depth--; }
    const flat = [];
    for (const o of this.ops) if (Array.isArray(o)) flat.push(...o); else flat.push(o);
    for (let i = 0; i < flat.length; i += 2000) this.page.pushOperators(...flat.slice(i, i + 2000));
  }
  colorInto(ops, c, fill) {
    const L = this.L, k = c.cmyk || [0, 0, 0, 1];
    if (this.rgb) { const [r, g, b] = [(1 - k[0]) * (1 - k[3]), (1 - k[1]) * (1 - k[3]), (1 - k[2]) * (1 - k[3])]; ops.push(fill ? L.setFillingRgbColor(r, g, b) : L.setStrokingRgbColor(r, g, b)); }
    else ops.push(fill ? L.setFillingCmykColor(...k) : L.setStrokingCmykColor(...k));
  }
}
void textRuns;

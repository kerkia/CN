// OCAD map files written (versions 9, 10, 11, 12 and 2018): a port of the parts of Purple Pen's OcadExport and OcadFileFormat
// (BSD licence, Copyright (c) 2006-2008 Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt) that a course file needs: the
// colours, line, area (fill, hatching) and text symbols, line, area and text objects, the scale, print area, real-world
// coordinates and background templates as parameter strings. The input is a plain course model (tracer/coursefiles.js):
//   { scale, printScale, printArea: [l, b, r, t] | null, notes, realWorld: { x, y, angle, grid, paperGrid, zone, on } | null,
//     colors: [{ id, name, cmyk: [c, m, y, k] (0..1), overprint }] from the bottom of the colour table to its top,
//     symbols: [{ code: "702.0", name, kind: "line" | "area" | "text" | "point", … }], objects: [{ sym, kind, paths | text, x, y }],
//     templates: [{ file, x, y (its centre, mm), mmPerPx, mmPerPxY (0 for a vector map), angle, front }],
//     layoutImages: [{ file, data (bytes), x, y (top-left, mm), u, v (mm per pixel) }] (OCAD 11 and later: kept in the file) }
// A point symbol is a glyph: parts { type: "circle", x, y, r (to the line's middle), width, color } | { type: "dot", x, y, d,
// color } | { type: "line", path, width, cap, join, color } | { type: "area", paths, color }, in mm around the point; a point
// object has its angle and, for circles, its gaps ([start, end, …] degrees, as Purple Pen's cut control circles).
// Paths are lists of commands in map mm, y up: ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"].

const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
/** A string as Windows-1252 bytes, as OCAD writes them on Windows; « ? » for what it cannot hold. */
export function cp1252(s) {
  const out = [];
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    out.push(c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[c] ?? 0x3f);
  }
  return out;
}

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.dv = new DataView(this.buf.buffer); this.pos = 0; this.end = 0; }
  room(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2; while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size); b.set(this.buf); this.buf = b; this.dv = new DataView(b.buffer);
  }
  moved() { if (this.pos > this.end) this.end = this.pos; }
  u8(v) { this.room(1); this.buf[this.pos++] = v & 0xff; this.moved(); }
  i16(v) { this.room(2); this.dv.setInt16(this.pos, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.pos += 2; this.moved(); }
  u16(v) { this.room(2); this.dv.setUint16(this.pos, Math.max(0, Math.min(65535, Math.round(v))), true); this.pos += 2; this.moved(); }
  i32(v) { this.room(4); this.dv.setInt32(this.pos, v | 0, true); this.pos += 4; this.moved(); }
  u32(v) { this.room(4); this.dv.setUint32(this.pos, v >>> 0, true); this.pos += 4; this.moved(); }
  f64(v) { this.room(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; this.moved(); }
  zeros(n) { this.room(n); this.buf.fill(0, this.pos, this.pos + n); this.pos += n; this.moved(); }
  bytes(a) { this.room(a.length); this.buf.set(a, this.pos); this.pos += a.length; this.moved(); }
  /** A Delphi short string: its length, then n bytes. */
  pstr(s, n) { const b = cp1252(s).slice(0, n); this.u8(b.length); this.bytes(b); this.zeros(n - b.length); }
  /** n UTF-16 characters, padded with NUL. */
  wstr(s, n) { const t = String(s ?? "").slice(0, n); for (let i = 0; i < n; i++) this.u16(i < t.length ? t.charCodeAt(i) : 0); }
  seek(p) { this.pos = p; }
  result() { return this.buf.slice(0, this.end); }
}

const oc = (mm) => Math.round(mm * 100);                     // OCAD units: 0.01 mm
const ang = (deg) => Math.round(deg * 10);                    // 0.1°
const num = (v) => String(Math.round(v * 1e6) / 1e6);

/** A path's points as OCAD coordinates: { x, y } shifted by 8 bits, with the bezier, corner and hole flags. */
function coordsOf(paths, area) {
  const out = [];
  paths.forEach((cmds, part) => {
    let first = null, start = out.length;
    for (const c of cmds) {
      if (c[0] === "M" || c[0] === "L") { out.push({ x: oc(c[1]) << 8, y: oc(c[2]) << 8 }); if (!first) first = [c[1], c[2]]; }
      else if (c[0] === "C") { out.push({ x: (oc(c[1]) << 8) | 1, y: oc(c[2]) << 8 }, { x: (oc(c[3]) << 8) | 2, y: oc(c[4]) << 8 }, { x: oc(c[5]) << 8, y: oc(c[6]) << 8 }); }
      else if (c[0] === "Z" && first && !area) {
        const l = out[out.length - 1];
        if ((l.x >> 8) !== oc(first[0]) || (l.y >> 8) !== oc(first[1])) out.push({ x: oc(first[0]) << 8, y: oc(first[1]) << 8 });
      }
    }
    if (area) {
      // an area closes itself: the repeated last point is dropped (Purple Pen's LastPointSynthesized)
      const f = out[start], l = out[out.length - 1];
      if (out.length - start > 2 && f.x === l.x && f.y === l.y) out.pop();
      if (part > 0 && out[start]) out[start].y |= 2;            // the first point of a hole
    }
  });
  return out;
}
/** The box of an object, widened by half a line (OCAD rejects an object outside its index box). */
function boxOf(coords, extra = 0) {
  let l = Infinity, b = Infinity, r = -Infinity, t = -Infinity;
  for (const c of coords) { const x = c.x >> 8, y = c.y >> 8; if (x < l) l = x; if (x > r) r = x; if (y < b) b = y; if (y > t) t = y; }
  const e = oc(extra);
  return [(l - e) << 8, (b - e) << 8, (r + e) << 8, (t + e) << 8];
}

/** The symbol number in the file: « 702.1 » → 702001 (OCAD 9 and later). */
const symNumber = (code) => { const [a, b = "0"] = String(code).split("."); return parseInt(a, 10) * 1000 + parseInt(b, 10); };
const lineEnds = (cap, join) => (cap === "round" ? 1 : join === "bevel" || join === "round" ? 0 : 4);
const alignment = (align) => (align === "center" ? 1 : align === "right" ? 2 : 0);    // on the baseline

/** Write a course model as an OCAD file of the given version (9, 10, 11, 12 or 2018). Returns the file's bytes. */
export function writeOcad(model, version = 12) {
  if (![9, 10, 11, 12, 2018].includes(version)) throw new Error(`OCAD ${version} : seules les versions 9 à 12 et 2018 s'écrivent.`);
  const v = version, w = new Writer(), hdrSize = v >= 12 ? 60 : 48;
  w.zeros(hdrSize);
  const colorsUsed = (s) => [...new Set([s.color, s.fill, s.hatch?.color, s.frame?.color, ...(s.parts || []).map((q) => q.color)].filter((c) => c != null))];

  // ---- symbols: each one, then a block of 256 positions (OcadExport.WriteSymbols) ----
  let firstSymBlk = 0, prevBlk = 0;
  const symPos = [];
  const symList = model.symbols;
  for (let i = 0; i < symList.length; i++) {
    symPos.push(w.pos);
    writeSymbol(w, v, symList[i], colorsUsed(symList[i]));
    if (symPos.length === 256 || i === symList.length - 1) {
      const at = w.pos;
      if (!prevBlk) firstSymBlk = at; else { w.seek(prevBlk); w.i32(at); w.seek(at); }
      w.i32(0); for (let k = 0; k < 256; k++) w.i32(symPos[k] || 0);
      prevBlk = at; symPos.length = 0;
    }
  }

  // ---- objects: each one, then a block of 256 index entries (OcadExport.WriteObjects) ----
  let firstIdxBlk = 0; prevBlk = 0;
  let block = [];
  const flushIndex = () => {
    const at = w.pos;
    if (!prevBlk) firstIdxBlk = at; else { w.seek(prevBlk); w.i32(at); w.seek(at); }
    w.i32(0);
    for (let k = 0; k < 256; k++) {
      const e = block[k];
      if (!e) { w.zeros(40); continue; }
      w.i32(e.box[0]); w.i32(e.box[1]); w.i32(e.box[2]); w.i32(e.box[3]);
      w.i32(e.pos); w.i32(e.len); w.i32(e.sym); w.u8(e.otp); w.u8(0); w.u8(1); w.u8(0);
      w.i16(e.color); w.i16(0); w.i16(0); w.u8(0); w.u8(0);
    }
    prevBlk = at; block = [];
  };
  for (const o of model.objects) {
    const s = symList[o.sym];
    let coords, otp, text = null, angle = 0, extra = 0;
    let box = null;
    if (o.kind === "text") {
      otp = 4; text = String(o.text ?? "").replace(/\r?\n/g, "\r\n"); angle = o.angle || 0;
      coords = textCoords(o, s);
    } else if (o.kind === "point") {
      // the point, then each gap as a pair of angles (not coordinates: unshifted, in 0.1°)
      otp = 1; angle = o.angle || 0;
      coords = [{ x: oc(o.x) << 8, y: oc(o.y) << 8 }];
      const g = o.gaps || [];
      for (let i = 0; i + 1 < g.length; i += 2) coords.push({ x: ang(g[i]), y: ang(g[i + 1]) });
      box = boxOf(coords.slice(0, 1), glyphRadius(s));
    } else if (o.kind === "area") { otp = 3; coords = coordsOf(o.paths, true); }
    else { otp = 2; coords = coordsOf(o.paths, false); extra = (s.width || 0) / 2; }
    if (!coords.length) continue;
    const nText = text != null ? Math.floor(text.length / 4) + 1 : 0;
    const pos = w.pos;
    if (v >= 12) {
      w.i32(symNumber(s.code)); w.u8(otp); w.u8(0); w.i16(ang(angle)); w.u32(0); w.i16(0); w.i16(0);
      w.i32(0); w.i32(0); w.f64(0); w.i32(0); w.f64(0);
      w.i32(coords.length); w.i16(nText); w.i16(0); w.i16(0); w.u8(0); w.u8(0);
    } else {
      w.i32(symNumber(s.code)); w.u8(otp); w.u8(0); w.i16(ang(angle)); w.i32(coords.length); w.i16(nText); w.i16(0);
      w.u32(0); w.i16(0); w.i16(0); w.zeros(16);
    }
    for (const c of coords) { w.i32(c.x); w.i32(c.y); }
    if (text != null) for (let i = 0; i < nText * 4; i++) w.u16(i < text.length ? text.charCodeAt(i) : 0);
    const used = colorsUsed(s);
    block.push({ box: box || boxOf(o.kind === "text" ? coords.slice(1) : coords, extra), pos, len: (v >= 12 ? 56 : 40) + 8 * (coords.length + nText),
      sym: symNumber(s.code), otp, color: used.length === 1 ? used[0] : -1 });
    if (block.length === 256) flushIndex();
  }
  flushIndex();

  // ---- parameter strings (OcadExport.WriteStringParameters) ----
  const params = [];
  for (const c of model.colors.slice().reverse()) {
    params.push([9, `${c.name}\tn${c.id}\tc${num(c.cmyk[0] * 100)}\tm${num(c.cmyk[1] * 100)}\ty${num(c.cmyk[2] * 100)}\tk${num(c.cmyk[3] * 100)}\to${c.overprint ? 1 : 0}`]);
  }
  const rw = model.realWorld || {};
  let scale = `\tm${num(model.scale)}\tg${num(rw.paperGrid || 10)}\tr${rw.on ? 1 : 0}\tx${num(rw.x || 0)}\ty${num(rw.y || 0)}\ta${num(rw.angle || 0)}\td${num(rw.grid || 100)}`;
  if (v >= 10) scale += "\tb0\tc0";
  if (rw.zone) scale += `\ti${rw.zone}`;
  params.push([1039, scale]);
  const pa = model.printArea;
  params.push([1026, `\ta${num(model.printScale || model.scale)}` + (pa ? `\tr1\tL${num(pa[0])}\tB${num(pa[1])}\tR${num(pa[2])}\tT${num(pa[3])}` : "\tr0")]);
  params.push([1030, "\td0\tl0" + (v >= 11 ? "\tp1" : "")]);
  for (const line of String(model.notes || "").split(/\r?\n/).filter(Boolean)) params.push([11, line]);
  for (const t of model.templates || []) params.push([8, `${t.file}\tr1\ts1\tx${num(t.x)}\ty${num(t.y)}\ta${num(t.angle || 0)}\tu${num(t.mmPerPx || 0)}\tv${num(t.mmPerPxY ?? t.mmPerPx ?? 0)}`]);
  // images of the layout layer (OCAD 11 and later), the file kept in the parameter (« F »: base 64), as OCAD itself does
  if (v >= 11) for (const im of model.layoutImages || []) params.push([27, `${im.file}\tr1\ts1\tx${num(im.x)}\ty${num(im.y)}\tu${num(im.u)}\tv${num(im.v)}\tF${base64(im.data)}`]);
  let firstStBlk = 0; prevBlk = 0;
  const table = [];
  for (let i = 0; i < params.length; i++) {
    const [type, s] = params[i], bytes = cp1252(s), len = (bytes.length + 2) & ~1;
    table.push({ pos: w.pos, len, type });
    w.bytes(bytes); w.zeros(len - bytes.length);
    if (table.length === 256 || i === params.length - 1) {
      const at = w.pos;
      if (!prevBlk) firstStBlk = at; else { w.seek(prevBlk); w.i32(at); w.seek(at); }
      w.i32(0);
      for (let k = 0; k < 256; k++) { const e = table[k]; w.i32(e?.pos || 0); w.i32(e?.len || 0); w.i32(e?.type || 0); w.i32(0); }
      prevBlk = at; table.length = 0;
    }
  }

  // ---- the file header, now that the blocks are placed ----
  w.seek(0);
  w.i16(3245); w.i16(0); w.i16(v); w.i16(v === 11 ? 770 : v === 12 ? 256 : 0);
  w.i32(firstSymBlk); w.i32(firstIdxBlk); w.i32(0); w.i32(0); w.i32(0); w.i32(0); w.i32(firstStBlk);
  w.i32(0); w.i32(0); w.i32(0);
  if (v >= 12) { w.i32(0); w.i32(0); w.i32(0); }
  return w.result();
}

/** The common head of a symbol (OcadSymbol.Write, version 9 and later); the size is set once the symbol is written. */
function symbolHead(w, v, s, otp, extent, colors, start, flags = 0) {
  w.i32(0); w.i32(symNumber(s.code)); w.u8(otp); w.u8(flags); w.u8(0); w.u8(0);
  w.u8(0); w.u8(0); w.u8(0); w.u8(0); w.i32(Math.round(extent)); w.i32(start);
  w.i16(0); w.i16(colors.length); for (let i = 0; i < 14; i++) w.i16(i < colors.length ? colors[i] : 0);
  if (v <= 10) w.pstr(s.name, 31); else w.wstr(s.name, 64);
  w.zeros(484);                                               // the icon: blank
  if (v >= 11) w.zeros(128);                                  // symbol tree groups
}
function writeSymbol(w, v, s, colors) {
  const start = w.pos;
  if (s.kind === "line") {
    symbolHead(w, v, s, 2, oc(s.width / 2), colors, start);
    w.i16(s.color); w.i16(oc(s.width)); w.u16(lineEnds(s.cap, s.join));
    w.zeros(2 * 10);                                          // DistFromStart … PrimSymDist
    w.u16(0); w.u16(0); w.zeros(2 * 8); w.zeros(2 * 3);         // double line: off
    w.u16(0); w.i16(0);                                       // decrease
    if (v >= 12) { w.u8(1); w.u8(0); } else w.i16(0);
    w.i16(0); w.i16(0); w.i16(0);                             // framing line: none
    w.zeros(2 * 5); w.u8(0); w.u8(0);                         // no glyphs
  } else if (s.kind === "point") {
    // OcadExport.WritePointSymDef: the glyph's parts as symbol elements; flag 1 = the symbol turns with its object
    symbolHead(w, v, s, 1, oc(glyphRadius(s)), colors, start, s.rotatable ? 1 : 0);
    const elts = s.parts.map((q) => {
      if (q.type === "circle") return { type: 3, flags: 0, color: q.color, width: oc(q.width), diam: oc(2 * q.r), coords: [{ x: oc(q.x) << 8, y: oc(q.y) << 8 }] };
      if (q.type === "dot") return { type: 4, flags: 0, color: q.color, width: 0, diam: oc(q.d), coords: [{ x: oc(q.x) << 8, y: oc(q.y) << 8 }] };
      if (q.type === "line") return { type: 1, flags: lineEnds(q.cap, q.join), color: q.color, width: oc(q.width), diam: 0, coords: coordsOf([q.path], false) };
      return { type: 2, flags: 0, color: q.color, width: 0, diam: 0, coords: coordsOf(q.paths, true) };
    }).filter((e) => e.coords.length);
    w.i16(elts.reduce((n, e) => n + 2 + e.coords.length, 0)); w.i16(0);
    for (const e of elts) {
      w.i16(e.type); w.u16(e.flags); w.i16(e.color); w.i16(e.width); w.i16(e.diam); w.i16(e.coords.length); w.i16(0); w.i16(0);
      for (const c of e.coords) { w.i32(c.x); w.i32(c.y); }
    }
  } else if (s.kind === "area") {
    symbolHead(w, v, s, 3, 0, colors, start);
    const h = s.hatch;
    w.i32(0);                                                 // border symbol
    w.i16(s.fill ?? 0); w.i16(h ? (h.angles.length > 1 ? 2 : 1) : 0); w.i16(h ? h.color : 0); w.i16(h ? oc(h.width) : 0); w.i16(h ? oc(h.spacing) : 0);
    w.i16(h ? ang(h.angles[0]) : 0); w.i16(h && h.angles.length > 1 ? ang(h.angles[1]) : 0);
    w.u8(s.fill != null ? 1 : 0); w.u8(0);
    if (v <= 11) w.i16(0); else { w.u8(0); w.u8(0); }
    w.i16(0); w.i16(0); w.i16(0);                             // structure: none
    if (v >= 12) { w.u8(0); w.u8(0); w.i16(0); }
    w.i16(0); w.i16(0);
  } else {
    symbolHead(w, v, s, 4, 0, colors, start);
    const f = s.font;
    w.pstr(f.name, 31); w.i16(s.color); w.i16(Math.round((f.size / 25.4) * 72 * 10)); w.i16(f.bold ? 700 : 400); w.u8(f.italic ? 1 : 0); w.u8(0);
    w.i16(0); w.i16(100); w.i16(alignment(s.align)); w.i16(Math.round((f.lineSpacing || 1.15) * 100)); w.i16(0); w.i16(0); w.i16(0);
    w.i16(0); w.zeros(32 * 4);                                // tabs
    w.u16(0); w.i16(0); w.i16(0); w.i16(0); w.i16(0);         // line below: off
    const fr = s.frame;
    w.u8(fr ? 2 : 0); w.u8(fr ? 1 : 0);                       // framing by a line, rounded
    if (v >= 10) { w.u8(0); w.i32(0); w.pstr("", 18); w.zeros(8); }
    else { w.pstr("", 23); w.zeros(8); }
    w.i16(fr ? fr.color : 0); w.i16(fr ? oc(fr.width) : 0); w.i16(400); w.u16(0); w.i16(0); w.i16(0);
  }
  const end = w.pos;
  w.seek(start); w.i32(end - start); w.seek(end);
}
/** How far a point symbol reaches from its point (mm). */
export function glyphRadius(s) {
  let r = 0;
  const far = (cmds, w) => { for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) r = Math.max(r, Math.hypot(c[i], c[i + 1]) + w / 2); };
  for (const q of s.parts || []) {
    if (q.type === "circle") r = Math.max(r, Math.hypot(q.x, q.y) + q.r + q.width / 2);
    else if (q.type === "dot") r = Math.max(r, Math.hypot(q.x, q.y) + q.d / 2);
    else if (q.type === "line") far(q.path, q.width);
    else for (const pth of q.paths) far(pth, 0);
  }
  return r;
}
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/**
 * An unformatted text's five coordinates (OcadExport.GetAnyTextObjectCoords): the anchor on the baseline (left, centre or right
 * of the text by its alignment), then the corners of its box from the descent to the ascent.
 */
function textCoords(o, s) {
  const f = s.font, a = ((o.angle || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const W = o.width || 0, asc = f.ascent ?? f.size * 0.9, desc = f.descent ?? f.size * 0.21;
  const x0 = s.align === "center" ? -W / 2 : s.align === "right" ? -W : 0;
  const pt = (dx, dy) => ({ x: oc(o.x + dx * ca - dy * sa) << 8, y: oc(o.y + dx * sa + dy * ca) << 8 });
  return [pt(0, 0), pt(x0, -desc), pt(x0 + W, -desc), pt(x0 + W, asc), pt(x0, asc)];
}

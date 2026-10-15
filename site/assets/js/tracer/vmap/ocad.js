// OCAD map files (versions 6 to 12 and 2018) read into a vector map (map.js): a port of Purple Pen's OcadFileFormat and
// OcadImport (BSD licence, Copyright (c) 2006-2008 Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt). The file's
// colours, symbols (point, line, area, text, line text, rectangle) and objects are read as OCAD stores them; background
// templates (separate image files the map refers to) are not drawn, nor layout bitmaps kept outside the file.

import { VMap, VColor, PointSymbol, LineSymbol, AreaSymbol, TextSymbol, LineTextSymbol, RectSymbol, GraphicsLine, GraphicsArea, LayerLine, LayerArea, LayerBitmap } from "./map.js";
import { Glyph, PointSymDef, LineSymDef, AreaSymDef, TextSymDef, RectangleSymDef, GraphicsSymDef, ImageSymDef, SPACING, LOC, ROTATE, FILL, HALIGN, VALIGN, faceMetrics } from "./symdefs.js";
import { SymPath, PathWithHoles, K, FLAG_LEFT, FLAG_RIGHT, FLAG_MAIN } from "./sympath.js";

export const isOcad = (u8) => u8.length > 4 && u8[0] === 0xad && u8[1] === 0x0c;

const cp1252 = new TextDecoder("windows-1252");
let utf8 = null;
try { utf8 = new TextDecoder("utf-8", { fatal: true }); } catch (e) { utf8 = null; }
/** 8-bit strings: Windows-1252, as OCAD writes them on Windows; UTF-8 when the bytes are valid UTF-8 with accents. */
function decode8(bytes) {
  if (utf8 && bytes.some((b) => b > 0x7f)) { try { return utf8.decode(bytes); } catch (e) { /* not UTF-8 */ } }
  return cp1252.decode(bytes);
}

class Reader {
  constructor(u8) { this.u = u8; this.v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.pos = 0; }
  get length() { return this.u.length; }
  get remaining() { return this.u.length - this.pos; }
  seek(p) { if (p < 0 || p > this.u.length) throw new Error("ocad: offset"); this.pos = p; }
  u8() { return this.u[this.pos++]; }
  i16() { const r = this.v.getInt16(this.pos, true); this.pos += 2; return r; }
  u16() { const r = this.v.getUint16(this.pos, true); this.pos += 2; return r; }
  i32() { const r = this.v.getInt32(this.pos, true); this.pos += 4; return r; }
  u32() { const r = this.v.getUint32(this.pos, true); this.pos += 4; return r; }
  f64() { const r = this.v.getFloat64(this.pos, true); this.pos += 8; return r; }
  bytes(n) { const r = this.u.subarray(this.pos, this.pos + n); this.pos += n; return r; }
  /** A Delphi short string: a length byte, then n bytes. */
  pstr(n) { const len = this.u8(); const s = decode8(this.u.subarray(this.pos, this.pos + Math.min(n, len))); this.pos += n; return s; }
  /** n UTF-16 characters, up to the first NUL. */
  wstr(n) { let s = "", end = false; for (let i = 0; i < n; i++) { const c = this.u16(); if (!c) end = true; if (!end) s += String.fromCharCode(c); } return s; }
}
const mm = (v) => v / 100;
const deg = (a) => (a % 3600) * 0.1;
const coordX = (c) => mm(c.x >> 8), coordY = (c) => mm(c.y >> 8);

function readCoords(r, n) {
  if (r.remaining < n * 8) throw new Error("ocad: corrupt");
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: r.i32(), y: r.i32() };
  return out;
}
function readElements(r, size) {
  const list = [];
  while (size > 0 && r.remaining >= size) {
    const e = { type: r.i16(), flags: r.u16(), color: r.i16(), lineWidth: r.i16(), diameter: r.i16(), nPoly: r.i16() };
    r.i16(); r.i16();
    e.coords = readCoords(r, e.nPoly);
    size -= 2 + e.nPoly;
    list.push(e);
  }
  if (size !== 0) throw new Error("ocad: corrupt symbol");
  return list;
}

/** Read an OCAD file into a VMap. Returns { map, version }. */
export function readOcad(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isOcad(u8)) throw new Error("Ce n'est pas un fichier OCAD.");
  const r = new Reader(u8), map = new VMap();
  const h = { mark: r.i16(), sectionMark: r.i16(), version: r.i16(), sub: r.i16(), firstSym: r.i32(), firstIdx: r.i32(), setupPos: r.i32(), setupSize: r.i32(),
    infoPos: r.i32(), infoSize: r.i32(), firstStIdx: r.i32() };
  r.i32(); r.i32(); r.i32();
  const version = h.version;
  if (version < 6 || (version > 12 && version !== 2018)) throw new Error(`Fichier OCAD ${version} : seuls OCAD 6 à 12 et 2018 se lisent.`);
  if (version >= 12) { r.i32(); r.i32(); r.i32(); }
  const ids = new Map();                                       // colour number → VColor
  const symdefs = new Map();                                   // symbol id → symdef
  const ctx = { version, map, ids, symdefs, graphics: null, layout: null, layoutBitmaps: [], imageOrder: 0, fonts: null };

  if (version <= 8) {
    // the symbol header (colours) right after the file header, then the setup block
    const nColors = r.i16(); r.bytes(22);
    const infos = [];
    for (let i = 0; i < 256; i++) {
      const c = { num: r.i16(), overprint: r.i16(), cmyk: [r.u8(), r.u8(), r.u8(), r.u8()], name: r.pstr(31) };
      r.bytes(32);
      infos.push(c);
    }
    for (let i = nColors - 1; i >= 0; i--) {
      const c = infos[i];
      ids.set(c.num, map.addColor(new VColor(c.name, c.num, c.cmyk.map((v) => v / 200), c.overprint !== 0)));
    }
    if (h.setupPos > 0 && h.setupPos < r.length) {
      r.seek(h.setupPos);
      const end = h.setupPos + h.setupSize;
      try {
        r.i32(); r.i32();                                   // offset
        const gridDist = r.f64(); r.bytes(8);              // grid distance, work/line/edit mode, active symbol
        map.scale = r.f64();
        const ox = r.f64(), oy = r.f64(), angle = r.f64(), grid = r.f64();
        if (r.pos < end) {
          r.f64();                                          // gps angle
          r.bytes(12 * (8 + 16 + 16)); r.i32(); r.f64(); r.f64();   // gps adjust points, draft scale
          r.i32(); r.i32(); r.pstr(255); r.u16(); r.i16(); r.f64(); r.i32(); r.i32(); r.f64();   // template
          const prLL = { x: r.i32(), y: r.i32() }, prUR = { x: r.i32(), y: r.i32() };
          r.u16(); r.i16(); r.i16(); r.i16();
          map.printScale = r.f64();
          map.printArea = [coordX(prLL), coordY(prLL), coordX(prUR), coordY(prUR)];
          r.i16(); r.i16(); r.u16(); r.u16(); r.u16(); r.u16();
          r.i32(); r.i32(); r.i32(); r.i32(); r.f64();
          r.bytes(9 * 16); r.i32();
          const rwOn = version >= 7 && r.pos + 2 <= end ? r.u16() : 0;
          map.realWorld = { x: ox, y: oy, angle, grid, paperGrid: gridDist, on: rwOn !== 0, zone: 0 };
        } else map.realWorld = { x: ox, y: oy, angle, grid, paperGrid: gridDist, on: false, zone: 0 };
      } catch (e) { /* a short setup block */ }
    }
  }
  if (version >= 8) readParams(r, h.firstStIdx, ctx);
  if (!map.printScale) map.printScale = map.scale;

  // the symbols: area and text after the others (they refer to line and point symbols)
  const syms = [];
  for (let next = h.firstSym, guard = 0; next && guard < 10000; guard++) {
    if (next <= 0 || next >= r.length) break;
    r.seek(next);
    next = r.i32();
    const pos = [];
    for (let i = 0; i < 256; i++) { const p = r.i32(); if (p) pos.push(p); }
    for (const p of pos) {
      if (p <= 0 || p > r.length) continue;
      r.seek(p);
      try { const s = readSymbol(r, version); if (s) syms.push(s); } catch (e) { map.notes.push(`Symbole illisible (${e.message})`); }
    }
  }
  for (const s of syms) if (s.otp !== 3 && s.otp !== 4) createSymdef(s, ctx);
  for (const s of syms) if (s.otp === 3 || s.otp === 4) createSymdef(s, ctx);

  // the objects
  for (let next = h.firstIdx, guard = 0, objIndex = 1; next > 0 && next < r.length && guard < 100000; guard++) {
    r.seek(next);
    next = r.i32();
    const idx = [];
    for (let i = 0; i < 256; i++, objIndex++) {
      const e = { objIndex, ll: { x: r.i32(), y: r.i32() }, ur: { x: r.i32(), y: r.i32() } };
      if (version <= 8) { e.pos = r.i32(); e.len = r.i16(); e.sym = r.i16(); e.status = 1; }
      else {
        e.pos = r.i32(); e.len = r.i32(); e.sym = r.i32(); e.objType = r.u8(); r.u8(); e.status = r.u8(); r.u8(); r.i16();
        r.i16(); r.i16();
        e.layoutFont = r.u8(); r.u8();
      }
      if (e.sym !== 0) idx.push(e);
    }
    for (const e of idx) {
      if ((version > 8 && e.status !== 1) || e.pos <= 0 || e.pos > r.length) continue;
      r.seek(e.pos);
      try { createObject(e, readObject(r, version), ctx); } catch (err) { /* a damaged object is skipped */ }
    }
  }
  // layout bitmaps (OCAD 11+: embedded in the parameter strings)
  for (const b of ctx.layoutBitmaps) {
    if (!b.data) continue;
    const def = layoutDef(ctx, "layout");
    // the image's size is known once decoded: kept as a box of its pixels at u × v mm
    const bm = new LayerBitmap(def, b.x, b.y, 0, 0, b.data, b.type, b.visible, b.order);
    if (typeof createImageBitmap === "function") createImageBitmap(new Blob([b.data], { type: b.type })).then((im) => {
      bm.w = im.width * b.u; bm.h = im.height * b.v; bm.bbox = [b.x, b.y - bm.h, b.x + bm.w, b.y]; bm.image = im;
    }).catch(() => {});
    map.add(bm);
  }
  return { map, version };
}

// ---- string parameters (OCAD 8+: colours, scale, georeferencing, view, layout) ---------------------------------------------
function parseParam(s, type) {
  if (type === 11) return { first: s.replace(/\0[\s\S]*$/, ""), codes: {} };
  s = s.replace(/\0[\s\S]*$/, "");
  const parts = s.split("\t"), codes = {};
  for (let i = 1; i < parts.length; i++) if (parts[i].length) { const c = parts[i][0]; if (!(c in codes)) codes[c] = parts[i].slice(1); }
  return { first: parts[0], codes };
}
const pnum = (p, c, d) => { const v = p?.codes?.[c]; if (v == null) return d; const f = parseFloat(v); return Number.isFinite(f) ? f : d; };
const pint = (p, c, d) => { const v = p?.codes?.[c]; if (v == null) return d; const f = parseInt(v, 10); return Number.isFinite(f) ? f : d; };
function readParams(r, first, ctx) {
  const { map, version } = ctx;
  if (!first) return;
  const list = [];
  for (let next = first, guard = 0; next && guard < 10000; guard++) {
    if (next <= 0 || next >= r.length) break;
    r.seek(next);
    next = r.i32();
    for (let i = 0; i < 256; i++) {
      const pos = r.i32(), len = r.i32(), type = r.i32(), objIndex = r.i32();
      if (type > 0) list.push({ pos, len, type, objIndex });
    }
  }
  const single = new Map(), multi = new Map();
  for (const e of list) {
    if (e.pos <= 0 || e.pos + e.len > r.length) continue;
    const p = parseParam(decode8(r.u.subarray(e.pos, e.pos + e.len)), e.type);
    p.objIndex = e.objIndex;
    if (e.type >= 1024) single.set(e.type, p);
    else { if (!multi.has(e.type)) multi.set(e.type, []); multi.get(e.type).push(p); }
  }
  if (version >= 9) {
    const sc = single.get(1039);
    if (sc) {
      map.scale = pnum(sc, "m", 10000);
      map.realWorld = { x: pnum(sc, "x", 0), y: pnum(sc, "y", 0), angle: pnum(sc, "a", 0), grid: pnum(sc, "d", 0), paperGrid: pnum(sc, "g", 0), on: pint(sc, "r", 0) !== 0, zone: pint(sc, "i", 0) };
    }
    const pr = single.get(1026);
    if (pr) {
      map.printScale = pnum(pr, "a", map.scale);
      map.printArea = [pnum(pr, "L", 0), pnum(pr, "T", 0), pnum(pr, "R", 0), pnum(pr, "B", 0)].map((v, i) => v);
      const [l, t, rr, b] = [pnum(pr, "L", 0), pnum(pr, "B", 0), pnum(pr, "R", 0), pnum(pr, "T", 0)];
      map.printArea = [Math.min(l, rr), Math.min(t, b), Math.max(l, rr), Math.max(t, b)];
    }
    const colors = multi.get(9) || [];
    for (let i = colors.length - 1; i >= 0; i--) {
      const p = colors[i], num = pint(p, "n", 0);
      ctx.ids.set(num, map.addColor(new VColor(p.first, num, ["c", "m", "y", "k"].map((k) => pnum(p, k, 0) / 100), pint(p, "o", 0) !== 0)));
    }
    const view = single.get(1030);
    if (view) {
      map.hideLayout = pint(view, "l", 0) !== 0;
      if (version >= 11) map.useEuclid = pint(view, "p", 0) === 0;
    }
  }
  if (version >= 11) {
    const lo = multi.get(27) || [];
    ctx.layout = new Map();
    let order = 0;
    for (const p of lo) {
      order -= 1;
      const vis = pint(p, "s", 1) !== 0, idx = pint(p, "n", p.objIndex), bitmap = pint(p, "r", 0) !== 0;
      if (bitmap) {
        let data = null, type = "image/png";
        const b64 = p.codes.F;
        if (b64) { try { data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); if (data[0] === 0xff) type = "image/jpeg"; else if (data[0] === 0x42) type = "image/bmp"; else if (data[0] === 0x47) type = "image/gif"; } catch (e) { data = null; } }
        ctx.layoutBitmaps.push({ x: Math.round(pnum(p, "x", 0) * 100) / 100, y: Math.round(pnum(p, "y", 0) * 100) / 100, u: pnum(p, "u", 0.1), v: pnum(p, "v", 0.1), data, type, visible: vis, order });
      } else ctx.layout.set(idx, { visible: vis, order });
    }
    if (version === 11) ctx.fonts = (multi.get(28) || []).map((p) => ({ name: p.first, size: pnum(p, "s", 10) }));
  }
}

// ---- symbols ---------------------------------------------------------------------------------------------------------------
function readSymbol(r, version) {
  const s = {};
  if (version <= 8) { s.size = r.i16(); s.sym = r.i16(); s.otp = r.i16(); s.symTp = r.u8(); }
  else { s.size = r.i32(); s.sym = r.i32(); s.otp = r.u8(); s.symTp = 0; }
  s.flags = r.u8();
  if (version <= 8) s.extent = r.i16();
  s.selected = r.u8(); s.status = r.u8();
  if (version <= 8) { r.i16(); r.i16(); }
  else { r.u8(); r.u8(); r.u8(); r.u8(); s.extent = r.i32(); }
  r.i32();                                                       // file position
  if (version <= 8) r.bytes(32);
  else { r.i16(); const n = r.i16(); r.bytes(28); s.nColors = n; }
  s.description = version <= 10 ? r.pstr(31) : r.wstr(64);
  r.bytes(version <= 8 ? 264 : 484);
  if (version >= 11) r.bytes(128);
  if (s.otp === 1) { s.dataSize = r.i16(); r.i16(); s.elts = readElements(r, s.dataSize); }
  else if ((s.otp === 2 && s.symTp === 0)) readLineExtra(r, s, version);
  else if ((s.otp === 2 && s.symTp === 1) || s.otp === 6) readLineTextExtra(r, s);
  else if (s.otp === 3) readAreaExtra(r, s, version);
  else if (s.otp === 4) readTextExtra(r, s, version);
  else if (s.otp === 5 || s.otp === 7) readRectExtra(r, s);
  else return null;
  return s;
}
function readLineExtra(r, s, version) {
  Object.assign(s, { lineColor: r.i16(), lineWidth: r.i16(), lineEnds: r.u16(), distFromStart: r.i16(), distToEnd: r.i16(), mainLength: r.i16(), endLength: r.i16(),
    mainGap: r.i16(), secGap: r.i16(), endGap: r.i16(), minSym: r.i16(), nPrimSym: r.i16(), primSymDist: r.i16(), dblMode: r.u16(), dblFlags: r.u16(),
    dblFillColor: r.i16(), dblLeftColor: r.i16(), dblRightColor: r.i16(), dblWidth: r.i16(), dblLeftWidth: r.i16(), dblRightWidth: r.i16(), dblLength: r.i16(), dblGap: r.i16() });
  r.i16(); r.i16(); r.i16();
  s.decMode = r.u16(); s.decLast = r.i16();
  if (version >= 12) { s.decSymbolDistance = r.u8() !== 0; s.decSymbolWidth = r.u8() !== 0; }
  else { r.i16(); s.decSymbolDistance = true; s.decSymbolWidth = false; }
  Object.assign(s, { frColor: r.i16(), frWidth: r.i16(), frStyle: r.i16(), primDSize: r.i16(), secDSize: r.i16(), cornerDSize: r.i16(), startDSize: r.i16(), endDSize: r.i16(), useSymbolFlags: r.u8() });
  r.u8();
  s.prim = readElements(r, s.primDSize); s.sec = readElements(r, s.secDSize); s.corner = readElements(r, s.cornerDSize);
  s.start = readElements(r, s.startDSize); s.end = readElements(r, s.endDSize);
}
function readLineTextExtra(r, s) {
  Object.assign(s, { fontName: r.pstr(31), fontColor: r.i16(), fontSize: r.i16(), weight: r.i16(), italic: r.u8() !== 0 });
  r.u8();
  Object.assign(s, { charSpace: r.i16(), wordSpace: r.i16(), alignment: r.i16(), frMode: r.u8(), frFlags: r.u8(), frName: r.pstr(31), frColor: r.i16(), frSize: r.i16(), frWeight: r.i16(), frItalic: r.u16() !== 0, frOfX: r.i16(), frOfY: r.i16() });
  s.frWidth = 0; s.frLeft = s.frTop = s.frRight = s.frBottom = 0;
}
function readAreaExtra(r, s, version) {
  if (version <= 8) { s.areaFlags = r.u16(); s.fillOn = r.u16() !== 0; } else s.borderSym = r.i32();
  Object.assign(s, { fillColor: r.i16(), hatchMode: r.i16(), hatchColor: r.i16(), hatchLineWidth: r.i16(), hatchDist: r.i16(), hatchAngle1: r.i16(), hatchAngle2: r.i16() });
  if (version <= 8) r.i16(); else { s.fillOn = r.u8() !== 0; s.borderOn = r.u8() !== 0; }
  if (version <= 11) s.structMode = r.i16() & 0xff; else { s.structMode = r.u8(); s.structDraw = r.u8(); }
  s.structWidth = r.i16(); s.structHeight = r.i16(); s.structAngle = r.i16();
  if (version >= 12) { s.irrX = r.u8(); s.irrY = r.u8(); s.irrMin = r.i16(); }
  r.i16();
  s.dataSize = r.i16();
  s.elts = readElements(r, s.dataSize);
}
function readTextExtra(r, s, version) {
  Object.assign(s, { fontName: r.pstr(31), fontColor: r.i16(), fontSize: r.i16(), weight: r.i16(), italic: r.u8() !== 0 });
  r.u8();
  Object.assign(s, { charSpace: r.i16(), wordSpace: r.i16(), alignment: r.i16(), lineSpace: r.i16(), paraSpace: r.i16(), indentFirst: r.i16(), indentOther: r.i16() });
  s.nTabs = r.i16(); s.tabs = []; for (let i = 0; i < 32; i++) s.tabs.push(r.i32());
  s.lbOn = r.u16() !== 0; s.lbColor = r.i16(); s.lbWidth = r.i16(); s.lbDist = r.i16(); r.i16();
  s.frLeft = s.frTop = s.frRight = s.frBottom = 0; s.pointSymOn = false;
  if (version <= 8) {
    Object.assign(s, { frMode: r.u8(), frFlags: r.u8(), frName: r.pstr(31), frColor: r.i16(), frSize: r.i16(), frWeight: r.i16(), frItalic: r.u16() !== 0, frOfX: r.i16(), frOfY: r.i16() });
  } else if (version <= 9) {
    s.frMode = r.u8(); s.frFlags = r.u8(); r.pstr(23);
    Object.assign(s, { frLeft: r.i16(), frBottom: r.i16(), frRight: r.i16(), frTop: r.i16(), frColor: r.i16(), frSize: r.i16(), frWeight: r.i16(), frItalic: r.u16() !== 0, frOfX: r.i16(), frOfY: r.i16() });
  } else {
    s.frMode = r.u8(); s.frFlags = r.u8(); s.pointSymOn = r.u8() !== 0; s.pointSym = r.i32(); r.pstr(18);
    Object.assign(s, { frLeft: r.i16(), frBottom: r.i16(), frRight: r.i16(), frTop: r.i16(), frColor: r.i16(), frSize: r.i16(), frWeight: r.i16(), frItalic: r.u16() !== 0, frOfX: r.i16(), frOfY: r.i16() });
  }
  s.frWidth = 0;
}
function readRectExtra(r, s) {
  Object.assign(s, { lineColor: r.i16(), lineWidth: r.i16(), radius: r.i16(), gridFlags: r.u16(), cellWidth: r.i16(), cellHeight: r.i16() });
  r.i16(); r.i16();
  s.unnumCells = r.i16(); s.unnumText = r.pstr(3); r.i16(); r.pstr(31); r.i16();
  s.fontSize = r.i16(); r.i16(); r.u16(); r.i16(); r.i16();
}

const symId = (n, version) => (version >= 9 ? `${Math.floor(n / 1000)}.${n % 1000}` : `${Math.floor(n / 10)}.${n % 10}`);
const color = (ctx, id) => ctx.ids.get(id) || null;
const joinOf = (e) => ((e & 1) === 1 ? "round" : (e & 4) === 4 ? "miter" : "bevel");
const capOf = (e) => ((e & 1) === 1 ? "round" : "butt");

function createSymdef(s, ctx) {
  const id = symId(s.sym, ctx.version), name = s.description;
  let d = null;
  try {
    if (s.otp === 1) d = new PointSymDef(name, id, glyphOf(s.elts, ctx), (s.flags & 1) !== 0);
    else if (s.otp === 2 && s.symTp === 0) d = lineSymdef(name, id, s, ctx);
    else if (s.otp === 2 || s.otp === 6) d = lineTextSymdef(name, id, s, ctx);
    else if (s.otp === 3) d = areaSymdef(name, id, s, ctx);
    else if (s.otp === 4) d = textSymdef(name, id, s, ctx);
    else if (s.otp === 5 || s.otp === 7) d = rectSymdef(name, id, s, ctx);
  } catch (e) { ctx.map.notes.push(`Symbole ${id} : ${e.message}`); }
  if (!d) return;
  if ((s.status & 2) !== 0) d.visible = false;
  ctx.map.addSymdef(d);
  ctx.symdefs.set(id, d);
}
function glyphOf(elts, ctx) {
  const g = new Glyph();
  for (const e of elts || []) {
    const c = color(ctx, e.color);
    if (!c) continue;
    if (e.type === 1) { const p = linePath(e.coords); if (p) g.addLine(c, p, mm(e.lineWidth), joinOf(e.flags), capOf(e.flags)); }
    else if (e.type === 2) { const a = areaPath(e.coords); if (a) g.addArea(c, a); }
    else if (e.type === 3) {
      const w = mm(e.lineWidth);
      let d = mm(e.diameter);
      if (ctx.version >= 9 && d > w) d += w;                    // OCAD 9+: the diameter is to the middle of the line
      g.addCircle(c, coordX(e.coords[0]), coordY(e.coords[0]), w, d);
    } else if (e.type === 4) g.addDot(c, coordX(e.coords[0]), coordY(e.coords[0]), mm(e.diameter));
  }
  return g.done();
}
function lineSymdef(name, id, s, ctx) {
  const width = mm(s.lineWidth);
  const d = new LineSymDef(name, id, width > 0 ? color(ctx, s.lineColor) : null, width, joinOf(s.lineEnds), capOf(s.lineEnds));
  if (s.distFromStart || s.distToEnd) d.shorten = { start: mm(s.distFromStart), end: mm(s.distToEnd), pointy: (s.lineEnds & 2) !== 0 };
  if (s.frWidth > 0) d.second = { color: color(ctx, s.frColor), width: mm(s.frWidth), join: joinOf(s.frStyle), cap: capOf(s.frStyle) };
  if (s.dblMode > 0) {
    const dl = { fill: (s.dblFlags & 1) !== 0 ? color(ctx, s.dblFillColor) : null, left: color(ctx, s.dblLeftColor), right: color(ctx, s.dblRightColor),
      thick: mm(s.dblWidth), leftWidth: mm(s.dblLeftWidth), rightWidth: mm(s.dblRightWidth), fillDashed: false, leftDashed: false, rightDashed: false, dashes: null };
    if (s.dblMode > 1) {
      if (s.dblMode === 2) dl.leftDashed = true;
      else if (s.dblMode === 3) dl.leftDashed = dl.rightDashed = true;
      else dl.fillDashed = dl.leftDashed = dl.rightDashed = true;
      const L = mm(s.dblLength);
      dl.dashes = { dash: L, first: L, last: L, gap: mm(s.dblGap), minGaps: 1, secEnd: 0, secEndLen: 0, secMid: 0, secMidLen: 0, halfClosed: false, spacing: SPACING.OCAD };
    }
    d.double = dl;
  }
  if (s.mainGap > 0 || s.secGap > 0) {
    const di = { spacing: SPACING.OCAD, dash: mm(s.mainLength), first: mm(s.endLength), last: mm(s.endLength), gap: mm(s.mainGap), minGaps: s.minSym + 1 };
    if (s.secGap > 0) { di.secMid = 1; di.secMidLen = mm(s.secGap); }
    if (s.endGap > 0) { di.secEnd = 1; di.secEndLen = mm(s.endGap); }
    d.setDashes(di);
  }
  let prim = s.prim?.length > 0, sec = s.sec?.length > 0, corner = s.corner?.length > 0, start = s.start?.length > 0, end = s.end?.length > 0;
  if (ctx.version >= 11) {
    if (!(s.useSymbolFlags & 8)) sec = false;
    if (!(s.useSymbolFlags & 4)) corner = false;
    if (!(s.useSymbolFlags & 2)) start = false;
    if (!(s.useSymbolFlags & 1)) end = false;
  }
  const glyphs = [];
  const spaced = () => ({ distance: mm(s.mainLength + s.mainGap), first: mm(s.endLength) + mm(s.mainGap) / 2, last: mm(s.endLength) + mm(s.mainGap) / 2, minimum: Math.max(1, s.minSym + 1) });
  if (prim) {
    const gi = { spacingMethod: SPACING.OCAD, glyph: glyphOf(s.prim, ctx), number: s.nPrimSym, spacing: mm(s.primSymDist) };
    if (s.decMode > 0) {
      Object.assign(gi, { loc: LOC.SpacedDecrease, ...spaced(), decreaseLimit: s.decLast / 100, decreaseBoth: s.decMode === 2 });
      if (s.decMode === 3 || !s.decSymbolDistance || s.decSymbolWidth) ctx.map.notes.push(`Ligne ${id} : une décroissance d'OCAD 12 dessinée comme OCAD 11`);
    } else if ((width > 0 && s.mainGap > 0) || s.secGap > 0) Object.assign(gi, { loc: LOC.GapCenters, minimum: 1 });
    else Object.assign(gi, { loc: LOC.Spaced, ...spaced() });
    glyphs.push(gi);
  }
  if (sec) glyphs.push({ spacingMethod: SPACING.OCAD, glyph: glyphOf(s.sec, ctx), number: 1, loc: LOC.SpacedOffset, offset: mm(s.mainLength) / 2, ...spaced() });
  if (corner) glyphs.push({ glyph: glyphOf(s.corner, ctx), number: 1, loc: LOC.Corners });
  if (start) glyphs.push({ spacingMethod: SPACING.OCAD, glyph: glyphOf(s.start, ctx), number: 1, loc: LOC.Start });
  if (end) glyphs.push({ spacingMethod: SPACING.OCAD, glyph: glyphOf(s.end, ctx), number: 1, loc: LOC.End });
  if (glyphs.length) d.glyphs = glyphs.map((g) => ({ distance: 0, first: 0, last: 0, minimum: 0, spacing: 0, offset: 0, decreaseLimit: 1, decreaseBoth: false, number: 1, ...g }));
  return d;
}
function rectSymdef(name, id, s, ctx) {
  const ts = ctx.version >= 10 && s.fontSize > 0 ? (s.fontSize / 10 / 72) * 25.4 : (15 / 72) * 25.4;
  return new RectangleSymDef(name, id, color(ctx, s.lineColor), mm(s.lineWidth), mm(s.radius), s.gridFlags, mm(s.cellWidth), mm(s.cellHeight), ts, s.unnumCells, s.unnumText);
}
function areaSymdef(name, id, s, ctx) {
  let border = null;
  if (s.borderOn) { const b = ctx.symdefs.get(symId(s.borderSym, ctx.version)); if (b instanceof LineSymDef) border = b; }
  const d = new AreaSymDef(name, id, s.fillOn ? color(ctx, s.fillColor) : null, border);
  if (s.hatchMode > 0) {
    const hc = color(ctx, s.hatchColor);
    if (hc) {
      const h = { color: hc, width: mm(s.hatchLineWidth), spacing: mm(ctx.version <= 8 ? s.hatchLineWidth + s.hatchDist : s.hatchDist), angle: deg(s.hatchAngle1), offset: 0, rotate: (s.flags & 1) !== 0 ? ROTATE.Always : ROTATE.ManualOnly };
      d.hatches.push(h);
      if (s.hatchMode === 2) d.hatches.push({ ...h, angle: deg(s.hatchAngle2) });
    }
  }
  if (s.structMode > 0 && s.structWidth > 0 && s.structHeight > 0) {
    const p = { offsetRows: s.structMode === 2, width: mm(s.structWidth), height: mm(s.structHeight), angle: deg(s.structAngle), glyph: glyphOf(s.elts, ctx),
      offsetX: 0, offsetY: 0, rotate: (s.flags & 1) !== 0 ? ROTATE.Always : ROTATE.ManualOnly, fillMode: FILL.Clip, irregular: false, varX: 0, varY: 0, minDist: 0 };
    if (ctx.version >= 12) {
      p.fillMode = s.structDraw || 0;
      p.irregular = s.irrX > 0 && s.irrY > 0; p.varX = s.irrX / 100; p.varY = s.irrY / 100; p.minDist = mm(s.irrMin);
    }
    d.patterns.push(p);
  }
  return d;
}
function alignment(a, version) {
  let h = HALIGN.Left, v = VALIGN.Baseline;
  switch (a) {
    case 0: h = HALIGN.Left; break; case 1: h = HALIGN.Center; break; case 2: h = HALIGN.Right; break; case 3: h = HALIGN.Justified; break;
    case 4: if (version > 9) { h = HALIGN.Left; v = VALIGN.Midpoint; } break;
    case 5: if (version > 9) { h = HALIGN.Center; v = VALIGN.Midpoint; } break;
    case 6: if (version > 9) { h = HALIGN.Right; v = VALIGN.Midpoint; } break;
    case 8: if (version > 9) { h = HALIGN.Left; v = VALIGN.TopAscent; } break;
    case 9: if (version > 9) { h = HALIGN.Center; v = VALIGN.TopAscent; } break;
    case 10: if (version > 9) { h = HALIGN.Right; v = VALIGN.TopAscent; } break;
  }
  return [h, v];
}
function framing(d, s, ctx) {
  const v = ctx.version, c = color(ctx, s.frColor);
  if (!c) return;
  if (s.frMode === 2 && v >= 7) d.framing = { style: "line", color: c, width: mm(v === 7 ? s.frWidth : s.frSize), lineStyle: s.frFlags === 1 ? "rounded" : s.frFlags === 2 ? "beveled" : "mitered" };
  else if (s.frMode === 1 && (v >= 9 || v <= 7)) d.framing = { style: "shadow", color: c, dx: mm(s.frOfX), dy: mm(s.frOfY) };
  else if (s.frMode === 3 && v >= 9) d.framing = { style: "rect", color: c, left: mm(s.frLeft), right: mm(s.frRight), top: mm(s.frTop), bottom: mm(s.frBottom) };
}
const ptToMm = (pt) => (pt / 72) * 25.4;
function textSymdef(name, id, s, ctx) {
  const [h, v] = alignment(s.alignment, ctx.version);
  const size = ptToMm(s.fontSize / 10);
  let para = mm(s.paraSpace);
  if (s.lbOn) para += mm(s.lbDist + s.lbWidth);
  let center = null;
  if (ctx.version >= 10 && s.pointSymOn) { const p = ctx.symdefs.get(symId(s.pointSym, ctx.version)); if (p instanceof PointSymDef) center = p; }
  const d = new TextSymDef(name, id, "normal", center);
  d.setFont({ font: s.fontName, size, bold: s.weight >= 500, italic: s.italic, color: color(ctx, s.fontColor), lineSpacing: (size * s.lineSpace) / 100, paraSpacing: para,
    firstIndent: mm(s.indentFirst), restIndent: mm(s.indentOther), tabs: s.nTabs > 0 ? s.tabs.slice(0, s.nTabs).map(mm) : null, charSpacing: s.charSpace / 100, wordSpacing: s.wordSpace / 100, halign: h, valign: v });
  framing(d, s, ctx);
  if (s.lbOn) d.underline = { on: true, color: color(ctx, s.lbColor), distance: mm(s.lbDist), width: mm(s.lbWidth) };
  return d;
}
function lineTextSymdef(name, id, s, ctx) {
  const [h, v] = alignment(s.alignment, ctx.version);
  const size = ptToMm(s.fontSize / 10);
  const d = new TextSymDef(name, id, "line", null);
  d.setFont({ font: s.fontName, size, bold: s.weight >= 500, italic: s.italic, color: color(ctx, s.fontColor), lineSpacing: size, paraSpacing: 0, charSpacing: s.charSpace / 100, wordSpacing: s.wordSpace / 100, halign: h, valign: v });
  framing(d, s, ctx);
  return d;
}

// ---- objects ----------------------------------------------------------------------------------------------------------------
function readObject(r, version) {
  const o = {};
  if (version <= 8) {
    o.sym = r.i16(); o.otp = r.u8(); o.unicode = r.u8(); o.nItem = r.i16(); o.nText = r.i16(); o.ang = r.i16(); r.i16(); r.i32(); r.pstr(15);
    o.coords = readCoords(r, o.nItem);
  } else if (version <= 11) {
    o.unicode = 1; o.sym = r.i32(); o.otp = r.u8(); r.u8(); o.ang = r.i16(); o.nItem = r.i32(); o.nText = r.i16(); r.i16();
    o.col = r.u32(); o.lineWidth = r.i16(); o.diamFlags = r.i16(); r.bytes(16);
    o.coords = readCoords(r, o.nItem);
  } else {
    o.unicode = 1; o.sym = r.i32(); o.otp = r.u8(); r.u8(); o.ang = r.i16(); o.col = r.u32(); o.lineWidth = r.i16(); o.diamFlags = r.i16();
    r.i32(); r.i32(); r.f64(); r.i32(); r.f64();
    o.nItem = r.i32(); o.nText = r.i16(); o.nObjStr = r.i16(); o.nDbStr = r.i16(); o.objStrType = r.u8(); r.u8();
    o.coords = readCoords(r, o.nItem);
  }
  o.text = readText(r, o.nText, version > 8 || o.unicode !== 0);
  if (version >= 12) o.objStr = readText(r, o.nObjStr, true);
  return o;
}
function readText(r, n, unicode) {
  if (!(n > 0)) return null;
  let s = "";
  if (unicode) { for (let i = 0; i < n * 4; i++) { const c = r.u16(); if (!c) { r.pos += (n * 4 - i - 1) * 2; break; } s += String.fromCharCode(c); } }
  else { const b = r.bytes(n * 8); const z = b.indexOf(0); s = decode8(z >= 0 ? b.subarray(0, z) : b); }
  return s;
}
function layoutDef(ctx, layer) {
  const key = layer === "image" ? "_imageDef" : "_layoutDef";
  if (!ctx[key]) { ctx[key] = new ImageSymDef(layer); ctx.map.addSymdef(ctx[key]); }
  return ctx[key];
}
function compressedCmyk(c) { return [(c & 0xff) / 255, ((c >>> 8) & 0xff) / 255, ((c >>> 16) & 0xff) / 255, ((c >>> 24) & 0xff) / 255]; }
function createObject(e, o, ctx) {
  const { map, version } = ctx;
  if (version >= 9 && o.sym < 0) {
    if (o.sym === -2) {
      if (!ctx.graphics) { ctx.graphics = new GraphicsSymDef(); map.addSymdef(ctx.graphics); }
      if (o.otp === 3) { const a = areaPath(o.coords); if (a) map.add(new GraphicsArea(ctx.graphics, a, color(ctx, o.col))); }
      else if (o.otp === 2) { const p = linePath(o.coords); if (p) map.add(new GraphicsLine(ctx.graphics, p, color(ctx, o.col), mm(o.lineWidth), capOf(o.diamFlags), joinOf(o.diamFlags))); }
    } else if (o.sym === -3 || o.sym === -4) {
      const layer = o.sym === -3 ? "image" : "layout", def = layoutDef(ctx, layer);
      let visible = true, order = ctx.imageOrder++;
      if (layer === "layout") { const info = ctx.layout?.get(e.objIndex); if (info) { visible = info.visible; order = info.order; } else { visible = false; order = -1; } }
      const cmyk = compressedCmyk(o.col);
      if (o.otp === 3) { const a = areaPath(o.coords); if (a) map.add(new LayerArea(def, a, cmyk, visible, order)); }
      else if (o.otp === 2) { const p = linePath(o.coords); if (p) map.add(new LayerLine(def, p, cmyk, mm(o.lineWidth), capOf(o.diamFlags), joinOf(o.diamFlags), visible, order)); }
      else if (o.otp === 4 || o.otp === 5) map.add(layerText(ctx, def, e, o, cmyk, visible, order));
    }
    return;
  }
  const def = ctx.symdefs.get(symId(o.sym, version));
  if (!def) return;
  let sym = null;
  switch (o.otp) {
    case 1: if (def instanceof PointSymDef && o.coords.length) {
      let gaps = null;
      if (o.coords.length > 1) { gaps = []; for (let i = 1; i < o.coords.length; i++) gaps.push(deg(o.coords[i].x), deg(o.coords[i].y)); }
      sym = new PointSymbol(def, coordX(o.coords[0]), coordY(o.coords[0]), deg(o.ang), gaps);
    } break;
    case 2: case 6:
      if (def instanceof LineSymDef && o.otp === 2) { const p = linePath(o.coords); if (p) sym = new LineSymbol(def, p); }
      else if (def instanceof TextSymDef) { const p = linePath(o.coords); if (p) sym = new LineTextSymbol(def, p, o.text || ""); }
      break;
    case 3: if (def instanceof AreaSymDef) { const a = areaPath(o.coords); if (a) sym = new AreaSymbol(def, a, deg(o.ang), 0, 0); } break;
    case 4: if (def instanceof TextSymDef) sym = textSymbol(def, o, false, version); break;
    case 5: case 7:
      if (def instanceof TextSymDef) sym = textSymbol(def, o, true, version);
      else if (def instanceof RectangleSymDef && o.coords.length >= 4) {
        const p = o.coords.slice(0, 4).map((c) => [coordX(c), coordY(c)]);
        const w = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), h = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]);
        if (w || h) sym = new RectSymbol(def, p[0][0], p[0][1], w, h, (Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180) / Math.PI);
      }
      break;
  }
  if (sym) map.add(sym);
}
function textLines(text) {
  const lines = (text || "").split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[0].length === 0) lines.shift();    // OCAD ignores one blank line at the start
  return lines;
}
function textSymbol(def, o, formatted, version) {
  const angle = deg(o.ang);
  let x, y, width, top, left;
  if (formatted && o.coords.length >= 4) {
    x = coordX(o.coords[3]); y = coordY(o.coords[3]);
    width = Math.hypot(coordX(o.coords[2]) - x, coordY(o.coords[2]) - y);
    top = def.ocadTopAdjustment(true, version); left = def.ocadFormattedHorizAdjustment(width);
  } else {
    if (!o.coords.length) return null;
    x = coordX(o.coords[0]); y = coordY(o.coords[0]); width = 0;
    top = def.ocadTopAdjustment(false, version); left = 0;
  }
  const a1 = ((angle + 90) * Math.PI) / 180, a0 = (angle * Math.PI) / 180;
  y += top * Math.sin(a1); x += top * Math.cos(a1);
  y += left * Math.sin(a0); x += left * Math.cos(a0);
  return new TextSymbol(def, textLines(o.text), x, y, angle, width, HALIGN.Default, VALIGN.Default);
}
/** Text of the layout or image layer: its own font and colour. */
function layerText(ctx, def, e, o, cmyk, visible, order) {
  let font = "Arial", sizePt = 27;
  if (ctx.version >= 12 && o.objStr && o.objStrType === 3) { const p = parseParam(o.objStr, 1); font = p.first || font; sizePt = pnum(p, "s", 27); }
  else if (ctx.fonts && e.layoutFont < ctx.fonts.length) { font = ctx.fonts[e.layoutFont].name; sizePt = ctx.fonts[e.layoutFont].size; }
  const col = new VColor("", -1, cmyk);
  const td = new TextSymDef("layout text", "-5", "normal", null);
  td.setFont({ font, size: ptToMm(sizePt), color: col, halign: HALIGN.Left, valign: VALIGN.TopAscent });
  const formatted = o.otp === 5 && o.coords.length >= 4;
  const angle = deg(o.ang), m = faceMetrics(font, ptToMm(sizePt));
  let x, y, width;
  if (formatted) { x = coordX(o.coords[3]); y = coordY(o.coords[3]); width = Math.hypot(coordX(o.coords[2]) - x, coordY(o.coords[2]) - y); }
  else { x = coordX(o.coords[0]); y = coordY(o.coords[0]); width = 0; }
  const top = formatted ? m.em - (m.ascent + m.descent) : m.ascent, a1 = ((angle + 90) * Math.PI) / 180;
  y += top * Math.sin(a1); x += top * Math.cos(a1);
  const sym = new TextSymbol(td, textLines(o.text), x, y, angle, width);
  return { def, visible, order, bbox: sym.bbox, draw: (g) => sym.draw(g, col) };
}

// ---- paths ---------------------------------------------------------------------------------------------------------------------
const isBez = (c) => (c.x & 3) !== 0, isHole = (c) => (c.y & 2) !== 0;
const anyCut = (c) => (c.x & 0xc) !== 0 || (c.y & 4) !== 0;
function kindOf(c) { return isBez(c) ? K.Bezier : (c.y & 1) ? K.Corner : (c.y & 8) ? K.Dash : K.Normal; }
function flagsOf(c) { let b = 0; if (c.x & 4) b |= FLAG_LEFT; if (c.y & 4) b |= FLAG_RIGHT; if (c.x & 8) b |= FLAG_MAIN; return b; }
/** Fix what OCAD files sometimes hold: not exactly two bezier controls in a row, a path starting or ending with one, holes in
 *  a line. Purple Pen's FixOcadCoords. */
function fixCoords(coords, allowHoles) {
  let problem = false, nb = 0, holes = 0, cuts = false;
  if (!coords.length) return { coords, holes, cuts };
  if (isBez(coords[0])) problem = true;
  coords.forEach((c, i) => {
    if (anyCut(c)) cuts = true;
    if (i >= 1 && isHole(c)) { if (isBez(c) || nb !== 0 || !allowHoles) problem = true; else holes++; }
    if (isBez(c)) nb++;
    else { if (nb !== 0 && nb !== 2) problem = true; nb = 0; }
  });
  if (nb !== 0) problem = true;
  if (!problem) return { coords, holes, cuts };
  const list = [];
  let n = 0, atStart = true;
  for (const c0 of coords) {
    const c = { ...c0 };
    if (isHole(c)) { if (n) { list.splice(list.length - n, n); n = 0; } atStart = true; if (!allowHoles) break; }
    if (isBez(c)) { if (!atStart) { n++; list.push(c); } }
    else {
      if (n !== 0 && n !== 2) list.splice(list.length - n, n);
      n = 0;
      if (atStart && list.length) c.y |= 2;
      list.push(c); atStart = false;
    }
  }
  if (n) list.splice(list.length - n, n);
  holes = allowHoles ? list.filter((c, i) => i > 0 && isHole(c)).length : 0;
  return { coords: list, holes, cuts };
}
export function linePath(coords0) {
  const { coords, cuts } = fixCoords(coords0, false);
  if (coords.length < 2) return null;
  const p = [], k = [], ss = cuts ? [] : null;
  coords.forEach((c, i) => { p.push(coordX(c), coordY(c)); k.push(kindOf(c)); if (cuts && i < coords.length - 1) ss.push(flagsOf(c)); });
  return new SymPath(p, k, ss);
}
export function areaPath(coords0) {
  const { coords, cuts } = fixCoords(coords0, true);
  if (coords.length < 2) return null;
  let main = null;
  const holes = [];
  let start = 0, part = -1;
  for (let i = 1; i <= coords.length; i++) {
    if (i < coords.length && !isHole(coords[i])) continue;
    const size = i - start;
    const first = coords[start], last = coords[i - 1];
    const close = size <= 1 || coordX(last) !== coordX(first) || coordY(last) !== coordY(first);
    const p = [], k = [], ss = cuts ? [] : null;
    for (let q = start; q < i; q++) { p.push(coordX(coords[q]), coordY(coords[q])); k.push(kindOf(coords[q])); if (cuts) ss.push(flagsOf(coords[q])); }
    if (close) { p.push(coordX(first), coordY(first)); k.push(kindOf(first)); }
    if (ss) ss.length = k.length - 1;
    const path = k.length >= 2 ? new SymPath(p, k, ss, close) : null;
    if (part === -1) main = path; else if (path) holes.push(path);
    part++;
    start = i;
  }
  return main ? new PathWithHoles(main, holes) : null;
}

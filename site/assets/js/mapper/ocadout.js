// Cartographier's document written as an OCAD file (versions 9, 10, 11, 12 and 2018). The document's symbols, objects and
// parameter strings are OCAD's own records as tracer/vmap/ocad.js reads them (docs/mapper/model.md), so writing them is the
// reader run backwards: every field readSymbol (with readLineExtra, readAreaExtra, readTextExtra, readLineTextExtra,
// readRectExtra) and readObject read is written at the place it was read from, in the target version's layout.
//
// What was not touched keeps every byte (owner, 2026-11-06):
//   - a record with `rawAt` and no `dirty`, written to its source's version, is copied byte for byte from the source (a
//     symbol's own file position, kept in its head, set to where it now lies);
//   - a dirty record with `rawAt`, written to its source's version, is written over a copy of its raw bytes: what the reader
//     skips (a symbol's icon, its tree groups and colour list, OCAD 12's object dates and ids, the database string, reserved
//     fields, the room OCAD left after a record) survives; fields inside variable lists only while the lists keep their shape;
//   - a document whose every record is clean and in the source's order, with nothing else changed, is the source itself;
//   - objects keep their place in the object index (their `e.objIndex`), so that the parameter strings tied to an object by
//     its index (course setting, layout) still point at it; new objects go after the last one. The source's hidden objects
//     (index status 2: readOcad leaves them out) are carried along;
//   - parameter strings are copied, but for the colours (type 9), the scale and georeference (1039) and the print settings
//     (1026) when `doc.dirty` says they changed, or when the document has none: then written again from the document, every
//     code of the original string Ozimut does not manage kept, and a managed one kept as it was written when its value holds.
// Bytes nobody knows get zeros. The records are always in OCAD 9+ numbering and semantics (docs/mapper/model.md): a document
// read from OCAD 6-8 is written without carrying anything through.

import { _readSymbol, _readObject, OcadReader, parseParam } from "../tracer/vmap/ocad.js";
import { cp1252 } from "../tracer/vmap/ocadwrite.js";
import { t } from "./lang.js";

const VERSIONS = [9, 10, 11, 12, 2018];
const SUB = { 9: 0, 10: 0, 11: 770, 12: 256, 2018: 0 };     // a header's subversion when the source's does not apply
const IDX = 40, SYM_BLK = 4 + 256 * 4, IDX_BLK = 4 + 256 * IDX, STR_BLK = 4 + 256 * 16;

// ---- bytes --------------------------------------------------------------------------------------------------------------------
const utf8enc = new TextEncoder();
let utf8dec = null;
try { utf8dec = new TextDecoder("utf-8", { fatal: true }); } catch (e) { utf8dec = null; }
const cp1252dec = new TextDecoder("windows-1252");
/** 8-bit strings as the reader decodes them (ocad.js decode8): UTF-8 when valid with accents, else Windows-1252. */
function decode8(bytes) {
  if (utf8dec && bytes.some((b) => b > 0x7f)) { try { return utf8dec.decode(bytes); } catch (e) { /* not UTF-8 */ } }
  return cp1252dec.decode(bytes);
}
/** A string as 8-bit bytes: UTF-8 (OCAD 2018 writes its strings so), else Windows-1252. */
const encode8 = (s, utf8) => (utf8 ? [...utf8enc.encode(String(s ?? ""))] : cp1252(s));
const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

class Buf {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(size); this.dv = new DataView(this.buf.buffer); this.pos = 0; this.end = 0; }
  room(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2; while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size); b.set(this.buf); this.buf = b; this.dv = new DataView(b.buffer);
  }
  moved() { if (this.pos > this.end) this.end = this.pos; }
  u8(v) { this.room(1); this.buf[this.pos++] = (v | 0) & 0xff; this.moved(); }
  i16(v) { this.room(2); this.dv.setInt16(this.pos, Math.max(-32768, Math.min(32767, Math.round(+v || 0))), true); this.pos += 2; this.moved(); }
  u16(v) { this.room(2); this.dv.setUint16(this.pos, Math.max(0, Math.min(65535, Math.round(+v || 0))), true); this.pos += 2; this.moved(); }
  i32(v) { this.room(4); this.dv.setInt32(this.pos, Math.round(+v || 0) | 0, true); this.pos += 4; this.moved(); }
  u32(v) { this.room(4); this.dv.setUint32(this.pos, (+v || 0) >>> 0, true); this.pos += 4; this.moved(); }
  f64(v) { this.room(8); this.dv.setFloat64(this.pos, +v || 0, true); this.pos += 8; this.moved(); }
  zeros(n) { if (n <= 0) return; this.room(n); this.buf.fill(0, this.pos, this.pos + n); this.pos += n; this.moved(); }
  bytes(a) { this.room(a.length); this.buf.set(a, this.pos); this.pos += a.length; this.moved(); }
  seek(p) { this.pos = p; }
  result() { return this.buf.slice(0, this.end); }
}

/**
 * One record written over its raw bytes (`under`, or null): the fields the reader knows are written, the others (`keep`) are
 * copied from `under` at the same offset — always within the record's fixed part, beyond it only when the record's variable
 * lists have the raw record's shape (`full`) — else zeros.
 */
class Rec extends Buf {
  constructor(under, full, utf8) { super(1024); this.under = under; this.full = full; this.fixedEnd = Infinity; this.utf8 = utf8; }
  /** The fixed part ends here: offsets beyond follow variable lists. */
  vary() { if (this.fixedEnd === Infinity) this.fixedEnd = this.pos; }
  can(n) { return !!this.under && this.pos + n <= this.under.length && (this.full || this.pos + n <= this.fixedEnd); }
  keep(n) { if (this.can(n)) this.bytes(this.under.subarray(this.pos, this.pos + n)); else this.zeros(n); }
  /** A Delphi short string of n bytes; the raw one (with what lies after its end) when it says the same. */
  pstr(s, n) {
    s = String(s ?? "");
    if (this.can(n + 1)) {
      const len = this.under[this.pos];
      if (len <= n && decode8(this.under.subarray(this.pos + 1, this.pos + 1 + len)) === s) { this.keep(n + 1); return; }
    }
    let b = encode8(s, this.utf8);
    if (b.length > n) b = encode8(s, false).slice(0, n);
    this.u8(b.length); this.bytes(b); this.zeros(n - b.length);
  }
  /** n UTF-16 characters, up to a NUL; the raw ones when they say the same. */
  wstr(s, n) {
    s = String(s ?? "").slice(0, n);
    if (this.can(2 * n) && readW(this.under, this.pos, n) === s) { this.keep(2 * n); return; }
    for (let i = 0; i < n; i++) this.u16(i < s.length ? s.charCodeAt(i) : 0);
  }
  /** A boolean: the raw byte(s) when they say the same (OCAD writes some as 0xFFFF), else 1 or 0. */
  b8(val) { if (this.can(1) && (this.under[this.pos] !== 0) === !!val) this.keep(1); else this.u8(val ? 1 : 0); }
  b16(val) { if (this.can(2) && ((this.under[this.pos] | this.under[this.pos + 1]) !== 0) === !!val) this.keep(2); else this.u16(val ? 1 : 0); }
  /** Bytes taken from the raw record wherever they were (a text, a database string), or n zeros. */
  copyFrom(at, n) { if (this.under && at >= 0 && at + n <= this.under.length) this.bytes(this.under.subarray(at, at + n)); else this.zeros(n); }
  /** What the raw record holds beyond what was written (room OCAD left), when the shapes agree. */
  tail() { if (this.under && this.full && this.under.length > this.pos) this.bytes(this.under.subarray(this.pos)); }
}
function readW(u, at, n) {
  let s = "";
  for (let i = 0; i < n; i++) { const c = u[at + 2 * i] | (u[at + 2 * i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
  return s;
}

// ---- the source's tables ---------------------------------------------------------------------------------------------------
/** The source's header, file name, and index tables (OCAD 9+), read as they are, for carrying them through. */
function parseSource(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 48 || u8[0] !== 0xad || u8[1] !== 0x0c) throw new Error(t("map.ocad.notOcad"));
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const v = dv.getInt16(4, true);
  if (v < 9) return { version: v };
  const hs = v >= 12 ? 60 : 48;
  const i32 = (p) => dv.getInt32(p, true);
  const blocks = (first, size) => {
    const out = [], seen = new Set();
    for (let n = first; n > 0 && n + size <= u8.length && !seen.has(n) && out.length < 100000; n = i32(n)) { seen.add(n); out.push(n); }
    return out;
  };
  const src = { version: v, u8, header: u8.slice(0, hs), fileName: null, symbols: [], objects: [], entries: new Map(), hidden: [], params: [], utf8: null };
  const fnPos = i32(36), fnSize = i32(40);
  if (fnPos > 0 && fnSize > 0 && fnPos + fnSize <= u8.length) src.fileName = u8.slice(fnPos, fnPos + fnSize);
  for (const b of blocks(i32(8), SYM_BLK)) for (let i = 0; i < 256; i++) { const p = i32(b + 4 + 4 * i); if (p > 0 && p < u8.length) src.symbols.push(p); }
  let slot = 0;
  for (const b of blocks(i32(12), IDX_BLK)) {
    for (let i = 0; i < 256; i++) {
      slot++;
      const a = b + 4 + i * IDX, sym = i32(a + 24), pos = i32(a + 16), len = i32(a + 20), status = u8[a + 30];
      if (!sym || pos <= 0 || pos >= u8.length) continue;
      const e = { slot, pos, len, sym, status, raw: u8.slice(a, a + IDX) };
      if (status === 1) { src.objects.push(pos); src.entries.set(pos, e); }
      else if (status === 2 && pos + len <= u8.length) src.hidden.push(e);
    }
  }
  for (const b of blocks(i32(32), STR_BLK)) {
    for (let i = 0; i < 256; i++) {
      const a = b + 4 + i * 16, pos = i32(a), len = i32(a + 4), type = i32(a + 8);
      if (type <= 0 || pos <= 0 || pos + len > u8.length) continue;
      src.params.push(pos);
      const s = u8.subarray(pos, pos + len), z = s.indexOf(0), str = z >= 0 ? s.subarray(0, z) : s;
      if (src.utf8 == null && str.some((x) => x > 0x7f)) { try { utf8dec?.decode(str); src.utf8 = true; } catch (e) { src.utf8 = false; } }
    }
  }
  return src;
}

// ---- symbols ---------------------------------------------------------------------------------------------------------------
const eltsSize = (list) => (list || []).reduce((n, e) => n + 2 + (e.coords?.length || 0), 0);
/** The colours a symbol draws with, in a stable order (the head's list of up to 14). */
function symbolColors(s) {
  const out = [];
  const add = (c) => { if (c != null && c >= 0 && !out.includes(c)) out.push(c); };
  const elts = (l) => { for (const e of l || []) add(e.color); };
  if (s.otp === 1) elts(s.elts);
  else if (s.otp === 2 && !s.symTp) {
    if (s.lineWidth > 0) add(s.lineColor);
    if (s.frWidth > 0) add(s.frColor);
    if (s.dblMode > 0) { if (s.dblFlags & 1) add(s.dblFillColor); if (s.dblLeftWidth > 0) add(s.dblLeftColor); if (s.dblRightWidth > 0) add(s.dblRightColor); }
    elts(s.prim); elts(s.sec); elts(s.corner); elts(s.start); elts(s.end);
  } else if (s.otp === 3) {
    if (s.fillOn) add(s.fillColor);
    if (s.hatchMode > 0) add(s.hatchColor);
    if (s.structMode > 0) elts(s.elts);
  } else if (s.otp === 4 || s.otp === 6 || s.otp === 2) {
    add(s.fontColor);
    if (s.frMode > 0) add(s.frColor);
    if (s.lbOn) add(s.lbColor);
  } else if (s.otp === 5 || s.otp === 7) add(s.lineColor);
  return out.slice(0, 14);
}
const shapeOf = (s) => ["elts", "prim", "sec", "corner", "start", "end"].map((k) => (s[k] || []).map((e) => `${e.coords?.length || 0}`).join(",")).join("|") + `|${outOtp(s)}`;
/** OCAD 9+ has no line text inside line symbols (OCAD 6-8's symTp 1): it is a symbol of its own, type 6. */
const outOtp = (s) => (s.otp === 2 && s.symTp === 1 ? 6 : s.otp);

function writeElements(w, list) {
  for (const e of list || []) {
    const coords = e.coords || [];
    w.i16(e.type); w.u16(e.flags); w.i16(e.color); w.i16(e.lineWidth); w.i16(e.diameter); w.i16(coords.length); w.keep(4);
    for (const c of coords) { w.i32(c.x); w.i32(c.y); }
  }
}
/**
 * A symbol read in one version (`from`) as another version shows it the same: OCAD 11 and later draw a line symbol's
 * secondary, corner, start and end glyphs only when its « use » flags say so (OCAD 9-10 always); OCAD 10 and later read a
 * rectangle's cell font size (OCAD 9: 15 pt) and a text's middle and top alignments (OCAD 9: left and baseline only).
 */
function adapt(s, from, v) {
  const otp = outOtp(s);
  if (otp === 2) {
    const lists = [["sec", 8], ["corner", 4], ["start", 2], ["end", 1]];
    if (from <= 10 && v >= 11) {
      let f = (s.useSymbolFlags || 0) & ~15;
      for (const [k, bit] of lists) if (s[k]?.length) f |= bit;
      if (f !== s.useSymbolFlags) s = { ...s, useSymbolFlags: f };
    } else if (from >= 11 && v <= 10) {
      const off = lists.filter(([k, bit]) => s[k]?.length && !((s.useSymbolFlags || 0) & bit));
      if (off.length) { s = { ...s }; for (const [k] of off) s[k] = []; }
    }
  } else if ((otp === 5 || otp === 7) && from <= 9 && v >= 10) s = { ...s, fontSize: 150 };
  else if (otp === 4 && from <= 9 && v >= 10 && s.alignment > 3) s = { ...s, alignment: 0 };
  else if (otp === 4 && from >= 10 && v <= 9 && s.alignment > 3) s = { ...s, alignment: s.alignment & 3 };
  return s;
}
/** A symbol record in version v's layout, over its raw bytes when given (`raw`, the record read from them: `r0`). */
function serializeSymbol(s, v, raw, r0, utf8, from = v) {
  if (from !== v) s = adapt(s, from, v);
  const otp = outOtp(s);
  const w = new Rec(raw, !!raw && !!r0 && shapeOf(s) === shapeOf(r0), utf8);
  const colors = symbolColors(s);
  w.i32(0); w.i32(s.sym); w.u8(otp); w.u8(s.flags); w.u8(s.selected); w.u8(s.status);
  w.keep(4);                                                  // tool, course-setting mode, object type, description flags
  w.i32(s.extent); w.i32(0);                                  // the extent; the file position, set once placed
  w.keep(2);                                                  // the symbol tree's group
  if (r0 && raw && same(symbolColors(r0), colors)) w.keep(30);
  else { w.i16(colors.length); for (let i = 0; i < 14; i++) w.i16(i < colors.length ? colors[i] : 0); }
  if (v <= 10) w.pstr(s.description, 31); else w.wstr(s.description, 64);
  w.keep(484);                                                // the icon
  if (v >= 11) w.keep(128);                                   // the symbol tree's groups
  if (otp === 1) {
    w.i16(eltsSize(s.elts)); w.keep(2); w.vary();
    writeElements(w, s.elts);
  } else if (otp === 2) {
    w.i16(s.lineColor); w.i16(s.lineWidth); w.u16(s.lineEnds); w.i16(s.distFromStart); w.i16(s.distToEnd); w.i16(s.mainLength); w.i16(s.endLength);
    w.i16(s.mainGap); w.i16(s.secGap); w.i16(s.endGap); w.i16(s.minSym); w.i16(s.nPrimSym); w.i16(s.primSymDist); w.u16(s.dblMode); w.u16(s.dblFlags);
    w.i16(s.dblFillColor); w.i16(s.dblLeftColor); w.i16(s.dblRightColor); w.i16(s.dblWidth); w.i16(s.dblLeftWidth); w.i16(s.dblRightWidth); w.i16(s.dblLength); w.i16(s.dblGap);
    w.keep(6);
    w.u16(s.decMode); w.i16(s.decLast);
    if (v >= 12) { w.b8(s.decSymbolDistance !== false); w.b8(s.decSymbolWidth); } else w.keep(2);
    w.i16(s.frColor); w.i16(s.frWidth); w.i16(s.frStyle);
    w.i16(eltsSize(s.prim)); w.i16(eltsSize(s.sec)); w.i16(eltsSize(s.corner)); w.i16(eltsSize(s.start)); w.i16(eltsSize(s.end));
    w.u8(s.useSymbolFlags); w.keep(1); w.vary();
    for (const k of ["prim", "sec", "corner", "start", "end"]) writeElements(w, s[k]);
  } else if (otp === 6) {
    w.pstr(s.fontName, 31); w.i16(s.fontColor); w.i16(s.fontSize); w.i16(s.weight); w.b8(s.italic); w.keep(1);
    w.i16(s.charSpace); w.i16(s.wordSpace); w.i16(s.alignment); w.u8(s.frMode); w.u8(s.frFlags); w.pstr(s.frName, 31);
    w.i16(s.frColor); w.i16(s.frSize); w.i16(s.frWeight); w.b16(s.frItalic); w.i16(s.frOfX); w.i16(s.frOfY);
  } else if (otp === 3) {
    w.i32(s.borderSym); w.i16(s.fillColor); w.i16(s.hatchMode); w.i16(s.hatchColor); w.i16(s.hatchLineWidth); w.i16(s.hatchDist); w.i16(s.hatchAngle1); w.i16(s.hatchAngle2);
    w.b8(s.fillOn); w.b8(s.borderOn);
    if (v <= 11) { w.u8(s.structMode); w.keep(1); } else { w.u8(s.structMode); w.u8(s.structDraw); }
    w.i16(s.structWidth); w.i16(s.structHeight); w.i16(s.structAngle);
    if (v >= 12) { w.u8(s.irrX); w.u8(s.irrY); w.i16(s.irrMin); }
    w.keep(2); w.i16(eltsSize(s.elts)); w.vary();
    writeElements(w, s.elts);
  } else if (otp === 4) {
    w.pstr(s.fontName, 31); w.i16(s.fontColor); w.i16(s.fontSize); w.i16(s.weight); w.b8(s.italic); w.keep(1);
    w.i16(s.charSpace); w.i16(s.wordSpace); w.i16(s.alignment); w.i16(s.lineSpace); w.i16(s.paraSpace); w.i16(s.indentFirst); w.i16(s.indentOther);
    w.i16(s.nTabs); for (let i = 0; i < 32; i++) w.i32(s.tabs?.[i] ?? 0);
    w.b16(s.lbOn); w.i16(s.lbColor); w.i16(s.lbWidth); w.i16(s.lbDist); w.keep(2);
    w.u8(s.frMode); w.u8(s.frFlags);
    if (v <= 9) w.keep(24);                                     // a font name OCAD 9 no longer uses
    else { w.b8(s.pointSymOn); w.i32(s.pointSym); w.keep(19); }
    w.i16(s.frLeft); w.i16(s.frBottom); w.i16(s.frRight); w.i16(s.frTop); w.i16(s.frColor); w.i16(s.frSize); w.i16(s.frWeight); w.b16(s.frItalic);
    w.i16(s.frOfX); w.i16(s.frOfY);
  } else if (otp === 5 || otp === 7) {
    w.i16(s.lineColor); w.i16(s.lineWidth); w.i16(s.radius); w.u16(s.gridFlags); w.i16(s.cellWidth); w.i16(s.cellHeight); w.keep(4);
    w.i16(s.unnumCells); w.pstr(s.unnumText, 3); w.keep(2);
    if (w.can(32)) w.keep(32); else w.pstr("Arial", 31);         // the cells' font
    w.keep(2); w.i16(s.fontSize); w.keep(8);
  } else return null;
  w.tail();
  const out = w.result();
  new DataView(out.buffer).setInt32(0, out.length, true);
  return out;
}

// ---- objects -----------------------------------------------------------------------------------------------------------------
const groups = (s) => (s == null ? 0 : Math.floor(String(s).length / 4) + 1);   // 8-byte groups of UTF-16, a NUL at least
function writeText(w, s, n) { const str = String(s ?? ""); for (let i = 0; i < n * 4; i++) w.u16(i < str.length ? str.charCodeAt(i) : 0); }
const coordsKey = (cs) => (cs || []).map((c) => `${c.x},${c.y}`).join(";");
/** An object record in version v's layout, over its raw bytes when given (`r0` read from them). */
function serializeObject(o, v, raw, r0) {
  const coords = o.coords || [];
  const hs = v >= 12 ? 56 : 40;
  const sameText = !!r0 && (r0.text ?? null) === (o.text ?? null);
  const sameObjStr = !!r0 && (r0.objStr ?? null) === (o.objStr ?? null);
  const nText = sameText ? r0.nText || 0 : groups(o.text);
  const nObjStr = v >= 12 ? (sameObjStr ? r0.nObjStr || 0 : groups(o.objStr)) : 0;
  const nDbStr = v >= 12 && r0 ? r0.nDbStr || 0 : 0;
  const full = !!r0 && r0.nItem === coords.length && sameText && (v < 12 || sameObjStr);
  const w = new Rec(raw, full, false);
  if (v >= 12) {
    w.i32(o.sym); w.u8(o.otp); w.keep(1); w.i16(o.ang); w.u32(o.col); w.i16(o.lineWidth); w.i16(o.diamFlags);
    w.keep(28);                                               // server object id, height, creation date, representation, modification date
    w.i32(coords.length); w.i16(nText); w.i16(nObjStr); w.i16(nDbStr); w.u8(o.objStrType); w.keep(1);
  } else {
    w.i32(o.sym); w.u8(o.otp); w.keep(1); w.i16(o.ang); w.i32(coords.length); w.i16(nText); w.keep(2);
    w.u32(o.col); w.i16(o.lineWidth); w.i16(o.diamFlags); w.keep(16);
  }
  w.vary();
  for (const c of coords) { w.i32(c.x); w.i32(c.y); }
  // the texts as they were in the raw record (what lies after their NUL too) when they say the same
  const rawAt = r0 ? hs + 8 * (r0.nItem || 0) : 0;
  if (sameText && nText) w.copyFrom(rawAt, nText * 8); else writeText(w, o.text, nText);
  if (v >= 12) {
    const at = rawAt + 8 * (r0?.nText || 0);
    if (sameObjStr && nObjStr) w.copyFrom(at, nObjStr * 8); else writeText(w, o.objStr, nObjStr);
    if (nDbStr) w.copyFrom(at + 8 * (r0.nObjStr || 0), nDbStr * 8);
  }
  w.tail();
  return w.result();
}
/** The object's box for the index ([l, b, r, t] in OCAD's shifted coordinates): its points and its symbol's reach. */
function boxOf(o, sym, symByNum) {
  const cs = o.coords || [];
  if (!cs.length) return [0, 0, 0, 0];
  let ext = 0;
  if (o.sym === -2) ext = Math.ceil((o.lineWidth || 0) / 2);
  else if (sym) {
    ext = Math.max(0, sym.extent || 0);
    if (sym.otp === 3 && sym.borderOn) ext = Math.max(ext, symByNum.get(sym.borderSym)?.extent || 0);
  }
  const pts = o.otp === 1 ? cs.slice(0, 1) : cs;
  let l = Infinity, b = Infinity, r = -Infinity, tp = -Infinity;
  for (const c of pts) { const x = c.x >> 8, y = c.y >> 8; if (x < l) l = x; if (x > r) r = x; if (y < b) b = y; if (y > tp) tp = y; }
  return [(l - ext) * 256, (b - ext) * 256, (r + ext) * 256, (tp + ext) * 256];
}
/** The colour an index entry names: a graphic object's own, a symbol's only colour, else -1. */
function indexColor(o, sym) {
  if (o.sym === -2) return (o.col | 0) & 0xffff;
  if (o.sym < 0 || !sym) return -1;
  const c = symbolColors(sym);
  return c.length === 1 ? c[0] : -1;
}

// ---- parameter strings ---------------------------------------------------------------------------------------------------------
const num = (v) => String(Math.round((+v || 0) * 1e6) / 1e6);
const sameNum = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) < 1e-7;
/**
 * A parameter string written again: its first field (null: kept) and its codes. `set` gives Ozimut's codes as [value, the
 * reader's default]: a value replaces the code's first occurrence (its former text kept when it says the same number), null
 * removes it; a code the string lacks is added unless its value is the default. Every other part is kept as it was.
 */
function rewrite(str, first, set) {
  const fresh = str == null;
  const parts = fresh ? [""] : String(str).split("\t");
  const out = [first != null ? first : parts[0]], done = new Set();
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i], c = p[0];
    if (!p.length || !(c in set) || done.has(c)) { out.push(p); continue; }   // not Ozimut's, or a repeated code the reader skips
    done.add(c);
    const [val] = set[c];
    if (val == null) continue;
    const old = p.slice(1);
    out.push(c + (typeof val === "number" ? (sameNum(old, val) ? old : num(val)) : String(val)));
  }
  for (const [c, [val, dflt]] of Object.entries(set)) {
    if (done.has(c) || val == null || (!fresh && dflt !== undefined && (typeof val === "number" ? sameNum(val, dflt) : val === dflt))) continue;
    out.push(c + (typeof val === "number" ? num(val) : String(val)));
  }
  return out.join("\t");
}
/** The document's parameter strings in the order they will be written: [{ type, objIndex, raw | str }]. */
function paramList(doc, v, carry, src) {
  const params = (doc.params || []).filter((p) => p && p.type > 0);
  const old = !!doc.ocad && !(doc.ocad.version >= 9);       // read from OCAD 6-8: the colours and settings are the document's
  const isNew = !src && !old;                                // no source file: the settings are written from the document
  const d = doc.dirty || {};
  const has = (type) => params.some((p) => p.type === type);
  const rawOfParam = (p) => (carry && src && Array.isArray(p.rawAt) && p.rawAt[0] > 0 && p.rawAt[0] + p.rawAt[1] <= src.u8.length
    ? src.u8.subarray(p.rawAt[0], p.rawAt[0] + p.rawAt[1]) : null);
  const rw = doc.realWorld, pa = doc.printArea;
  const redo = {
    9: old || !!d.colors || (!has(9) && (doc.colors || []).length > 0),
    1039: old || (has(1039) ? !!d.georef : isNew || (!!d.georef && (!!rw || (doc.scale || 10000) !== 10000))),
    1026: old || (has(1026) ? !!d.print : (isNew || !!d.print) && (!!pa || (!!doc.printScale && doc.printScale !== doc.scale))),
  };
  // the colours, from the top of OCAD's table down; each keeps the codes of its former string (by number)
  const byNum = new Map();
  for (const p of params) if (p.type === 9) { const n = parseInt(parseParam(p.str ?? "", 9).codes.n, 10); if (Number.isFinite(n) && !byNum.has(n)) byNum.set(n, p.str); }
  const colorString0 = (c) => rewrite(old ? null : byNum.get(c.num) ?? null, c.name ?? "", { n: [c.num], c: [(c.cmyk?.[0] || 0) * 100, 0],
    m: [(c.cmyk?.[1] || 0) * 100, 0], y: [(c.cmyk?.[2] || 0) * 100, 0], k: [(c.cmyk?.[3] || 0) * 100, 0], o: [c.overprint ? 1 : 0, 0] });
  // the spot inks a colour is printed with (Cartographier's colour editor, colors.js): its « s<ink> » / « p<percent> » pairs
  // written again when the document says which (`spot`); other codes kept
  const colorString = (c) => {
    const s = colorString0(c);
    if (!Array.isArray(c.spot) || !d.colors) return s;
    const parts = s.split("	"), out = [parts[0]];
    for (let i = 1; i < parts.length; i++) { if (parts[i][0] === "s") { if (parts[i + 1]?.[0] === "p") i++; continue; } out.push(parts[i]); }
    for (const x of c.spot) out.push(`s${x.name}`, `p${num(Math.round((x.pct || 0) * 1000) / 10)}`);
    return out.join("	");
  };
  const scale = (str) => {
    const r = rw || {};
    const s = rewrite(str, str == null ? "" : null, { m: [doc.scale || 10000, 10000], g: [r.paperGrid ?? (str == null ? 10 : 0), 0], r: [r.on ? 1 : 0, 0],
      x: [r.x || 0, 0], y: [r.y || 0, 0], a: [r.angle || 0, 0], d: [r.grid ?? (str == null ? 100 : 0), 0], i: [r.zone || 0, 0] });
    return str == null && v >= 10 ? s + "\tb0\tc0" : s;
  };
  const print = (str) => {
    const r = str != null ? parseParam(str, 1026).codes.r : undefined;
    return rewrite(str, str == null ? "" : null, { a: [doc.printScale || doc.scale || 10000, doc.scale || 10000],
      r: [str == null ? (pa ? 1 : 0) : r == null ? null : pa ? r : 0], L: [pa ? pa[0] : null, 0], B: [pa ? pa[1] : null, 0], R: [pa ? pa[2] : null, 0], T: [pa ? pa[3] : null, 0] });
  };
  const out = [];
  for (const p of params) {
    if (p.type === 9 && redo[9]) { out.push({ colorSlot: true }); continue; }
    if (p.type === 10 && d.spots && Array.isArray(doc.spots)) continue;                 // the spot inks: written again below
    if (p.type === 1039 && redo[1039]) { if (!out.some((x) => x.type === 1039)) out.push({ type: 1039, objIndex: p.objIndex || 0, str: scale(old ? null : p.str) }); continue; }
    if (p.type === 1026 && redo[1026]) { if (!out.some((x) => x.type === 1026)) out.push({ type: 1026, objIndex: p.objIndex || 0, str: print(old ? null : p.str) }); continue; }
    const raw = p.dirty ? null : rawOfParam(p);
    out.push(raw ? { type: p.type, objIndex: p.objIndex || 0, raw } : { type: p.type, objIndex: p.objIndex || 0, str: p.str ?? "" });
  }
  if (d.spots && Array.isArray(doc.spots)) {
    // the spot inks (type 10), from the document: each keeps the codes of its former string (by name)
    const byName = new Map();
    for (const p of params) if (p.type === 10) byName.set(String(p.str || "").split("	")[0], p.str);
    const first = out.findIndex((x) => x && (x.type === 9 || x.colorSlot));
    const inks = doc.spots.map((s, i) => ({ type: 10, objIndex: 0, str: rewrite(byName.get(s.name) ?? null, s.name, { n: [s.num ?? i], v: [s.visible === false ? 0 : 1],
      c: [(s.cmyk?.[0] || 0) * 100], m: [(s.cmyk?.[1] || 0) * 100], y: [(s.cmyk?.[2] || 0) * 100], k: [(s.cmyk?.[3] || 0) * 100], f: [s.freq || 0], a: [s.angle || 0] }) }));
    out.splice(first < 0 ? out.length : first, 0, ...inks);
  }
  if (redo[9]) {
    // in the former colours' places, in the document's order; more colours after the last, fewer: the places left go
    const list = (doc.colors || []).slice().reverse().map((c) => ({ type: 9, objIndex: 0, str: colorString(c) }));
    const slots = out.map((x, i) => (x.colorSlot ? i : -1)).filter((i) => i >= 0);
    const after = slots.length ? slots[slots.length - 1] + 1 : 0;
    const extra = list.slice(slots.length);
    slots.forEach((at, k) => { out[at] = list[k] || null; });
    out.splice(after, 0, ...extra);
  }
  if (redo[1039] && !out.some((x) => x?.type === 1039)) out.push({ type: 1039, objIndex: 0, str: scale(null) });
  if (redo[1026] && !out.some((x) => x?.type === 1026)) out.push({ type: 1026, objIndex: 0, str: print(null) });
  // layout images given with their bytes and not yet among the strings (none of type 27 at their place): OCAD 11 and later
  // keep them in the file (« F »)
  const placed = params.filter((p) => p.type === 27).map((p) => parseParam(p.str ?? "", 27).codes);
  if (v >= 11) for (const im of doc.layoutImages || []) {
    if (!(im?.data instanceof Uint8Array)) continue;
    if (placed.some((c) => c.F && sameNum(c.x, im.x) && sameNum(c.y, im.y))) continue;
    out.push({ type: 27, objIndex: 0, str: `${im.name || im.file || "image"}\tr1\ts1\tx${num(im.x)}\ty${num(im.y)}\tu${num(im.u)}\tv${num(im.v)}\tF${base64(im.data)}` });
  }
  // a string written again as it was keeps its raw bytes (and the room OCAD gave it)
  const was = new Map();
  for (const p of params) if (!p.dirty && rawOfParam(p)) { const k = `${p.type}\n${p.str}`; if (!was.has(k)) was.set(k, []); was.get(k).push(rawOfParam(p)); }
  return out.filter(Boolean).map((x) => {
    if (x.raw) return x;
    const list = was.get(`${x.type}\n${x.str}`);
    return list?.length ? { type: x.type, objIndex: x.objIndex, raw: list.shift() } : x;
  });
}
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- the file ----------------------------------------------------------------------------------------------------------------
const rawOf = (src, rec) => (src && Array.isArray(rec?.rawAt) && rec.rawAt[0] > 0 && rec.rawAt[1] > 0 && rec.rawAt[0] + rec.rawAt[1] <= src.u8.length
  ? src.u8.subarray(rec.rawAt[0], rec.rawAt[0] + rec.rawAt[1]) : null);
/** True when the document is its source as read: every record clean, in the source's order, nothing else changed. */
function unchanged(doc, src) {
  const d = doc.dirty || {};
  if (d.colors || d.georef || d.print) return false;
  if ((doc.layoutImages || []).some((im) => im?.data instanceof Uint8Array)) return false;
  const list = (recs, positions) => recs.length === positions.length && recs.every((r, i) => r && !r.dirty && Array.isArray(r.rawAt) && r.rawAt[0] === positions[i]);
  const params = (doc.params || []).filter((p) => p && p.type > 0);
  return list(doc.symbols || [], src.symbols) && list(doc.objects || [], src.objects) && list(params, src.params);
}

/**
 * Write the document as an OCAD file of `version` (9, 10, 11, 12 or 2018; the source's by default when it is 9 or later, else
 * 2018). `source`: the bytes of the OCAD file the document was read from, or null. Returns the file's bytes. `doc.layoutImages`
 * entries holding their bytes (`data`) are written as new layout images (OCAD 11+); those of the source are among `doc.params`.
 * `rebuild` (tests): lay the file out again even when the document is its source unchanged.
 */
export function writeOcadDoc(doc, source, { version, rebuild = false } = {}) {
  const src = source ? parseSource(source instanceof Uint8Array ? source : new Uint8Array(source)) : null;
  const srcVersion = src?.version ?? doc.ocad?.version ?? null;
  const v = version ?? (srcVersion >= 9 ? srcVersion : 2018);
  if (!VERSIONS.includes(v)) throw new Error(t("map.ocad.version", { v }));
  const fresh = src && src.version >= 9 ? src : null;          // the source's tables, when it has OCAD 9+'s
  const carry = !!fresh && fresh.version === v;                 // records copied or written over their raw bytes
  if (carry && !rebuild && unchanged(doc, fresh)) return fresh.u8.slice();
  const utf8 = carry && fresh.utf8 != null ? fresh.utf8 : v >= 12;
  const hs = v >= 12 ? 60 : 48;
  const w = new Buf(1 << 20);
  const symByNum = new Map((doc.symbols || []).map((s) => [s.sym, s]));
  const from = doc.ocad?.version || 2018;                      // the version whose meaning the records have

  // ---- the header (written last), the file name OCAD keeps after it ----
  w.zeros(hs);
  let fnPos = 0, fnSize = 0;
  if (fresh?.fileName) { fnPos = w.pos; fnSize = fresh.fileName.length; w.bytes(fresh.fileName); }

  // ---- parameter strings, each block of 256 before its strings ----
  const params = paramList(doc, v, carry, fresh);
  let firstStr = 0, prevBlk = 0;
  for (let i = 0; i < params.length; i += 256) {
    const blk = w.pos;
    if (!prevBlk) firstStr = blk; else { w.seek(prevBlk); w.i32(blk); w.seek(blk); }
    w.zeros(STR_BLK);
    const table = [];
    for (const p of params.slice(i, i + 256)) {
      const at = w.pos;
      let bytes = p.raw;
      if (!bytes) {
        const b = encode8(p.str, utf8), step = v >= 12 ? 16 : 64;
        bytes = new Uint8Array(Math.ceil((b.length + 1) / step) * step); bytes.set(b);
      }
      w.bytes(bytes);
      table.push([at, bytes.length, p.type, p.objIndex]);
    }
    const end = w.pos;
    w.seek(blk + 4);
    for (const [at, len, type, oi] of table) { w.i32(at); w.i32(len); w.i32(type); w.i32(oi); }
    w.seek(end);
    prevBlk = blk;
  }

  // ---- symbols, each block of 256 positions before its symbols ----
  const symbols = doc.symbols || [];
  let firstSym = 0; prevBlk = 0;
  for (let i = 0; i < symbols.length; i += 256) {
    const blk = w.pos;
    if (!prevBlk) firstSym = blk; else { w.seek(prevBlk); w.i32(blk); w.seek(blk); }
    w.zeros(SYM_BLK);
    const pos = [];
    for (const s of symbols.slice(i, i + 256)) {
      const raw = carry ? rawOf(fresh, s) : null;
      const at = w.pos;
      let bytes = null, fixPos = true;
      if (raw && !s.dirty && raw.length >= 24 && new DataView(raw.buffer, raw.byteOffset).getInt32(4, true) === s.sym) {
        bytes = raw.slice();                                    // carried through
        fixPos = new DataView(raw.buffer, raw.byteOffset).getInt32(20, true) === s.rawAt[0];
      } else {
        let r0 = null;
        if (raw) { try { r0 = _readSymbol(new OcadReader(raw), v); } catch (e) { r0 = null; } }
        bytes = serializeSymbol(s, v, r0 ? raw : null, r0, utf8, from);
        if (!bytes) continue;                                   // a kind OCAD 9+ cannot hold
        if (r0 && raw && new DataView(raw.buffer, raw.byteOffset).getInt32(20, true) !== s.rawAt[0]) fixPos = false;
      }
      if (fixPos) new DataView(bytes.buffer, bytes.byteOffset).setInt32(20, at, true);
      w.bytes(bytes);
      pos.push(at);
    }
    const end = w.pos;
    w.seek(blk + 4); for (const p of pos) w.i32(p); w.seek(end);
    prevBlk = blk;
  }

  // ---- objects, in their index slots (the source's, else after the last), each block of 256 entries before its objects ----
  const slots = [];
  const taken = new Set();
  for (const e of fresh?.hidden || []) { slots[e.slot] = { hidden: e }; taken.add(e.slot); }
  const later = [];
  for (const o of doc.objects || []) {
    const k = o?.e?.objIndex;
    if (Number.isInteger(k) && k > 0 && !taken.has(k)) { slots[k] = { o }; taken.add(k); } else if (o) later.push(o);
  }
  let next = slots.length || 1;
  for (const o of later) slots[next++] = { o };
  const nBlocks = Math.max(1, Math.ceil((slots.length - 1) / 256));
  let firstIdx = 0; prevBlk = 0;
  for (let b = 0; b < nBlocks; b++) {
    const blk = w.pos;
    if (!prevBlk) firstIdx = blk; else { w.seek(prevBlk); w.i32(blk); w.seek(blk); }
    w.zeros(IDX_BLK);
    const entries = [];
    for (let i = 0; i < 256; i++) {
      const s = slots[b * 256 + i + 1];
      if (!s) continue;
      const at = w.pos;
      let bytes, entry;
      if (s.hidden) {
        // the source's hidden object, as it was (written again in another version)
        const h = s.hidden, raw = fresh.u8.subarray(h.pos, h.pos + h.len);
        if (carry) { bytes = raw.slice(); entry = h.raw.slice(); }
        else {
          let o;
          try { o = _readObject(new OcadReader(raw), fresh.version); } catch (e) { continue; }
          bytes = serializeObject(o, v, null, null);
          entry = indexEntry(null, o, symByNum, 2);
        }
      } else {
        const o = s.o, raw = carry ? rawOf(fresh, o) : null;
        const old = raw ? fresh.entries.get(o.rawAt[0]) : null;
        if (raw && old && !o.dirty && old.sym === o.sym) { bytes = raw.slice(); entry = old.raw.slice(); }
        else {
          let r0 = null;
          if (raw) { try { r0 = _readObject(new OcadReader(raw), v); } catch (e) { r0 = null; } }
          bytes = serializeObject(o, v, r0 ? raw : null, r0);
          entry = indexEntry(old && r0 ? { old, r0 } : null, o, symByNum, o.e?.status === 2 ? 2 : 1);
        }
      }
      const dv = new DataView(entry.buffer, entry.byteOffset);
      dv.setInt32(16, at, true); dv.setInt32(20, bytes.length, true);
      w.bytes(bytes);
      entries.push([i, entry]);
    }
    const end = w.pos;
    for (const [i, entry] of entries) { w.seek(blk + 4 + i * IDX); w.bytes(entry); }
    w.seek(end);
    prevBlk = blk;
  }

  // ---- the header ----
  const head = new Buf(hs);
  if (carry) head.bytes(fresh.header);
  else {
    const h = doc.ocad?.header;
    head.i16(3245); head.u8(fresh ? fresh.header[2] : doc.ocad?.version >= 9 ? (h?.sectionMark ?? 0) & 0xff : 0); head.u8(0); head.i16(v); head.i16(SUB[v]);
    head.zeros(hs - 8);
  }
  head.seek(4); head.i16(v);
  head.seek(8); head.i32(firstSym); head.i32(firstIdx);
  head.seek(32); head.i32(firstStr); head.i32(fnPos); head.i32(fnSize);
  if (v >= 12) { head.seek(56); head.i32(0); }                // a multi-representation block: not carried
  w.seek(0); w.bytes(head.result());
  return w.result();
}

/**
 * An object's index entry: the source's (`from.old`, the raw object `from.r0`) with what changed set again, or one made from
 * the record and its `e` (object type, status, view type, layout font).
 */
function indexEntry(from, o, symByNum, status) {
  const sym = symByNum.get(o.sym);
  const b = new Buf(IDX);
  if (from) {
    b.bytes(from.old.raw);
    const sameGeom = from.r0.sym === o.sym && coordsKey(from.r0.coords) === coordsKey(o.coords);
    b.seek(0);
    if (!sameGeom) for (const x of boxOf(o, sym, symByNum)) b.i32(x);
    b.seek(24); b.i32(o.sym); b.u8(o.otp);
    if (from.r0.sym !== o.sym) { b.seek(32); b.i16(indexColor(o, sym)); }
    return b.result();
  }
  for (const x of boxOf(o, sym, symByNum)) b.i32(x);
  b.i32(0); b.i32(0); b.i32(o.sym); b.u8(o.otp); b.u8(0); b.u8(status); b.u8(o.e?.viewType || 0);
  b.i16(indexColor(o, sym)); b.i16(0); b.i16(0); b.u8(o.e?.layoutFont || 0); b.u8(0);
  return b.result();
}

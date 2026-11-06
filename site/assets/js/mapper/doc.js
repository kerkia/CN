// Cartographier's map document (docs/mapper/model.md) and its live form: OCAD's records compiled into the Tracer's vector map
// (tracer/vmap/map.js) one at a time, so that an edit redraws only what it touched; a spatial index for picking; every change
// a transaction with its undo. The records stay as OCAD's: an OCAD map written back carries what was not changed through.

import { readOcad, makeContext, compileSymbol, compileObject, symId, applyParams } from "../tracer/vmap/ocad.js";
import { VColor } from "../tracer/vmap/map.js";
import * as G from "./geom.js";
import { spotsFromParams } from "./colors.js";

export const FORMAT = "ozimut-map", VERSION = 1;
const CELL = 20;                                         // the index's cells, mm
let nextId = 1;
/** An id for an object drawn here, unique across the team's editors (several mappers at once: merged by id, collab.js). */
export const newId = () => 2 ** 40 + Math.floor(Math.random() * 2 ** 50);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o, (k, v) => (k === "inst" || k === "cellKeys" || k === "__rec" ? undefined : v))));
const symKey = (sym) => `${Math.floor(sym / 1000)}.${sym % 1000}`;

/** A new, empty document. */
export function blank({ title = "", scale = 10000, standard = null, colors = [], symbols = [] } = {}) {
  return { format: FORMAT, version: VERSION, title, ocad: null, scale, printScale: scale, printArea: null, realWorld: null, declination: 0,
    standard, colors: clone(colors), symbols: clone(symbols), objects: [], params: [], parts: [{ id: "p1", name: "", hidden: false, locked: false }],
    backgrounds: [], layoutImages: [], dirty: {} };
}

/** A document from an OCAD file: its records, kept with where they lie in the file (the file itself goes with the document). */
export function fromOcad(bytes, title = "") {
  const { map, version, records } = readOcad(bytes);
  const v8 = version <= 8;
  const doc = blank({ title, scale: map.scale });
  doc.ocad = { version, header: records.header };
  doc.printScale = map.printScale || map.scale;
  doc.printArea = map.printArea || null;
  doc.realWorld = map.realWorld ? { ...map.realWorld } : null;
  doc.colors = map.colors.map((c) => ({ num: c.id, name: c.name, cmyk: c.cmyk.slice(), overprint: !!c.overprint }));
  const renum = (n) => (v8 && n > 0 ? Math.floor(n / 10) * 1000 + (n % 10) : n);
  // OCAD 6-8: a circle's diameter is to its outer edge, OCAD 9+ to the line's middle (ocad.js glyphOf)
  const v9circle = (e) => (e.type === 3 && e.diameter > e.lineWidth ? { ...e, diameter: e.diameter - e.lineWidth } : e);
  doc.symbols = records.symbols.map((s) => {
    const r = { ...s, sym: renum(s.sym) };
    if (v8) { delete r.rawAt; r.dirty = true; for (const k of ["elts", "prim", "sec", "corner", "start", "end"]) if (Array.isArray(r[k])) r[k] = r[k].map(v9circle); }
    return r;
  });
  doc.objects = records.objects.map(({ e, o, rawAt }) => {
    const r = { ...o, sym: renum(o.sym), e: { objType: e.objType, status: e.status, viewType: e.viewType, layoutFont: e.layoutFont, objIndex: e.objIndex }, id: nextId++ };
    delete r.inst; delete r.unicode; delete r.nItem; delete r.nText; delete r.nObjStr; delete r.nDbStr;
    if (!v8) r.rawAt = rawAt; else r.dirty = true;
    return r;
  });
  doc.params = records.params.map((p) => ({ ...p }));
  doc.layoutImages = (map.layoutImages || []).length;     // kept in their parameter strings (type 27), counted here
  spotsFromParams(doc);                                    // the spot inks and each colour's share of them (colors.js)
  return doc;
}

/** A live document: the records compiled, indexed, edited with undo. `doc.objects[i].inst` is the render object. */
export class Live {
  constructor(doc, { onChange } = {}) {
    this.doc = doc;
    this.onChange = onChange || (() => {});
    this.undoStack = []; this.redoStack = []; this.tx = null;
    this.version = doc.ocad && doc.ocad.version >= 9 ? doc.ocad.version : 2018;   // new maps, Mapper's and OCAD 6-8 files: OCAD 2018's meanings
    for (const o of doc.objects) { if (!o.id) o.id = nextId++; else nextId = Math.max(nextId, o.id + 1); }
    // a document saved before the spot inks were read (2026-11-06): read now from its OCAD strings
    if (doc.spots === undefined && (doc.params || []).some((p) => p.type === 10)) spotsFromParams(doc);
    this.compile();
  }
  /** Compile every record (once at opening, after a change of colours or of many symbols). */
  compile() {
    const d = this.doc;
    this.ctx = makeContext(this.version, d.colors);
    this.map = this.ctx.map;
    this.map.scale = d.scale; this.map.printScale = d.printScale || d.scale; this.map.printArea = d.printArea; this.map.realWorld = d.realWorld;
    this.map.useEuclid = false;
    this.symBy = new Map();
    this.layoutImages = applyParams(this.ctx, d.params);      // logos and the layout's order: never left out (owner, 2026-11-04)
    for (const s of d.symbols) if (s.otp !== 3 && s.otp !== 4) this.compileSym(s);
    for (const s of d.symbols) if (s.otp === 3 || s.otp === 4) this.compileSym(s);
    this.byId = new Map(); this.grid = new Map(); this.ordMax = 0; this.groups = new Map();
    d.objects.forEach((o, i) => { o.ord = i + 1; });
    for (const o of d.objects) this.place(o);
    this.map.ready = Promise.all(this.layoutImages.map((b) => b.ready));
  }
  compileSym(s) {
    const def = compileSymbol(s, this.ctx);
    this.symBy.set(s.sym, { s, def });
    if (def && s.hidden) def.visible = false;
    return def;
  }
  symbol(sym) { return this.symBy.get(sym)?.s || null; }
  defOf(sym) { return this.symBy.get(sym)?.def || null; }
  object(id) { return this.byId.get(id) || null; }
  get objects() { return this.doc.objects; }

  // ---- render objects and the index -------------------------------------------------------------------------------------
  place(o) {
    this.byId.set(o.id, o);
    let inst = null;
    try { inst = compileObject(o.e || { objIndex: 0 }, o, this.ctx); } catch (e) { inst = null; }
    o.inst = inst || null;
    if (o.ord == null) o.ord = ++this.ordMax; else if (o.ord > this.ordMax) this.ordMax = o.ord;
    if (inst) inst.__rec = o;
    const part = this.doc.parts.find((p) => p.id === (o.part || "p1"));
    if (inst && (part?.hidden || o.hidden)) inst.visible = false;
    o.bb = this.bboxOf(o);
    this.indexAdd(o);
    if (o.omap?.o != null) { let g = this.groups.get(o.omap.o); if (!g) this.groups.set(o.omap.o, (g = new Set())); g.add(o); }
  }
  unplace(o) {
    const inst = o.inst;
    if (inst?.def?.symbols) { const i = inst.def.symbols.lastIndexOf(inst); if (i >= 0) inst.def.symbols.splice(i, 1); }
    o.inst = null;
    this.indexDel(o);
    this.byId.delete(o.id);
    if (o.omap?.o != null) this.groups.get(o.omap.o)?.delete(o);
  }
  bboxOf(o) {
    if (o.inst?.bbox && Number.isFinite(o.inst.bbox[0])) return o.inst.bbox.slice();
    const b = G.bboxOf((o.coords || []).map((c) => [G.mmX(c), G.mmY(c)]));
    return Number.isFinite(b[0]) ? b : null;
  }
  cells(b) {
    const out = [];
    if (!b) return out;
    const x0 = Math.floor(b[0] / CELL), y0 = Math.floor(b[1] / CELL), x1 = Math.floor(b[2] / CELL), y1 = Math.floor(b[3] / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return ["*"];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x},${y}`);
    return out;
  }
  indexAdd(o) { for (const k of (o.cellKeys = this.cells(o.bb))) { let s = this.grid.get(k); if (!s) this.grid.set(k, (s = new Set())); s.add(o); } }
  indexDel(o) { for (const k of o.cellKeys || []) this.grid.get(k)?.delete(o); o.cellKeys = null; }
  /** The objects whose box meets [l, b, r, t]. */
  near(b) {
    const seen = new Set();
    for (const k of [...this.cells(b), "*"]) for (const o of this.grid.get(k) || []) {
      if (seen.has(o)) continue;
      if (o.bb && o.bb[0] <= b[2] && o.bb[2] >= b[0] && o.bb[1] <= b[3] && o.bb[3] >= b[1]) seen.add(o);
    }
    return [...seen];
  }
  bounds() {
    let b = null;
    for (const o of this.doc.objects) if (o.bb && o.inst?.visible !== false) b = b ? [Math.min(b[0], o.bb[0]), Math.min(b[1], o.bb[1]), Math.max(b[2], o.bb[2]), Math.max(b[3], o.bb[3])] : o.bb.slice();
    return b || [-100, -100, 100, 100];
  }

  // ---- picking ----------------------------------------------------------------------------------------------------------
  /** The objects under a point, the top one first: a point symbol or text near it, a line within `tol` mm, an area around it. */
  pick(x, y, tol = 1, { all = false, filter = null } = {}) {
    const hits = [];
    const zOf = (o) => { const i = this.map.symdefs.indexOf(o.inst?.def); return i < 0 ? 0 : i; };
    for (const o of this.near([x - tol, y - tol, x + tol, y + tol])) {
      if (o.inst?.visible === false || (filter && !filter(o))) continue;
      const part = this.doc.parts.find((p) => p.id === (o.part || "p1"));
      if (part?.locked) continue;
      const d = this.distance(o, x, y);
      if (d <= tol) hits.push({ o, d, z: zOf(o), area: o.otp === 3 ? Math.abs((o.bb[2] - o.bb[0]) * (o.bb[3] - o.bb[1])) : 0 });
    }
    // lines and points before areas, then the nearest, then the top-most symbol, the smallest area
    hits.sort((a, b) => (a.o.otp === 3) - (b.o.otp === 3) || a.d - b.d || b.z - a.z || a.area - b.area);
    return all ? hits.map((h) => h.o) : hits[0]?.o || null;
  }
  distance(o, x, y) {
    const parts = G.partsOf(o.coords);
    if (!parts.length) return Infinity;
    if (o.otp === 1 || o.otp === 4 || o.otp === 5) {
      if (o.bb && x >= o.bb[0] && x <= o.bb[2] && y >= o.bb[1] && y <= o.bb[3]) return o.otp === 1 ? Math.hypot(x - parts[0].pts[0][0], y - parts[0].pts[0][1]) * 0.25 : 0;
      return Math.hypot(x - parts[0].pts[0][0], y - parts[0].pts[0][1]);
    }
    let best = Infinity;
    const halfWidth = o.inst?.def?.width ? o.inst.def.width / 2 : 0;
    for (const p of parts) {
      const poly = G.flatten(p.pts, 0.1);
      best = Math.min(best, Math.max(0, G.nearestOn(poly, x, y, o.otp === 3).d - halfWidth));
    }
    if (o.otp === 3) {
      const rings = parts.map((p) => G.flatten(p.pts, 0.2));
      if (G.inRing(rings[0], x, y) && !rings.slice(1).some((r) => G.inRing(r, x, y))) return 0;
    }
    return best;
  }

  // ---- edits ------------------------------------------------------------------------------------------------------------
  /** Group the edits `fn` makes into one undoable step. */
  transact(label, fn) {
    const outer = !this.tx;
    if (outer) this.tx = { label, ops: [], box: null };
    try { fn(); } finally {
      if (outer) {
        const tx = this.tx; this.tx = null;
        if (tx.ops.length) { this.undoStack.push(tx); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; this.changed(tx.box, tx.label); }
      }
    }
  }
  record(op, box) {
    if (!this.tx) { this.transact("", () => this.record(op, box)); return; }
    this.tx.ops.push(op);
    if (box) this.tx.box = this.tx.box ? [Math.min(this.tx.box[0], box[0]), Math.min(this.tx.box[1], box[1]), Math.max(this.tx.box[2], box[2]), Math.max(this.tx.box[3], box[3])] : box.slice();
  }
  changed(box, label) { this.onChange({ box, label }); }
  /** A guard set by the editor (several mappers at once): false for a box in a sector another mapper keeps. */
  check(box) { if (this.guard && box && !this.guard(box)) { const e = new Error(this.guardMsg || "locked"); e.code = "sector"; throw e; } }
  add(rec) {
    const o = { ...rec, id: rec.id || newId(), dirty: true };
    delete o.rawAt; delete o.inst;
    if (o.e == null) o.e = { objType: o.otp, status: 1, viewType: 0 };
    this.doc.objects.push(o);
    this.place(o);
    try { this.check(o.bb); } catch (e) { this.unplace(o); this.doc.objects.pop(); throw e; }
    this.record({ kind: "add", id: o.id, after: clone(o) }, o.bb);
    return o;
  }
  /** The other copies of one object of a Mapper map whose combined symbol became one OCAD object per part (fromomap.js:
   *  `omap.o` the source object; a multi-part line's `piece`, an area's border line per `ring`): kept in step. */
  siblings(o) {
    if (o?.omap?.o == null) return [];
    return [...(this.groups.get(o.omap.o) || [])].filter((s) => s !== o && (s.omap.piece || 0) === (o.omap.piece || 0));
  }
  /** A sibling's coordinates after `o` changed: the same, or an area's ring as its border line, or a border line back into its area. */
  siblingCoords(o, s) {
    const ro = o.omap.ring, rs = s.omap.ring;
    if (ro == null && rs == null) return o.coords;
    const parts = G.partsOf(o.coords);
    if (ro == null && rs != null && o.otp === 3) {
      const ring = parts[rs]; if (!ring) return null;
      const pts = ring.pts.map((p) => [p[0], p[1], p[2] & ~G.F.HOLE]);
      if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push([pts[0][0], pts[0][1], 0]);
      return G.coordsOf([{ pts, hole: false }]);
    }
    if (ro != null && rs == null && s.otp === 3) {
      const sp = G.partsOf(s.coords); if (!sp[ro]) return null;
      const pts = parts[0].pts.slice(); if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      sp[ro] = { pts, hole: ro > 0 };
      return G.coordsOf(sp);
    }
    return null;
  }
  remove(id) {
    const o = this.byId.get(id);
    if (!o) return;
    if (!this._sync && o.omap?.o != null) { this._sync = true; try { for (const s of this.siblings(o)) this.remove(s.id); } finally { this._sync = false; } }
    this.check(o.bb);
    const i = this.doc.objects.indexOf(o), before = clone(o), box = o.bb;
    this.unplace(o);
    this.doc.objects.splice(i, 1);
    this.record({ kind: "remove", id, before, at: i }, box);
  }
  /** Change an object: `patch` merged into its record (coords, sym, ang, text…). */
  update(id, patch) {
    const o = this.byId.get(id);
    if (!o) return null;
    const before = clone(o), box0 = o.bb;
    this.check(box0);
    this.unplace(o);
    Object.assign(o, patch, { dirty: true });
    this.place(o);
    this.reorder(o);
    this.record({ kind: "update", id, before, after: clone(o) }, union(box0, o.bb));
    if (!this._sync && o.omap?.o != null && (patch.coords || patch.ang != null)) {
      this._sync = true;
      try {
        for (const s of this.siblings(o)) {
          const p = {};
          if (patch.coords) { const c = this.siblingCoords(o, s); if (c) p.coords = c; }
          if (patch.ang != null && s.otp === o.otp) p.ang = patch.ang;
          if (Object.keys(p).length) this.update(s.id, p);
        }
      } finally { this._sync = false; }
    }
    return o;
  }
  /** A render object goes back to its record's place in its symbol's list (its drawing order among its symbol's objects). */
  reorder(o) {
    const list = o.inst?.def?.symbols;
    if (!list) return;
    const j = list.lastIndexOf(o.inst);
    if (j >= 0) list.splice(j, 1);
    let lo = 0, hi = list.length;                          // the objects of a symbol are kept in their records' order
    while (lo < hi) { const m = (lo + hi) >> 1; if ((list[m].__rec?.ord ?? 0) < o.ord) lo = m + 1; else hi = m; }
    list.splice(lo, 0, o.inst);
  }
  /** Change a symbol's record (recompiled; its objects drawn again). */
  updateSymbol(sym, patch) {
    const cur = this.symBy.get(sym);
    if (!cur) return;
    const before = clone(cur.s);
    Object.assign(cur.s, patch, { dirty: true });
    this.recompileSymbol(cur.s);
    this.record({ kind: "symbol", sym, before, after: clone(cur.s) }, this.bounds());
  }
  addSymbol(rec) {
    const s = clone(rec); delete s.rawAt; s.dirty = true;
    this.doc.symbols.push(s);
    this.compileSym(s);
    this.record({ kind: "addSymbol", sym: s.sym, after: clone(s) }, null);
    return s;
  }
  recompileSymbol(s) {
    const old = this.symBy.get(s.sym)?.def;
    const objs = this.doc.objects.filter((o) => o.sym === s.sym);
    for (const o of objs) this.unplace(o);
    if (old) { const i = this.map.symdefs.indexOf(old); if (i >= 0) this.map.symdefs.splice(i, 1); }
    this.ctx.symdefs.delete(symId(s.sym, this.version));
    const def = this.compileSym(s);
    // keep the symbol's place in the drawing order
    if (def && old) { const j = this.map.symdefs.indexOf(def), i0 = Math.min(this.map.symdefs.length - 1, Math.max(0, this.symOrder(s))); if (j >= 0 && i0 !== j) { this.map.symdefs.splice(j, 1); this.map.symdefs.splice(i0, 0, def); } }
    for (const o of objs) this.place(o);
  }
  symOrder(s) { return this.doc.symbols.filter((x) => x.otp !== 3 && x.otp !== 4).length > 0 ? this.doc.symbols.indexOf(s) : 0; }
  /** Colours changed: the document compiled again (symbols' colours resolve at compile time). */
  setColors(colors) {
    const before = clone(this.doc.colors);
    this.doc.colors = clone(colors);
    this.doc.dirty = { ...(this.doc.dirty || {}), colors: true };
    this.compile();
    this.record({ kind: "colors", before, after: clone(colors) }, this.bounds());
  }
  setDocField(field, value) {
    const before = clone(this.doc[field]);
    this.doc[field] = clone(value);
    if (field === "realWorld" || field === "scale" || field === "declination") this.doc.dirty = { ...(this.doc.dirty || {}), georef: true };
    if (field === "printArea" || field === "printScale") this.doc.dirty = { ...(this.doc.dirty || {}), print: true };
    if (field === "scale") this.map.scale = value;
    if (field === "parts") for (const o of this.doc.objects) { if (o.inst) { const p = this.doc.parts.find((q) => q.id === (o.part || "p1")); o.inst.visible = !(p?.hidden || o.hidden); } }
    this.record({ kind: "field", field, before, after: clone(value) }, field === "parts" ? this.bounds() : null);
  }

  // ---- undo -------------------------------------------------------------------------------------------------------------
  undo() { return this.step(this.undoStack, this.redoStack, true); }
  redo() { return this.step(this.redoStack, this.undoStack, false); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  step(from, to, back) {
    const tx = from.pop();
    if (!tx) return null;
    const ops = back ? tx.ops.slice().reverse() : tx.ops;
    let recompile = false;
    for (const op of ops) {
      if (op.kind === "add" || op.kind === "remove") {
        const adding = (op.kind === "add") !== back;
        if (adding) {
          const rec = clone(op.kind === "add" ? op.after : op.before);
          const at = op.kind === "remove" ? Math.min(op.at, this.doc.objects.length) : this.doc.objects.length;
          this.doc.objects.splice(at, 0, rec);
          this.place(rec);
          this.reorder(rec);
        } else {
          const o = this.byId.get(op.id);
          if (o) { this.unplace(o); this.doc.objects.splice(this.doc.objects.indexOf(o), 1); }
        }
      } else if (op.kind === "update") {
        const o = this.byId.get(op.id);
        if (o) { this.unplace(o); for (const k of Object.keys(o)) if (k !== "id") delete o[k]; Object.assign(o, clone(back ? op.before : op.after)); this.place(o); this.reorder(o); }
      } else if (op.kind === "symbol") {
        const cur = this.symBy.get(op.sym);
        if (cur) { for (const k of Object.keys(cur.s)) delete cur.s[k]; Object.assign(cur.s, clone(back ? op.before : op.after)); this.recompileSymbol(cur.s); }
      } else if (op.kind === "addSymbol") {
        if (back) { const i = this.doc.symbols.findIndex((s) => s.sym === op.sym); if (i >= 0) this.doc.symbols.splice(i, 1); recompile = true; }
        else { this.doc.symbols.push(clone(op.after)); recompile = true; }
      } else if (op.kind === "colors") { this.doc.colors = clone(back ? op.before : op.after); recompile = true; }
      else if (op.kind === "field") { this.doc[op.field] = clone(back ? op.before : op.after); if (op.field === "symbols" || op.field === "params") recompile = true; }
    }
    if (recompile) this.compile();
    to.push(tx);
    this.changed(tx.box || this.bounds(), tx.label);
    return tx;
  }

  // ---- saving -----------------------------------------------------------------------------------------------------------
  /** The document as map.json (render objects and the index left out). */
  toJSON() {
    return JSON.parse(JSON.stringify(this.doc, (k, v) => (k === "inst" || k === "bb" || k === "cellKeys" || k === "__rec" || k === "ord" ? undefined : v)));
  }
}
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
export { union, symKey, VColor };

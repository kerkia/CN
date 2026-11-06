// Cartographier's document (docs/mapper/model.md: OCAD's records) written as an OpenOrienteering Mapper map (.omap: XML, file
// format 9, as Mapper 0.9 writes it). The format as tracer/vmap/oom.js reads it and tracer/vmap/oomwrite.js writes it (after
// Purple Pen's OpenMapperExport, BSD); nothing of Mapper's own code (GPL). Mapper counts in thousandths of a mm with y down,
// angles in radians, its colours from the top (priority 0). What came from a Mapper file (fromomap.js's `omap` notes) is written
// back as it was when untouched — each symbol's XML, the colours', the georeferencing's —, else rebuilt from the records: a
// combined symbol from the records its parts became, a text symbol from its records of each alignment, an area's patterns from
// its records. What Mapper has no symbol for becomes a combined symbol (an OCAD line with a framing line or a double line beside
// its main line, an area with its border line) or is approached (see `losses`).

import { compileSymbol, makeContext } from "../tracer/vmap/ocad.js";
import { faceMetrics, HALIGN, VALIGN } from "../tracer/vmap/symdefs.js";
import { oomV, oomH, oomTextDef } from "./fromomap.js";

const CURVE = 1, CLOSE = 2, HOLE = 16, DASH = 32, REG_BLACK = -900;
const esc = (s) => String(s ?? "").replace(/[&<>"\n\r\t]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\n": "&#10;", "\r": "&#13;", "\t": "&#9;" })[c]);
const escT = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const n = (v) => String(Math.round(v * 1e6) / 1e6);
const um = (h) => Math.round(h * 10);                                 // OCAD's hundredths of a mm → Mapper's µm
const rad = (tenths) => n((tenths * Math.PI) / 1800);                 // tenths of a degree → radians
const mmX = (c) => (c.x >> 8) / 100, mmY = (c) => (c.y >> 8) / 100;
const codeOf = (sym) => (sym % 1000 ? `${Math.floor(sym / 1000)}.${sym % 1000}` : `${Math.floor(sym / 1000)}`);
const joinOf = (e) => ((e & 1) ? 2 : (e & 4) ? 1 : 0), capOf = (e) => ((e & 1) ? 1 : 0);
/** An object's angle in radians: Mapper's own when it came from Mapper and was not turned since. */
const radOf = (o) => (o.omap?.r != null && Math.round((o.omap.r * 1800) / Math.PI) === (o.ang || 0) ? n(o.omap.r) : rad(o.ang || 0));
const rootOf = (id) => (id == null ? null : Number(String(id).split("/")[0]));

/** Write a document as a Mapper file. opts: keepSource (default true: what came from a Mapper file and was not changed is
 *  written as it came), losses (an array to which what Mapper cannot hold is added: { key, sym }). Returns the bytes (UTF-8). */
export function docToOmap(doc, { keepSource = true, losses = null } = {}) {
  const w = new Writer(doc, keepSource, losses);
  return new TextEncoder().encode(w.write());
}

class Writer {
  constructor(doc, keepSource, losses) {
    this.doc = doc; this.keep = keepSource; this.lossList = losses; this.lossSeen = new Set();
    this.version = doc.ocad?.version || 2018;
    this.recBySym = new Map(doc.symbols.map((r) => [r.sym, r]));
    this.table = doc.omap?.symbols || {};
  }
  loss(key, sym) {
    const k = `${key}|${sym}`;
    if (this.lossSeen.has(k)) return;
    this.lossSeen.add(k);
    this.lossList?.push({ key: `map.omap.lost.${key}`, sym });
  }
  write() {
    this.compile();
    this.colors();
    this.plan();
    const symbols = this.out.map((e) => this.symbolXml(e));
    const parts = this.objects();
    // OCAD's layout images (logos kept in the file): Mapper keeps no image inside a map, only templates beside it
    if (this.doc.layoutImages?.length || this.doc.params?.some((p) => p.type === 27 && /	r1/.test(p.str || ""))) this.loss("layoutImage", "");
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">'];
    out.push(`<notes>${escT(this.doc.omap?.notes || "")}</notes>`);
    out.push(this.georef());
    out.push(`<colors count="${this.colorXml.length}">`, ...this.colorXml, "</colors>");
    out.push('<barrier version="6" required="0.6.0">');
    out.push(`<symbols count="${symbols.length}"${this.doc.omap?.symbolSet ? ` id="${esc(this.doc.omap.symbolSet)}"` : ""}>`, ...symbols, "</symbols>");
    out.push(`<parts count="${parts.length}" current="0">`);
    for (const p of parts) out.push(`<part name="${esc(p.name)}"><objects count="${p.objs.length}">`, ...p.objs, "</objects></part>");
    out.push("</parts>");
    out.push('<templates count="0" first_front_template="0">', '<defaults use_meters_per_pixel="true" meters_per_pixel="0" dpi="0" scale="0"/>', "</templates>");
    out.push(this.print());
    out.push("</barrier>", "</map>");
    return out.join("\n") + "\n";
  }

  // ---- the records compiled (text metrics, visibility) -------------------------------------------------------------------------
  compile() {
    this.ctx = makeContext(this.version, this.doc.colors);
    this.defs = new Map();
    const one = (s) => { try { this.defs.set(s, compileSymbol(s, this.ctx)); } catch (e) { /* written as far as possible */ } };
    for (const s of this.doc.symbols) if (s.otp !== 3 && s.otp !== 4) one(s);
    for (const s of this.doc.symbols) if (s.otp === 3 || s.otp === 4) one(s);
  }

  // ---- colours -----------------------------------------------------------------------------------------------------------------
  colors() {
    const doc = this.doc, main = doc.colors.filter((c) => !c.omap?.reg).slice().reverse();      // the top of the table first
    // colours for the image and layout objects (OCAD's own CMYK): the layout's above the map, the images' under it
    const layer = { "-4": [], "-3": [] }, seen = new Map();
    for (const o of doc.objects) if (o.sym === -3 || o.sym === -4) {
      const cmyk = compressedCmyk(o.col), key = `${o.sym}|${cmyk.join(",")}`;
      if (!seen.has(key)) { seen.set(key, { name: `${o.sym === -4 ? "Layout" : "Image"} ${cmyk.map((v) => Math.round(v * 100)).join("/")}`, cmyk, overprint: false, layer: key }); layer[o.sym].push(seen.get(key)); }
    }
    const list = [...layer["-4"], ...main, ...layer["-3"]];
    this.prio = new Map();
    list.forEach((c, i) => { if (c.layer) this.prio.set(c.layer, i); else this.prio.set(c.num, i); });
    for (const c of doc.colors) if (c.omap?.reg) this.prio.set(c.num, REG_BLACK);
    const sig = (c) => JSON.stringify([c.name, c.cmyk, !!c.overprint]);
    this.colorsIntact = this.keep && !layer["-4"].length && main.every((c, i) => c.omap?.xml && c.omap.p === i && c.omap.sig === sig(c));
    this.colorXml = list.map((c, i) => (this.colorsIntact ? c.omap.xml
      : `<color priority="${i}" name="${esc(c.name)}" c="${n(c.cmyk[0])}" m="${n(c.cmyk[1])}" y="${n(c.cmyk[2])}" k="${n(c.cmyk[3])}" opacity="1">`
        + `${c.overprint ? "" : '<spotcolors knockout="true"/>'}<cmyk method="custom"/><rgb method="cmyk"/></color>`));
  }
  /** An OCAD colour number as a Mapper colour id (-1 none). */
  col(num) { const p = this.prio.get(num); return p == null ? -1 : p; }

  // ---- which Mapper symbols, and the records' objects on them ------------------------------------------------------------------
  plan() {
    const doc = this.doc, table = this.table;
    this.out = [];
    this.idOfMapper = new Map(); this.idOfRec = new Map();
    const byRoot = new Map();
    for (const r of doc.symbols) {
      const S = rootOf(r.omap?.id);
      if (S == null || !table[S]) continue;
      if (!byRoot.has(S)) byRoot.set(S, []);
      byRoot.get(S).push(r);
    }
    this.byRoot = byRoot;
    // the Mapper symbols the document came with, in their order: those with records, and the combined symbols of written parts
    const ids = Object.keys(table).map(Number).sort((a, b) => a - b);
    const present = new Set(ids.filter((S) => byRoot.has(S)));
    for (let changed = true; changed;) {
      changed = false;
      for (const S of ids) if (!present.has(S) && table[S].type === 16 && table[S].parts?.some((p) => p != null && present.has(p))) { present.add(S); changed = true; }
    }
    for (const S of ids) {
      if (!present.has(S)) continue;
      const e = { kind: "mapper", S, recs: byRoot.get(S) || [], id: this.out.length };
      this.out.push(e);
      this.idOfMapper.set(S, e.id);
      for (const r of e.recs) this.idOfRec.set(r, e.id);
    }
    // records of the document's own
    for (const r of doc.symbols) {
      if (this.idOfRec.has(r)) continue;
      const e = { kind: "record", rec: r, id: this.out.length };
      this.out.push(e);
      this.idOfRec.set(r, e.id);
    }
    this.rotated = new Set(doc.objects.filter((o) => o.otp === 3 && o.ang).map((o) => o.sym));
    // whether each Mapper symbol is written as it came
    for (const e of this.out) if (e.kind === "mapper") e.reuse = this.reusable(e);
    // OCAD's graphics, image and layout objects: a symbol of each kind, colour and line
    this.extra = new Map();
    for (const o of doc.objects) if (o.sym < 0 && o.sym >= -4) this.extraSymbol(o);
  }
  reusable(e) {
    const entry = this.table[e.S];
    if (!this.keep || !this.colorsIntact || !entry?.xml || e.recs.some((r) => r.dirty)) return false;
    if (entry.type === 16) return (entry.parts || []).every((p) => p == null || this.idOfMapper.has(p));
    return e.recs.length > 0;
  }

  // ---- symbols -------------------------------------------------------------------------------------------------------------------
  symbolXml(e) {
    if (e.kind === "extra") return e.xml;
    if (e.kind === "mapper") {
      const entry = this.table[e.S];
      if (e.reuse) {
        return entry.xml.replace(/^(<symbol\b[^>]*?\sid=")-?\d+(")/, `$1${e.id}$2`)
          .replace(/(<part\b[^>]*?\ssymbol=")(-?\d+)(")/g, (m, a, id, b) => `${a}${this.idOfMapper.get(Number(id)) ?? -1}${b}`);
      }
      return this.rebuild(e, entry);
    }
    const r = e.rec, parts = this.partsOf(r);
    return this.wrap(parts, { id: e.id, code: codeOf(r.sym), name: r.description || "", status: r.status });
  }
  /** A symbol element: one part as it is, several as a combined symbol of private parts (and references). */
  wrap(parts, { id, code, name, status = 0, extra = "" }) {
    const head = (type) => `<symbol type="${type}"${id != null ? ` id="${id}"` : ""} code="${esc(code)}" name="${esc(name)}"${status & 2 ? ' is_hidden="true"' : ""}${status & 1 ? ' is_protected="true"' : ""}${extra}>`;
    if (parts.length === 1 && !parts[0].ref) return `${head(parts[0].type)}${parts[0].body}</symbol>`;
    if (!parts.length) return `${head(2)}${lineXml({})}</symbol>`;
    const ps = parts.map((p) => (p.ref != null ? `<part symbol="${p.ref}"/>` : `<part private="true"><symbol type="${p.type}" code="" name="">${p.body}</symbol></part>`));
    return `${head(16)}<combined_symbol parts="${ps.length}">${ps.join("")}</combined_symbol></symbol>`;
  }
  /** A Mapper symbol of the source rebuilt from its records (changed, or the colours changed). */
  rebuild(e, entry) {
    const S = e.S, recs = e.recs, status = recs[0]?.status ?? 0;
    const opt = { id: e.id, code: entry.code, name: entry.name, status };
    if (entry.type !== 16) {
      if (!recs.length) return this.wrap([], opt);
      const main = recs.find((r) => r.omap.role === "main") || recs[0];
      if (main.otp === 4) return this.wrap(this.partsOf(main), opt);
      if (main.otp === 3) return this.wrap(this.areaParts(recs.filter((r) => String(r.omap.id) === String(S))), opt);
      return this.wrap(this.partsOf(main), opt);
    }
    const parts = [];
    const clone = recs.find((r) => r.omap.role === "combo");
    (entry.parts || []).forEach((ref, k) => {
      if (ref == null) {
        const pr = recs.filter((r) => String(r.omap.id) === `${S}/${k}` || String(r.omap.id).startsWith(`${S}/${k}/`));
        const areas = pr.filter((r) => r.otp === 3);
        if (areas.length) parts.push(...this.areaParts(areas, true));
        for (const r of pr) if (r.otp !== 3) parts.push(...this.partsOf(r, true));
        return;
      }
      const copies = recs.filter((r) => String(r.omap.id) === `${S}/${ref}`);
      if (copies.length) {
        const areas = copies.filter((r) => r.otp === 3);
        if (areas.length) parts.push(...this.areaParts(areas, true));
        for (const r of copies) if (r.otp !== 3) parts.push(...this.partsOf(r, true));
      } else if (clone && clone.dirty && String(clone.omap.from) === String(ref)) parts.push(...this.areaParts([{ ...clone, borderOn: false }], true));
      else if (this.idOfMapper.has(ref)) parts.push({ ref: this.idOfMapper.get(ref) });
    });
    return this.wrap(parts, opt);
  }
  /** The Mapper parts of one record: [{ type, body }] or [{ ref }]. `flat`: never a reference (inside a combined symbol's own). */
  partsOf(r, flat = false) {
    if (r.otp === 1) return [{ type: 1, body: pointXml(this, r.elts, (r.flags & 1) !== 0) }];
    if (r.otp === 2 && !r.symTp) return this.lineParts(r);
    if (r.otp === 3) return this.areaParts([r], flat);
    if (r.otp === 4 || r.otp === 6 || (r.otp === 2 && r.symTp === 1)) return [{ type: 8, body: this.textBody(r) }];
    if (r.otp === 5 || r.otp === 7) {
      if (r.gridFlags & 1) this.loss("rectGrid", codeOf(r.sym));
      return [{ type: 2, body: lineXml({ color: this.col(r.lineColor), width: um(r.lineWidth), join: r.radius > 0 ? 2 : 1, cap: 0 }) }];
    }
    return [];
  }
  lineParts(r) {
    const code = codeOf(r.sym), parts = [];
    const main = r.lineWidth > 0 && this.col(r.lineColor) !== -1, dbl = r.dblMode > 0;
    const glyph = (list, flag) => (list?.length && (this.version < 11 || r.useSymbolFlags & flag) ? pointXml(this, list, true) : null);
    const dashed = r.mainGap > 0 || r.secGap > 0;
    const spec = { color: main ? this.col(r.lineColor) : -1, width: main ? um(r.lineWidth) : 0, join: joinOf(r.lineEnds), cap: r.lineEnds & 2 ? 3 : capOf(r.lineEnds),
      startOff: um(r.distFromStart), endOff: um(r.distToEnd) };
    if (dashed && main) {
      if (r.secGap > 0) Object.assign(spec, { dashed: true, groups: 2, ig: um(r.secGap), dash: um((r.mainLength - r.secGap) / 2), brk: um(r.mainGap) });
      else Object.assign(spec, { dashed: true, dash: um(r.mainLength), brk: um(r.mainGap) });
      spec.half = r.endLength > 0 && r.endLength < r.mainLength * 0.75;
    }
    if (r.decMode > 0) this.loss("decrease", code);
    const mid = r.prim?.length && r.nPrimSym > 0 ? pointXml(this, r.prim, true) : null;
    if (mid) {
      const per = Math.max(1, r.nPrimSym), dist = um(r.primSymDist);
      Object.assign(spec, { mid, per, dist });
      if (spec.dashed) spec.placement = 2;
      else {
        // OCAD's symbols spaced every main length + main gap, the first an end length + half a gap from the start
        spec.segLen = Math.max(1, um(r.mainLength + r.mainGap) - (per - 1) * dist);
        spec.endLen = Math.max(0, um(r.endLength + r.mainGap / 2) - ((per - 1) * dist) / 2);
        spec.minMid = r.minSym + 1;
      }
    }
    spec.start = glyph(r.start, 2); spec.end = glyph(r.end, 1); spec.dashSym = glyph(r.corner, 4);
    if (spec.dashSym && r.omap?.noEndDash) spec.suppress = true;
    if (dbl) {
      const lw = r.dblLeftWidth > 0 ? um(r.dblLeftWidth) : 0, rw = r.dblRightWidth > 0 ? um(r.dblRightWidth) : 0;
      const dl = r.dblMode >= 2, dr = r.dblMode >= 3, df = r.dblMode >= 4;
      const border = (c, w0, dashedB) => `<border color="${w0 ? this.col(c) : -1}" width="${w0}" shift="${Math.round(w0 / 2)}"${dashedB ? ` dashed="true" dash_length="${um(r.dblLength)}" break_length="${um(r.dblGap)}"` : ""}/>`;
      const borders = `<borders>${border(r.dblLeftColor, lw, dl)}${border(r.dblRightColor, rw, dr)}</borders>`;
      const fill = r.dblFlags & 1 ? this.col(r.dblFillColor) : -1;
      const dspec = { color: fill, width: um(r.dblWidth), join: joinOf(r.lineEnds), cap: 0, borders };
      if (df) Object.assign(dspec, { dashed: true, dash: um(r.dblLength), brk: um(r.dblGap) });
      if (!main) {
        // the double line on the main line's own symbol (its symbols along the line stay with it)
        parts.push({ type: 2, body: lineXml({ ...spec, ...dspec, startOff: spec.startOff, endOff: spec.endOff }) });
      } else parts.push({ type: 2, body: lineXml(spec) }, { type: 2, body: lineXml(dspec) });
    } else parts.push({ type: 2, body: lineXml(spec) });
    if (r.frWidth > 0 && this.col(r.frColor) !== -1) parts.push({ type: 2, body: lineXml({ color: this.col(r.frColor), width: um(r.frWidth), join: joinOf(r.frStyle), cap: capOf(r.frStyle) }) });
    const sec = glyph(r.sec, 8);
    if (sec) {
      // OCAD's secondary symbol, between the main ones: a line of its own with the symbol, offset by half a main length
      parts.push({ type: 2, body: lineXml({ color: -1, width: 0, mid: sec, segLen: Math.max(1, um(r.mainLength + r.mainGap)), endLen: um(r.endLength + r.mainGap / 2 + r.mainLength / 2), minMid: 0 }) });
    }
    return parts;
  }
  /** An area from one or more records (fill, hatching and structures merged); with its border line, a combined symbol. */
  areaParts(recs, flat = false) {
    const main = recs[0], pats = [];
    const rotatable = (r) => (r.flags & 1) !== 0 || this.rotated?.has(r.sym);
    for (const r of recs) {
      if (r.hatchMode > 0 && this.col(r.hatchColor) !== -1) {
        for (const a of r.hatchMode === 2 ? [r.hatchAngle1, r.hatchAngle2] : [r.hatchAngle1]) {
          const dist = this.version <= 8 ? r.hatchLineWidth + r.hatchDist : r.hatchDist;
          pats.push(`<pattern type="1" angle="${rad(a)}"${rotatable(r) ? ' rotatable="true"' : ""} line_spacing="${um(dist)}" line_offset="0" offset_along_line="0" color="${this.col(r.hatchColor)}" line_width="${um(r.hatchLineWidth)}"/>`);
        }
      }
      if (r.structMode > 0 && r.structWidth > 0 && r.structHeight > 0 && r.elts?.length) {
        const ps = `<symbol type="1" code="" name=""><point_symbol rotatable="true"${pointBody(this, r.elts)}</symbol>`;
        const draw = this.version >= 12 && r.structDraw ? ` no_clipping="${r.structDraw}"` : "";
        const W = um(r.structWidth), H = um(r.structHeight), base = `angle="${rad(r.structAngle)}"${rotatable(r) ? ' rotatable="true"' : ""} point_distance="${W}"${draw}`;
        if (r.structMode === 2) {
          // OCAD's shifted rows: two patterns of twice the row spacing, the second half a row and half a step along
          pats.push(`<pattern type="2" ${base} line_spacing="${2 * H}" line_offset="0" offset_along_line="0">${ps}</pattern>`,
            `<pattern type="2" ${base} line_spacing="${2 * H}" line_offset="${H}" offset_along_line="${Math.round(W / 2)}">${ps}</pattern>`);
        } else pats.push(`<pattern type="2" ${base} line_spacing="${H}" line_offset="0" offset_along_line="0">${ps}</pattern>`);
        if (r.irrX > 0 || r.irrY > 0) this.loss("irregular", codeOf(r.sym));
      }
    }
    const fill = main.fillOn ? this.col(main.fillColor) : -1;
    const parts = [{ type: 4, body: `<area_symbol inner_color="${fill}" min_area="0" patterns="${pats.length}">${pats.join("")}</area_symbol>` }];
    if (main.borderOn && main.borderSym) {
      const b = this.recBySym.get(main.borderSym);
      if (b) {
        if (flat || !this.idOfRec.has(b)) parts.push(...this.partsOf(b, true).filter((p) => !p.ref));
        else parts.push({ ref: this.idOfRec.get(b) });
      }
    }
    return parts;
  }
  textBody(r) {
    const code = codeOf(r.sym), V = this.version;
    const size = ((r.fontSize / 10) / 72) * 25.4, lsRatio = faceMetrics(r.fontName || "Arial", 1).lineSpacing;
    const ls = r.otp === 4 ? r.lineSpace / 100 / lsRatio : 1 / lsRatio;
    const out = [`<text_symbol icon_text="A" rotatable="true"><font family="${esc(r.fontName || "Arial")}" size="${Math.round(size * 1000)}"${r.weight >= 500 ? ' bold="true"' : ""}${r.italic ? ' italic="true"' : ""}/>`];
    out.push(`<text color="${this.col(r.fontColor)}" line_spacing="${n(ls)}" paragraph_spacing="${um(r.paraSpace || 0)}" character_spacing="${n((r.charSpace || 0) / 100)}" kerning="true"/>`);
    if (r.wordSpace && r.wordSpace !== 100) this.loss("wordSpace", code);
    if (r.indentFirst || r.indentOther) this.loss("indent", code);
    if (r.pointSymOn) this.loss("textPoint", code);
    const fc = this.col(r.frColor);
    if (r.frMode === 2 && fc !== -1) out.push(`<framing color="${fc}" mode="1" line_half_width="${um(V === 7 ? r.frWidth : r.frSize)}" shadow_x_offset="0" shadow_y_offset="0"/>`);
    else if (r.frMode === 1 && fc !== -1) out.push(`<framing color="${fc}" mode="2" line_half_width="0" shadow_x_offset="${um(r.frOfX)}" shadow_y_offset="${-um(r.frOfY)}"/>`);
    else if (r.frMode === 3) this.loss("textFrame", code);
    if (r.lbOn && this.col(r.lbColor) !== -1) out.push(`<line_below color="${this.col(r.lbColor)}" width="${um(r.lbWidth)}" distance="${um(r.lbDist)}"/>`);
    if (r.nTabs > 0 && !r.omap?.defTab) out.push(`<tabs count="${r.nTabs}">${r.tabs.slice(0, r.nTabs).map((x) => `<tab>${um(x)}</tab>`).join("")}</tabs>`);
    out.push("</text_symbol>");
    if (r.otp !== 4) this.loss("lineText", code);
    return out.join("");
  }
  /** A symbol for OCAD's graphics (-2), image (-3) and layout (-4) objects: one per kind, colour and line. */
  extraSymbol(o) {
    const kind = o.sym === -2 ? "Graphics" : o.sym === -3 ? "Image layer" : "Layout layer";
    const color = o.sym === -2 ? this.col(o.col) : this.prio.get(`${o.sym}|${compressedCmyk(o.col).join(",")}`) ?? -1;
    let key, body, type;
    if (o.otp === 3) { key = `${o.sym}|a|${color}`; type = 4; body = `<area_symbol inner_color="${color}" min_area="0" patterns="0"/>`; }
    else if (o.otp === 2) { key = `${o.sym}|l|${color}|${o.lineWidth}|${o.diamFlags}`; type = 2; body = lineXml({ color, width: um(o.lineWidth), join: joinOf(o.diamFlags), cap: capOf(o.diamFlags) }); }
    else if (o.otp === 4 || o.otp === 5) {
      let font = "Arial", pt = 27;
      if (o.objStr && o.objStrType === 3) { const p = o.objStr.split("\t"); font = p[0] || font; const s = p.find((x, i) => i && x[0] === "s"); if (s) pt = parseFloat(s.slice(1)) || pt; }
      key = `${o.sym}|t|${color}|${font}|${pt}`; type = 8;
      body = `<text_symbol icon_text="A" rotatable="true"><font family="${esc(font)}" size="${Math.round((pt / 72) * 25400)}"/><text color="${color}" line_spacing="1" paragraph_spacing="0" character_spacing="0" kerning="true"/></text_symbol>`;
    } else return;
    if (this.extra.has(key)) return;
    const e = { kind: "extra", id: this.out.length, type, font: type === 8 ? body : null };
    e.xml = this.wrap([{ type, body }], { id: e.id, code: `${kind === "Graphics" ? 990 : kind === "Image layer" ? 991 : 992}.${this.extra.size + 1}`, name: `${kind} ${this.extra.size + 1}` });
    this.out.push(e); this.extra.set(key, e);
  }

  // ---- objects ------------------------------------------------------------------------------------------------------------------
  objects() {
    const doc = this.doc, parts = (doc.parts?.length ? doc.parts : [{ id: "p1", name: "default part" }]).map((p) => ({ id: p.id, name: p.name || "default part", objs: [] }));
    const partOf = (o) => parts.find((p) => p.id === o.part) || parts[0];
    // what came from one Mapper object, written once: its symbol, its first record's pieces, its area
    const groups = new Map();
    for (const o of doc.objects) {
      const g = o.omap?.o;
      if (g == null || !this.idOfMapper.has(o.omap.sym)) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(o);
    }
    const done = new Set();
    for (const o of doc.objects) {
      if (this.version >= 12 && (o.e?.viewType >= 1 && o.e?.viewType <= 4 || o.objStrType === 1)) continue;   // OCAD's course setting
      const g = o.omap?.o;
      if (g != null && groups.has(g)) {
        if (done.has(g)) continue;
        done.add(g);
        const xml = this.groupXml(groups.get(g));
        if (xml) partOf(o).objs.push(xml);
        continue;
      }
      const xml = this.objectXml(o, null);
      if (xml) partOf(o).objs.push(xml);
    }
    return parts;
  }
  groupXml(list) {
    const S = list[0].omap.sym, id = this.idOfMapper.get(S);
    const area = list.find((o) => o.otp === 3);
    if (area) return this.objectXml(area, id);
    const first = list[0];
    if (first.otp === 2) {
      const pieces = list.filter((o) => o.sym === first.sym).sort((a, b) => (a.omap.piece || 0) - (b.omap.piece || 0));
      return this.pathXml(id, pieces.flatMap((o) => partsOfCoords(o.coords, false)), false, 0);
    }
    return this.objectXml(first, id);
  }
  objectXml(o, id) {
    const rec = this.recBySym.get(o.sym);
    if (o.sym < 0) return this.extraObject(o);
    if (!rec) return null;
    id ??= this.idOfRec.get(rec);
    if (id == null) return null;
    const code = codeOf(rec.sym);
    if (o.coords?.some((c) => (c.x & 12) || (c.y & 4))) this.loss("gaps", code);
    if (o.otp === 1) {
      if (!o.coords?.length) return null;
      if (o.coords.length > 1) this.loss("circleGaps", code);
      return `<object type="0" symbol="${id}" rotation="${radOf(o)}"><coords count="1">${xy(o.coords[0])};</coords></object>`;
    }
    if ((o.otp === 4 || o.otp === 5) && (rec.otp === 4)) return this.textXml(o, rec, id);
    if (o.otp === 6 || (rec.otp === 6 || rec.symTp === 1)) return this.lineTextXml(o, rec, id);
    if ((o.otp === 7 || o.otp === 5) && (rec.otp === 5 || rec.otp === 7)) {
      const d = this.defs.get(rec);
      if (!d || o.coords.length < 4) return null;
      const p = o.coords.slice(0, 4).map((c) => [mmX(c), mmY(c)]);
      const wd = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), ht = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]);
      if (!wd && !ht) return null;                                    // OCAD draws nothing of an empty rectangle
      const cmds = d.path(p[0][0], p[0][1], wd, ht, (Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180) / Math.PI).commands();
      return this.pathXml(id, [cmdsCoords(cmds)], false, "0");
    }
    if (o.otp === 3 || rec.otp === 3) return this.pathXml(id, partsOfCoords(o.coords, true), true, radOf(o), o.omap?.pc);
    if (o.otp === 2) {
      const parts = partsOfCoords(o.coords, false);
      if (parts.length > 1) this.loss("holesInLine", code);
      return this.pathXml(id, parts, false, 0);
    }
    return null;
  }
  pathXml(id, parts, area, ang, pc = null) {
    const all = [];
    parts.forEach((p, k) => {
      if (p.length < 2) return;
      const q = p.map((c) => c.slice());
      const f = q[0], l = q[q.length - 1];
      const closed = area || (f[0] === l[0] && f[1] === l[1]);
      if (area && (f[0] !== l[0] || f[1] !== l[1])) q.push([f[0], f[1], 0]);
      if (closed) q[q.length - 1][2] |= CLOSE | HOLE;
      else if (k < parts.length - 1) q[q.length - 1][2] |= HOLE;
      all.push(...q);
    });
    if (all.length < 2) return null;
    return `<object type="1" symbol="${id}"><coords count="${all.length}">${all.map(([x, y, fl]) => `${x} ${y}${fl ? ` ${fl}` : ""};`).join("")}</coords><pattern rotation="${ang}"><coord x="${pc ? pc[0] : 0}" y="${pc ? pc[1] : 0}"/></pattern></object>`;
  }
  /** The Mapper text symbol an OCAD text record is written as (its metrics place the objects as oom.js reads them). */
  mdefOf(id) {
    this.mdefs ||= new Map();
    if (this.mdefs.has(id)) return this.mdefs.get(id);
    const e = this.out[id];
    let xml = e ? (e.kind === "extra" ? e.xml : this.symbolXml(e)) : null, d = null;
    try {
      const el = new DOMParser().parseFromString(`<x xmlns="http://openorienteering.org/apps/mapper/xml/v2">${xml}</x>`, "application/xml").documentElement;
      const ts = el.getElementsByTagName("text_symbol")[0];
      if (ts) d = oomTextDef(null, ts);
    } catch (err) { d = null; }
    this.mdefs.set(id, d);
    return d;
  }
  /**
   * An OCAD text as a Mapper one, placed so that Mapper draws it where OCAD does: the alignment kept (the object's own when it
   * came from Mapper, else its symbol's), the anchor (or the box's centre) moved by the difference of the vertical offsets.
   */
  textXml(o, rec, id) {
    const def = this.defs.get(rec), md = this.mdefOf(id);
    if (!def || !md || !o.coords?.length) return null;
    const raw = (o.text || "").split(/\r\n|\n|\r/);
    if (raw.length && raw[0] === "") raw.shift();                    // OCAD ignores one blank line at the start
    const lines = raw;
    const h0 = def.halign === HALIGN.Center ? 1 : def.halign === HALIGN.Right ? 2 : 0;
    const v0 = def.valign === VALIGN.TopAscent ? 1 : def.valign === VALIGN.Midpoint ? 2 : 0;
    const ha = o.omap?.h ?? h0, va = o.omap?.v ?? v0, vM = oomV(va), hM = oomH(ha);
    const angle = (Number(radOf(o)) * 180) / Math.PI, a0 = (angle * Math.PI) / 180, a1 = ((angle + 90) * Math.PI) / 180;
    const dir = [Math.cos(a0), Math.sin(a0)], up = [Math.cos(a1), Math.sin(a1)];
    const mv = (p, d, v) => [p[0] + d * v[0], p[1] + d * v[1]];
    const head = `<object type="4" symbol="${id}" rotation="${radOf(o)}" h_align="${ha}" v_align="${va}">`;
    const tail = `<text>${escT(lines.join("\n"))}</text></object>`;
    if (rec.otp === 4 && o.otp === 5 && o.coords.length >= 4) {
      const ul = [mmX(o.coords[3]), mmY(o.coords[3])], ur = [mmX(o.coords[2]), mmY(o.coords[2])], ll = [mmX(o.coords[0]), mmY(o.coords[0])];
      const wd = o.omap?.box ? o.omap.box[0] / 1000 : Math.hypot(ur[0] - ul[0], ur[1] - ul[1]), ht = o.omap?.box ? o.omap.box[1] / 1000 : Math.hypot(ul[0] - ll[0], ul[1] - ll[1]);
      const d = def.ocadTopAdjustment(true, this.version) + def.vertOffset(VALIGN.Default, def.wrap(lines, wd, HALIGN.Default).lines) - md.vertOffset(vM, md.wrap(lines, wd, hM).lines);
      let c = mv(mv(ul, wd / 2, dir), d, up);
      if (vM === VALIGN.TopAscent || vM === VALIGN.Baseline) c = mv(c, -ht / 2, up); else if (vM === VALIGN.BaselineLast) c = mv(c, ht / 2, up);
      const W = Math.round(wd * 1000), H = Math.round(ht * 1000);
      return `${head}<coords count="2">${Math.round(c[0] * 1000)} ${Math.round(-c[1] * 1000)};${W} ${H};</coords><size width="${W}" height="${H}"/>${tail}`;
    }
    const p = [mmX(o.coords[0]), mmY(o.coords[0])];
    const d = def.ocadTopAdjustment(false, this.version) + def.vertOffset(VALIGN.Default, def.unwrapped(lines).lines) - md.vertOffset(vM, md.unwrapped(lines).lines);
    const c = mv(p, d, up);
    return `${head}<coords count="1">${Math.round(c[0] * 1000)} ${Math.round(-c[1] * 1000)};</coords>${tail}`;
  }
  /** OCAD's text along a line: Mapper has none; a text at the line's start, along its first leg. */
  lineTextXml(o, rec, id) {
    if (!o.coords?.length) return null;
    const a = o.coords[0], b = o.coords[1] || a;
    const ang = Math.atan2(mmY(b) - mmY(a), mmX(b) - mmX(a));
    return `<object type="4" symbol="${id}" rotation="${n(ang)}" h_align="0" v_align="0"><coords count="1">${xy(a)};</coords><text>${escT(o.text || "")}</text></object>`;
  }
  extraObject(o) {
    const kind = o.otp === 3 ? "a" : o.otp === 2 ? "l" : "t";
    const color = o.sym === -2 ? this.col(o.col) : this.prio.get(`${o.sym}|${compressedCmyk(o.col).join(",")}`) ?? -1;
    const e = [...this.extra.entries()].find(([k]) => k.startsWith(`${o.sym}|${kind}|${color}|`) || k === `${o.sym}|${kind}|${color}`)?.[1];
    if (!e) return null;
    if (o.otp === 3) return this.pathXml(e.id, partsOfCoords(o.coords, true), true, 0);
    if (o.otp === 2) {
      const ex = this.extra.get(`${o.sym}|l|${color}|${o.lineWidth}|${o.diamFlags}`) || e;
      return this.pathXml(ex.id, partsOfCoords(o.coords, false), false, 0);
    }
    if (!o.coords?.length) return null;
    const p = o.otp === 5 && o.coords.length >= 4 ? o.coords[3] : o.coords[0];
    return `<object type="4" symbol="${e.id}" rotation="${n(((o.ang || 0) * Math.PI) / 1800)}" h_align="0" v_align="1"><coords count="1">${xy(p)};</coords><text>${escT((o.text || "").replace(/\r\n|\r/g, "\n"))}</text></object>`;
  }

  // ---- georeferencing and printing -----------------------------------------------------------------------------------------------
  georef() {
    const doc = this.doc, src = doc.omap?.georef;
    if (this.keep && src && !doc.dirty?.georef) return src;
    const rw = doc.realWorld, scale = doc.scale || 10000;
    const gs = rw?.gridScale && rw.gridScale !== 1 ? ` grid_scale_factor="${n(rw.gridScale)}"` : "";
    const head = `<georeferencing scale="${n(scale)}"${gs} declination="${n(doc.declination || 0)}" grivation="${n(rw?.on ? rw.angle || 0 : 0)}"><ref_point x="0" y="0"/>`;
    if (!rw?.on) return `${head}<projected_crs id="Local"><ref_point x="0" y="0"/></projected_crs></georeferencing>`;
    let crs = '<projected_crs id="Local">';
    const z = Math.abs(rw.zone || 0);
    if (z > 2000 && z <= 2060) crs = `<projected_crs id="UTM"><spec language="PROJ.4">+proj=utm +datum=WGS84 +zone=${z - 2000}${rw.zone < 0 ? " +south" : ""}</spec><parameter>${z - 2000} ${rw.zone < 0 ? "S" : "N"}</parameter>`;
    else if (rw.epsg) crs = `<projected_crs id="EPSG"><spec language="PROJ.4">+init=epsg:${rw.epsg}</spec><parameter>${rw.epsg}</parameter>`;
    else if (rw.proj4) crs = `<projected_crs id="PROJ.4"><spec language="PROJ.4">${escT(rw.proj4)}</spec>`;
    else if (rw.zone) this.loss("grid", String(rw.zone));
    return `${head}${crs}<ref_point x="${n(rw.x || 0)}" y="${n(rw.y || 0)}"/></projected_crs></georeferencing>`;
  }
  print() {
    const doc = this.doc, src = doc.omap?.print;
    if (this.keep && src && !doc.dirty?.print) return src;
    const s = doc.printScale || doc.scale || 10000, a = doc.printArea;
    const area = a ? `<print_area left="${n(a[0])}" top="${n(-a[3])}" width="${n(a[2] - a[0])}" height="${n(a[3] - a[1])}"/>` : "";
    return `<print scale="${n(s)}" resolution="600" mode="vector"><page_format paper_size="A4" orientation="portrait" h_overlap="5" v_overlap="5"><dimensions width="210" height="297"/>`
      + `<page_rect left="0" top="0" width="210" height="297"/></page_format>${area}</print>`;
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------
function compressedCmyk(c) { return [(c & 0xff) / 255, ((c >>> 8) & 0xff) / 255, ((c >>> 16) & 0xff) / 255, ((c >>> 24) & 0xff) / 255]; }
const xy = (c) => `${(c.x >> 8) * 10} ${-(c.y >> 8) * 10}`;
/**
 * OCAD coordinates as Mapper's, part by part: [[x, y, flags]] — a curve start before OCAD's two bezier controls, a dash point
 * (32) for OCAD's corners and dash points (Mapper restarts a line's pattern at both, and draws its dash symbol there), a new part
 * at OCAD's hole flag.
 */
export function partsOfCoords(coords, area) {
  const parts = [];
  let cur = [];
  for (const c of coords || []) {
    if (c.y & 2 && cur.length && !(c.x & 3)) { parts.push(cur); cur = []; }
    let fl = 0;
    if (!(c.x & 3) && c.y & 9) fl |= DASH;
    if (c.x & 1 && cur.length) cur[cur.length - 1][2] |= CURVE;
    cur.push([(c.x >> 8) * 10, -(c.y >> 8) * 10, fl]);
  }
  if (cur.length) parts.push(cur);
  void area;
  return parts.filter((p) => p.length >= 2);
}
/** Path commands (map mm, y up) as Mapper coordinates. */
function cmdsCoords(cmds) {
  const out = [];
  for (const c of cmds) {
    if (c[0] === "M" || c[0] === "L") out.push([Math.round(c[1] * 1000), Math.round(-c[2] * 1000), 0]);
    else if (c[0] === "C") { out[out.length - 1][2] |= CURVE; out.push([Math.round(c[1] * 1000), Math.round(-c[2] * 1000), 0], [Math.round(c[3] * 1000), Math.round(-c[4] * 1000), 0], [Math.round(c[5] * 1000), Math.round(-c[6] * 1000), 0]); }
    else if (c[0] === "Z" && out.length) { const f = out[0], l = out[out.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1], 0]); }
  }
  return out;
}
/** A Mapper line symbol. */
function lineXml(s) {
  const a = [`color="${s.color ?? -1}"`, `line_width="${s.width || 0}"`, 'minimum_length="0"', `join_style="${s.join ?? 1}"`, `cap_style="${s.cap ?? 0}"`,
    `start_offset="${s.startOff || 0}"`, `end_offset="${s.endOff || 0}"`];
  if (s.dashed) a.push('dashed="true"');
  a.push(`segment_length="${s.segLen ?? 4000}"`, `end_length="${s.endLen ?? 0}"`, 'show_at_least_one_symbol="true"', `minimum_mid_symbol_count="${s.minMid ?? 0}"`,
    'minimum_mid_symbol_count_when_closed="0"', `dash_length="${s.dash ?? 4000}"`, `break_length="${s.brk ?? 1000}"`, `dashes_in_group="${s.groups ?? 1}"`,
    `in_group_break_length="${s.ig ?? 500}"`);
  if (s.half) a.push('half_outer_dashes="true"');
  a.push(`mid_symbols_per_spot="${s.per ?? 1}"`, `mid_symbol_distance="${s.dist ?? 0}"`);
  if (s.placement) a.push(`mid_symbol_placement="${s.placement}"`);
  if (s.suppress) a.push('suppress_dash_symbol_at_ends="true"');
  const sym = (tag, ps) => (ps ? `<${tag}><symbol type="1" code="" name="">${ps}</symbol></${tag}>` : "");
  const kidsXml = sym("start_symbol", s.start) + sym("mid_symbol", s.mid) + sym("end_symbol", s.end) + sym("dash_symbol", s.dashSym) + (s.borders || "");
  return `<line_symbol ${a.join(" ")}${kidsXml ? `>${kidsXml}</line_symbol>` : "/>"}`;
}
/** A Mapper point symbol from OCAD's elements: the first disc or ring at the point is the symbol's own, the others elements. */
function pointXml(w, elts, rotatable) { return `<point_symbol${rotatable ? ' rotatable="true"' : ""}${pointBody(w, elts)}`; }
function pointBody(w, elts) {
  const list = (elts || []).filter((e) => w.col(e.color) !== -1 && ((e.type === 3 && e.diameter > e.lineWidth) || (e.type === 4 && e.diameter > 0) || ((e.type === 1 || e.type === 2) && e.coords?.length >= 2)));
  const at0 = (e) => (e.type === 3 || e.type === 4) && !(e.coords[0].x >> 8) && !(e.coords[0].y >> 8);
  const i0 = list.findIndex(at0);
  const ring = (e) => (e.type === 4 ? `inner_radius="${um(e.diameter / 2)}" inner_color="${w.col(e.color)}" outer_width="0" outer_color="-1"`
    : `inner_radius="${um((e.diameter - e.lineWidth) / 2)}" inner_color="-1" outer_width="${um(e.lineWidth)}" outer_color="${w.col(e.color)}"`);
  const head = i0 >= 0 ? ring(list[i0]) : 'inner_radius="0" inner_color="-1" outer_width="0" outer_color="-1"';
  const rest = list.filter((e, i) => i !== i0).map((e) => {
    if (e.type === 3 || e.type === 4) return `<element><symbol type="1" code=""><point_symbol ${ring(e)} elements="0"/></symbol><object type="0"><coords count="1">${xy(e.coords[0])};</coords></object></element>`;
    const parts = partsOfCoords(e.coords, e.type === 2);
    const cs = [];
    parts.forEach((p, k) => {
      const q = p.map((c) => c.slice());
      if (e.type === 2) { const f = q[0], l = q[q.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) q.push([f[0], f[1], 0]); q[q.length - 1][2] |= CLOSE | HOLE; }
      cs.push(...q);
    });
    const coords = `<coords count="${cs.length}">${cs.map(([x, y, f]) => `${x} ${y}${f ? ` ${f}` : ""};`).join("")}</coords>`;
    if (e.type === 1) return `<element><symbol type="2" code="">${lineXml({ color: w.col(e.color), width: um(e.lineWidth), join: joinOf(e.flags), cap: capOf(e.flags) })}</symbol><object type="1">${coords}</object></element>`;
    return `<element><symbol type="4" code=""><area_symbol inner_color="${w.col(e.color)}" min_area="0" patterns="0"/></symbol><object type="1">${coords}</object></element>`;
  });
  return ` ${head} elements="${rest.length}"${rest.length ? `>${rest.join("")}</point_symbol>` : "/>"}`;
}

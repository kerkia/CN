// The model of a vector map (OCAD, OpenOrienteering Mapper) and its drawing: a port of Purple Pen's Map, SymColor and Symbol
// (BSD licence, Copyright (c) 2006-2008 Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt). The colours are kept from
// the bottom to the top of the map's colour table, and drawn one at a time (OCAD's layering): every symbol that uses a colour
// draws its part in that colour, then the next colour up. A part of the colour table can be drawn alone (from after a colour,
// up to a colour), which lets the course's purple sit between the map's colours (Purple Pen's « layer » mode).

import { rectUnion, rectsMeet, bizarro, euclid, cmykToCss, cmykToHsv } from "./geom.js";

export class VColor {
  constructor(name, id, cmyk, overprint = false, layer = "normal") {
    this.name = name; this.id = id; this.cmyk = cmyk; this.overprint = overprint; this.layer = layer; this.special = layer !== "normal";
    this.css = cmyk ? cmykToCss(...cmyk) : "transparent";
  }
}

// ---- symbols ------------------------------------------------------------------------------------------------------------------
export class PointSymbol {
  constructor(def, x, y, angle = 0, gaps = null) { Object.assign(this, { def, x, y, angle, gaps }); this.bbox = def.bounds(x, y, angle); }
  draw(g, c) { this.def.draw(g, this.x, this.y, this.angle, this.gaps, c); }
}
export class LineSymbol {
  constructor(def, path) { this.def = def; this.path = path; this.bbox = def.bounds(path); }
  draw(g, c, ro) { this.def.draw(g, this.path, c, ro); }
}
export class AreaSymbol {
  constructor(def, area, angle = 0, rcx = 0, rcy = 0) { Object.assign(this, { def, area, angle, rcx, rcy }); this.bbox = def.bounds(area); }
  draw(g, c, ro) { this.def.draw(g, this.area, c, this.angle, this.rcx, this.rcy, ro); }
}
export class TextSymbol {
  /** lines: the object's text; width: 0 for unformatted text, else the width it is wrapped to. */
  constructor(def, lines, x, y, angle = 0, width = 0, h = 0, v = 0) {
    Object.assign(this, { def, text: lines, x, y, angle, width, h, v });
    this.layout();
  }
  layout() {
    const r = this.width > 0 ? this.def.wrap(this.text, this.width, this.h) : this.def.unwrapped(this.text);
    this.lines = r.lines; this.widths = r.widths;
    this.bbox = this.def.bounds(this.lines, this.widths, this.x, this.y, this.angle, this.width, this.h, this.v);
  }
  draw(g, c) { this.def.draw(g, this.lines, this.widths, this.x, this.y, this.angle, this.width, c, this.h, this.v); }
}
export class LineTextSymbol {
  constructor(def, path, text, h = 0, v = 0) { Object.assign(this, { def, path, text, h, v }); this.bbox = def.pathBounds(path); }
  draw(g, c) { this.def.drawOnPath(g, this.path, this.text, c, this.h, this.v); }
}
export class RectSymbol {
  constructor(def, x, y, w, h, rot) { Object.assign(this, { def, x, y, w, h, rot }); this.bbox = def.bounds(x, y, w, h, rot); }
  draw(g, c) { this.def.draw(g, this.x, this.y, this.w, this.h, this.rot, c); }
}
/** OCAD's « graphics » objects: a line or an area with its own colour. */
export class GraphicsLine {
  constructor(def, path, color, width, cap, join) { Object.assign(this, { def, path, color, width, cap, join }); const b = path.bbox, d = width / 2; this.bbox = [b[0] - d, b[1] - d, b[2] + d, b[3] + d]; }
  draw(g, c) { if (this.color && c === this.color) g.stroke(this.path.commands(), { color: c, width: this.width, cap: this.cap, join: this.join, miter: 5 }); }
}
export class GraphicsArea {
  constructor(def, area, color) { Object.assign(this, { def, area, color }); this.bbox = area.bbox; }
  draw(g, c) { if (this.color && c === this.color) g.fill(this.area.commands(), c); }
}
/** Image and layout objects: their own CMYK colour, drawn in the image layer (under the map) or the layout layer (over it). */
export class LayerLine {
  constructor(def, path, cmyk, width, cap, join, visible = true, order = 0) {
    Object.assign(this, { def, path, width, cap, join, visible, order }); this.color = new VColor("", -1, cmyk);
    const b = path.bbox, d = width / 2; this.bbox = [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
  }
  draw(g) { if (this.width > 0) g.stroke(this.path.commands(), { color: this.color, width: this.width, cap: this.cap, join: this.join, miter: 5 }); }
}
export class LayerArea {
  constructor(def, area, cmyk, visible = true, order = 0) { Object.assign(this, { def, area, visible, order }); this.color = new VColor("", -1, cmyk); this.bbox = area.bbox; }
  draw(g) { g.fill(this.area.commands(), this.color); }
}
export class LayerBitmap {
  /** An image of the layout (OCAD 11+): its top-left corner and size in mm, its file bytes. */
  constructor(def, x, y, w, h, bytes, type, visible = true, order = 0) {
    Object.assign(this, { def, x, y, w, h, visible, order }); this.bbox = [x, y - h, x + w, y];
    this.image = null;
    if (bytes && typeof createImageBitmap === "function") createImageBitmap(new Blob([bytes], { type })).then((im) => { this.image = im; }).catch(() => {});
    this.bytes = bytes; this.type = type;
  }
  draw(g) { if (this.image) g.image(this.image, this.bbox); }
}

// ---- the map ------------------------------------------------------------------------------------------------------------------
export class VMap {
  constructor() {
    this.colors = [];                           // bottom to top
    this.symdefs = [];
    this.scale = 10000; this.printScale = 0;
    this.useEuclid = false;
    this.realWorld = null;                      // { x, y, angle, grid, gridZone, on } (OCAD's real-world coordinates)
    this.printArea = null;
    this.imageColor = new VColor("image", -3, null, false, "image");
    this.layoutColor = new VColor("layout", -4, null, false, "layout");
    this.hideLayout = false;
    this.notes = [];                            // what could not be rendered as the file says
  }
  get metric() { return this.useEuclid ? euclid : bizarro; }
  addColor(c) { this.colors.push(c); return c; }
  addSymdef(d) { this.symdefs.push(d); d.finish?.(); return d; }
  add(sym) { if (sym) sym.def.symbols.push(sym); return sym; }
  /** The extent of everything drawn ([l, b, r, t], mm). */
  bounds() {
    let b = null;
    for (const d of this.symdefs) if (d.visible) for (const s of d.symbols) if (s.visible !== false && s.bbox && Number.isFinite(s.bbox[0])) b = rectUnion(b, s.bbox);
    return b || [0, 0, 100, 100];
  }
  /** The colour a colour id names, or null. */
  colorById(id) { return this.colors.find((c) => c.id === id) || null; }
  /**
   * Draw the part of the map in `rect` on a graphics target, one colour at a time. opts: { begin (draw the colours above this id),
   * end (up to and including this id), overprint (blend the colours flagged « overprint » darker, as printed), minRes (mm per
   * device pixel) }.
   */
  draw(g, rect, { begin = null, end = null, overprint = false, minRes = 0.05 } = {}) {
    const ro = { minRes, metric: this.metric, view: rect };
    let on = begin == null;
    if (on) this.drawColor(g, this.imageColor, rect, ro, false);
    for (const c of this.colors) {
      if (on) this.drawColor(g, c, rect, ro, overprint && c.overprint);
      if (!on && begin === c.id) on = true;
      if (on && end === c.id) on = false;
    }
    if (on && !this.hideLayout) this.drawColor(g, this.layoutColor, rect, ro, false);
  }
  drawColor(g, c, rect, ro, blend) {
    let any = false;
    for (const d of this.symdefs) {
      if (!d.visible || !d.hasColor(c)) continue;
      let list = d.symbols;
      if (d.sortSymbols) list = list.slice().sort((a, b) => a.order - b.order);
      for (const s of list) {
        if (s.visible === false || !s.bbox || !rectsMeet(s.bbox, rect)) continue;
        if (blend && !any) g.blend(true);
        any = true;
        try { s.draw(g, c, ro); } catch (e) { /* a broken object does not stop the map */ }
      }
    }
    g.flush?.();
    if (blend && any) g.blend(false);
  }

  // ---- the course's purple: Purple Pen's FindPurple ------------------------------------------------------------------------
  /** The map's purple closest to the IOF's, or null. */
  purple() {
    const iof = [0.35, 0.85, 0, 0];
    let best = null, bd = 1000;
    for (const c of this.colors) {
      if (!isPurple(...c.cmyk)) continue;
      const d = c.cmyk.reduce((s, v, i) => s + (v - iof[i]) ** 2, 0);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /** The colour the course's lower purple goes just above: the map's own lower purple (a purple below the top black that
   *  has the same purple above it), else the colour under the top-most solid green below the top black, else the top colour. */
  lowerPurpleLayer() {
    const cols = this.colors, same = (a, b) => a.every((v, i) => v === b[i]);
    const p = this.purple();
    if (p) {
      for (let i = Math.floor(cols.length / 2); i < cols.length; i++) {
        if (!same(cols[i].cmyk, p.cmyk)) continue;
        for (let j = i + 1; j < cols.length; j++) {
          if (!isBlack(...cols[j].cmyk)) continue;
          for (let l = j + 1; l < cols.length; l++) if (same(cols[l].cmyk, p.cmyk)) return { id: cols[i].id, exact: true };
        }
        break;
      }
    }
    let black = -1, green = -1;
    for (let i = cols.length - 1; i >= 0; i--) if (isBlack(...cols[i].cmyk)) { black = i; break; }
    if (black > 0) for (let i = black - 1; i >= 0; i--) if (isGreen(...cols[i].cmyk)) { green = i; break; }
    if (green > 0) return { id: cols[green - 1].id, exact: false };
    return cols.length ? { id: cols[cols.length - 1].id, exact: false } : null;
  }
}
export function isPurple(c, m, y, k) { const [h, s, v] = cmykToHsv(c, m, y, k); return h >= 0.7 && h <= 0.95 && s >= 0.5 && v >= 0.5; }
export function isGreen(c, m, y, k) { const [h, s, v] = cmykToHsv(c, m, y, k); return h >= 0.2 && h <= 0.45 && s >= 0.7 && v >= 0.5; }
export const isBlack = (c, m, y, k) => k > 0.95 && c < 0.05 && y < 0.05;

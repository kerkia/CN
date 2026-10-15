// OpenOrienteering Mapper maps (.omap, .xmap: XML, format versions 6 to 9) read into a vector map (map.js): a port of
// Purple Pen's OpenMapperImport and OpenMapperFileFormat (BSD licence, Copyright (c) 2006-2008 Peter Golde — see
// /assets/tracer/LICENSE-PurplePen.txt). Mapper's coordinates are thousandths of a mm with y down; its colours are ordered by
// priority (0 on top); its line, area and text symbols map onto OCAD's model, combined symbols onto groups of symbols.

import { VMap, VColor, PointSymbol, LineSymbol, AreaSymbol, TextSymbol } from "./map.js";
import { Glyph, PointSymDef, LineSymDef, AreaSymDef, TextSymDef, LineComboSymDef, AreaComboSymDef, SPACING, LOC, ROTATE, FILL, HALIGN, VALIGN, faceMetrics } from "./symdefs.js";
import { SymPath, PathWithHoles, K } from "./sympath.js";

const REG_BLACK = -900;
const CURVE = 1, HOLE = 16, DASH = 32;
export const isOom = (u8) => {
  const head = new TextDecoder().decode(u8.subarray(0, 600));
  return /<map[\s>]/.test(head) && /openorienteering|<\?xml/i.test(head);
};

const kids = (el, ...names) => [...el.children].filter((c) => !names.length || names.includes(c.localName));
const kid = (el, name) => kids(el, name)[0] || null;
const ai = (el, n, d = 0) => { const v = el?.getAttribute(n); if (v == null || v === "") return d; const x = parseInt(v, 10); return Number.isFinite(x) ? x : d; };
const af = (el, n, d = 0) => { const v = el?.getAttribute(n); if (v == null || v === "") return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
const ab = (el, n, d = false) => { const v = el?.getAttribute(n); return v == null ? d : v === "true" || v === "1"; };
const mm = (v) => v / 1000;
const rad2deg = (r) => (r * 180) / Math.PI;

/** Read a Mapper file into a VMap. Returns { map, version }. */
export function readOom(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(u8), "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "map") throw new Error("Ce n'est pas un fichier OpenOrienteering Mapper.");
  const version = ai(root, "version", 0);
  if (version < 6 || version > 9) throw new Error(`Fichier Mapper au format ${version} : seuls les formats 6 à 9 se lisent.`);
  const map = new VMap();
  map.useEuclid = true;
  const ctx = { map, colors: new Map(), defs: new Map(), delayed: [] };
  readElements(root, ctx);
  return { map, version };
}
function readElements(el, ctx) {
  for (const c of kids(el)) {
    switch (c.localName) {
      case "colors": readColors(c, ctx); break;
      case "barrier": if (c.getAttribute("required") === "0.6.0") readElements(c, ctx); break;
      case "symbols": readSymbols(c, ctx); break;
      case "parts": for (const p of kids(c, "part")) for (const os of kids(p, "objects")) for (const o of kids(os, "object")) createObject(o, ctx); break;
      case "georeferencing": readGeoref(c, ctx); break;
      case "print": { const s = af(c, "scale", -1); if (s > 0) ctx.map.printScale = s; break; }
    }
  }
}
function readColors(el, ctx) {
  const list = kids(el, "color").map((c) => {
    const sc = kid(c, "spotcolors");
    return { priority: ai(c, "priority"), name: c.getAttribute("name") || "", cmyk: ["c", "m", "y", "k"].map((k) => af(c, k)), knockout: ab(sc, "knockout", false) };
  });
  list.sort((a, b) => b.priority - a.priority);                   // the bottom of the table first
  ctx.colors.clear();
  for (const c of list) ctx.colors.set(c.priority, ctx.map.addColor(new VColor(c.name, c.priority, c.cmyk, !c.knockout)));
  ctx.colors.set(REG_BLACK, ctx.map.addColor(new VColor("Registration black", list.length ? list[0].priority + 1 : 1, [1, 1, 1, 1], false)));
}
const color = (ctx, id) => (id < 0 && id !== REG_BLACK ? null : ctx.colors.get(id) || null);
const joinOf = (v) => (v === 0 ? "bevel" : v === 1 ? "miter" : "round");
const capOf = (v) => (v === 1 ? "round" : v === 2 ? "square" : "butt");

function readGeoref(el, ctx) {
  const scale = af(el, "scale", 10000), gridScale = af(el, "grid_scale_factor", 1), grivation = af(el, "grivation", 0);
  ctx.map.scale = scale; ctx.map.printScale = scale;
  const ref = kid(el, "ref_point"), crs = kid(el, "projected_crs");
  const id = crs?.getAttribute("id") || "";
  const cref = crs ? kid(crs, "ref_point") : null;
  const gx = af(cref, "x", 0), gy = af(cref, "y", 0);
  const param = (kid(crs || el, "parameter")?.textContent || "").trim();
  const spec = crs ? kid(crs, "spec") : null;
  if (id === "Local" && !grivation && !gx && !gy) return;
  let x = -af(ref, "x", 0), y = af(ref, "y", 0);
  x *= (gridScale * scale) / 1000; y *= (gridScale * scale) / 1000;
  const a = (-grivation * Math.PI) / 180;
  const rw = { on: true, angle: grivation, x: x * Math.cos(a) - y * Math.sin(a) + gx, y: x * Math.sin(a) + y * Math.cos(a) + gy, gridScale, zone: 0 };
  if (id === "UTM") { const p = param.split(/\s+/).filter(Boolean); if (p.length) rw.zone = (p[1] && /^s/i.test(p[1]) ? -1 : 1) * (2000 + parseInt(p[0], 10)); }
  else if (id === "EPSG" && /^\d+$/.test(param)) rw.epsg = parseInt(param, 10);
  else if (spec && /proj/i.test(spec.getAttribute("language") || "")) rw.proj4 = spec.textContent.trim();
  ctx.map.realWorld = rw;
}

// ---- symbols ----------------------------------------------------------------------------------------------------------------
function readSymbols(el, ctx) {
  for (const s of kids(el, "symbol")) readSymbol(s, ctx);
  for (const d of ctx.delayed) createCombo(d, ctx);
  ctx.delayed = [];
}
function readSymbol(s, ctx) {
  const type = ai(s, "type"), id = ai(s, "id", -1), code = s.getAttribute("code") || "", name = s.getAttribute("name") || "";
  const hidden = ab(s, "is_hidden") || ab(s, "is_helper_symbol");
  let d = null;
  try {
    if (type === 1) { const ps = kid(s, "point_symbol"); if (ps) d = new PointSymDef(name, code, glyphOf(ps, ctx), ab(ps, "rotatable")); }
    else if (type === 2) { const ls = kid(s, "line_symbol"); if (ls) d = lineSymdef(name, code, ls, ctx); }
    else if (type === 4) { const as = kid(s, "area_symbol"); if (as) d = areaSymdef(name, code, as, ctx); }
    else if (type === 8) { const ts = kid(s, "text_symbol"); if (ts) d = textSymdef(name, code, ts, ctx); }
    else if (type === 16) { const cs = kid(s, "combined_symbol"); if (cs) ctx.delayed.push({ id, name, code, hidden, parts: kids(cs, "part").map((p) => (ab(p, "private") ? { def: kid(p, "symbol") ? readSymbol(kid(p, "symbol"), ctx) : null } : { ref: ai(p, "symbol", -1) })) }); return null; }
  } catch (e) { ctx.map.notes.push(`Symbole ${code} : ${e.message}`); }
  if (!d) return null;
  ctx.map.addSymdef(d);
  ctx.defs.set(id, d);
  if (hidden) d.visible = false;
  return d;
}
function createCombo(c, ctx) {
  if (c.def) return c.def;
  if (c.busy) return null;
  c.busy = true;
  const parts = c.parts.map((p) => p.def || ctx.defs.get(p.ref) || (ctx.delayed.find((x) => x.id === p.ref) ? createCombo(ctx.delayed.find((x) => x.id === p.ref), ctx) : null)).filter(Boolean);
  if (!parts.length) return null;
  const d = parts.every((p) => p instanceof LineSymDef) ? new LineComboSymDef(c.name, c.code, parts) : new AreaComboSymDef(c.name, c.code, parts);
  ctx.map.addSymdef(d); ctx.defs.set(c.id, d);
  if (c.hidden) d.visible = false;
  c.def = d;
  return d;
}
/** A point symbol's glyph: its own circle and dot, then each element (a point, line or area with its object). */
function glyphOf(ps, ctx) {
  const g = new Glyph();
  addElement(g, ps, null, ctx);
  for (const e of kids(ps, "element")) {
    const sym = kid(e, "symbol"), obj = kid(e, "object");
    const inner = sym ? kids(sym)[0] : null;
    if (inner) addElement(g, inner, obj, ctx);
  }
  return g.done();
}
function addElement(g, sym, obj, ctx) {
  if (sym.localName === "point_symbol") {
    let x = 0, y = 0;
    const cs = obj ? coordList(obj) : null;
    if (cs?.length) { x = cs[0].x; y = cs[0].y; }
    const ir = ai(sym, "inner_radius", 0), ic = ai(sym, "inner_color", -1), ow = ai(sym, "outer_width", 0), oc = ai(sym, "outer_color", -1);
    if (ic !== -1 && ir > 0) g.addDot(color(ctx, ic), mm(x), -mm(y), mm(ir) * 2);
    if (oc !== -1 && ow > 0) g.addCircle(color(ctx, oc), mm(x), -mm(y), mm(ow), 2 * mm(ir + ow));
  } else if (sym.localName === "line_symbol" && obj) {
    const c = ai(sym, "color", -1), w = ai(sym, "line_width", 0);
    if (c !== -1 && w > 0) { const p = pathOf(coordList(obj), { dashToCorner: true }); if (p) g.addLine(color(ctx, c), p.main, mm(w), joinOf(ai(sym, "join_style")), capOf(ai(sym, "cap_style"))); }
  } else if (sym.localName === "area_symbol" && obj) {
    const c = ai(sym, "inner_color", -1);
    if (c !== -1) { const p = pathOf(coordList(obj), { dashToCorner: true, close: true }); if (p) g.addArea(color(ctx, c), p); }
  }
}
const innerGlyph = (el, ctx) => { const s = el ? kid(el, "symbol") : null, ps = s ? kid(s, "point_symbol") : null; if (!ps) return null; const gl = glyphOf(ps, ctx); return gl.empty ? null : gl; };

function lineSymdef(name, code, ls, ctx) {
  const L = (n, d = 0) => ai(ls, n, d);
  const d = new LineSymDef(name, code, color(ctx, L("color", -1)), mm(L("line_width")), joinOf(L("join_style")), capOf(L("cap_style")));
  let dashAsCorner = true;
  const dashed = ab(ls, "dashed"), groups = L("dashes_in_group");
  if (dashed) {
    dashAsCorner = false;
    const di = { spacing: SPACING.OMDashes, dash: mm(L("dash_length")), gap: mm(L("break_length")) };
    if (ab(ls, "half_outer_dashes")) { di.first = di.last = di.dash / 2; di.halfClosed = false; }
    else { di.first = di.last = di.dash; di.halfClosed = groups !== 2; }
    if (groups >= 2) {
      di.secMid = di.secEnd = groups - 1;
      di.secMidLen = di.secEndLen = mm(L("in_group_break_length"));
      di.first = di.last = di.dash = di.dash * groups + di.secMidLen * (groups - 1);
    }
    d.setDashes(di);
  }
  const so = L("start_offset"), eo = L("end_offset"), cap = L("cap_style");
  if (so > 0 || eo > 0) d.shorten = { start: mm(so), end: mm(eo), pointy: cap === 3 };
  else if (cap === 3 && L("pointed_cap_length") > 0) d.shorten = { start: mm(L("pointed_cap_length")), end: mm(L("pointed_cap_length")), pointy: true };
  const bs = kid(ls, "borders"), borders = bs ? kids(bs, "border") : [];
  if (borders.length) {
    const b = borders[0], r = borders[1] || b;
    const dl = { fill: null, fillDashed: false, left: color(ctx, ai(b, "color", -1)), right: color(ctx, ai(r, "color", -1)),
      thick: mm(L("line_width")) - mm(ai(b, "width")) / 2 + mm(ai(b, "shift", 0)), leftWidth: mm(ai(b, "width")), rightWidth: mm(ai(r, "width")) };
    if (dashed) { dl.leftDashed = dl.rightDashed = true; dl.dashes = d.dashes; }
    else {
      dl.leftDashed = ab(b, "dashed"); dl.rightDashed = ab(r, "dashed");
      const src = ab(b, "dashed") ? b : ab(r, "dashed") ? r : null;
      if (src) { dashAsCorner = false; const L2 = mm(ai(src, "dash_length")); dl.dashes = { spacing: SPACING.OMDashes, dash: L2, first: L2, last: L2, gap: mm(ai(src, "break_length")), halfClosed: true, minGaps: 0, secMid: 0, secMidLen: 0, secEnd: 0, secEndLen: 0 }; }
    }
    d.double = dl;
  }
  const start = innerGlyph(kid(ls, "start_symbol"), ctx), mid = innerGlyph(kid(ls, "mid_symbol"), ctx), end = innerGlyph(kid(ls, "end_symbol"), ctx), dash = innerGlyph(kid(ls, "dash_symbol"), ctx);
  const glyphs = [];
  const base = { distance: 0, first: 0, last: 0, minimum: 0, number: 1, spacing: 0, offset: 0, decreaseLimit: 1, decreaseBoth: false, noScaleAtCorners: false };
  if (start) glyphs.push({ ...base, spacingMethod: SPACING.OMDashes, glyph: start, loc: LOC.Start });
  if (end) glyphs.push({ ...base, spacingMethod: SPACING.OMDashes, glyph: end, loc: LOC.End });
  if (dash) {
    const sup = ab(ls, "suppress_dash_symbol_at_ends");
    glyphs.push({ ...base, spacingMethod: SPACING.OMDashes, glyph: dash, loc: dashAsCorner ? (sup ? LOC.CornersIgnoreEnds : LOC.Corners) : (sup ? LOC.DashPointsIgnoreEnds : LOC.DashPoints), noScaleAtCorners: !ab(ls, "scale_dash_symbol", true) });
  }
  const place = L("mid_symbol_placement");
  if (mid && place >= 0 && place <= 2) {
    const per = L("mid_symbols_per_spot"), dist = mm(L("mid_symbol_distance"));
    const gi = { ...base, glyph: mid, number: per, spacing: dist };
    if (dashed) { gi.loc = place === 2 ? LOC.GapCenters : LOC.DashCenters; gi.spacingMethod = SPACING.OMDashes; }
    else {
      gi.spacingMethod = SPACING.OMMid; gi.loc = LOC.Spaced;
      gi.distance = Math.max(0.01, mm(L("segment_length")) + (per - 1) * dist);
      gi.first = gi.last = mm(L("end_length")) + ((per - 1) * dist) / 2;
      gi.minimum = ab(ls, "show_at_least_one_symbol") ? 1 : 0;
    }
    glyphs.push(gi);
  }
  if (glyphs.length) d.glyphs = glyphs;
  return d;
}
function areaSymdef(name, code, as, ctx) {
  const d = new AreaSymDef(name, code, color(ctx, ai(as, "inner_color", -1)), null);
  for (const p of kids(as, "pattern")) {
    const type = ai(p, "type"), angle = rad2deg(af(p, "angle", 0)), rotatable = ab(p, "rotatable");
    if (type === 1) {
      const c = ai(p, "color", -1);
      if (c < 0) continue;
      let offset = -mm(ai(p, "line_offset", 0));
      if (angle >= 179.999) offset = -offset;
      d.hatches.push({ color: color(ctx, c), width: mm(ai(p, "line_width")), spacing: mm(ai(p, "line_spacing")), angle, offset, rotate: rotatable ? ROTATE.Always : ROTATE.Never });
    } else {
      const glyph = innerGlyph(p, ctx);
      if (!glyph) continue;
      let ox = -mm(ai(p, "offset_along_line", 0)), oy = -mm(ai(p, "line_offset", 0));
      if (angle >= 179.999) oy = -oy;
      if (angle >= 90.001 && angle <= 270.001) ox = -ox;
      if ((angle >= 179.999 && angle <= 180.001) || Math.abs(angle) <= 0.001 || (angle >= 359.999 && angle <= 360.001)) ox = -ox;
      const nc = ai(p, "no_clipping", 0);
      d.patterns.push({ offsetRows: false, width: mm(ai(p, "point_distance")), height: mm(ai(p, "line_spacing")), angle, glyph, offsetX: ox, offsetY: oy,
        rotate: rotatable ? ROTATE.Always : ROTATE.Never, fillMode: nc === 1 ? FILL.CompletelyInside : nc === 2 ? FILL.CenterInside : nc === 3 ? FILL.PartiallyInside : FILL.Clip, irregular: false, varX: 0, varY: 0, minDist: 0 });
    }
  }
  return d;
}
function textSymdef(name, code, ts, ctx) {
  const f = kid(ts, "font"), t = kid(ts, "text"), fr = kid(ts, "framing"), lb = kid(ts, "line_below"), tabs = kid(ts, "tabs");
  const font = f?.getAttribute("family") || "Arial", size = mm(ai(f, "size", 4000)), bold = ab(f, "bold"), italic = ab(f, "italic"), under = ab(f, "underline");
  const d = new TextSymDef(name, code, "normal", null);
  const m = faceMetrics(font, size, bold, italic);
  let para = mm(ai(t, "paragraph_spacing", 0));
  if (lb) {
    const u = { on: true, color: color(ctx, ai(lb, "color", -1)), distance: mm(ai(lb, "distance", 0)), width: mm(ai(lb, "width", 0)) };
    if (u.color) d.underline = u;
    para += u.distance + u.width;
  }
  let tabList = tabs ? kids(tabs, "tab").map((x) => mm(parseInt(x.textContent, 10) || 0)) : null;
  d.setFont({ font, size, bold, italic, underlineEffect: under, color: color(ctx, ai(t, "color", -1)), lineSpacing: m.lineSpacing * af(t, "line_spacing", 1), paraSpacing: para,
    tabs: tabList, charSpacing: af(t, "character_spacing", 0), wordSpacing: 1, halign: HALIGN.Left, valign: VALIGN.TopAscent });
  if (!tabList) d.tabs = [d.m.width("aeiolnrs")];                    // Mapper's default tab: 8 average characters
  if (fr) {
    const c = color(ctx, ai(fr, "color", -1)), mode = ai(fr, "mode", 0);
    if (c && mode === 1) d.framing = { style: "line", color: c, width: mm(ai(fr, "line_half_width", 0)), lineStyle: "mitered" };
    else if (c && mode === 2) d.framing = { style: "shadow", color: c, dx: mm(ai(fr, "shadow_x_offset", 0)), dy: -mm(ai(fr, "shadow_y_offset", 0)) };
  }
  return d;
}

// ---- objects -------------------------------------------------------------------------------------------------------------------
/** The coordinates of an object: « x y flags; » text, or <coord> elements. */
function coordList(obj) {
  const cs = kid(obj, "coords");
  if (!cs) return [];
  const out = [];
  const els = kids(cs, "coord");
  if (els.length) for (const c of els) out.push({ x: ai(c, "x"), y: ai(c, "y"), flags: ai(c, "flags", 0) });
  else for (const part of cs.textContent.split(";")) {
    const v = part.trim().split(/\s+/).filter(Boolean).map((x) => parseInt(x, 10));
    if (v.length >= 2) out.push({ x: v[0], y: v[1], flags: v[2] || 0 });
  }
  return out;
}
/** A path (and its holes) from Mapper coordinates: a hole flag ends a part; curve starts make the next two points controls. */
function pathOf(coords, { dashToCorner = false, close = false } = {}) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < coords.length; i++) if (coords[i].flags & HOLE) { parts.push([start, i + 1]); start = i + 1; }
  if (start < coords.length) parts.push([start, coords.length]);
  const paths = [];
  for (const [s, e] of parts) {
    const n = e - s;
    if (n < 2) { paths.push(null); continue; }
    const p = [], k = new Array(n).fill(K.Normal);
    for (let i = s; i < e; i++) {
      const c = coords[i], j = i - s;
      p.push(mm(c.x), -mm(c.y));
      if (c.flags & DASH && k[j] === K.Normal) k[j] = dashToCorner ? K.Corner : K.Dash;
      if (c.flags & CURVE) { if (j + 1 < n) k[j + 1] = K.Bezier; if (j + 2 < n) k[j + 2] = K.Bezier; }
    }
    const forceClose = close && (p[0] !== p[p.length - 2] || p[1] !== p[p.length - 1]);
    if (forceClose) { p.push(p[0], p[1]); k.push(k[0]); }
    try { paths.push(new SymPath(p, k, null, forceClose)); } catch (err) { paths.push(null); }
  }
  if (!paths[0]) return null;
  return new PathWithHoles(paths[0], paths.slice(1).filter(Boolean));
}
function createObject(o, ctx) {
  const def = ctx.defs.get(ai(o, "symbol", -1));
  if (!def) return;
  const coords = coordList(o), rot = rad2deg(af(o, "rotation", 0));
  const pat = kid(o, "pattern");
  const map = ctx.map;
  if (def instanceof PointSymDef) {
    if (coords.length) map.add(new PointSymbol(def, mm(coords[0].x), -mm(coords[0].y), rot, null));
  } else if (def.kind === "line") {
    const p = pathOf(coords, { dashToCorner: !def.hasDashes });
    if (p) map.add(new LineSymbol(def, p.main));
  } else if (def.kind === "area") {
    const p = pathOf(coords, { dashToCorner: !def.hasDashes, close: true });
    if (!p) return;
    let angle = rot, rcx = 0, rcy = 0;
    if (pat) { angle = rad2deg(af(pat, "rotation", 0)); const pc = kid(pat, "coord"); if (pc) { rcx = mm(ai(pc, "x")); rcy = -mm(ai(pc, "y")); } }
    map.add(new AreaSymbol(def, p, angle, rcx, rcy));
  } else if (def instanceof TextSymDef) {
    const text = (kid(o, "text")?.textContent || "").split(/\r\n|\r|\n/);
    const ha = ai(o, "h_align", 0), va = ai(o, "v_align", 0);
    const h = ha === 1 ? HALIGN.Center : ha === 2 ? HALIGN.Right : HALIGN.Left;
    const v = va === 0 ? VALIGN.Baseline : va === 1 ? VALIGN.TopAscent : va === 2 ? VALIGN.MidpointAllLines : va === 3 ? VALIGN.BaselineLast : VALIGN.TopAscent;
    const size = kid(o, "size");
    if (!coords.length) return;
    const cx = mm(coords[0].x), cy = -mm(coords[0].y);
    if (coords.length === 1 && !size) { map.add(new TextSymbol(def, text, cx, cy, rot, 0, h, v)); return; }
    const w = size ? mm(ai(size, "width")) : mm(coords[1].x), ht = size ? mm(ai(size, "height")) : mm(coords[1].y);
    const move = ([x, y], dd, a) => [x + dd * Math.cos((a * Math.PI) / 180), y + dd * Math.sin((a * Math.PI) / 180)];
    let loc = [cx, cy];
    if (h === HALIGN.Left) loc = move(loc, -w / 2, rot); else if (h === HALIGN.Right) loc = move(loc, w / 2, rot);
    if (v === VALIGN.TopAscent || v === VALIGN.Baseline) loc = move(loc, ht / 2, rot + 90);
    else if (v === VALIGN.BaselineLast) loc = move(loc, -ht / 2, rot + 90);
    map.add(new TextSymbol(def, text, loc[0], loc[1], rot, w, h, v));
  }
}

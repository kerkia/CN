// OpenOrienteering Mapper maps (.omap, .xmap: XML, format versions 6 to 9) read into Cartographier's document (docs/mapper/
// model.md): OCAD's own records, in OCAD 9+ numbering and units, as tracer/vmap/ocad.js reads them. The file format as
// tracer/vmap/oom.js reads it (a port of Purple Pen's OpenMapperImport, BSD); nothing of Mapper's own code (GPL). Mapper counts in
// thousandths of a mm with y down, angles in radians, its colours from the top of the table (priority 0); OCAD in hundredths of a
// mm with y up, tenths of a degree, colours from the bottom. What one OCAD record cannot hold is spread over several, each object
// put on each of them: a combined symbol's parts (an area and its line become an area with its border line), an area's third
// pattern, a text symbol's alignments (OCAD aligns a text by its symbol, Mapper by its object: one record per alignment used).
// Notes `omap` on the records and objects (the Mapper symbol and object they came from) and on the document (each Mapper symbol's
// XML, the colours', the georeferencing's) let toomap.js write the map back as it was.

import { compileSymbol, makeContext } from "../tracer/vmap/ocad.js";
import { TextSymDef, faceMetrics, HALIGN, VALIGN } from "../tracer/vmap/symdefs.js";
import { t } from "./lang.js";

const VERSION = 2018;                                  // the OCAD version the records are written for (alignments, fill modes)
const CURVE = 1, HOLE = 16, DASH = 32;                 // Mapper's coordinate flags (2 close point: implied by OCAD)
const REG_BLACK = -900;

// ---- XML helpers -----------------------------------------------------------------------------------------------------------
/** Child elements (xmldom has no `children`). */
export const kids = (el, ...names) => {
  const out = [];
  for (let n = el?.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!names.length || names.includes(n.localName))) out.push(n);
  return out;
};
export const kid = (el, name) => kids(el, name)[0] || null;
const attr = (el, n) => (el && el.hasAttribute?.(n) ? el.getAttribute(n) : null);
const ai = (el, n, d = 0) => { const v = attr(el, n); if (v == null || v === "") return d; const x = parseInt(v, 10); return Number.isFinite(x) ? x : d; };
const af = (el, n, d = 0) => { const v = attr(el, n); if (v == null || v === "") return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
const ab = (el, n, d = false) => { const v = attr(el, n); return v == null ? d : v === "true" || v === "1"; };
const escT = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const escA = (s) => String(s).replace(/[&<>"\n\r\t]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\n": "&#10;", "\r": "&#13;", "\t": "&#9;" })[c]);
/** An element as XML text (no namespace declarations: the map's own is implied). */
export function xmlOf(n) {
  if (n.nodeType === 3) return escT(n.nodeValue);
  if (n.nodeType === 4) return escT(n.nodeValue);
  if (n.nodeType !== 1) return "";
  let s = `<${n.localName}`;
  for (let i = 0; i < n.attributes.length; i++) { const a = n.attributes[i]; if (a.name !== "xmlns" && !a.name.startsWith("xmlns:")) s += ` ${a.name}="${escA(a.value)}"`; }
  let inner = "";
  for (let c = n.firstChild; c; c = c.nextSibling) inner += xmlOf(c);
  return inner ? `${s}>${inner}</${n.localName}>` : `${s}/>`;
}

// ---- units ------------------------------------------------------------------------------------------------------------------
const rnd = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));       // half away from zero: a symbol stays symmetric
const hu = (um) => rnd(um / 10);                                      // Mapper's µm → OCAD's hundredths of a mm
const tenths = (rad) => rnd((rad * 1800) / Math.PI);                  // radians → tenths of a degree
const ptOf = (xh, yh, xf = 0, yf = 0) => ({ x: xh * 256 + xf, y: yh * 256 + yf });
const ptMm = (xmm, ymm, xf = 0, yf = 0) => ptOf(rnd(xmm * 100), rnd(ymm * 100), xf, yf);
/** An OCAD symbol number (number × 1000 + sub) from a Mapper code (« 101 », « 101.1 », « 506.1.2 » → 506001), or null. */
export function codeNum(code) {
  const m = /^\s*(\d{1,5})(?:\.(\d{1,3}))?/.exec(code || "");
  return m ? Number(m[1]) * 1000 + (m[2] ? Number(m[2]) : 0) : null;
}

/** Mapper coordinates of an object: « x y flags; » text, or <coord> elements. */
export function coordList(obj) {
  const cs = kid(obj, "coords");
  if (!cs) return [];
  const els = kids(cs, "coord"), out = [];
  if (els.length) for (const c of els) out.push({ x: ai(c, "x"), y: ai(c, "y"), flags: ai(c, "flags", 0) });
  else for (const part of cs.textContent.split(";")) {
    const v = part.trim().split(/\s+/).filter(Boolean).map((x) => parseInt(x, 10));
    if (v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) out.push({ x: v[0], y: v[1], flags: v[2] || 0 });
  }
  return out;
}
/**
 * Mapper coordinates as OCAD's, part by part (a hole flag ends a part): the two points after a curve start are OCAD's bezier
 * controls (x flags 1 and 2), a dash point becomes OCAD's `dashFlag` (y flag 1 corner, or 8 dash point). Parts of one point left
 * out (Mapper draws nothing of them either).
 */
export function ocadParts(list, dashFlag = 1, noEndDash = false) {
  const parts = [];
  let cur = [], pending = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    let xf = 0, yf = 0;
    if (pending > 0) { xf = pending === 2 ? 1 : 2; pending--; }
    else {
      if (c.flags & DASH) yf |= dashFlag;
      if (c.flags & CURVE) pending = 2;
    }
    cur.push(ptOf(hu(c.x), hu(-c.y), xf, yf));
    if (c.flags & HOLE) { if (cur.length >= 2) parts.push(cur); cur = []; pending = 0; }
  }
  if (cur.length >= 2) parts.push(cur);
  if (noEndDash) for (const p of parts) for (const c of [p[0], p[p.length - 1]]) c.y = (c.y & ~0xff) | (c.y & 0xff & ~9);
  return parts.map(wholeCurves);
}
/** A curve cut short by the end of a part loses its controls (as OCAD's reader would drop them). */
function wholeCurves(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c.x & 1) {
      if (i + 2 < p.length && p[i + 1].x & 2 && !(p[i + 2].x & 3)) { out.push(c, p[i + 1]); i++; }
      else if (p[i + 1]?.x & 2) i++;
      continue;
    }
    if (!(c.x & 2)) out.push(c);
  }
  return out;
}
/** The parts of an area as one OCAD list: the first point of each hole flagged (y flag 2). */
const areaCoords = (parts) => parts.flatMap((p, k) => p.map((c, i) => (k > 0 && i === 0 ? { x: c.x, y: c.y | 2 } : c)));

// ---- the document -----------------------------------------------------------------------------------------------------------
/** Read a Mapper file (bytes) into a document. Its `omap` note holds what toomap.js needs to write it back. */
export function omapToDoc(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let xml;
  try { xml = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(u8), "application/xml"); } catch (e) { throw new Error(t("map.omap.badXml")); }
  const root = xml?.documentElement;
  if (!root || root.localName !== "map" || kids(root, "parsererror").length || xml.getElementsByTagName("parsererror").length) throw new Error(t("map.omap.notOmap"));
  const version = ai(root, "version", 0);
  if (version < 6 || version > 9) throw new Error(t("map.omap.version", { v: version }));

  const doc = {
    format: "ozimut-map", version: 1, title: "", ocad: null,
    scale: 10000, printScale: 10000, printArea: null,
    realWorld: { x: 0, y: 0, angle: 0, grid: 0, paperGrid: 0, on: false, zone: 0 }, declination: 0, standard: null,
    colors: [], symbols: [], objects: [], params: [], parts: [], backgrounds: [], layoutImages: [],
    omap: { version, notes: "", symbols: {}, georef: null, print: null, symbolSet: null, losses: [] },
  };
  const st = { doc, byId: new Map(), plans: new Map(), nums: new Set(), oid: 0, losses: new Map(), defs: new Map(), mdefs: new Map(), regNum: 0, usesReg: false, scratch: null };
  // the elements this reader uses, wherever the barrier of 0.6.0 puts them
  const els = { colors: null, symbols: null, parts: null, georeferencing: null, print: null, notes: null };
  (function walk(el) {
    for (const c of kids(el)) {
      if (c.localName === "barrier") { if (c.getAttribute("required") === "0.6.0") walk(c); }
      else if (c.localName in els && !els[c.localName]) els[c.localName] = c;
    }
  })(root);
  doc.omap.notes = els.notes?.textContent || "";
  if (els.colors) readColors(els.colors, st);
  if (els.georeferencing) readGeoref(els.georeferencing, doc);
  if (els.print) readPrint(els.print, doc);
  st.scratch = makeContext(VERSION, doc.colors);
  st.textUse = textUse(els.parts);
  if (els.symbols) readSymbols(els.symbols, st);
  if (st.usesReg) doc.colors.push({ num: st.regNum, name: "Registration black", cmyk: [1, 1, 1, 1], overprint: false, omap: { reg: true } });
  if (els.parts) readParts(els.parts, st);
  doc.omap.losses = [...st.losses.values()];
  for (const s of doc.symbols) finishSymbol(s);
  return doc;
}
function loss(st, key, code) { const k = `${key}|${code}`; if (!st.losses.has(k)) st.losses.set(k, { key: `map.omap.loss.${key}`, sym: code }); }

function readColors(el, st) {
  const list = kids(el, "color").map((c) => ({ p: ai(c, "priority"), name: c.getAttribute("name") || "", cmyk: ["c", "m", "y", "k"].map((k) => af(c, k)),
    knockout: ab(kid(c, "spotcolors"), "knockout", false), xml: xmlOf(c) }));
  list.sort((a, b) => b.p - a.p);                                    // the bottom of the table first
  // the source's colour kept with what it said (toomap.js writes it back as it came while it says the same)
  st.doc.colors = list.map((c) => ({ num: c.p, name: c.name, cmyk: c.cmyk, overprint: !c.knockout, omap: { xml: c.xml, p: c.p, sig: JSON.stringify([c.name, c.cmyk, !c.knockout]) } }));
  st.regNum = list.length ? Math.max(...list.map((c) => c.p)) + 1 : 0;
}
/** A Mapper colour id as an OCAD colour number (-1 none). */
function col(st, id) {
  if (id === REG_BLACK) { st.usesReg = true; return st.regNum; }
  return id < 0 ? -1 : id;
}

function readGeoref(el, doc) {
  doc.omap.georef = xmlOf(el);
  const scale = af(el, "scale", 10000), grivation = af(el, "grivation", 0);
  const gridScale = attr(el, "grid_scale_factor") != null ? af(el, "grid_scale_factor", 1) : af(el, "auxiliary_scale_factor", 1);
  doc.scale = scale; doc.printScale = scale;
  doc.declination = af(el, "declination", 0);
  const ref = kid(el, "ref_point"), crs = kid(el, "projected_crs");
  const id = crs?.getAttribute("id") || "";
  const cref = crs ? kid(crs, "ref_point") : null;
  const gx = af(cref, "x", 0), gy = af(cref, "y", 0);
  const param = (kid(crs || el, "parameter")?.textContent || "").trim();
  const spec = crs ? kid(crs, "spec") : null;
  if (/^Local/.test(id) && !grivation && !gx && !gy) return;
  // the paper's origin in the grid (oom.js's readGeoref, Purple Pen's Map.CheckRealWorldCoords)
  let x = -af(ref, "x", 0), y = af(ref, "y", 0);
  x *= (gridScale * scale) / 1000; y *= (gridScale * scale) / 1000;
  const a = (-grivation * Math.PI) / 180;
  const rw = { x: x * Math.cos(a) - y * Math.sin(a) + gx, y: x * Math.sin(a) + y * Math.cos(a) + gy, angle: grivation, grid: 0, paperGrid: 0, on: true, zone: 0, gridScale };
  if (id === "UTM") { const p = param.split(/\s+/).filter(Boolean); if (p.length) rw.zone = (p[1] && /^s/i.test(p[1]) ? -1 : 1) * (2000 + parseInt(p[0], 10)); }
  else if (id === "EPSG" && /^\d+$/.test(param)) rw.epsg = parseInt(param, 10);
  else if (spec && /proj/i.test(spec.getAttribute("language") || "")) rw.proj4 = spec.textContent.trim();
  doc.realWorld = rw;
}
function readPrint(el, doc) {
  doc.omap.print = xmlOf(el);
  const s = af(el, "scale", -1);
  if (s > 0) doc.printScale = s;
  const a = kid(el, "print_area");
  if (a) { const l = af(a, "left"), tp = af(a, "top"), w = af(a, "width"), h = af(a, "height"); doc.printArea = [l, -(tp + h), l + w, -tp]; }
}

// ---- symbols -----------------------------------------------------------------------------------------------------------------
/** The IOF standard a symbol set's name gives (Mapper names its sets « ISOM 2017-2 », « ISSprOM 2019-2 »…). */
const STANDARDS = [[/ISSprOM/i, "ISSprOM2019-2"], [/ISSkiOM/i, "ISSkiOM2019"], [/ISMTBOM/i, "ISMTBOM2022"], [/ISOM\s*2017/i, "ISOM2017-2"]];
function readSymbols(el, st) {
  st.doc.omap.symbolSet = el.getAttribute("id") || null;
  st.doc.standard = STANDARDS.find(([re]) => re.test(st.doc.omap.symbolSet || ""))?.[1] || null;
  const list = kids(el, "symbol");
  for (const s of list) { const id = ai(s, "id", -1); if (id >= 0) st.byId.set(id, s); }
  // each symbol's own code first (in the file's order), the records it needs besides after
  for (const s of list) { const n = codeNum(s.getAttribute("code")); if (n != null && !st.nums.has(n)) { st.nums.add(n); s._num = n; } }
  for (const s of list) {
    const id = ai(s, "id", -1);
    st.doc.omap.symbols[id] = { type: ai(s, "type"), code: s.getAttribute("code") || "", name: s.getAttribute("name") || "", xml: xmlOf(s),
      parts: ai(s, "type") === 16 ? kids(kid(s, "combined_symbol"), "part").map((p) => (ab(p, "private") ? null : ai(p, "symbol", -1))) : undefined };
  }
  for (const s of list) planOf(st, ai(s, "id", -1));
}
/** A free OCAD symbol number at or after `want` (else in the 900s, for codes that are no number). */
function alloc(st, want) {
  let n = want ?? 900000;
  while (st.nums.has(n)) n++;
  st.nums.add(n);
  return n;
}
function head(st, s, { num, name, hidden, otp }) {
  const status = (hidden ? 2 : 0) | (ab(s, "is_protected") ? 1 : 0);
  return { sym: num, otp, symTp: 0, flags: 0, extent: 0, selected: 0, status, description: name ?? (s.getAttribute("name") || ""), nColors: 0 };
}
const hiddenOf = (s) => ab(s, "is_hidden") || ab(s, "is_helper_symbol");

/** The plan of a Mapper symbol: { kind: point|line|area|text|combo, recs (OCAD records), … }. */
function planOf(st, id, seen = new Set()) {
  if (st.plans.has(id)) return st.plans.get(id);
  const s = st.byId.get(id);
  if (!s || seen.has(id)) return null;
  seen.add(id);
  const num = s._num ?? alloc(st, codeNum(s.getAttribute("code")));
  s._num = num;
  const plan = leafPlan(st, s, { num, omapId: id, hidden: hiddenOf(s), seen });
  if (plan) st.plans.set(id, plan);
  return plan;
}
/** A symbol element made into records: `omapId` the Mapper symbol (a private part's id is « combo/k »). */
function leafPlan(st, s, { num, omapId, hidden, role = "main", name, seen = new Set() }) {
  const type = ai(s, "type"), code = s.getAttribute("code") || "";
  const opt = { num, name: name ?? (s.getAttribute("name") || ""), hidden, omapId, role, code };
  try {
    if (type === 1) { const ps = kid(s, "point_symbol"); return ps ? { kind: "point", recs: [add(st, pointRec(st, s, ps, opt), opt)], hidden } : null; }
    if (type === 2) { const ls = kid(s, "line_symbol"); return ls ? { kind: "line", recs: [add(st, lineRec(st, s, ls, opt), opt)], hidden } : null; }
    if (type === 4) { const as = kid(s, "area_symbol"); return as ? { kind: "area", recs: areaRecs(st, s, as, opt).map((r, k) => add(st, r, { ...opt, role: k ? "pattern" : role })), hidden } : null; }
    if (type === 8) { const ts = kid(s, "text_symbol"); return ts ? textPlan(st, s, ts, opt) : null; }
    if (type === 16) return comboPlan(st, s, opt, seen);
  } catch (e) { loss(st, "symbol", code); }
  return null;
}
function add(st, rec, { omapId, role }) {
  rec.omap = { id: omapId, role, ...rec._omap };
  delete rec._omap;
  st.doc.symbols.push(rec);
  return rec;
}
/** A record copied for a combined symbol that cannot share it (another visibility, a border of its own). */
function copyRec(st, rec, { omapId, num, hidden, name, role }) {
  const { id, role: r0, ...keep } = rec.omap || {};
  const c = JSON.parse(JSON.stringify({ ...rec, omap: undefined, _omap: keep }));
  c.sym = num; c.status = (c.status & ~2) | (hidden ? 2 : 0);
  if (name != null) c.description = name;
  return add(st, c, { omapId, role });
}

// ---- point symbols ----
/** The elements of a Mapper point symbol as OCAD's: its own dot and ring, then each element's point, line or area. */
function eltsOf(st, ps) {
  const out = [];
  ring(st, ps, 0, 0, out);
  for (const e of kids(ps, "element")) {
    const sym = kid(e, "symbol"), obj = kid(e, "object");
    const inner = sym ? kids(sym, "point_symbol", "line_symbol", "area_symbol")[0] : null;
    if (!inner) continue;
    const cs = obj ? coordList(obj) : [];
    if (inner.localName === "point_symbol") ring(st, inner, cs[0]?.x || 0, cs[0]?.y || 0, out);
    else if (inner.localName === "line_symbol") {
      const c = ai(inner, "color", -1), w = ai(inner, "line_width", 0);
      const p = ocadParts(cs, 1)[0];
      if (c !== -1 && w > 0 && p) out.push(elt(1, endsOf(ai(inner, "join_style"), ai(inner, "cap_style")) & ~2, col(st, c), hu(w), 0, p));
    } else {
      const c = ai(inner, "inner_color", -1), parts = ocadParts(cs, 1);
      if (c !== -1 && parts.length) out.push(elt(2, 0, col(st, c), 0, 0, areaCoords(parts)));
    }
  }
  return out;
}
const elt = (type, flags, color, lineWidth, diameter, coords) => ({ type, flags, color, lineWidth, diameter, nPoly: coords.length, coords });
/** A Mapper point's disc (inner radius) and ring (outer width): OCAD's dot and circle (OCAD 9+: the diameter to the middle of the
 *  ring's line); a ring with no inner radius is a disc. */
function ring(st, ps, x, y, out) {
  const ir = ai(ps, "inner_radius", 0), ic = ai(ps, "inner_color", -1), ow = ai(ps, "outer_width", 0), oc = ai(ps, "outer_color", -1);
  const at = [ptOf(hu(x), hu(-y))];
  if (ic !== -1 && ir > 0) out.push(elt(4, 0, col(st, ic), 0, hu(2 * ir), at));
  if (oc !== -1 && ow > 0) out.push(ir > 0 ? elt(3, 0, col(st, oc), hu(ow), hu(2 * ir + ow), at) : elt(4, 0, col(st, oc), 0, hu(2 * ow), at));
}
const eltSize = (elts) => elts.reduce((n, e) => n + 2 + e.coords.length, 0);
function pointRec(st, s, ps, opt) {
  const r = head(st, s, { ...opt, otp: 1 });
  r.flags = ab(ps, "rotatable") ? 1 : 0;
  r.elts = eltsOf(st, ps);
  r.dataSize = eltSize(r.elts);
  return r;
}
const innerPoint = (el) => { const s = el ? kid(el, "symbol") : null; return s ? kid(s, "point_symbol") : null; };

// ---- line symbols ----
/** OCAD's line ends (1 round, 2 pointed, 4 miter) from Mapper's join (0 bevel, 1 miter, 2 round) and cap (0 flat, 1 round,
 *  2 square, 3 pointed): OCAD rounds both ends and corners or neither. */
const endsOf = (join, cap) => ((join === 2 || cap === 1 ? 1 : join === 1 ? 4 : 0) | (cap === 3 ? 2 : 0));
const LINE0 = () => ({ lineColor: 0, lineWidth: 0, lineEnds: 0, distFromStart: 0, distToEnd: 0, mainLength: 0, endLength: 0, mainGap: 0, secGap: 0, endGap: 0,
  minSym: 0, nPrimSym: 0, primSymDist: 0, dblMode: 0, dblFlags: 0, dblFillColor: 0, dblLeftColor: 0, dblRightColor: 0, dblWidth: 0, dblLeftWidth: 0,
  dblRightWidth: 0, dblLength: 0, dblGap: 0, decMode: 0, decLast: 0, decSymbolDistance: true, decSymbolWidth: false, frColor: 0, frWidth: 0, frStyle: 0,
  primDSize: 0, secDSize: 0, cornerDSize: 0, startDSize: 0, endDSize: 0, useSymbolFlags: 0, prim: [], sec: [], corner: [], start: [], end: [] });
function lineRec(st, s, ls, opt) {
  const r = Object.assign(head(st, s, { ...opt, otp: 2 }), LINE0());
  const L = (n, d = 0) => ai(ls, n, d), code = opt.code;
  const color = L("color", -1), width = L("line_width"), join = L("join_style"), cap = L("cap_style");
  if (color !== -1 && width > 0) { r.lineColor = col(st, color); r.lineWidth = hu(width); }
  r.lineEnds = endsOf(join, cap);
  if (cap === 2 && r.lineWidth) loss(st, "capSquare", code);
  if (r.lineWidth) {
    const round = (r.lineEnds & 1) !== 0;
    if ((round ? 2 : join) !== join || (cap <= 1 && (round ? 1 : 0) !== cap)) loss(st, "joinCap", code);
  }
  const so = L("start_offset"), eo = L("end_offset");
  if (so > 0 || eo > 0) { r.distFromStart = hu(so); r.distToEnd = hu(eo); }
  else if (cap === 3 && L("pointed_cap_length") > 0) r.distFromStart = r.distToEnd = hu(L("pointed_cap_length"));
  const dashed = ab(ls, "dashed"), groups = L("dashes_in_group", 1);
  let groupLen = 0;
  if (dashed) {
    const dash = L("dash_length"), ig = L("in_group_break_length");
    groupLen = groups >= 2 ? dash * groups + ig * (groups - 1) : dash;
    if (groups >= 2) { r.secGap = hu(ig); r.endGap = hu(ig); if (groups > 2) loss(st, "dashGroups", code); }
    r.mainLength = hu(groupLen); r.mainGap = hu(L("break_length"));
    r.endLength = ab(ls, "half_outer_dashes") ? hu(groupLen / 2) : hu(groupLen);
  }
  // borders: OCAD's double line (oom.js's reading: the gap between the borders' inner edges is the line's width less half the
  // first border's width, plus its shift; the main line stays the main line)
  const bs = kids(kid(ls, "borders"), "border");
  if (bs.length) {
    const b = bs[0], rb = bs[1] || b;
    r.dblMode = 1;
    r.dblWidth = hu(width - ai(b, "width") / 2 + ai(b, "shift", 0));
    const lc = ai(b, "color", -1), rc = ai(rb, "color", -1);
    r.dblLeftColor = lc === -1 ? 0 : col(st, lc); r.dblLeftWidth = lc === -1 ? 0 : hu(ai(b, "width"));
    r.dblRightColor = rc === -1 ? 0 : col(st, rc); r.dblRightWidth = rc === -1 ? 0 : hu(ai(rb, "width"));
    if (bs[1] && ai(rb, "shift", 0) !== ai(b, "shift", 0)) loss(st, "borders", code);
    if (dashed) { r.dblMode = 3; r.dblLength = hu(groupLen); r.dblGap = r.mainGap; }
    else {
      const ld = ab(b, "dashed"), rd = ab(rb, "dashed");
      if (ld || rd) {
        const src = ld ? b : rb;
        r.dblLength = hu(ai(src, "dash_length")); r.dblGap = hu(ai(src, "break_length"));
        r.dblMode = ld && rd ? 3 : ld ? 2 : 3;
        if (rd && !ld) loss(st, "borders", code);
      }
    }
  }
  // symbols along the line
  const glyph = (name) => { const ps = innerPoint(kid(ls, name)); const e = ps ? eltsOf(st, ps) : []; return e.length ? e : null; };
  const start = glyph("start_symbol"), end = glyph("end_symbol"), dash = glyph("dash_symbol"), mid = glyph("mid_symbol");
  if (start) { r.start = start; r.useSymbolFlags |= 2; }
  if (end) { r.end = end; r.useSymbolFlags |= 1; }
  if (dash) {
    r.corner = dash; r.useSymbolFlags |= 4;
    // OCAD draws its corner symbol at a path's ends too: the objects' ends are no dash points there
    if (ab(ls, "suppress_dash_symbol_at_ends")) r._omap = { noEndDash: true };
  }
  const place = L("mid_symbol_placement", 0);
  if (mid && place >= 0 && place <= 2) {
    const per = Math.max(1, L("mid_symbols_per_spot", 1)), dist = L("mid_symbol_distance");
    r.prim = mid; r.nPrimSym = per; r.primSymDist = hu(dist);
    if (!dashed) {
      // OCAD's spaced symbols: every main length, the first an end length from the start (oom.js: segment and end lengths
      // with the spread of the symbols of one spot)
      r.mainLength = hu(Math.max(10, L("segment_length") + (per - 1) * dist)); r.endLength = hu(L("end_length") + ((per - 1) * dist) / 2);
      r.minSym = Math.max(0, L("minimum_mid_symbol_count") - 1);
      if (!ab(ls, "show_at_least_one_symbol")) loss(st, "midMin", code);
    } else if (place !== 2) loss(st, "midDash", code);
  }
  r.primDSize = eltSize(r.prim); r.cornerDSize = eltSize(r.corner); r.startDSize = eltSize(r.start); r.endDSize = eltSize(r.end);
  return r;
}
/** The OCAD flag a Mapper dash point becomes on a line record: a corner (where OCAD draws its corner symbol, and where an
 *  undashed line's pattern restarts — oom.js reads it so), or a dash point of a dashed line. */
function dashFlagOf(rec) {
  if (!rec || rec.otp !== 2) return 1;
  if (rec.corner?.length) return 1;
  return rec.mainGap > 0 || rec.secGap > 0 || rec.dblMode > 1 ? 8 : 1;
}

// ---- area symbols ----
function areaRecs(st, s, as, opt) {
  const code = opt.code, fill = ai(as, "inner_color", -1);
  const hatches = [], points = [];
  for (const p of kids(as, "pattern")) {
    const type = ai(p, "type");
    if (type === 1) {
      const c = ai(p, "color", -1);
      if (c < 0) continue;
      hatches.push({ el: p, color: col(st, c), width: hu(ai(p, "line_width")), dist: hu(ai(p, "line_spacing")), angle: tenths(af(p, "angle", 0)),
        rot: ab(p, "rotatable"), off: ai(p, "line_offset", 0) });
    } else {
      const ps = innerPoint(p), elts = ps ? eltsOf(st, ps) : [];
      if (!elts.length) continue;
      points.push({ el: p, elts, key: JSON.stringify(elts), w: ai(p, "point_distance"), h: ai(p, "line_spacing"), angle: tenths(af(p, "angle", 0)),
        rot: ab(p, "rotatable"), draw: ai(p, "no_clipping", 0), lo: ai(p, "line_offset", 0), oa: ai(p, "offset_along_line", 0) });
    }
  }
  const area = () => ({ borderSym: 0, fillColor: 0, hatchMode: 0, hatchColor: 0, hatchLineWidth: 0, hatchDist: 0, hatchAngle1: 0, hatchAngle2: 0,
    fillOn: false, borderOn: false, structMode: 0, structDraw: 0, structWidth: 0, structHeight: 0, structAngle: 0, irrX: 0, irrY: 0, irrMin: 0, dataSize: 0, elts: [] });
  const recs = [];
  const make = (num) => { const r = Object.assign(head(st, s, { ...opt, num, otp: 3 }), area()); recs.push(r); return r; };
  const main = make(opt.num);
  if (fill !== -1) { main.fillColor = col(st, fill); main.fillOn = true; }
  // hatching: one or two lines of one colour, width and spacing a record
  const setHatch = (r, a, b) => {
    Object.assign(r, { hatchMode: b ? 2 : 1, hatchColor: a.color, hatchLineWidth: a.width, hatchDist: a.dist, hatchAngle1: a.angle, hatchAngle2: b ? b.angle : 0 });
    if (a.rot || b?.rot) r.flags |= 1;
    if (a.off || b?.off) loss(st, "patternOffset", code);
  };
  const hq = hatches.slice(), hatchPairs = [];
  while (hq.length) {
    const a = hq.shift(), j = hq.findIndex((b) => b.color === a.color && b.width === a.width && b.dist === a.dist && b.rot === a.rot && !a.off && !b.off);
    hatchPairs.push(j >= 0 ? [a, hq.splice(j, 1)[0]] : [a]);
  }
  // structures: two patterns of one element whose rows fall halfway between each other are OCAD's shifted rows
  const pq = points.slice(), structs = [];
  const half = (d, period) => { const m = ((d % period) + period) % period; return Math.abs(m - period / 2) <= 1; };
  while (pq.length) {
    const a = pq.shift();
    const j = pq.findIndex((b) => b.key === a.key && b.w === a.w && b.h === a.h && b.angle === a.angle && b.rot === a.rot && b.draw === a.draw
      && half(b.lo - a.lo, a.h) && half(b.oa - a.oa, a.w));
    if (j >= 0) { pq.splice(j, 1); structs.push({ ...a, mode: 2, h: a.h / 2 }); if (a.lo || a.oa) loss(st, "patternOffset", code); }
    else { structs.push({ ...a, mode: 1 }); if (a.lo || a.oa) loss(st, "patternOffset", code); }
  }
  const setStruct = (r, p) => {
    Object.assign(r, { structMode: p.mode, structDraw: p.draw, structWidth: hu(p.w), structHeight: hu(p.h), structAngle: p.angle, elts: p.elts, dataSize: eltSize(p.elts) });
    if (p.rot) r.flags |= 1;
  };
  if (hatchPairs.length) setHatch(main, ...hatchPairs.shift());
  if (structs.length) setStruct(main, structs.shift());
  // what one record cannot hold: a record of its own, each object put on it too
  for (const hp of hatchPairs) setHatch(make(alloc(st, opt.num + 1)), ...hp);
  for (const p of structs) setStruct(make(alloc(st, opt.num + 1)), p);
  return recs;
}

// ---- text symbols ----
/** OCAD's alignment (OCAD 10+): left, centre, right; + 4 middle, + 8 top. */
const alignCode = (hk, vc) => (vc === 1 ? 4 : vc === 2 ? 8 : 0) + hk;
function textPlan(st, s, ts, opt) {
  const plan = { kind: "text", recs: [], variants: new Map(), hidden: opt.hidden, s, ts, opt, mdef: oomTextDef(st, ts) };
  if (ab(kid(ts, "font"), "underline")) loss(st, "textUnderline", opt.code);
  // a record per alignment its objects use, the most used one under the symbol's own number (left and baseline when unused)
  const use = st.textUse?.get(opt.omapId);
  const keys = use ? [...use.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]) : [0];
  for (const k of keys) textVariant(st, plan, k % 4, k >= 8 ? 2 : k >= 4 ? 1 : 0);
  return plan;
}
/** How many text objects of each symbol use each alignment (OCAD's codes). */
function textUse(parts) {
  const use = new Map();
  for (const p of kids(parts, "part")) for (const os of kids(p, "objects")) for (const ob of kids(os, "object")) {
    if (ai(ob, "type") !== 4) continue;
    const sid = ai(ob, "symbol", -1), ha = ai(ob, "h_align", 0), key = alignCode(ha === 1 ? 1 : ha === 2 ? 2 : 0, vClass(ai(ob, "v_align", 0)));
    if (!use.has(sid)) use.set(sid, new Map());
    const m = use.get(sid); m.set(key, (m.get(key) || 0) + 1);
  }
  return use;
}
/** The record of a text symbol for one alignment (h: 0 left, 1 centre, 2 right; v: 0 baseline, 1 middle, 2 top): the first one
 *  made takes the symbol's own number. */
function textVariant(st, plan, hk, vc) {
  const key = alignCode(hk, vc);
  let r = plan.variants.get(key);
  if (r) return r;
  const { s, ts, opt } = plan;
  const num = plan.recs.length ? alloc(st, opt.num + 1) : opt.num;
  r = Object.assign(head(st, s, { ...opt, num, otp: 4 }), textFields(st, ts, key));
  add(st, r, { omapId: opt.omapId, role: plan.recs.length ? "variant" : opt.role });
  r.omap.align = key;
  plan.recs.push(r); plan.variants.set(key, r);
  return r;
}
function textFields(st, ts, alignment) {
  const f = kid(ts, "font"), tx = kid(ts, "text"), fr = kid(ts, "framing"), lb = kid(ts, "line_below"), tabs = kid(ts, "tabs");
  const font = (f?.getAttribute("family") || "Arial").slice(0, 31), size = ai(f, "size", 4000) / 1000, bold = ab(f, "bold"), italic = ab(f, "italic");
  const m = faceMetrics(font, size, bold, italic);
  const r = { fontName: font, fontColor: col(st, ai(tx, "color", -1)), fontSize: Math.round((size / 25.4) * 720), weight: bold ? 700 : 400, italic,
    charSpace: Math.round(af(tx, "character_spacing", 0) * 100), wordSpace: 100, alignment, lineSpace: Math.round(((m.lineSpacing * af(tx, "line_spacing", 1)) / size) * 100),
    paraSpace: hu(ai(tx, "paragraph_spacing", 0)), indentFirst: 0, indentOther: 0, nTabs: 0, tabs: new Array(32).fill(0),
    lbOn: false, lbColor: 0, lbWidth: 0, lbDist: 0, frMode: 0, frFlags: 0, pointSymOn: false, pointSym: 0, frName: "",
    frLeft: 0, frBottom: 0, frRight: 0, frTop: 0, frColor: 0, frSize: 0, frWeight: 400, frItalic: false, frOfX: 0, frOfY: 0, frWidth: 0 };
  if (lb) {
    const c = ai(lb, "color", -1);
    if (c !== -1) Object.assign(r, { lbOn: true, lbColor: col(st, c), lbWidth: hu(ai(lb, "width")), lbDist: hu(ai(lb, "distance")) });
    else r.paraSpace += hu(ai(lb, "distance") + ai(lb, "width"));           // oom.js counts it in the paragraph spacing
  }
  const list = tabs ? kids(tabs, "tab").map((x) => hu(parseInt(x.textContent, 10) || 0)) : null;
  if (list?.length) { r.nTabs = Math.min(32, list.length); list.slice(0, 32).forEach((v, i) => { r.tabs[i] = v; }); }
  else { r.nTabs = 1; r.tabs[0] = Math.round(m.width("aeiolnrs") * 100); r._omap = { defTab: true }; }   // Mapper's default tab: 8 average characters
  if (fr) {
    const c = ai(fr, "color", -1), mode = ai(fr, "mode", 0);
    if (c !== -1 && mode === 1) Object.assign(r, { frMode: 2, frColor: col(st, c), frSize: hu(ai(fr, "line_half_width", 0)) });
    else if (c !== -1 && mode === 2) Object.assign(r, { frMode: 1, frColor: col(st, c), frOfX: hu(ai(fr, "shadow_x_offset", 0)), frOfY: hu(-ai(fr, "shadow_y_offset", 0)) });
  }
  return r;
}
/** The text symbol oom.js makes of a Mapper text symbol (its metrics place the texts as Mapper does). */
export function oomTextDef(st, ts) {
  const f = kid(ts, "font"), tx = kid(ts, "text"), lb = kid(ts, "line_below"), tabs = kid(ts, "tabs");
  const font = f?.getAttribute("family") || "Arial", size = ai(f, "size", 4000) / 1000, bold = ab(f, "bold"), italic = ab(f, "italic");
  const d = new TextSymDef("", "", "normal", null), m = faceMetrics(font, size, bold, italic);
  let para = ai(tx, "paragraph_spacing", 0) / 1000;
  if (lb) para += (ai(lb, "distance", 0) + ai(lb, "width", 0)) / 1000;
  const tl = tabs ? kids(tabs, "tab").map((x) => (parseInt(x.textContent, 10) || 0) / 1000) : null;
  d.setFont({ font, size, bold, italic, lineSpacing: m.lineSpacing * af(tx, "line_spacing", 1), paraSpacing: para, tabs: tl, charSpacing: af(tx, "character_spacing", 0),
    wordSpacing: 1, halign: HALIGN.Left, valign: VALIGN.TopAscent });
  if (!tl) d.tabs = [d.m.width("aeiolnrs")];
  return d;
}
/** A text record compiled (its metrics place the text as OCAD does). */
function defOf(st, rec) {
  let d = st.defs.get(rec);
  if (!d) { d = compileSymbol(rec, st.scratch); st.defs.set(rec, d); }
  return d;
}

// ---- combined symbols ----
/** A combined symbol's leaves (point and text parts are left out: Mapper draws none of them along a path or over an area). */
function comboLeaves(st, s, opt, seen, depth = 0) {
  const out = [];
  kids(kid(s, "combined_symbol"), "part").forEach((p, k) => {
    if (depth > 8) return;
    if (ab(p, "private")) {
      const inner = kid(p, "symbol");
      if (!inner) return;
      const pid = `${opt.omapId}/${k}`;
      if (ai(inner, "type") === 16) { out.push(...comboLeaves(st, inner, { ...opt, omapId: pid }, seen, depth + 1)); return; }
      out.push({ private: true, s: inner, pid });
    } else {
      const ref = ai(p, "symbol", -1), rs = st.byId.get(ref);
      if (!rs) return;
      if (ai(rs, "type") === 16) {
        if (seen.has(ref)) return;
        const sub = new Set(seen); sub.add(ref);
        out.push(...comboLeaves(st, rs, { ...opt, omapId: ref }, sub, depth + 1));
      } else out.push({ private: false, id: ref, s: rs });
    }
  });
  return out;
}
function comboPlan(st, s, opt, seen) {
  const leaves = [];
  for (const lf of comboLeaves(st, s, opt, seen)) {
    const t0 = ai(lf.s, "type");
    if (t0 !== 2 && t0 !== 4) { loss(st, "comboPart", opt.code); continue; }
    let plan;
    if (lf.private) plan = leafPlan(st, lf.s, { num: alloc(st, opt.num + 1), omapId: lf.pid, hidden: opt.hidden, role: "private", name: lf.s.getAttribute("name") || opt.name });
    else {
      plan = planOf(st, lf.id, new Set([...seen]));
      // a part drawn otherwise than the combined symbol (a helper symbol hidden on its own): a copy of its own
      if (plan && plan.hidden !== opt.hidden) plan = { ...plan, recs: plan.recs.map((r) => copyRec(st, r, { omapId: `${opt.omapId}/${lf.id}`, num: alloc(st, opt.num + 1), hidden: opt.hidden, role: "private" })) };
    }
    if (plan?.recs.length) leaves.push(plan);
  }
  const areas = leaves.filter((p) => p.kind === "area"), lines = leaves.filter((p) => p.kind === "line");
  const plan = { kind: areas.length ? "area" : "line", combo: true, hidden: opt.hidden, targets: [] };
  if (areas.length && lines.length === 1) {
    // an area and its line: OCAD's area with its border line, under the combined symbol's own number
    const [first, ...rest] = areas;
    const border = lines[0].recs[0];
    const a = copyRec(st, first.recs[0], { omapId: opt.omapId, num: opt.num, hidden: opt.hidden, name: opt.name, role: "combo" });
    a.borderSym = border.sym; a.borderOn = true; a.omap.from = first.recs[0].omap.id;
    plan.targets.push({ rec: a, as: "area" }, ...first.recs.slice(1).map((r) => ({ rec: r, as: "area" })));
    for (const p of rest) plan.targets.push(...p.recs.map((r) => ({ rec: r, as: "area" })));
    plan.border = border;
  } else {
    for (const p of areas) plan.targets.push(...p.recs.map((r) => ({ rec: r, as: "area" })));
    for (const p of lines) plan.targets.push(...p.recs.map((r) => ({ rec: r, as: areas.length ? "rings" : "line" })));
    if (!areas.length && !lines.length) return null;
  }
  plan.recs = plan.targets.map((x) => x.rec);
  return plan;
}

// ---- objects -----------------------------------------------------------------------------------------------------------------
function readParts(el, st) {
  let o = 0;
  kids(el, "part").forEach((p, i) => {
    const id = `p${i + 1}`;
    st.doc.parts.push({ id, name: p.getAttribute("name") || "", hidden: false, locked: false });
    for (const os of kids(p, "objects")) for (const ob of kids(os, "object")) { try { readObject(ob, o, id, st); } catch (e) { /* a damaged object is left out */ } o++; }
  });
  if (!st.doc.parts.length) st.doc.parts.push({ id: "p1", name: "", hidden: false, locked: false });
}
function objRec(st, rec, otp, coords, part, omap) {
  const o = { id: ++st.oid, sym: rec.sym, otp, ang: 0, coords, nItem: coords.length, text: null, nText: 0, col: 0, lineWidth: 0, diamFlags: 0,
    objStr: null, objStrType: 0, unicode: 1, part, e: { objType: otp, status: 1, viewType: 0, layoutFont: 0 }, omap };
  st.doc.objects.push(o);
  return o;
}
function readObject(ob, oi, part, st) {
  const sid = ai(ob, "symbol", -1), plan = st.plans.get(sid);
  if (!plan) return;
  const coords = coordList(ob), rot = af(ob, "rotation", 0);
  let note = (extra) => ({ o: oi, sym: sid, ...extra });
  if (plan.kind === "point") {
    if (!coords.length) return;
    const o = objRec(st, plan.recs[0], 1, [ptOf(hu(coords[0].x), hu(-coords[0].y))], part, note());
    o.ang = tenths(rot);
    if (rot) o.omap.r = rot;                                         // the angle as Mapper keeps it (OCAD's: a tenth of a degree)
  } else if (plan.kind === "text") textObject(st, plan, ob, coords, rot, part, note);
  else if (plan.kind === "line") {
    const targets = plan.targets || plan.recs.map((rec) => ({ rec, as: "line" }));
    for (const { rec } of targets) ocadParts(coords, dashFlagOf(rec), rec.omap?.noEndDash).forEach((p, k) => objRec(st, rec, 2, p, part, note(k ? { piece: k } : {})));
  } else {
    const pat = kid(ob, "pattern"), pc = pat ? kid(pat, "coord") : null;
    const angle = pat ? af(pat, "rotation", 0) : rot;
    if (pc && (ai(pc, "x") || ai(pc, "y"))) note = ((f) => (extra) => ({ ...f(extra), pc: [ai(pc, "x"), ai(pc, "y")] }))(note);
    // a rotatable pattern turns about the object's own point in Mapper, about the map's origin in OCAD
    if (pc && (ai(pc, "x") || ai(pc, "y")) && plan.recs.some((r) => r.otp === 3 && r.flags & 1 && (r.hatchMode || r.structMode))) loss(st, "patternOrigin", st.doc.omap.symbols[sid]?.code || "");
    const targets = plan.targets || plan.recs.map((rec) => ({ rec, as: "area" }));
    for (const { rec, as } of targets) {
      if (as === "area") {
        const parts = ocadParts(coords, plan.border ? dashFlagOf(plan.border) : 1);
        if (!parts.length) continue;
        const o = objRec(st, rec, 3, areaCoords(parts), part, note());
        o.ang = tenths(angle);
        if (angle) o.omap.r = angle;
      } else {
        // a line part of a combined area: drawn along each ring of the area
        ocadParts(coords, dashFlagOf(rec), rec.omap?.noEndDash).forEach((p, k) => {
          const f = p[0], l = p[p.length - 1];
          const ringPts = (f.x >> 8) === (l.x >> 8) && (f.y >> 8) === (l.y >> 8) ? p : [...p, { x: f.x & ~0xff, y: f.y & ~0xff }];
          objRec(st, rec, 2, ringPts, part, note({ ring: k }));
        });
      }
    }
  }
}
/** OCAD's vertical alignment class of a Mapper text object (0 baseline, 1 middle, 2 top) and oom.js's own alignment. */
const vClass = (va) => (va === 0 || va === 3 ? 0 : va === 2 ? 1 : 2);
export const oomV = (va) => (va === 0 ? VALIGN.Baseline : va === 1 ? VALIGN.TopAscent : va === 2 ? VALIGN.MidpointAllLines : va === 3 ? VALIGN.BaselineLast : VALIGN.TopAscent);
export const oomH = (ha) => (ha === 1 ? HALIGN.Center : ha === 2 ? HALIGN.Right : HALIGN.Left);
/**
 * A Mapper text object as an OCAD one, placed so that OCAD draws it where Mapper does: an anchored text (otp 4) at the anchor
 * moved by the difference of the alignments' vertical offsets (and OCAD's own adjustment); a text in a box (otp 5) by the box's
 * four corners, from the top left, moved the same way.
 */
function textObject(st, plan, ob, coords, rot, part, note) {
  if (!coords.length) return;
  const raw = kid(ob, "text")?.textContent || "", lines = raw.split(/\r\n|\r|\n/);
  const ha = ai(ob, "h_align", 0), va = ai(ob, "v_align", 0);
  const hk = ha === 1 ? 1 : ha === 2 ? 2 : 0, rec = textVariant(st, plan, hk, vClass(va)), def = defOf(st, rec), md = plan.mdef;
  const vM = oomV(va), hM = oomH(ha), size = kid(ob, "size");
  const angle = (rot * 180) / Math.PI, a0 = (angle * Math.PI) / 180, a1 = ((angle + 90) * Math.PI) / 180;
  const dir = [Math.cos(a0), Math.sin(a0)], up = [Math.cos(a1), Math.sin(a1)];
  const cx = coords[0].x / 1000, cy = -coords[0].y / 1000;
  const text = (lines[0] === "" ? "\r\n" : "") + lines.join("\r\n");     // OCAD ignores one blank line at the start
  let o;
  if (coords.length === 1 && !size) {
    const d = md.vertOffset(vM, md.unwrapped(lines).lines) - def.vertOffset(VALIGN.Default, def.unwrapped(lines).lines) - def.ocadTopAdjustment(false, VERSION);
    o = objRec(st, rec, 4, [ptMm(cx + d * up[0], cy + d * up[1])], part, note({ h: ha, v: va }));
  } else {
    const w = size ? ai(size, "width") / 1000 : coords[1].x / 1000, h = size ? ai(size, "height") / 1000 : coords[1].y / 1000;
    const mv = (p, dd, v) => [p[0] + dd * v[0], p[1] + dd * v[1]];
    // oom.js's place of the text: the box's left, centre or right; its top, middle or bottom
    let loc = [cx, cy];
    if (hM === HALIGN.Left) loc = mv(loc, -w / 2, dir); else if (hM === HALIGN.Right) loc = mv(loc, w / 2, dir);
    if (vM === VALIGN.TopAscent || vM === VALIGN.Baseline) loc = mv(loc, h / 2, up); else if (vM === VALIGN.BaselineLast) loc = mv(loc, -h / 2, up);
    const d = md.vertOffset(vM, md.wrap(lines, w, hM).lines) - def.vertOffset(VALIGN.Default, def.wrap(lines, w, HALIGN.Default).lines) - def.ocadTopAdjustment(true, VERSION);
    const ul = mv(mv(loc, d, up), -def.ocadFormattedHorizAdjustment(w), dir), ur = mv(ul, w, dir), ll = mv(ul, -h, up), lr = mv(ll, w, dir);
    o = objRec(st, rec, 5, [ll, lr, ur, ul].map((p) => ptMm(p[0], p[1])), part, note({ h: ha, v: va, box: [Math.round(w * 1000), Math.round(h * 1000)] }));
  }
  o.ang = rnd(angle * 10);
  if (rot) o.omap.r = rot;
  o.text = text;
  o.nText = Math.ceil(((text.length + 1) * 2) / 8);
}

// ---- finishing ---------------------------------------------------------------------------------------------------------------
/** The colours a record uses (OCAD 9+ lists their count in the symbol's header). */
function finishSymbol(s) {
  const cols = new Set(), elts = (l) => { for (const e of l || []) cols.add(e.color); };
  if (s.otp === 1) elts(s.elts);
  else if (s.otp === 2) {
    if (s.lineWidth) cols.add(s.lineColor);
    if (s.dblMode) { if (s.dblFlags & 1) cols.add(s.dblFillColor); if (s.dblLeftWidth) cols.add(s.dblLeftColor); if (s.dblRightWidth) cols.add(s.dblRightColor); }
    for (const k of ["prim", "sec", "corner", "start", "end"]) elts(s[k]);
  } else if (s.otp === 3) { if (s.fillOn) cols.add(s.fillColor); if (s.hatchMode) cols.add(s.hatchColor); if (s.structMode) elts(s.elts); }
  else if (s.otp === 4) { cols.add(s.fontColor); if (s.frMode) cols.add(s.frColor); if (s.lbOn) cols.add(s.lbColor); }
  cols.delete(-1);
  s.nColors = cols.size;
}

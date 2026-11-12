// Printing a map with spot inks, shared by Cartographier and the Tracer (owner, 2026-11-12: one print engine, used by both — the
// Tracer prints the maps with their courses, so it needs what Cartographier's « Séparations » does). Three things:
// - the inks, read from OCAD's parameter strings (9+): type 10 names each ink (CMYK, screen frequency and angle, shown or not),
//   each colour's string of type 9 its `s<ink>` / `p<percent>` pairs (a `p` before the first `s` is something else);
// - a composite PDF where a colour printed with inks is painted in them: a « Separation » colour space for one ink, « DeviceN »
//   for several (their CMYK for the screen, the sum of the inks' CMYK by their tints), the colours without inks in CMYK; the
//   « All » space for registration marks (every plate);
// - one plate at a time: each spot ink, or C, M, Y and K (process), in grey at the colour's share; a colour the plate does not
//   print knocks out what is under it (white) unless it overprints, when it is left out — so the plates come out right whatever
//   the viewer does with overprint. A logo (an image) is separated too: process plates by its pixels' CMYK, spot plates on the
//   darkest ink's plate (it cannot be split into spot inks).
// A « paint » is anything with { cmyk (0..1 ×4), spot? [{ name, pct (0..1) }], overprint? }: a map's VColor (map.js), a colour
// of Cartographier's document, or a course colour of the Tracer.

/** The inks and each colour's share of them, from OCAD's parameter strings: { spots: [{ num, name, cmyk, freq, angle,
 *  visible }], byColour: Map(colour number → [{ name, pct }]) }. */
export function readInks(params) {
  const spots = [], byColour = new Map();
  for (const p of params || []) {
    if (p.type !== 10) continue;
    const parts = String(p.str || "").split("\t"), code = (c) => parts.find((x) => x[0] === c)?.slice(1);
    spots.push({ num: Number(code("n")) || spots.length, name: parts[0], cmyk: ["c", "m", "y", "k"].map((c) => (Number(code(c)) || 0) / 100),
      freq: Number(code("f")) || 0, angle: Number(code("a")) || 0, visible: code("v") !== "0" });
  }
  for (const p of params || []) {
    if (p.type !== 9) continue;
    const parts = String(p.str || "").split("\t"), n = Number(parts.find((x) => x[0] === "n")?.slice(1));
    const list = [];
    for (let i = 1; i < parts.length; i++) if (parts[i][0] === "s") {
      const next = parts[i + 1];
      list.push({ name: parts[i].slice(1), pct: next?.[0] === "p" ? (Number(next.slice(1)) || 0) / 100 : 1 });
    }
    if (Number.isFinite(n) && list.length) byColour.set(n, list);
  }
  return { spots, byColour };
}
/** A map read from OCAD (vmap) given its inks: `map.spots`, and `spot` on each of its colours that has some. */
export function attachInks(map, params) {
  const { spots, byColour } = readInks(params);
  map.spots = spots;
  for (const c of map.colors) if (byColour.has(c.id)) c.spot = byColour.get(c.id);
  return map;
}
/** The inks a paint is printed with (a share above 0), among those known. */
export const inksOf = (c, known) => (c?.spot || []).filter((x) => x.pct > 0 && (!known || known.has(x.name)));
/** A name PDF accepts for an ink (its own name, as the printer will read it: only what a PDF name cannot hold is changed). */
const pdfInkName = (s) => String(s || "Ink").replace(/[\s()<>[\]{}/%#]/g, "_").slice(0, 120);

// ---- the plates --------------------------------------------------------------------------------------------------------------
/**
 * The plates of a print: { name, share(paint) → 0..1, angle?, freq? }. process: C, M, Y, K from each paint's CMYK. Else each
 * shown spot ink some paint uses, then C, M, Y, K for the paints printed without inks (OCAD prints spot and process together),
 * each plate only if something is on it. paints: every paint drawn (the map's colours, the course's).
 */
export function plates(spots, paints, { process = false } = {}) {
  const PROC = ["C", "M", "Y", "K"];
  const known = new Set((spots || []).map((s) => s.name));
  if (process) return PROC.map((name, k) => ({ name, share: (c) => c?.cmyk?.[k] || 0 })).filter((p) => paints.some((c) => p.share(c) > 0));
  const out = [];
  for (const s of spots || []) {
    if (s.visible === false) continue;
    const share = (c) => (c?.spot || []).find((x) => x.name === s.name)?.pct || 0;
    if (paints.some((c) => share(c) > 0)) out.push({ name: s.name, angle: s.angle, freq: s.freq, cmyk: s.cmyk, share });
  }
  PROC.forEach((name, k) => {
    const share = (c) => (inksOf(c, known).length ? 0 : c?.cmyk?.[k] || 0);
    if (paints.some((c) => share(c) > 0)) out.push({ name, share });
  });
  return out;
}
/** The paints printed on no plate at all: colours with inks none of which is shown, said before printing. */
export function unprinted(spots, paints) {
  const shown = new Set((spots || []).filter((s) => s.visible !== false).map((s) => s.name)), known = new Set((spots || []).map((s) => s.name));
  return paints.filter((c) => { const ins = inksOf(c, known); return ins.length && !ins.some((x) => shown.has(x.name)); });
}

// ---- painters: how a PDF target (target.js PdfTarget) and the Tracer's course items set a colour ---------------------------------
/** The colour spaces of one PDF document: made once, named on each page that uses them. */
class Spaces {
  constructor(L, doc, spots) {
    this.L = L; this.doc = doc; this.spots = new Map((spots || []).map((s) => [s.name, s])); this.refs = new Map();
  }
  sep(name, cmyk) {
    const key = `S|${name}`;
    if (!this.refs.has(key)) {
      const { L, doc } = this, C = doc.context;
      const fn = C.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: cmyk, N: 1 });
      this.refs.set(key, C.register(C.obj([L.PDFName.of("Separation"), L.PDFName.of(name === "All" ? "All" : pdfInkName(name)), L.PDFName.of("DeviceCMYK"), fn])));
    }
    return key;
  }
  deviceN(inks) {
    const key = `N|${inks.map((x) => x.name).join("|")}`;
    if (!this.refs.has(key)) {
      const { L, doc } = this, C = doc.context, N = inks.length, f = (v) => (Math.round(v * 10000) / 10000).toString();
      // the inks' tints on the stack, their CMYK summed (PostScript calculator: FunctionType 4)
      let ps = "{";
      for (let j = 0; j < 4; j++) {
        ps += " 0";
        inks.forEach((x, i) => { ps += ` ${j + 1 + (N - 1 - i)} index ${f(this.spots.get(x.name).cmyk[j])} mul add`; });
      }
      ps += ` ${N + 4} 4 roll${" pop".repeat(N)} }`;
      const fn = C.stream(ps, { FunctionType: 4, Domain: Array(N).fill([0, 1]).flat(), Range: [0, 1, 0, 1, 0, 1, 0, 1] });
      this.refs.set(key, C.register(C.obj([L.PDFName.of("DeviceN"), inks.map((x) => L.PDFName.of(pdfInkName(x.name))), L.PDFName.of("DeviceCMYK"), C.register(fn)])));
    }
    return key;
  }
  /** The name of a colour space on a page (its resources' ColorSpace dictionary). */
  on(page, key) {
    const { L } = this, res = page.node.Resources();
    let dict = res.lookupMaybe(L.PDFName.of("ColorSpace"), L.PDFDict);
    if (!dict) { dict = this.doc.context.obj({}); res.set(L.PDFName.of("ColorSpace"), dict); }
    page._csNames ||= new Map();
    if (!page._csNames.has(key)) {
      const name = `CS${page._csNames.size}`;
      dict.set(L.PDFName.of(name), this.refs.get(key));
      page._csNames.set(key, name);
    }
    return page._csNames.get(key);
  }
  ops(page, key, tints, fill) {
    const { L } = this;
    return [L.PDFOperator.of(fill ? "cs" : "CS", [L.PDFName.of(this.on(page, key))]), L.PDFOperator.of(fill ? "scn" : "SCN", tints.map((v) => L.PDFNumber.of(v)))];
  }
}

/**
 * The composite with spot inks: a paint printed with inks is painted in them, any other in CMYK. Overprint is the PDF's own
 * (an ExtGState with OP and op): `overprintState(page)` gives its name on a page, for the colours that overprint.
 */
export function spotPainter(L, doc, spots) {
  const S = new Spaces(L, doc, spots), known = new Set((spots || []).map((s) => s.name));
  const P = {
    kind: "spot", spots,
    skip: () => false,
    /** Operators setting a paint's colour on a page, or null for the caller's own CMYK. */
    ops(page, c, fill) {
      const inks = inksOf(c, known);
      if (inks.length === 1) return S.ops(page, S.sep(inks[0].name, S.spots.get(inks[0].name).cmyk), [inks[0].pct], fill);
      if (inks.length > 1) return S.ops(page, S.deviceN(inks), inks.map((x) => x.pct), fill);
      return null;
    },
    /** Registration colour: every plate. */
    registration(page, fill) { return S.ops(page, S.sep("All", [1, 1, 1, 1]), [1], fill); },
    overprintState(page) { return overprintGs(L, doc, page); },
  };
  return P;
}
/** One plate in grey: what the plate prints in black at its share, a colour it does not print white, or left out if it overprints.
 *  all: every plate of the print — images go to the process plates when there are some, else to the darkest ink's. */
export function platePainter(L, plate, spots, all = [plate]) {
  const isProc = (p) => /^[CMYK]$/.test(p.name) && !p.cmyk;
  const anyProc = all.some(isProc);
  const darkest = (spots || []).filter((s) => s.visible !== false).reduce((best, s) => {
    const d = 1 - (1 - s.cmyk[3]) * (1 - Math.max(s.cmyk[0], s.cmyk[1], s.cmyk[2]) * 0.8);
    return !best || d > best.d ? { name: s.name, d } : best;
  }, null)?.name;
  // a colour the plate does not print only matters over what the plate already holds (it knocks it out): until the plate's
  // first colour is drawn (colours are drawn from the bottom of the table up) there is nothing to knock out
  let painted = false;
  const P = {
    kind: "plate", plate, spots,
    skip: (c) => !(plate.share(c) > 0) && (!!c?.overprint || !painted),
    ops(page, c, fill) {
      if (plate.share(c) > 0) painted = true;
      const v = 1 - Math.min(1, Math.max(0, plate.share(c) || 0));
      return [fill ? L.setFillingGrayscaleColor(v) : L.setStrokingGrayscaleColor(v)];
    },
    registration(page, fill) { return [fill ? L.setFillingGrayscaleColor(0) : L.setStrokingGrayscaleColor(0)]; },
    overprintState: () => null,
    /** An image's tint on this plate, per pixel (0..1), or null if the plate does not print images. */
    imageTint: isProc(plate)
      ? (r, g, b) => { const k = 1 - Math.max(r, g, b); if (plate.name === "K") return k; if (k >= 1) return 0; const i = "CMY".indexOf(plate.name); return (1 - [r, g, b][i] - k) / (1 - k); }
      : !anyProc && plate.name === darkest ? (r, g, b) => 1 - (0.299 * r + 0.587 * g + 0.114 * b) : null,
  };
  return P;
}
const gsCache = new WeakMap();
/** The overprint ExtGState's name on a page (OP and op, mode 1: a 0 in a CMYK colour leaves that plate alone). */
export function overprintGs(L, doc, page) {
  let m = gsCache.get(doc);
  if (!m) { m = { ref: doc.context.register(doc.context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })), pages: new Map() }; gsCache.set(doc, m); }
  if (!m.pages.has(page)) m.pages.set(page, page.node.newExtGState("GSop", m.ref));
  return m.pages.get(page);
}

/** An image (bytes or a decoded picture) as this plate's grey PNG (its transparency kept), or null when the plate leaves it out. */
export async function plateImage(painter, { bytes = null, img = null, type = "" } = {}) {
  if (!painter?.imageTint || typeof document === "undefined") return null;
  let pic = img;
  if (!pic && bytes) pic = await createImageBitmap(new Blob([bytes], { type: type || (bytes[0] === 0x89 ? "image/png" : "image/jpeg") })).catch(() => null);
  if (!pic) return null;
  const c = document.createElement("canvas"); c.width = pic.width; c.height = pic.height;
  const g = c.getContext("2d"); g.drawImage(pic, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const tint = Math.min(1, Math.max(0, painter.imageTint(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255)));
    a[i] = a[i + 1] = a[i + 2] = Math.round(255 * (1 - tint));
  }
  g.putImageData(d, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** Registration marks at the four corners of a page, `m` points in, and a line of text (the plate's name) in its bottom margin,
 *  in the registration colour: every plate (the « All » space in the composite, black on a plate, CMYK 100 % else). */
export function plateMarks(L, page, painter, { m = 30, label = "", font = null } = {}) {
  const W = page.getWidth(), H = page.getHeight();
  const ops = [L.pushGraphicsState(), ...(painter?.registration ? painter.registration(page, false) : [L.setStrokingCmykColor(1, 1, 1, 1)]), L.setLineWidth(0.3)];
  const cross = (x, y) => {
    const r = m * 0.28, c = r * 0.6, k = 0.5523 * c;
    ops.push(L.moveTo(x - r, y), L.lineTo(x + r, y), L.moveTo(x, y - r), L.lineTo(x, y + r), L.stroke());
    ops.push(L.moveTo(x + c, y), L.appendBezierCurve(x + c, y + k, x + k, y + c, x, y + c), L.appendBezierCurve(x - k, y + c, x - c, y + k, x - c, y),
      L.appendBezierCurve(x - c, y - k, x - k, y - c, x, y - c), L.appendBezierCurve(x + k, y - c, x + c, y - k, x + c, y), L.stroke());
  };
  cross(m / 2, m / 2); cross(W - m / 2, m / 2); cross(m / 2, H - m / 2); cross(W - m / 2, H - m / 2);
  ops.push(L.popGraphicsState());
  page.pushOperators(...ops);
  if (label && font) plateLabel(L, page, painter, label, font, { x: m * 1.2, y: Math.max(2, m * 0.35) });
}
/** A line of small text in the registration colour (the plate's name): font a standard font embedded (Helvetica), ASCII only. */
export function plateLabel(L, page, painter, text, font, { x = 6, y = 3, size = 7 } = {}) {
  const ascii = String(text).normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  if (!ascii || !font) return;
  page.pushOperators(L.pushGraphicsState(), ...(painter?.registration ? painter.registration(page, true) : [L.setFillingCmykColor(1, 1, 1, 1)]),
    L.beginText(), L.setFontAndSize(page.node.newFontDictionary(font.name, font.ref), size), L.moveText(x, y), L.showText(font.encodeText(ascii)), L.endText(),
    L.popGraphicsState());
}

// The Tracer's PDFs, built in the browser with pdf-lib (MIT): the course maps — the map as it came (a PDF page embedded
// unchanged, so it stays vector; an image at its full resolution), the course drawn over it in vector with the purple in
// CMYK (Multiply blend so black features show through, as Purple Pen's « Blend »), each course at its print scale on its
// page —, the description sheets (one of each, a page of each, or N copies of each), the punch cards, and the print
// areas (Purple Pen's File › Set Print Area).

import * as M from "./model.js";
import { layoutCourse } from "./layout.js";
import { itemsFor } from "./draw.js";
import { describe, sheetItems, sheetSize, widthInCells } from "./descr.js";
import { modal, download, fileName, field, sel, num, saveFiles } from "./dialogs.js";
import * as S from "./store.js";
import { isPdf } from "./mapsrc.js";
import { loadFonts, textRuns, chunkFile, ensureText } from "./fonts.js";
import { coursePurple, layerOf, splitItems, syncMap } from "./appear.js";
import { where } from "./ribbon-data.js";
import { hasGeo as hasGeoEv } from "./geo.js";
import { t } from "./lang.js";

import { PDFLIB, FFLATE } from "../vendor.js";
const loaded = {};
function script(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); });
  return loaded[src];
}
export async function pdfLib() { await script(PDFLIB); return window.PDFLib; }
export async function zip(files) { await script(FFLATE); return window.fflate.zipSync(files, { level: 0 }); }

const PT = 72 / 25.4;                                         // points per mm
export const PAGES = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The page (mm) of a print area: Purple Pen keeps it in 1/100 inch. */
export function pageOf(pa) {
  let w = pa?.pageW > 0 ? pa.pageW * 0.254 : 210, h = pa?.pageH > 0 ? pa.pageH * 0.254 : 297;
  if (pa?.landscape && w < h) [w, h] = [h, w];
  if (!pa?.landscape && w > h) [w, h] = [h, w];
  return { w, h, margin: (pa?.margins || 0) * 0.254 };
}
/** The part of the map a course designator prints (mm [l, b, r, t]) and the page: its print area, or around the course. */
export function printBox(E, cd, layout) {
  const ev = E.ev, pa = M.printAreaOf(ev, cd), page = pageOf(pa);
  const ps = cd.course ? ev.courses[cd.course].printScale : ev.allControls.printScale;
  const k = ev.map.scale / ps;                                  // paper mm per map mm
  const fitsW = (page.w - 2 * page.margin) / k, fitsH = (page.h - 2 * page.margin) / k;
  if (pa && !pa.auto && pa.rect) {
    const [l, b, r, t] = pa.rect;
    if (!pa.restrict) return { box: [l, b, r, t], page, k };
    const cx = (l + r) / 2, cy = (b + t) / 2;
    return { box: [cx - fitsW / 2, cy - fitsH / 2, cx + fitsW / 2, cy + fitsH / 2], page, k };
  }
  // automatic: the course (controls, descriptions, specials) centred on the page, the page turned to fit it best
  const xs = [], ys = [];
  for (const o of layout.objs) {
    const pts = o.ctr ? [o.ctr] : o.pts || (o.box ? [[o.box[0], o.box[1]], [o.box[2], o.box[3]]] : []);
    for (const p of pts) { xs.push(p[0]); ys.push(p[1]); }
  }
  const bb = xs.length ? [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10] : [0, 0, ev.map.w, ev.map.h];
  let pg = page;
  if (pa?.auto && !pa?.restrictOrientation) {
    const wide = bb[2] - bb[0] > bb[3] - bb[1];
    if (wide !== pg.w > pg.h) pg = { ...pg, w: pg.h, h: pg.w };
  }
  const W = (pg.w - 2 * pg.margin) / k, H = (pg.h - 2 * pg.margin) / k;
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  return { box: [cx - W / 2, cy - H / 2, cx + W / 2, cy + H / 2], page: pg, k };
}

/**
 * The pages of a course designator: one box per page (map mm). A print area larger than the paper is tiled over as many
 * pages as it needs, left to right then top to bottom, the overlap spread evenly (Purple Pen's CoursePageLayout), unless it
 * is kept to one page (« restrict »: its middle).
 */
export function printTiles(E, cd, layout) {
  const pb = printBox(E, cd, layout), pa = M.printAreaOf(E.ev, cd);
  if (!pa || pa.auto || !pa.rect || pa.restrict) return [pb];
  const [l, b, r, t] = pa.rect, W = (pb.page.w - 2 * pb.page.margin) / pb.k, H = (pb.page.h - 2 * pb.page.margin) / pb.k;
  const nx = Math.max(1, Math.ceil((r - l) / W - 1e-6)), ny = Math.max(1, Math.ceil((t - b) / H - 1e-6));
  if (nx === 1 && ny === 1) return [pb];
  const sx = nx > 1 ? (r - l - W) / (nx - 1) : 0, sy = ny > 1 ? (t - b - H) / (ny - 1) : 0;
  const cx = (l + r) / 2, cy = (b + t) / 2, tiles = [];
  for (let j = 0; j < ny; j++) {
    const y0 = ny > 1 ? t - H - j * sy : cy - H / 2;
    for (let i = 0; i < nx; i++) { const x0 = nx > 1 ? l + i * sx : cx - W / 2; tiles.push({ ...pb, box: [x0, y0, x0 + W, y0 + H], tile: [i + 1, j + 1, nx, ny] }); }
  }
  return tiles;
}

// ---- drawing items with PDF operators ----------------------------------------------------------------------------------------
function cmykOf(P, role, rgb) {
  const c = Array.isArray(role) ? role : role === "upper" || role === "lower" ? P : role === "purple50" ? P.map((x) => x / 2) : role === "white" ? [0, 0, 0, 0] : [0, 0, 0, 1];
  return rgb ? { rgb: [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])] } : { cmyk: c };
}
function setColor(L, ops, col, fill) {
  if (col.rgb) ops.push(fill ? L.setFillingRgbColor(...col.rgb) : L.setStrokingRgbColor(...col.rgb));
  else ops.push(fill ? L.setFillingCmykColor(...col.cmyk) : L.setStrokingCmykColor(...col.cmyk));
}
const CAP = { butt: 0, round: 1, square: 2 }, JOIN = { miter: 0, round: 1, bevel: 2 };
function pathOps(L, ops, d, T) {
  for (const c of d) {
    if (c[0] === "M") ops.push(L.moveTo(...T(c[1], c[2])));
    else if (c[0] === "L") ops.push(L.lineTo(...T(c[1], c[2])));
    else if (c[0] === "C") ops.push(L.appendBezierCurve(...T(c[1], c[2]), ...T(c[3], c[4]), ...T(c[5], c[6])));
    else if (c[0] === "Z") ops.push(L.closePath());
  }
}
/**
 * Draw items (map mm, y up) on a PDF page: T(x, y) gives points, s the points per map mm. multiply: the ExtGState name
 * for the Multiply blend (purple), or null. fonts: { reg, bold }. images: a cache of embedded images.
 */
async function drawItemsPdf(L, doc, page, ev, items, T, s, { multiply = null, fonts, rgb = false, images = new Map(), purple: P = ev.appearance.purple || M.PURPLE, onInset = null }) {
  const ops = [];
  const flush = () => { if (ops.length) { page.pushOperators(...ops); ops.length = 0; } };
  for (const it of items) {
    const purple = it.color === "upper" || it.color === "lower" || it.color === "purple50";
    if (it.t === "path") {
      ops.push(L.pushGraphicsState());
      if (purple && multiply) ops.push(L.setGraphicsState(multiply));
      pathOps(L, ops, it.d, T);
      const col = cmykOf(P, it.color, rgb);
      if (it.fill && it.stroke) { setColor(L, ops, col, true); setColor(L, ops, col, false); ops.push(L.setLineWidth(it.stroke * s), L.fillAndStroke()); }
      else if (it.fill) { setColor(L, ops, col, true); ops.push(L.PDFOperator.of("f*")); }        // even-odd fill (pdf-lib has no helper for it)
      else if (it.stroke) {
        setColor(L, ops, col, false);
        ops.push(L.setLineWidth(it.stroke * s), L.setLineCap(CAP[it.cap] ?? 0), L.setLineJoin(JOIN[it.join] ?? 0), L.stroke());
      } else ops.push(L.endPath());
      ops.push(L.popGraphicsState());
    } else if (it.t === "hatch") {
      ops.push(L.pushGraphicsState());
      if (purple && multiply) ops.push(L.setGraphicsState(multiply));
      pathOps(L, ops, it.d, T); ops.push(L.clip(), L.endPath());
      setColor(L, ops, cmykOf(P, it.color, rgb), false);
      ops.push(L.setLineWidth(it.width * s));
      const xs = [], ys = [];
      for (const c of it.d) for (let i = 1; i < c.length; i += 2) { xs.push(c[i]); ys.push(c[i + 1]); }
      const l = Math.min(...xs), r = Math.max(...xs), b = Math.min(...ys), t = Math.max(...ys), R = Math.hypot(r - l, t - b), cx = (l + r) / 2, cy = (b + t) / 2;
      for (const a of it.angles) {
        const dx = Math.cos(a * Math.PI / 180), dy = Math.sin(a * Math.PI / 180), nx = -dy, ny = dx;
        for (let q = -R; q <= R; q += it.spacing) { ops.push(L.moveTo(...T(cx + nx * q - dx * R, cy + ny * q - dy * R)), L.lineTo(...T(cx + nx * q + dx * R, cy + ny * q + dy * R))); }
      }
      ops.push(L.stroke(), L.popGraphicsState());
    } else if (it.t === "text") {
      flush();
      // run by run: each in the face that holds its characters (fonts.js), side by side
      const runs = await fonts.runs(it.text, it.family || (it.condensed ? "Roboto Condensed" : "Roboto"), it.bold, it.italic);
      const size = it.size * s;
      const ws = runs.map((r) => r.font.widthOfTextAtSize(r.text, size)), w = ws.reduce((a, b) => a + b, 0);
      const [x, y] = T(it.x, it.y);
      const x0 = it.align === "center" ? x - w / 2 : x;
      const col = cmykOf(P, it.color, rgb);
      const colorObj = col.rgb ? L.rgb(...col.rgb) : L.cmyk(...col.cmyk);
      if (it.outline > 0) {
        let xo = x0;
        runs.forEach((r, i) => {
          page.pushOperators(L.pushGraphicsState(), L.beginText(), L.setFontAndSize(page.node.newFontDictionary(r.font.name, r.font.ref), size),
            L.setTextRenderingMode(L.TextRenderingMode.Outline), L.setLineWidth(it.outline * s * 2), L.setStrokingCmykColor(0, 0, 0, 0), L.setLineJoin(1),
            L.moveText(xo, y), L.showText(r.font.encodeText(r.text)), L.endText(), L.popGraphicsState());
          xo += ws[i];
        });
      }
      let xr = x0;
      runs.forEach((r, i) => {
        page.drawText(r.text, { x: xr, y, size, font: r.font, color: colorObj, ...(purple && multiply && !it.outline ? { blendMode: L.BlendMode.Multiply } : {}) });
        xr += ws[i];
      });
    } else if (it.t === "inset") {
      if (onInset) { flush(); await onInset(it); }
    } else if (it.t === "image" && it.image?.data) {
      flush();
      const key = it.image.data.slice(0, 64) + it.image.data.length;
      if (!images.has(key)) {
        const bytes = Uint8Array.from(atob(it.image.data), (c) => c.charCodeAt(0));
        images.set(key, /png/i.test(it.image.format) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
      }
      const img = images.get(key);
      const [x1, y1] = T(it.box[0], it.box[1]), [x2, y2] = T(it.box[2], it.box[3]);
      page.drawImage(img, { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
    }
  }
  flush();
}
/** Characters Helvetica (WinAnsi) can print: others become their closest. */
const winAnsi = (s) => String(s).replace(/[  ]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\u0000-ÿ€–—…œŒ•]/g, "?");

// ---- fonts: Roboto, Roboto Condensed and the CJK faces embedded by subset (fonts.js); the standard fonts for Arial, Times,
// Courier; Helvetica for what cannot be read without the network ------------------------------------------------------------
export async function makeFonts(doc, L) {
  await loadFonts();
  if (window.fontkit) doc.registerFontkit(window.fontkit);
  const std = new Map(), emb = new Map();
  const stdFont = async (name) => { if (!std.has(name)) std.set(name, await doc.embedFont(L.StandardFonts[name])); return std.get(name); };
  const subset = async (file) => {
    if (!emb.has(file.url)) { let f = null; try { f = await doc.embedFont(file.bytes, { subset: true }); } catch (e) { f = null; } emb.set(file.url, f); }
    return emb.get(file.url);
  };
  return {
    reg: await stdFont("Helvetica"), bold: await stdFont("HelveticaBold"),
    /** The runs of a text with their PDF fonts: [{ font, text }]. */
    async runs(text, fam, bold, italic) {
      await ensureText([text], { italic: !!italic, families: [fam === "Roboto Condensed" ? fam : "Roboto"] }).catch(() => false);
      const out = [];
      for (const r of textRuns(text, bold, fam, italic)) {
        const file = r.key ? chunkFile(r.key, r.chunk) : null;
        let font = r.std ? await stdFont(r.std) : file ? await subset(file) : null, t = r.text;
        if (!font || r.missing) { font = await stdFont(bold ? "HelveticaBold" : "Helvetica"); t = winAnsi(t); }
        const last = out[out.length - 1];
        if (last && last.font === font) last.text += t; else out.push({ font, text: t });
      }
      return out;
    },
  };
}

// ---- the map, embedded -----------------------------------------------------------------------------------------------------
async function mapEmbed(E, doc, L) {
  if (E._mapEmbed?.doc === doc) return E._mapEmbed;
  const raw = await S.loadMap(E.meta.id, E.key);
  if (!raw) return null;
  const type = E.meta.map?.type || raw.type;
  let out;
  if (isPdf(E.meta.map?.name || E.ev.map.file, type)) {
    const src = await L.PDFDocument.load(raw.bytes, { ignoreEncryption: true });
    const p = src.getPage(0), cb = p.getCropBox();
    const emb = await doc.embedPage(p, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
    out = { kind: "pdf", emb, wPt: cb.width, hPt: cb.height };
  } else {
    let bytes = raw.bytes, img;
    if (/png/i.test(type)) img = await doc.embedPng(bytes);
    else if (/jpe?g/i.test(type)) img = await doc.embedJpg(bytes);
    else {
      // GIF, BMP, WebP, TIFF: a lossless PNG of the image
      const c = document.createElement("canvas"); c.width = E.map.pxW; c.height = E.map.pxH;
      c.getContext("2d").drawImage(E.map.image, 0, 0);
      bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
      img = await doc.embedPng(bytes);
    }
    out = { kind: "bitmap", img };
  }
  E._mapEmbed = { doc, ...out };
  return E._mapEmbed;
}

/** An OCAD or Mapper map drawn as vectors on a page (vmap/target.js): the box (map mm) at s points per mm, all or a part. */
async function vectorMap(E, doc, L, page, box, T, s, { fonts, rgb }, part) {
  const [{ PdfTarget }, { Matrix }] = await Promise.all([import("./vmap/target.js"), import("./vmap/geom.js")]);
  let darken = null;
  if (E.map.overprint) darken = page.node.newExtGState("GSdark", doc.context.register(doc.context.obj({ Type: "ExtGState", BM: "Darken" })));
  const [x0, y0] = T(0, 0);
  const t = new PdfTarget(L, page, new Matrix(s, 0, 0, s, x0, y0), { rgb, fonts, darken, minRes: 0.01 });
  E.map.drawPdf(t, box, part);
  await t.finish();
}

/** Another map of the event (maps.js) on a page: its sheet's mm placed by the inverse of its affine, then T (points). */
async function extraMapPdf(E, doc, L, page, mo, T, s, { fonts, rgb }) {
  const { invert } = await import("./maps.js");
  const inv = invert(mo.tf), [x0, y0] = T(0, 0);
  // sheet mm → page points: x' = p0 x + p1 y + p2, y' = p3 x + p4 y + p5
  const p = [s * inv[0], s * inv[1], s * inv[2] + x0, s * inv[3], s * inv[4], s * inv[5] + y0];
  const src = mo.src || (E.extraMaps?.[mo.id]);
  if (src?.kind === "vector" && src.drawPdf) {
    const [{ PdfTarget }, { Matrix }] = await Promise.all([import("./vmap/target.js"), import("./vmap/geom.js")]);
    const tg = new PdfTarget(L, page, new Matrix(p[0], p[3], p[1], p[4], p[2], p[5]), { rgb, fonts, darken: null, minRes: 0.01 });
    src.drawPdf(tg, [0, 0, src.w, src.h], "all");
    await tg.finish();
    return;
  }
  E._extraEmbed = E._extraEmbed?.doc === doc ? E._extraEmbed : { doc, maps: {} };
  let em = E._extraEmbed.maps[mo.id];
  if (!em) {
    const raw = await S.loadExtraMap(E.meta.id, mo.id, E.key);
    if (!raw) return;
    if (isPdf(mo.meta.map.file, raw.type)) { const sd = await L.PDFDocument.load(raw.bytes, { ignoreEncryption: true }); const pg = sd.getPage(0), cb = pg.getCropBox(); em = { pdf: await doc.embedPage(pg, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height }) }; }
    else if (/png/i.test(raw.type)) em = { img: await doc.embedPng(raw.bytes) };
    else if (/jpe?g/i.test(raw.type)) em = { img: await doc.embedJpg(raw.bytes) };
    else if (src?.image) { const c = document.createElement("canvas"); c.width = src.pxW; c.height = src.pxH; c.getContext("2d").drawImage(src.image, 0, 0); em = { img: await doc.embedPng(new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer())) }; }
    else return;
    E._extraEmbed.maps[mo.id] = em;
  }
  const w = mo.meta.map.w || src?.w, h = mo.meta.map.h || src?.h;
  page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(p[0], p[3], p[1], p[4], p[2], p[5]));
  if (em.pdf) page.drawPage(em.pdf, { x: 0, y: 0, xScale: 25.4 / 72, yScale: 25.4 / 72 });
  else page.drawImage(em.img, { x: 0, y: 0, width: w, height: h });
  page.pushOperators(L.popGraphicsState());
}
/** One course designator on a page of the document. adv: the advanced level's options (printx.js: registration marks, the
 *  printer's offset, georeferenced pages). combined: other designators drawn on the same map (« all on one map »). */
async function coursePage(E, doc, L, cd, { withMap = true, rgb = false, fonts, images, variationName = "", team = null, leg = null, adv = null, combined = null }) {
  const ev = E.ev;
  const layout = layoutCourse(ev, cd, { variationName, team, leg });
  let items = itemsFor(ev, layout);
  if (combined?.length) {
    // the courses together on one map: their drawings one after the other, the print area around all of them
    for (const d of combined) { const l2 = layoutCourse(ev, d.cd, { descriptions: false }); layout.objs.push(...l2.objs); items = items.concat(itemsFor(ev, l2)); }
  }
  let last = null;
  for (const tile of printTiles(E, cd, layout)) last = await onePage(E, doc, L, ev, items, tile, { withMap, rgb, fonts, images, adv, cd });
  return last;
}
async function onePage(E, doc, L, ev, items, { box, page: pg, k, tile }, { withMap, rgb, fonts, images, adv = null, cd = null }) {
  const page = doc.addPage([pg.w * PT, pg.h * PT]);
  const s = k * PT;                                          // points per map mm
  const m = pg.margin * PT;
  const T = (x, y) => [m + (x - box[0]) * s, m + (y - box[1]) * s];
  const clip = [L.pushGraphicsState(), L.moveTo(m, m), L.lineTo(pg.w * PT - m, m), L.lineTo(pg.w * PT - m, pg.h * PT - m), L.lineTo(m, pg.h * PT - m), L.closePath(), L.clip(), L.endPath()];
  page.pushOperators(...clip);
  // another map of the event for this course part (the advanced level: maps.js)
  const { mapOf } = ev.maps ? await import("./maps.js") : {};
  const other = withMap && mapOf ? mapOf(E, cd) : null;
  const vector = withMap && !other && E.map?.kind === "vector";
  if (vector) await syncMap(ev, E.map);
  const layer = vector ? layerOf(ev, E.map) : null, purple = coursePurple(ev, E.map);
  if (other) await extraMapPdf(E, doc, L, page, other, T, s, { fonts, rgb });
  else if (vector) await vectorMap(E, doc, L, page, box, T, s, { fonts, rgb }, layer == null ? "all" : "below");
  else if (withMap) {
    const me = await mapEmbed(E, doc, L);
    if (me?.kind === "pdf") page.drawPage(me.emb, { x: T(0, 0)[0], y: T(0, 0)[1], xScale: k, yScale: k });
    else if (me?.kind === "bitmap") { const [x0, y0] = T(0, 0); page.drawImage(me.img, { x: x0, y: y0, width: ev.map.w * s, height: ev.map.h * s }); }
  }
  let multiply = null;
  if (ev.appearance.blend !== "none" && layer == null) {
    const gs = doc.context.obj({ Type: "ExtGState", BM: "Multiply" });
    multiply = page.node.newExtGState("GSmul", doc.context.register(gs));
  }
  // an enlarged section (the advanced level): the map and the course again, magnified, in its frame
  const onInset = async (it) => {
    const { insetSrc } = await import("./layoutx.js");
    const src = insetSrc(it), f = it.factor, [l, b, r, tt] = it.box;
    const T2 = (x, y) => T(l + (x - src[0]) * f, b + (y - src[1]) * f);
    const [px0, py0] = T(l, b), [px1, py1] = T(r, tt);
    page.pushOperators(L.pushGraphicsState(), L.moveTo(px0, py0), L.lineTo(px1, py0), L.lineTo(px1, py1), L.lineTo(px0, py1), L.closePath(), L.clip(), L.endPath());
    if (vector) await vectorMap(E, doc, L, page, src, T2, s * f, { fonts, rgb }, "all");
    else if (withMap) {
      const me = await mapEmbed(E, doc, L);
      if (me?.kind === "pdf") page.drawPage(me.emb, { x: T2(0, 0)[0], y: T2(0, 0)[1], xScale: k * f, yScale: k * f });
      else if (me?.kind === "bitmap") { const [x0, y0] = T2(0, 0); page.drawImage(me.img, { x: x0, y: y0, width: ev.map.w * s * f, height: ev.map.h * s * f }); }
    }
    await drawItemsPdf(L, doc, page, ev, items.filter((x) => !x.desc && x.t !== "inset" && !x.insetFrame), T2, s * f, { multiply, fonts, rgb, images, purple });
    page.pushOperators(L.popGraphicsState());
  };
  if (layer != null) {
    // « layer » mode (Purple Pen): the lower purple between the map's colours, opaque; the rest over the whole map
    const [lower, rest] = splitItems(items);
    await drawItemsPdf(L, doc, page, ev, lower, T, s, { fonts, rgb, images, purple });
    await vectorMap(E, doc, L, page, box, T, s, { fonts, rgb }, "above");
    await drawItemsPdf(L, doc, page, ev, rest, T, s, { fonts, rgb, images, purple, onInset });
  } else await drawItemsPdf(L, doc, page, ev, items, T, s, { multiply, fonts, rgb, images, purple, onInset });
  page.pushOperators(L.popGraphicsState());
  if (adv) {
    const X = await import("./printx.js");
    if (adv.regmarks) X.registrationMarks(L, page, { margin: pg.margin, dx: adv.dx || 0, dy: adv.dy || 0 });
    if (adv.geo) X.georeferencePage(L, doc, page, ev, { box, k, margin: pg.margin });
  }
  // a tiled page says which: « 2/3 – 1/2 » (across, down) in the margin
  if (tile && fonts?.reg) page.drawText(`${tile[0]}/${tile[2]} – ${tile[1]}/${tile[3]}`, { x: m, y: Math.max(2, m / 2 - 3), size: 7, font: fonts.reg, color: L.rgb(0.4, 0.4, 0.4) });
  return page;
}

// ---- dialogs: course maps -------------------------------------------------------------------------------------------------------
/** The courses' PDF. only: one course checked (the ribbon's « Ce circuit »); the other choices are the last ones made. */
export async function coursesDialog(E, { only = null } = {}) {
  const ev = E.ev, ids = M.courseIds(ev);
  const anyParts = ids.some((id) => M.countParts(ev, M.cdCourse(id)) > 1), anyVars = ids.some((id) => M.hasVariations(ev, id));
  const v = await modal(E, { title: only ? t("trc.pdf.courseTitle", { name: esc(ev.courses[only]?.name || "") }) : t("trc.pdf.coursesTitle"), wide: true, ok: t("trc.pdf.create"), remember: "pdfCourses", body: `
    <div class="tr-checks">${[0, ...ids].map((id) => `<label class="tr-check"><input type="checkbox" name="c${id}" ${only ? (id === only ? "checked" : "") : id ? "checked" : ""}> ${id ? esc(ev.courses[id].name) : esc(t("trc.pdf.allControls"))}</label>`).join("")}</div>
    <div class="tr-grid2">${field(t("trc.pdf.files"), sel("files", [["one", t("trc.pdf.filesOne")], ["course", t("trc.pdf.filesCourse")], ...(anyParts ? [["part", t("trc.pdf.filesPart")]] : [])], "one"))}
    ${anyVars ? field(t("trc.pdf.variations"), sel("vars", [["all", t("trc.pdf.varsAll")], ["combined", t("trc.pdf.varsCombined")], ["teams", t("trc.pdf.varsTeams")]], "all")) : ""}
    ${field(t("trc.pdf.content"), sel("content", [["map", t("trc.pdf.contentMap")], ["course", t("trc.pdf.contentCourse")]], "map"))}
    ${field(t("trc.pdf.colours"), sel("color", [["cmyk", t("trc.pdf.cmyk")], ["rgb", t("trc.pdf.rgb")]], "cmyk"))}</div>
    ${E.pro ? `<h4 class="tr-pro-h">${esc(t("trc.dlg.advanced"))}</h4><div class="tr-grid2">
      ${field(t("trc.pdf.layout"), sel("layout", [["page", t("trc.pdf.layoutPage")], ["each", t("trc.pdf.layoutEach")], ["fill", t("trc.pdf.layoutFill")], ["combined", t("trc.pdf.layoutCombined")]], "page"))}
      ${field(t("trc.pdf.sheet"), sel("sheet", Object.keys(PAGES).map((p) => [p, p]), "A3"), t("trc.pdf.sheetHint"))}
      ${field(t("trc.pdf.back"), sel("back", [["", t("trc.pdf.backNone")], ["name", t("trc.pdf.backName")], ["classes", t("trc.pdf.backClasses")], ["team", t("trc.pdf.backTeam")]], ""), t("trc.pdf.backHint"))}
      <label class="tr-check"><input type="checkbox" name="regmarks"> ${esc(t("trc.pdf.regmarks"))}</label>
      ${field(t("trc.pdf.offset"), '<input name="dx" value="0" size="4" inputmode="decimal"> × <input name="dy" value="0" size="4" inputmode="decimal">', t("trc.pdf.offsetHint"))}
      <label class="tr-check"><input type="checkbox" name="geo" ${hasGeoEv(ev) ? "" : "disabled"}> ${esc(t("trc.pdf.geo"))}</label></div>` : ""}
    <p class="tr-hint">${t("trc.pdf.coursesHint", { where: where("print-area") })}</p>` });
  if (!v) return;
  E.status(t("trc.pdf.busy"), "busy");
  try {
    const L = await pdfLib();
    const designators = [];
    for (const id of [0, ...ids]) {
      if (!v[`c${id}`]) continue;
      if (!id) { designators.push({ cd: M.cdAll(), name: t("trc.pdf.allControls") }); continue; }
      const c = ev.courses[id];
      let list = [{ cd: M.cdCourse(id), name: c.name }];
      if (M.hasVariations(ev, id) && v.vars !== "combined") {
        if (v.vars === "teams") {
          const { teamVariations } = await import("./relay.js");
          list = teamVariations(ev, id).map((x) => ({ cd: M.cdCourse(id, -1, x.path), name: `${c.name} ${x.team}.${x.leg}`, variation: x.code, team: x.team, leg: x.leg }));
        } else list = M.allVariations(ev, id).map((x) => ({ cd: M.cdCourse(id, -1, x.path), name: `${c.name} ${x.code}`, variation: x.code }));
      }
      for (const d of list) {
        const parts = M.countParts(ev, d.cd);
        if (parts > 1) for (let p = 0; p < parts; p++) designators.push({ ...d, cd: { ...d.cd, part: p }, name: `${d.name}-${p + 1}`, base: d.name });
        else designators.push(d);
      }
    }
    if (!designators.length) { E.toast(t("trc.pdf.noCourse")); return; }
    // the advanced level's options (printx.js)
    const adv = E.pro ? { regmarks: !!v.regmarks, dx: num(v.dx) || 0, dy: num(v.dy) || 0, geo: !!v.geo } : null;
    const layoutMode = E.pro ? v.layout || "page" : "page";
    const build = async (list) => {
      const doc = await L.PDFDocument.create();
      doc.setTitle(t("trc.pdf.docCourses", { title: ev.title })); doc.setCreator("Ozimut"); doc.setProducer("Ozimut (pdf-lib)");
      const fonts = await makeFonts(doc, L);
      const images = new Map();
      if (layoutMode === "combined") {
        await coursePage(E, doc, L, list[0].cd, { withMap: v.content === "map", rgb: v.color === "rgb", fonts, images, variationName: list[0].variation || "", adv, combined: list.slice(1) });
      } else for (const d of list) {
        const page = await coursePage(E, doc, L, d.cd, { withMap: v.content === "map", rgb: v.color === "rgb", fonts, images, variationName: d.variation || "", team: d.team, leg: d.leg, adv });
        if (E.pro && v.back && page && layoutMode === "page") { const X = await import("./printx.js"); await X.backPage(L, doc, [page.getWidth(), page.getHeight()], X.backText(ev, d, v.back), fonts.bold); }
      }
      E._mapEmbed = null;
      const bytes = await doc.save();
      // several courses, or copies of one, on each sheet
      if (layoutMode === "each" || layoutMode === "fill") { const X = await import("./printx.js"); return X.impose(L, bytes, { sheet: PAGES[v.sheet] || PAGES.A3, mode: layoutMode }); }
      return bytes;
    };
    const base = fileName(ev.title);
    if (v.files === "one") download(`${t("trc.pdf.fileCourses", { name: base })}.pdf`, await build(designators), "application/pdf");
    else {
      const groups = new Map();
      for (const d of designators) { const key = v.files === "part" ? d.name : d.base || d.name; (groups.get(key) || groups.set(key, []).get(key)).push(d); }
      const files = {};
      for (const [name, list] of groups) files[`${fileName(name)}.pdf`] = await build(list);
      if (Object.keys(files).length === 1) download(Object.keys(files)[0], Object.values(files)[0], "application/pdf");
      else await saveFiles(E, files, `${t("trc.pdf.fileCourses", { name: base })}.zip`);
    }
    E.status(t("trc.pdf.done"), "ok");
  } catch (err) { console.error(err); E.status(t("trc.pdf.failed"), "bad"); E.toast(t("trc.pdf.failedToast", { err: err.message })); }
}

// ---- description sheets ----------------------------------------------------------------------------------------------------------
export async function descriptionsDialog(E) {
  const ev = E.ev, ids = M.courseIds(ev);
  const v = await modal(E, { title: t("trc.pdf.descTitle"), wide: true, ok: t("trc.pdf.create"), remember: "pdfDescriptions", body: `
    <div class="tr-checks">${[0, ...ids].map((id) => `<label class="tr-check"><input type="checkbox" name="c${id}" ${id ? "checked" : ""}> ${id ? esc(ev.courses[id].name) : esc(t("trc.pdf.allControls"))}</label>`).join("")}</div>
    <div class="tr-grid2">${field(t("trc.pdf.copies"), sel("copies", [["one", t("trc.pdf.copiesOne")], ["page", t("trc.pdf.copiesPage")], ["n", t("trc.pdf.copiesN")]], "page"))}
    ${field(t("trc.pdf.count"), '<input name="n" value="50" inputmode="numeric">')}
    ${field(t("trc.pdf.cell"), '<input name="cell" value="6" inputmode="decimal">', t("trc.pdf.cellHint"))}
    ${field(t("trc.pdf.descriptions"), sel("kind", [["course", t("trc.pdf.kindCourse")], ["symbols", t("trc.pdf.kindSymbols")], ["text", t("trc.pdf.kindText")], ["symbols-and-text", t("trc.pdf.kindSymbolsText")]], "course"))}
    ${field(t("trc.pdf.paper"), sel("paper", Object.keys(PAGES).map((k) => [k, k]), "A4"))}</div>
    ${E.pro ? `<h4 class="tr-pro-h">${esc(t("trc.dlg.advanced"))}</h4><div class="tr-grid2">
      ${field(t("trc.pdf.gapX"), '<input name="gapx" value="4" inputmode="decimal">')}${field(t("trc.pdf.gapY"), '<input name="gapy" value="4" inputmode="decimal">')}
      ${field(t("trc.pdf.pageMargin"), '<input name="pmargin" value="10" inputmode="decimal">', t("trc.pdf.spacingHint"))}</div>` : ""}` ,
  validate: (o) => (!(num(o.cell) >= 3 && num(o.cell) <= 10) ? t("trc.pdf.cellErr") : null) });
  if (!v) return;
  const L = await pdfLib();
  const doc = await L.PDFDocument.create();
  doc.setTitle(t("trc.pdf.docDescriptions", { title: ev.title })); doc.setCreator("Ozimut");
  const fonts = await makeFonts(doc, L);
  // spacing to the hundredth of a millimetre (the advanced level: Condes's loose descriptions), else Purple Pen's
  const r2 = (x, d) => (E.pro && Number.isFinite(num(x)) ? Math.max(0, Math.round(num(x) * 100) / 100) : d);
  const [PW, PH] = PAGES[v.paper], margin = r2(v.pmargin, 10), gap = r2(v.gapy, 4), gapX = r2(v.gapx, 4), cell = num(v.cell);
  const sheets = [];
  for (const id of [0, ...ids]) {
    if (!v[`c${id}`]) continue;
    const cd = id ? M.cdCourse(id) : M.cdAll();
    const kind = v.kind === "course" ? (id ? ev.courses[id].descKind : ev.allControls.descKind) : v.kind;
    const lines = describe(ev, cd, { purpose: "print", createKey: kind === "symbols" });
    sheets.push({ lines, kind, size: sheetSize(lines, kind, cell) });
  }
  // pack sheets in columns, top to bottom, page after page (DescriptionPrinting)
  let page = null, x = margin, y = margin, colW = 0;
  const newPage = () => { page = doc.addPage([PW * PT, PH * PT]); x = margin; y = margin; colW = 0; };
  const placeOne = async (sh) => {
    if (!page) newPage();
    if (y + sh.size.h > PH - margin) { x += colW + gapX; y = margin; colW = 0; }
    if (x + sh.size.w > PW - margin) newPage();
    const items = sheetItems(sh.lines, sh.kind, cell, { x0: x, y0: y, white: false });
    const T = (xx, yy) => [xx * PT, (PH - yy) * PT];
    await drawItemsPdf(L, doc, page, ev, items.map((it) => (it.t === "text" ? { ...it, color: "black" } : { ...it, color: "black" })), T, PT, { fonts });
    y += sh.size.h + gap; colW = Math.max(colW, sh.size.w);
  };
  for (const sh of sheets) {
    if (v.copies === "one") await placeOne(sh);
    else {
      const perCol = Math.max(1, Math.floor((PH - 2 * margin + gap) / (sh.size.h + gap))), perRow = Math.max(1, Math.floor((PW - 2 * margin + gapX) / (sh.size.w + gapX)));
      const perPage = perCol * perRow, total = v.copies === "page" ? perPage : Math.max(1, Math.round(num(v.n)));
      newPage();
      for (let i = 0; i < total; i++) { if (i && i % perPage === 0) newPage(); await placeOne(sh); }
      page = null;
    }
  }
  download(`${t("trc.pdf.fileDescriptions", { name: fileName(ev.title) })}.pdf`, await doc.save(), "application/pdf");
}

// ---- punch cards ---------------------------------------------------------------------------------------------------------------
export async function punchDialog(E) {
  const ev = E.ev, ids = M.courseIds(ev, false);
  // the advanced level: blank backup cards (Condes's Emit/SI backup cards: the boxes numbered, no punch pattern)
  let blank = false;
  if (E.pro) { const v = await modal(E, { title: t("trc.pdf.punchTitle"), body: `<label class="tr-check"><input type="radio" name="k" value="" checked> ${esc(t("trc.pdf.punchPatterns"))}</label>
    <label class="tr-check"><input type="radio" name="k" value="blank"> ${esc(t("trc.pdf.punchBlank"))}</label>` }); if (!v) return; blank = v.k === "blank"; }
  const L = await pdfLib();
  const doc = await L.PDFDocument.create();
  const font = await doc.embedFont(L.StandardFonts.Helvetica), bold = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const { rows, cols, ltr, ttb } = ev.punchCard, box = 18, m = 12;
  const black = L.cmyk(0, 0, 0, 1);
  let any = false;
  for (const id of ids) {
    const v = M.view(ev, M.cdCourse(id), { specials: false, descriptions: false });
    const normals = v.controls.filter((x) => ev.controls[x.control].kind === "normal");
    if (!normals.length) continue;
    any = true;
    const page = doc.addPage([210 * PT, 297 * PT]);
    page.drawText(`${ev.title} — ${ev.courses[id].name}`, { x: m * PT, y: (297 - m) * PT - 12, size: 12, font: bold, color: black });
    normals.forEach((cv, i) => {
      const per = rows * cols, n = i % per, r = Math.floor(n / cols), c = n % cols;
      const col = ltr ? c : cols - 1 - c, row = ttb ? r : rows - 1 - r;
      const x = m + col * box, yTop = 297 - m - 10 - (Math.floor(i / per) * (rows + 1) + row) * box;
      const P = (xx, yy) => [xx * PT, yy * PT];
      page.drawRectangle({ x: P(x, yTop - box)[0], y: P(x, yTop - box)[1], width: box * PT, height: box * PT, borderColor: black, borderWidth: 0.8 });
      page.drawText(`${cv.ordinal}`, { x: (x + 1) * PT, y: (yTop - 4) * PT, size: 8, font: bold, color: black });
      page.drawText(`${ev.controls[cv.control].code}`, { x: (x + box - 6) * PT, y: (yTop - 4) * PT, size: 7, font, color: black });
      const pp = blank ? null : ev.controls[cv.control].punch;
      if (pp?.size) {
        const cellSize = (box - 6) / pp.size;
        for (let a = 0; a < pp.size; a++) for (let b = 0; b < pp.size; b++) if (pp.dots[a * pp.size + b] === "1")
          page.drawCircle({ x: (x + 3 + (b + 0.5) * cellSize) * PT, y: (yTop - 5 - (a + 0.5) * cellSize) * PT, size: cellSize * 0.35 * PT, color: black });
      }
    });
  }
  if (!any) { E.toast(t("trc.pdf.noControls")); return; }
  download(`${t("trc.pdf.filePunch", { name: fileName(ev.title) })}.pdf`, await doc.save(), "application/pdf");
}

// ---- print area (File › Set Print Area) ------------------------------------------------------------------------------------------
export async function printAreaDialog(E) {
  const ev = E.ev, cd = E.cd;
  const pa = M.printAreaOf(ev, cd) || M.DEFAULT_PRINT_AREA();
  const page = pageOf(pa);
  const paperName = Object.entries(PAGES).find(([, [w, h]]) => (Math.abs(w - Math.min(page.w, page.h)) < 1 && Math.abs(h - Math.max(page.w, page.h)) < 1))?.[0] || "A4";
  const v = await modal(E, { title: t("trc.pdf.areaTitle", { name: cd.course ? ev.courses[cd.course].name : t("trc.pdf.allControls") }), wide: true, body: `
    <div class="tr-grid2">${field(t("trc.pdf.paper"), sel("paper", Object.keys(PAGES).map((k) => [k, k]), paperName))}
    ${field(t("trc.pdf.orientation"), sel("orient", [["auto", t("trc.pdf.orientAuto")], ["portrait", t("trc.pdf.portrait")], ["landscape", t("trc.pdf.landscape")]], pa.auto && !pa.restrictOrientation ? "auto" : pa.landscape ? "landscape" : "portrait"))}
    ${field(t("trc.pdf.margins"), `<input name="margin" value="${Math.round(page.margin)}" inputmode="numeric">`)}
    ${field(t("trc.pdf.area"), sel("where", [["auto", t("trc.pdf.whereAuto")], ["draw", t("trc.pdf.whereDraw")], ["view", t("trc.pdf.whereView")], ["keep", t("trc.pdf.whereKeep")]], pa.auto ? "auto" : "keep"))}
    ${field(t("trc.pdf.over"), sel("over", [["tile", t("trc.pdf.overTile")], ["crop", t("trc.pdf.overCrop")]], pa.restrict ? "crop" : "tile"))}</div>
    <label class="tr-check"><input type="checkbox" name="all"> ${esc(t("trc.pdf.allCourses"))}</label>
    <p class="tr-hint">${t("trc.pdf.areaShow", { where: where("view-printarea") })}</p>` });
  if (!v) return;
  const [w, h] = PAGES[v.paper];
  const land = v.orient === "landscape";
  const make = (old) => {
    const out = { ...M.DEFAULT_PRINT_AREA(), ...old, pageW: Math.round(w / 0.254), pageH: Math.round(h / 0.254), landscape: land, margins: Math.round((num(v.margin) || 0) / 0.254),
      restrictOrientation: v.orient !== "auto" };
    if (v.where === "auto") { out.auto = true; out.rect = null; }
    if (v.where === "view") {
      const W = E.canvas.clientWidth, H = E.canvas.clientHeight, [l, t] = E.toMap(0, 0), [r, b] = E.toMap(W, H);
      out.auto = false; out.rect = [l, b, r, t];
    }
    if (v.where === "draw" && drawn) { out.auto = false; out.rect = drawn; }
    if (!out.auto) out.restrict = v.over === "crop";
    return out;
  };
  let drawn = null;
  if (v.where === "draw") {
    // two corners clicked on the map
    const corner = (msg) => new Promise((res) => { E.help(msg); E.pickOnce = res; E.pickCancel = () => res(null); });
    const a = await corner(t("trc.pdf.cornerFirst")), b2 = a ? await corner(t("trc.pdf.cornerSecond")) : null;
    E.help();
    if (!a || !b2) return;
    drawn = [Math.min(a[0], b2[0]), Math.min(a[1], b2[1]), Math.max(a[0], b2[0]), Math.max(a[1], b2[1])];
  }
  E.change((x) => {
    if (v.all) { x.printArea = make(x.printArea); for (const c of Object.values(x.courses)) c.printArea = make(c.printArea); }
    else if (cd.course) { const c = x.courses[cd.course]; if (cd.part >= 0) c.partAreas = { ...(c.partAreas || {}), [cd.part]: make(c.partAreas?.[cd.part] || c.printArea) }; else c.printArea = make(c.printArea); }
    else x.printArea = make(x.printArea);
  }, t("trc.pdf.areaUndo"));
  E.opts.printArea = true; E.redraw();
}
void widthInCells;

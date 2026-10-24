// Printing options of the advanced level (owner, 2026-10-24, after Condes's print menu), applied to the courses' PDF built by
// pdf.js: several courses — or copies of one — on each sheet (Condes's « One copy of each course » / « Fill page with copies »,
// for trainings printed four to an A3), the back of each map (its course, classes, or team and leg, for duplex printing),
// registration marks for printing the courses over maps printed beforehand (with the printer's shift corrected), and
// georeferenced pages (ISO 32000's geospatial viewport and measure, as Avenza Maps and other GPS apps read them).

import { hasGeo, toLatLon } from "./geo.js";
import { t } from "./lang.js";

const PT = 72 / 25.4;

/** Registration marks: a cross in a circle at each corner of the page's printed area, 6 mm in from it, shifted by the printer's
 *  offset (mm, dx right, dy up). Drawn in black on every colour separation (they are what the overprint is aligned on). */
export function registrationMarks(L, page, { margin = 0, dx = 0, dy = 0 } = {}) {
  const w = page.getWidth(), h = page.getHeight(), m = margin * PT + 6 * PT, r = 2.5 * PT;
  const ops = [L.pushGraphicsState(), L.setStrokingCmykColor(1, 1, 1, 1), L.setLineWidth(0.25)];
  for (const [x, y] of [[m, m], [w - m, m], [m, h - m], [w - m, h - m]]) {
    const cx = x + dx * PT, cy = y + dy * PT, k = 0.5522847498 * r;
    ops.push(L.moveTo(cx - 2 * r, cy), L.lineTo(cx + 2 * r, cy), L.moveTo(cx, cy - 2 * r), L.lineTo(cx, cy + 2 * r), L.stroke());
    ops.push(L.moveTo(cx + r, cy), L.appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r), L.appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
      L.appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r), L.appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy), L.stroke());
  }
  ops.push(L.popGraphicsState());
  page.pushOperators(...ops);
}

/** A page's georeference (ISO 32000-2, 12.10: the page's /VP viewport with a GEO measure): the printed box's corners in WGS 84. */
export function georeferencePage(L, doc, page, ev, { box, k, margin = 0 }) {
  if (!hasGeo(ev)) return false;
  const pw = page.getWidth(), ph = page.getHeight(), m = margin * PT, s = k * PT;
  const x0 = m, y0 = m, x1 = m + (box[2] - box[0]) * s, y1 = m + (box[3] - box[1]) * s;
  // the map's corners at the viewport's corners (bottom left, top left, top right, bottom right), as LPTS 0…1
  const corners = [[box[0], box[1]], [box[0], box[3]], [box[2], box[3]], [box[2], box[1]]];
  const gpts = corners.flatMap(([x, y]) => toLatLon(ev, x, y));
  const C = doc.context;
  const measure = C.obj({ Type: "Measure", Subtype: "GEO", Bounds: [0, 0, 0, 1, 1, 1, 1, 0],
    GCS: C.obj({ Type: "GEOGCS", EPSG: 4326, WKT: L.PDFString.of('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]') }),
    GPTS: gpts, LPTS: [0, 0, 0, 1, 1, 1, 1, 0], PDU: [L.PDFName.of("M"), L.PDFName.of("SQM"), L.PDFName.of("DEG")] });
  const vp = C.obj({ Type: "Viewport", BBox: [x0, y0, Math.min(pw, x1), Math.min(ph, y1)], Name: L.PDFString.of(ev.title || "Map"), Measure: measure });
  page.node.set(L.PDFName.of("VP"), C.obj([vp]));
  return true;
}

/** The back of a course's map: one line of text, large, in the middle of the page (« A », « A — D21, H21 », « 12.3 »). */
export async function backPage(L, doc, size, text, font) {
  const page = doc.addPage(size);
  const w = page.getWidth(), h = page.getHeight();
  let fs = 48;
  while (fs > 10 && font.widthOfTextAtSize(text, fs) > w - 40) fs -= 2;
  page.drawText(text, { x: (w - font.widthOfTextAtSize(text, fs)) / 2, y: h / 2 - fs / 3, size: fs, font, color: L.cmyk(0, 0, 0, 1) });
  return page;
}

/**
 * Several pages on each sheet (map pages of different sizes placed row by row, left to right, top to bottom; or one page
 * repeated to fill the sheet). bytes: the PDF of the course pages; sheet: [w, h] mm; mode: "each" | "fill"; gap mm. Returns the
 * new PDF's bytes.
 */
export async function impose(L, bytes, { sheet, mode = "each", gap = 4, margin = 6 } = {}) {
  const src = await L.PDFDocument.load(bytes);
  const out = await L.PDFDocument.create();
  out.setCreator("Ozimut"); out.setProducer("Ozimut (pdf-lib)");
  const pages = await out.embedPages(src.getPages());
  const [SW, SH] = sheet.map((v) => v * PT), g = gap * PT, m = margin * PT;
  let page = null, x = m, y = 0, rowH = 0;
  const newSheet = () => { page = out.addPage([SW, SH]); x = m; y = SH - m; rowH = 0; };
  const place = (p) => {
    // a page larger than the sheet is scaled down to fit (a proof), never up
    const sc = Math.min(1, (SW - 2 * m) / p.width, (SH - 2 * m) / p.height), w = p.width * sc, h = p.height * sc;
    if (!page) newSheet();
    if (x + w > SW - m + 0.5) { x = m; y -= rowH + g; rowH = 0; }
    if (y - h < m - 0.5) { newSheet(); }
    page.drawPage(p, { x, y: y - h, xScale: sc, yScale: sc });
    x += w + g; rowH = Math.max(rowH, h);
  };
  if (mode === "fill") {
    for (const p of pages) {
      const sc = Math.min(1, (SW - 2 * m) / p.width, (SH - 2 * m) / p.height), w = p.width * sc, h = p.height * sc;
      const nx = Math.max(1, Math.floor((SW - 2 * m + g) / (w + g))), ny = Math.max(1, Math.floor((SH - 2 * m + g) / (h + g)));
      newSheet();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) page.drawPage(p, { x: m + i * (w + g), y: SH - m - (j + 1) * h - j * g, xScale: sc, yScale: sc });
      page = null;
    }
  } else for (const p of pages) place(p);
  return out.save();
}

/** The text on the back of a designator's map: its course (and part), its classes, or its team and leg. */
export function backText(ev, d, what) {
  const c = d.cd.course ? ev.courses[d.cd.course] : null;
  if (what === "team" && d.team != null) return `${d.team}.${d.leg}`;
  if (what === "classes" && c?.secondary) return `${d.name} — ${c.secondary.replace(/\|/g, " ")}`;
  return d.name || t("trc.px.allControls");
}

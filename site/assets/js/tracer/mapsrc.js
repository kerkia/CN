// The Tracer's base map, read in the browser from the file as it came: an image (its resolution read from the file when
// it says it — PNG pHYs, JPEG JFIF or EXIF, TIFF —, else asked; TIFF read by tiff.js) or a PDF page (shown with pdf.js, kept as it is for the course
// PDFs, where it is embedded unchanged). Map millimetres follow Purple Pen: the sheet's bottom-left corner is the
// origin, y up; an image measures pixels × 25.4 / dpi, a PDF its page in points × 25.4 / 72.

import { isTiff, decodeTiff, tiffDpi } from "./tiff.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
let pdfjsLib = null;
async function pdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(/* webpackIgnore: true */ PDFJS);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}
export const isPdf = (name, type) => /\.pdf$/i.test(name || "") || type === "application/pdf";
export const isMapFile = (f) => /\.(png|jpe?g|gif|bmp|webp|tiff?|pdf)$/i.test(f.name) || /^image\//.test(f.type) || f.type === "application/pdf";
export const mimeOf = (name, type) => type && type !== "application/octet-stream" ? type
  : ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", pdf: "application/pdf", tif: "image/tiff", tiff: "image/tiff" })[(String(name).split(".").pop() || "").toLowerCase()] || "application/octet-stream";

/** The dots per inch an image file declares, or 0. */
export function imageDpi(bytes) {
  const a = new Uint8Array(bytes), v = new DataView(a.buffer, a.byteOffset, a.byteLength);
  if (isTiff(a)) return tiffDpi(a);
  // PNG: the pHYs chunk (pixels per metre)
  if (a[0] === 0x89 && a[1] === 0x50) {
    for (let p = 8; p + 12 < a.length;) {
      const len = v.getUint32(p), type = String.fromCharCode(a[p + 4], a[p + 5], a[p + 6], a[p + 7]);
      if (type === "pHYs" && a[p + 16] === 1) return Math.round((v.getUint32(p + 8) * 0.0254) * 10) / 10;
      if (type === "IDAT") break;
      p += 12 + len;
    }
    return 0;
  }
  // JPEG: JFIF density (APP0), else EXIF XResolution (APP1)
  if (a[0] === 0xff && a[1] === 0xd8) {
    for (let p = 2; p + 4 < a.length;) {
      if (a[p] !== 0xff) break;
      const marker = a[p + 1], len = v.getUint16(p + 2);
      if (marker === 0xe0 && String.fromCharCode(...a.subarray(p + 4, p + 9)) === "JFIF\0") {
        const unit = a[p + 11], x = v.getUint16(p + 12);
        if (unit === 1) return x; if (unit === 2) return Math.round(x * 2.54 * 10) / 10;
      }
      if (marker === 0xe1 && String.fromCharCode(...a.subarray(p + 4, p + 8)) === "Exif") {
        const t = p + 10, le = a[t] === 0x49, u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
        const ifd = u32(4), n = u16(ifd);
        let xr = 0, unit = 2;
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12, tag = u16(e);
          if (tag === 0x011a) { const off = u32(e + 8); xr = u32(off) / (u32(off + 4) || 1); }
          if (tag === 0x0128) unit = u16(e + 8);
        }
        if (xr) return unit === 3 ? Math.round(xr * 2.54 * 10) / 10 : Math.round(xr * 10) / 10;
      }
      if (marker === 0xda) break;
      p += 2 + len;
    }
  }
  return 0;
}

/**
 * Open a map from its bytes: { kind: "bitmap"|"pdf", w, h (mm of the sheet at dpi), pxW, pxH, dpi, image (bitmap), page, draw }.
 * For a PDF, `dpi` is the resolution of the first rendering; renderRegion() renders any part at any resolution.
 */
export async function openMap(bytes, type, name = "", dpiHint = 0) {
  if (isPdf(name, type)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });                // points
    const w = (vp.width * 25.4) / 72, h = (vp.height * 25.4) / 72;
    // a first rendering around 200 dpi, at most 7000 px on a side
    const dpi = Math.min(200, (7000 * 25.4) / Math.max(w, h));
    const scale = dpi / 72;
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width * scale); c.height = Math.round(vp.height * scale);
    await page.render({ canvasContext: c.getContext("2d"), viewport: page.getViewport({ scale }) }).promise;
    return {
      kind: "pdf", w, h, pxW: c.width, pxH: c.height, dpi, image: c, page, doc,
      /** Render a part of the page (mm box [l, b, r, t]) at pxPerMm into a canvas. */
      async renderRegion([l, b, r, t], pxPerMm, signal) {
        const s = (pxPerMm * 25.4) / 72;
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round((r - l) * pxPerMm)); out.height = Math.max(1, Math.round((t - b) * pxPerMm));
        const offX = -(l * 72) / 25.4 * s, offY = -((h - t) * 72) / 25.4 * s;
        const task = page.render({ canvasContext: out.getContext("2d"), viewport: page.getViewport({ scale: s }), transform: [1, 0, 0, 1, offX, offY] });
        if (signal) signal.addEventListener("abort", () => task.cancel());
        await task.promise;
        return out;
      },
    };
  }
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isTiff(u8)) {
    // browsers do not open TIFF: read here (tiff.js), with a GeoTIFF's georeferencing when it has one
    const t = await decodeTiff(u8);
    const dpi = t.dpi || dpiHint || 0, d = dpi || 254;
    return withLevels({ kind: "bitmap", w: (t.width * 25.4) / d, h: (t.height * 25.4) / d, pxW: t.width, pxH: t.height, dpi, image: t.canvas, world: t.world });
  }
  let blob = new Blob([bytes], { type: type || mimeOf(name) });
  let image;
  try { image = await createImageBitmap(blob); } catch (e) { throw new Error("map"); }
  const dpi = imageDpi(bytes) || dpiHint || 0;
  const d = dpi || 254;                                        // unknown: 10 px per mm until the user says
  return withLevels({ kind: "bitmap", w: (image.width * 25.4) / d, h: (image.height * 25.4) / d, pxW: image.width, pxH: image.height, dpi, image });
}
/** Reduced copies of a large image (½, ¼, ⅛…), made in the background: drawn instead of the full image when zoomed out,
 *  a large scan stays smooth to move. levels: [{ k (copy px per image px), image }], the finest first. */
function withLevels(src) {
  src.levels = [];
  if (src.pxW * src.pxH < 6e6 || typeof createImageBitmap !== "function") return src;
  (async () => {
    let w = src.pxW, h = src.pxH, from = src.image;
    while (w * h > 1.5e6) {
      w = Math.round(w / 2); h = Math.round(h / 2);
      try { from = await createImageBitmap(from, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); } catch (e) { return; }
      src.levels.push({ k: w / src.pxW, image: from });
    }
  })();
  return src;
}

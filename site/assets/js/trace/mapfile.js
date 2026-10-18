// A map file read in the browser, for the Analyse pages: an image (PNG, JPEG, WebP, GIF, BMP) as an ImageBitmap, or a
// PDF's first page rendered on a canvas by pdf.js (served from /assets/vendor, loaded only when a PDF comes). imageBlob() gives the
// map back as a file to store, never degraded: the original image when it is one, else a lossless PNG of the rendering.

import { PDFJS, PDFJS_WORKER } from "../vendor.js";
const MAX_SIDE = 4200;                                 // a PDF page rendered at most this wide or high

export const isImage = (f) => /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(f.name) || f.type.startsWith("image/") || f.type === "application/pdf";

/** The map as an ImageBitmap (an image) or a canvas (a PDF's first page). Throws "pdf" or "map". */
export async function readMap(file) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    let pdfjs;
    try { pdfjs = await import(/* webpackIgnore: true */ PDFJS); } catch (e) { throw new Error("pdf"); }
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SIDE / v1.width, MAX_SIDE / v1.height, 6);
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      return c;
    } catch (e) { throw new Error("pdf"); }
  }
  try { return await createImageBitmap(file); } catch (e) { throw new Error("map"); }
}

/** An image file's type, from its name when the system gave none. */
const typeOf = (f) => f.type || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" })[(f.name.split(".").pop() || "").toLowerCase()] || "";

/**
 * The map as a file to keep, at its full resolution and quality (owner, 2026-10-14: a stored map is never degraded):
 * a PNG, JPEG or WebP image exactly as it came; anything else — a PDF's page as rendered, a GIF, a BMP — as a PNG
 * (lossless) of what was drawn. Returns a Blob with its type.
 */
export async function imageBlob(file, image) {
  const type = file ? typeOf(file) : "";
  if (/^image\/(png|jpeg|webp)$/.test(type)) return file.type === type ? file : new Blob([file], { type });
  const c = document.createElement("canvas");
  c.width = image.width; c.height = image.height;
  c.getContext("2d").drawImage(image, 0, 0);
  const b = await new Promise((res) => c.toBlob((x) => res(x), "image/png"));
  if (!b) throw new Error("map");
  return b;
}

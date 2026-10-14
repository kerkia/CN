// A map file read in the browser, for the Analyse pages: an image (PNG, JPEG, WebP, GIF, BMP) as an ImageBitmap, or a
// PDF's first page rendered on a canvas by pdf.js (from jsdelivr, loaded only when a PDF comes). imageBlob() gives the
// map back as a file to store (the original image when it is one, else a JPEG of the rendering).

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
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

/**
 * The map as a file to keep (maps are kept as long as their analysis, so their size counts): a JPEG or WebP of up to
 * 6 MB and 8000 px is kept as it is; anything else — a PNG, a PDF's rendering, a heavier file — is re-encoded as WebP
 * (quality 0.9, the longest side at most 8000 px; JPEG where the browser cannot write WebP), unless that is no smaller.
 * Returns { blob, scale }: scale < 1 when the map was made smaller (positions on it are to be scaled alike).
 */
export async function imageBlob(file, image) {
  const MAX = 8000, side = Math.max(image.width, image.height);
  if (file && /^image\/(jpeg|webp)$/.test(file.type) && file.size <= 6 * 1024 * 1024 && side <= MAX) return { blob: file, scale: 1 };
  const k = Math.min(1, MAX / side), c = document.createElement("canvas");
  c.width = Math.round(image.width * k); c.height = Math.round(image.height * k);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);         // a transparent PNG on white
  g.drawImage(image, 0, 0, c.width, c.height);
  const encode = (type, q) => new Promise((res) => c.toBlob((b) => res(b), type, q));
  let b = await encode("image/webp", 0.9);
  if (!b || b.type !== "image/webp") b = await encode("image/jpeg", 0.9);
  if (!b) throw new Error("map");
  return { blob: file && /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= b.size && k === 1 ? file : b, scale: k };
}

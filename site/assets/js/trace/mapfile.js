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

/** The map as a file to store: the original when it is a PNG, JPEG or WebP image, else a JPEG of what was drawn. */
export async function imageBlob(file, image) {
  if (file && /^image\/(png|jpeg|webp)$/.test(file.type) && file.size <= 25 * 1024 * 1024) return file;
  const c = document.createElement("canvas");
  c.width = image.width; c.height = image.height;
  c.getContext("2d").drawImage(image, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("map"))), "image/jpeg", 0.9));
}

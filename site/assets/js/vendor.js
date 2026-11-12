// The third-party code and fonts the site loads, all served by the site itself from /assets/vendor/ (owner, 2026-10-18: no
// request to a public CDN — Safari reported cdn.jsdelivr.net as a tracker). Built by tools/vendor.py from the versions pinned
// there; `python tools/vendor.py check` says which have newer releases. On an update, change the version here too, then check
// the pages that use it:
//   ECHARTS    — every chart (charts.js loadECharts: loaded once the first page shows, a page with charts waits for it)
//   PDFJS      — maps given as PDF (Analyse solo / multi, Tracer), start lists in PDF (Horaires)
//   PDFLIB, FONTKIT, FFLATE — the Tracer's PDFs and fonts, the .ocnt file (zip)
//   PROJ4      — the Tracer's georeferencing from OCAD / Mapper files
//   DUCKDB     — « IA »
//   FONTSOURCE — the Tracer's fonts (Roboto, Roboto Condensed, Noto Sans JP / TC / HK)
//   FLAGS      — the countries' flags (« En direct »)
//   THREE      — « Analyse solo »'s 3D view (trace/view3d.js), loaded when the view opens
//   QRCODE     — « Depuis mon téléphone »'s QR code (phonelink.js)
//   POLYCLIP   — Cartographier's union, difference and intersection of areas (mapper/boolean.js)
//   GEOTIFF    — national terrain models read as GeoTIFF / COG (trace/terrain.js: Switzerland, the USA, Canada, New Zealand)
//   JSTS       — Cartographier's sprint map from open data (mapper/data/town.js: buffers, unions, line merging)
const V = "/assets/vendor";
export const ECHARTS = `${V}/echarts@5.5.1`;
export const PDFJS = `${V}/pdfjs-dist@4.10.38/build/pdf.min.mjs`;
export const PDFJS_WORKER = `${V}/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`;
export const PDFLIB = `${V}/pdf-lib@1.17.1/dist/pdf-lib.min.js`;
export const FONTKIT = `${V}/pdf-lib-fontkit@1.1.1/dist/fontkit.umd.min.js`;
export const FFLATE = `${V}/fflate@0.8.2/umd/index.js`;
export const PROJ4 = `${V}/proj4@2.12.1/dist/proj4.js`;
export const DUCKDB_DIR = `${V}/duckdb-wasm@1.32.0/dist`;
export const FONTSOURCE = `${V}/fontsource`;
export const THREE = `${V}/three@0.185.1/build/three.module.min.js`;
export const QRCODE = `${V}/qrcode-generator@2.0.4/dist/qrcode.mjs`;
export const POLYCLIP = `${V}/polygon-clipping@0.15.7/dist/polygon-clipping.umd.min.js`;
export const GEOTIFF = `${V}/geotiff@2.1.3/dist-browser/geotiff.js`;
export const JSTS = `${V}/jsts@2.12.1/dist/jsts.min.js`;
/** A country's flag (ISO alpha-2), a 4:3 SVG. */
export const flag = (cc) => `${V}/flag-icons@7.5.0/flags/4x3/${String(cc).toLowerCase()}.svg`;
export const FONT_PKG = {
  Roboto: `${FONTSOURCE}/roboto@5.0.8`, "Roboto Condensed": `${FONTSOURCE}/roboto-condensed@5.0.8`,
  "Noto Sans JP": `${FONTSOURCE}/noto-sans-jp@5.0.19`, "Noto Sans TC": `${FONTSOURCE}/noto-sans-tc@5.0.19`,
  "Noto Sans HK": `${FONTSOURCE}/noto-sans-hk@5.0.19`,
};
/** A file split in parts (Cloudflare Pages takes no file over 25 MiB): its parts fetched and joined, as an object URL. */
export async function joined(url, type) {
  const parts = await Promise.all([1, 2].map((i) => fetch(`${url}.part${i}`).then((r) => {
    if (!r.ok) throw new Error(`${url}.part${i}: HTTP ${r.status}`);
    return r.blob();
  })));
  return URL.createObjectURL(new Blob(parts, { type }));
}

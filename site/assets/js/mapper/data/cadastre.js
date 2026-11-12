// France's cadastre (Cartographier, 2026-11-12): the parcels of the communes an area lies in, from Etalab's cadastre
// (cadastre.data.gouv.fr, one GeoJSON a commune, open, CORS, Licence Ouverte 2.0) — the source tools/virtually/town_fetch.py
// uses —, the communes found by geo.api.gouv.fr at the area's corners and centre (a city's « arrondissement municipal » first:
// Paris, Lyon and Marseille are filed by them). When that service or Etalab does not answer, IGN's PCI parcels (« Parcellaire
// Express », the same DGFiP parcels, on IGN's WFS by the area's box). data/town.js reads them: the public road space is what the
// parcels leave uncovered, the private gardens are parcels holding houses.

import { WFS } from "./bdtopo.js";

export const CREDIT = "Cadastre © DGFiP (Etalab, IGN ; Licence Ouverte 2.0)";
const GEO = "https://geo.api.gouv.fr/communes";
const ETALAB = (code) => `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${code}/geojson/parcelles`;

/** A fetch that gives up after ms (geo.api.gouv.fr took 83 s for one answer on 2026-11-12). */
async function timed(f, url, ms) {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null, tm = ac && setTimeout(() => ac.abort(), ms);
  try { return await f(url, { credentials: "omit", signal: ac?.signal }); } finally { if (tm) clearTimeout(tm); }
}
/** The INSEE codes of the communes (or municipal arrondissements) at these points [[lat, lon]…], asked all at once. */
export async function communesAt(points, f = fetch) {
  const one = async ([lat, lon]) => {
    for (const type of ["arrondissement-municipal", null]) {
      const q = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6), fields: "code", ...(type ? { type } : {}) });
      const r = await timed(f, `${GEO}?${q}`, 10000);
      if (!r.ok) throw new Error(`geo.api ${r.status}`);
      const list = await r.json();
      if (list.length) return list.map((c) => c.code);
    }
    return [];
  };
  return [...new Set((await Promise.all(points.map(one))).flat())];
}

const inBox = (box) => (ring) => ring.some(([lo, la]) => la >= box.s && la <= box.n && lo >= box.w && lo <= box.e);
/** A parcel's rings [[lon, lat]…] (the first its outline) touches the box. */
function touches(geom, box) {
  const polys = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
  const hit = inBox(box);
  return polys.some((p) => {
    const xs = p[0].map((q) => q[0]), ys = p[0].map((q) => q[1]);
    return hit(p[0]) || (Math.min(...xs) <= box.e && Math.max(...xs) >= box.w && Math.min(...ys) <= box.n && Math.max(...ys) >= box.s);
  });
}

/** IGN's PCI parcels over a box (degrees), in Lambert 93: GeoJSON features. */
async function pciParcels(box, f = fetch) {
  const out = [];
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle",
      SRSNAME: "EPSG:2154", BBOX: `${box.s},${box.w},${box.n},${box.e},urn:ogc:def:crs:EPSG::4326`, OUTPUTFORMAT: "application/json", COUNT: "5000", STARTINDEX: String(page * 5000) });
    const r = await f(`${WFS}?${q}`, { credentials: "omit" });
    if (!r.ok) throw new Error(`pci ${r.status}`);
    const list = (await r.json()).features || [];
    out.push(...list);
    if (list.length < 5000) break;
  }
  return out;
}

/**
 * The parcels over an area (degrees { s, w, n, e }): { wgs84: [features in lon/lat], l93: [features in Lambert 93], communes }.
 * opts: fetch, onStage(code, i, n).
 */
export async function loadParcels(box, opts = {}) {
  const f = opts.fetch || fetch;
  const pts = [[box.s, box.w], [box.s, box.e], [box.n, box.w], [box.n, box.e], [(box.s + box.n) / 2, (box.w + box.e) / 2]];
  let codes = [], fallback = false;
  try { codes = await communesAt(pts, f); } catch (e) { fallback = true; }
  const wgs84 = [];
  for (let i = 0; i < codes.length; i++) {
    opts.onStage?.(codes[i], i, codes.length);
    if (fallback) break;
    try {
      const r = await timed(f, ETALAB(codes[i]), 60000);
      if (!r.ok) throw new Error(`cadastre ${r.status}`);
      for (const p of (await r.json()).features || []) if (touches(p.geometry, box)) wgs84.push(p);
    } catch (e) { fallback = true; }
  }
  // a commune Etalab could not give: the whole box from IGN's PCI instead (the same parcels; the others' dropped to avoid twins)
  if (fallback || !codes.length) return { wgs84: [], l93: await pciParcels(box, f), communes: codes, source: "pci" };
  return { wgs84, l93: [], communes: codes, source: "etalab" };
}

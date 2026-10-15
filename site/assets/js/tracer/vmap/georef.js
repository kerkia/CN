// An OCAD or OpenOrienteering Mapper map's own georeferencing turned into the Tracer's (ev.geo, an affine (lon, lat) → map mm;
// tracer/geo.js): the paper's millimetres to the grid's metres as Purple Pen does (Map.CheckRealWorldCoords: × scale / 1000 ×
// grid scale factor, turned by the grid's angle, moved to the grid's coordinates of the paper's origin), the grid to latitude and
// longitude by proj4js. The grid comes from OCAD's grid-and-zone id (Purple Pen's table of proj4 strings), an EPSG code (a table
// of the usual ones), or the PROJ.4 text a Mapper file holds — all in /assets/tracer/crs.json. Without any of them, coordinates
// that can only be Lambert 93 are read as such.

import { geoFromPoints } from "../geo.js";
import { projector, guessCrs, LAMBERT93 } from "../../trace/georef.js";

export const PROJ4 = "https://cdn.jsdelivr.net/npm/proj4@2.12.1/dist/proj4.js";
let tableP = null, projP = null;
const table = () => (tableP ||= fetch("/assets/tracer/crs.json").then((r) => (r.ok ? r.json() : { ocad: {}, epsg: {} })).catch(() => { tableP = null; return { ocad: {}, epsg: {} }; }));
const proj4lib = () => (projP ||= new Promise((res, rej) => {
  if (window.proj4) { res(window.proj4); return; }
  const s = document.createElement("script"); s.src = PROJ4; s.onload = () => res(window.proj4); s.onerror = () => { projP = null; rej(new Error("proj4")); };
  document.head.appendChild(s);
}));

/** The grid's proj4 text and a name for it, or null. */
export async function gridOf(rw) {
  const t = await table();
  let s = rw.proj4 || "", name = "";
  const init = /\+init=epsg:(\d+)/i.exec(s);
  if (init) { s = t.epsg[init[1]] || ""; name = `EPSG:${init[1]}`; }
  if (!s && rw.epsg) { s = t.epsg[String(rw.epsg)] || ""; name = `EPSG:${rw.epsg}`; }
  if (!s && rw.zone) { s = t.ocad[String(rw.zone)] || ""; name = Math.abs(rw.zone) > 2000 && Math.abs(rw.zone) < 2061 ? `UTM ${Math.abs(rw.zone) - 2000}${rw.zone < 0 ? " S" : ""}` : `OCAD ${rw.zone}`; }
  if (s && !name) name = /\+proj=utm/.test(s) ? `UTM ${/\+zone=(\d+)/.exec(s)?.[1] || ""}` : "PROJ";
  if (/\+proj=lcc/.test(s) && /lat_0=46\.5/.test(s) && /lon_0=3\b/.test(s) && /x_0=700000/.test(s)) name = "Lambert 93";
  return s ? { proj4: s, name } : null;
}

/**
 * The georeference of a vector map opened in the frame { ox, oy, w, h } (mapsrc.openVector): { geo, name } or null when the
 * file has no grid coordinates, or none that can be placed on the globe.
 */
export async function geoFromVector(map, { ox, oy, w, h }) {
  const rw = map.realWorld;
  if (!rw || (!rw.x && !rw.y)) return null;
  const k = (map.scale / 1000) * (rw.gridScale || 1), a = (-(rw.angle || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const grid = (x, y) => { const X = (x + ox) * k, Y = (y + oy) * k; return [X * ca - Y * sa + rw.x, X * sa + Y * ca + rw.y]; };
  let toLatLon = null, name = "";
  const g = await gridOf(rw).catch(() => null);
  if (g) {
    const p4 = await proj4lib().catch(() => null);
    if (p4) {
      try { const f = p4(g.proj4, "WGS84"); toLatLon = (X, Y) => { const [lon, lat] = f.forward([X, Y]); return [lat, lon]; }; name = g.name; }
      catch (e) { toLatLon = null; }
    }
  }
  if (!toLatLon) {
    // no grid named: only Lambert 93's numbers are unmistakable (France), or plain degrees
    const [X, Y] = grid(w / 2, h / 2), crs = guessCrs(X, Y, 0);
    if (crs !== LAMBERT93 && crs?.kind !== "latlon") return null;
    toLatLon = projector(crs); name = crs.name;
  }
  const pts = [];
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]]) {
    const [lat, lon] = toLatLon(...grid(x, y));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
    pts.push({ mm: [x, y], lat, lon });
  }
  const geo = geoFromPoints(pts);
  return geo ? { geo, name } : null;
}

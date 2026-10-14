// Georeferenced inputs for the Analyse page, read in the browser:
// - KMZ / KML (a GroundOverlay with its LatLonBox and rotation, or a gx:LatLonQuad; the image inside the KMZ):
//   OCAD's, OpenOrienteering Mapper's and Livelox's exports;
// - a world file (.jgw, .pgw, .tfw, .wld…) beside the image, with its .prj or the system guessed from the numbers
//   (Lambert 93, UTM); Lambert conformal conic and transverse Mercator are inverted here (GRS80);
// - IOF XML 3.0 CourseData (Purple Pen, OCAD, Condes): the courses, their controls' codes and order, the controls'
//   positions on the map (mm) and, when the map is georeferenced, on the ground (lat/lng).
// Each gives an affine transform from the trace's metres to the image's pixels (fitAffine on the image's corners).

import { fitAffine } from "./geom.js";
import { toLocal } from "./track.js";

const R = 6371000;
const num = (s) => { const v = s == null ? NaN : Number(String(s).trim()); return Number.isFinite(v) ? v : null; };

// ---- zip / KMZ --------------------------------------------------------------------------------------------------------
/** The entries of a zip (stored or deflated): [{ name, data: Uint8Array }]. */
export async function readZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), n = buf.byteLength;
  let e = -1;
  for (let i = n - 22; i >= Math.max(0, n - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("zip");
  const count = dv.getUint16(e + 10, true), out = [];
  let p = dv.getUint32(e + 16, true);
  for (let k = 0; k < count && p + 46 <= n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(start, start + csize);
    let data = null;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    if (data) out.push({ name, data });
  }
  return out;
}
/** The ground overlays of a KML: [{ href, box: { n, s, e, w, rot } | null, quad: [[lon, lat] × 4] | null }]. */
export function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return [];
  const ch = (el, name) => [...el.getElementsByTagName("*")].find((c) => c.localName === name);
  const out = [];
  for (const g of [...doc.getElementsByTagName("*")].filter((x) => x.localName === "GroundOverlay")) {
    const href = ch(g, "href")?.textContent.trim() || "";
    const box = ch(g, "LatLonBox"), quad = ch(g, "LatLonQuad");
    const o = { href, box: null, quad: null };
    if (box) o.box = { n: num(ch(box, "north")?.textContent), s: num(ch(box, "south")?.textContent), e: num(ch(box, "east")?.textContent), w: num(ch(box, "west")?.textContent), rot: num(ch(box, "rotation")?.textContent) || 0 };
    if (quad) o.quad = (ch(quad, "coordinates")?.textContent.trim().split(/\s+/) || []).map((c) => c.split(",").map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)).map((c) => [c[0], c[1]]);
    if ((o.box && [o.box.n, o.box.s, o.box.e, o.box.w].every((v) => v != null)) || (o.quad && o.quad.length === 4)) out.push(o);
  }
  return out;
}
/** The transform metres -> px of an overlay drawn on an image W × H. */
export function fitFromKml(ov, W, H, track) {
  let corners;                                       // lat/lon of the image's corners: top-left, top-right, bottom-right, bottom-left
  if (ov.quad) corners = [ov.quad[3], ov.quad[2], ov.quad[1], ov.quad[0]].map(([lon, lat]) => [lat, lon]);     // KML: lower-left first, counter-clockwise
  else {
    const { n, s, e, w, rot } = ov.box, latc = (n + s) / 2, lonc = (e + w) / 2;
    const kx = (Math.PI / 180) * R * Math.cos((latc * Math.PI) / 180), ky = (Math.PI / 180) * R;
    const hw = ((e - w) / 2) * kx, hh = ((n - s) / 2) * ky, a = (rot * Math.PI) / 180;
    corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => [latc + (x * Math.sin(a) + y * Math.cos(a)) / ky, lonc + (x * Math.cos(a) - y * Math.sin(a)) / kx]);
  }
  return fitAffine(corners.map(([lat, lon]) => toLocal(track, lat, lon)), [[0, 0], [W, 0], [W, H], [0, H]]);
}

// ---- world files and projections ---------------------------------------------------------------------------------------
export const isWorldFileName = (name) => /\.(jgw|pgw|tfw|gfw|bpw|wld|jpgw|pngw|tifw)$/i.test(name);
/** The six numbers of a world file: A, D, B, E, C, F (X = A col + B row + C, Y = D col + E row + F). */
export function parseWorldFile(text) {
  const v = text.trim().split(/\s+/).map(Number);
  return v.length >= 6 && v.slice(0, 6).every(Number.isFinite) ? v.slice(0, 6) : null;
}
export const LAMBERT93 = { kind: "lcc", lat1: 44, lat2: 49, lat0: 46.5, lon0: 3, fe: 700000, fn: 6600000, name: "Lambert 93" };
/** A coordinate system from a .prj (WKT): Lambert conformal conic, transverse Mercator (UTM) or plain lat/lon. */
export function crsFromWkt(wkt) {
  const proj = (/PROJECTION\s*\[\s*"([^"]+)"/i.exec(wkt)?.[1] || "").toLowerCase();
  const param = (names, dflt) => { const m = new RegExp(`PARAMETER\\s*\\[\\s*"(?:${names})"\\s*,\\s*([-0-9.eE+]+)`, "i").exec(wkt); return m ? Number(m[1]) : dflt; };
  if (/lambert_conformal_conic/.test(proj)) {
    return { kind: "lcc", lat1: param("standard_parallel_1", 44), lat2: param("standard_parallel_2", 49), lat0: param("latitude_of_origin|latitude_of_center", 46.5),
      lon0: param("central_meridian|longitude_of_center", 3), fe: param("false_easting", 0), fn: param("false_northing", 0), name: /PROJCS\s*\[\s*"([^"]+)"/i.exec(wkt)?.[1] || "Lambert" };
  }
  if (/transverse_mercator/.test(proj)) {
    return { kind: "tm", lon0: param("central_meridian", 3), k0: param("scale_factor", 0.9996), lat0: param("latitude_of_origin", 0), fe: param("false_easting", 500000),
      fn: param("false_northing", 0), name: /PROJCS\s*\[\s*"([^"]+)"/i.exec(wkt)?.[1] || "UTM" };
  }
  if (/GEOGCS/i.test(wkt) && !/PROJCS/i.test(wkt)) return { kind: "latlon", name: "WGS 84" };
  return null;
}
/** Without a .prj: the system the numbers suggest (lon: the trace's, for the UTM zone). */
export function guessCrs(X, Y, lon) {
  if (Math.abs(X) <= 180 && Math.abs(Y) <= 90) return { kind: "latlon", name: "WGS 84" };
  if (X > 0 && X < 1.4e6 && Y > 6.0e6 && Y < 7.3e6) return LAMBERT93;
  if (X > 1e5 && X < 1e6 && Y > 1e6 && Y < 1e7) { const zone = Math.floor((lon + 180) / 6) + 1; return { kind: "tm", lon0: zone * 6 - 183, k0: 0.9996, lat0: 0, fe: 500000, fn: 0, name: `UTM ${zone}` }; }
  return null;
}
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F);
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
/** (X, Y) in the system -> [lat, lon] in degrees. */
export function projector(crs) {
  if (crs.kind === "latlon") return (X, Y) => [Y, X];
  if (crs.kind === "lcc") {
    const e = Math.sqrt(E2);
    const m = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
    const tf = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
    const p1 = rad(crs.lat1), p2 = rad(crs.lat2), p0 = rad(crs.lat0);
    const n = Math.log(m(p1) / m(p2)) / Math.log(tf(p1) / tf(p2)), Fc = m(p1) / (n * Math.pow(tf(p1), n)), rho0 = A * Fc * Math.pow(tf(p0), n);
    return (X, Y) => {
      const x = X - crs.fe, y = rho0 - (Y - crs.fn), rho = Math.sign(n) * Math.hypot(x, y), tt = Math.pow(rho / (A * Fc), 1 / n);
      const lam = Math.atan2(x, y) / n + rad(crs.lon0);
      let phi = Math.PI / 2 - 2 * Math.atan(tt);
      for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2));
      return [deg(phi), deg(lam)];
    };
  }
  // transverse Mercator (Snyder)
  const ep2 = E2 / (1 - E2), e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2)), k0 = crs.k0 ?? 0.9996;
  const arc = (p) => A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * p - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * p));
  const M0 = arc(rad(crs.lat0 || 0));
  return (X, Y) => {
    const M = M0 + (Y - crs.fn) / k0, mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
    const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
    const C1 = ep2 * cos1 * cos1, T1 = tan1 * tan1, N1 = A / Math.sqrt(1 - E2 * sin1 * sin1), R1 = (A * (1 - E2)) / Math.pow(1 - E2 * sin1 * sin1, 1.5), D = (X - crs.fe) / (N1 * k0);
    const phi = phi1 - ((N1 * tan1) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
    const lam = rad(crs.lon0) + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / cos1;
    return [deg(phi), deg(lam)];
  };
}
/** The transform metres -> px from a world file on an image W × H, in a known system. */
export function fitFromWorld(wf, crs, W, H, track) {
  const [a, d, b, e, c, f] = wf, inv = projector(crs), src = [], dst = [];
  for (const [px, py] of [[0, 0], [W, 0], [W, H], [0, H]]) {
    const col = px - 0.5, row = py - 0.5;
    const [lat, lon] = inv(a * col + b * row + c, d * col + e * row + f);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    src.push(toLocal(track, lat, lon)); dst.push([px, py]);
  }
  return fitAffine(src, dst);
}

// ---- IOF XML 3.0 CourseData ----------------------------------------------------------------------------------------------
/** { controls: Map id -> { id, lat, lon, mx, my }, courses: [{ name, length, climb, controls: [{ type, id }] }], map } or null. */
export function parseIofCourse(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "CourseData") return null;
  const all = (el, name) => [...el.getElementsByTagName("*")].filter((c) => c.localName === name);
  const ch = (el, name) => [...el.children].find((c) => c.localName === name);
  const controls = new Map();
  for (const c of all(doc, "Control")) {
    if (c.parentElement?.localName === "CourseControl") continue;
    const id = ch(c, "Id")?.textContent.trim();
    if (!id) continue;
    const pos = ch(c, "Position"), mp = ch(c, "MapPosition");
    const k = mp?.getAttribute("unit") === "px" ? 1 : 1;
    controls.set(id, { id, lat: num(pos?.getAttribute("lat")), lon: num(pos?.getAttribute("lng")), mx: mp ? num(mp.getAttribute("x")) * k : null, my: mp ? num(mp.getAttribute("y")) * k : null });
  }
  const courses = all(doc, "Course").map((c) => ({
    name: ch(c, "Name")?.textContent.trim() || "", length: num(ch(c, "Length")?.textContent), climb: num(ch(c, "Climb")?.textContent),
    controls: [...c.children].filter((x) => x.localName === "CourseControl").map((cc) => ({ type: cc.getAttribute("type") || "Control", id: ch(cc, "Control")?.textContent.trim() || "" })) })).filter((c) => c.controls.length);
  const map = all(doc, "Map")[0], tl = map && ch(map, "MapPositionTopLeft"), br = map && ch(map, "MapPositionBottomRight");
  return { controls, courses, map: { scale: num(map && ch(map, "Scale")?.textContent),
    tl: tl ? [num(tl.getAttribute("x")), num(tl.getAttribute("y"))] : null, br: br ? [num(br.getAttribute("x")), num(br.getAttribute("y"))] : null } };
}

// The Tracer map's georeference: an affine transform from (longitude, latitude) to map millimetres, ev.geo = { a … f }
// (x = a lon + b lat + c, y = d lon + e lat + f), and back. It comes from points placed on the map with their ground
// coordinates (two or more), from a world file beside an image map (with its .prj, or the system guessed: Lambert 93,
// UTM), or from a KMZ/KML ground overlay of the same image. GPX, KML, the controls' positions in IOF XML, the field mode,
// the climb from IGN's elevations and the publication to « Analyse multi » use it.

import { projector, crsFromWkt, guessCrs } from "../trace/georef.js";

export const hasGeo = (ev) => !!ev.geo && ["a", "b", "c", "d", "e", "f"].every((k) => Number.isFinite(ev.geo[k])) && Math.abs(ev.geo.a * ev.geo.e - ev.geo.b * ev.geo.d) > 1e-12;
export const toMm = (ev, lat, lon) => { const g = ev.geo; return [g.a * lon + g.b * lat + g.c, g.d * lon + g.e * lat + g.f]; };
/** Map mm -> [lat, lon]. */
export function toLatLon(ev, x, y) {
  const g = ev.geo, det = g.a * g.e - g.b * g.d;
  const X = x - g.c, Y = y - g.f;
  const lon = (g.e * X - g.b * Y) / det, lat = (-g.d * X + g.a * Y) / det;
  return [lat, lon];
}
/** Least-squares affine (≥ 3 points) or similarity (2 points) from [{ mm: [x, y], lat, lon }]. */
export function geoFromPoints(pts) {
  if (pts.length < 2) return null;
  const lat0 = pts[0].lat, k = Math.cos((lat0 * Math.PI) / 180);
  if (pts.length === 2) {
    // a similarity in a local frame (lon scaled by cos lat), turned back into an affine on (lon, lat)
    const [p, q] = pts;
    const sx = [(p.lon) * k, p.lat], qx = [(q.lon) * k, q.lat];
    const dxs = qx[0] - sx[0], dys = qx[1] - sx[1], dxd = q.mm[0] - p.mm[0], dyd = q.mm[1] - p.mm[1];
    const den = dxs * dxs + dys * dys;
    if (!den) return null;
    const A = (dxd * dxs + dyd * dys) / den, B = (dyd * dxs - dxd * dys) / den;     // x' = A x - B y, y' = B x + A y
    const c = p.mm[0] - (A * sx[0] - B * sx[1]), f = p.mm[1] - (B * sx[0] + A * sx[1]);
    return { a: A * k, b: -B, c, d: B * k, e: A, f };
  }
  // normal equations for x = a lon + b lat + c, y = d lon + e lat + f
  const S = Array.from({ length: 3 }, () => [0, 0, 0]), bx = [0, 0, 0], by = [0, 0, 0];
  for (const p of pts) {
    const v = [p.lon, p.lat, 1];
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += v[i] * v[j]; bx[i] += v[i] * p.mm[0]; by[i] += v[i] * p.mm[1]; }
  }
  const sol = (b) => solve3(S, b);
  const X = sol(bx), Y = sol(by);
  return X && Y ? { a: X[0], b: X[1], c: X[2], d: Y[0], e: Y[1], f: Y[2] } : null;
}
function solve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-18) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}
/** From a world file (six numbers) and a .prj text (or null) on an image map: pixel corners -> ground -> geo. */
export function geoFromWorld(ev, wf, prj, pxW, pxH) {
  const [A, D, B, E, C, F] = wf;
  const crs = (prj && crsFromWkt(prj)) || guessCrs(C, F, 2);
  if (!crs) return null;
  const inv = projector(crs), pts = [];
  for (const [px, py] of [[0, 0], [pxW, 0], [pxW, pxH], [0, pxH]]) {
    const [lat, lon] = inv(A * (px - 0.5) + B * (py - 0.5) + C, D * (px - 0.5) + E * (py - 0.5) + F);
    pts.push({ lat, lon, mm: [(px * ev.map.w) / pxW, ev.map.h - (py * ev.map.h) / pxH] });
  }
  return geoFromPoints(pts);
}
/** From a KML ground overlay (box or quad, see trace/georef.parseKml) covering the whole image map. */
export function geoFromOverlay(ev, ov) {
  let corners;
  if (ov.quad) corners = [ov.quad[3], ov.quad[2], ov.quad[1], ov.quad[0]].map(([lon, lat]) => [lat, lon]);
  else {
    const { n, s, e, w, rot } = ov.box, latc = (n + s) / 2, lonc = (e + w) / 2, R = 6371000;
    const kx = (Math.PI / 180) * R * Math.cos((latc * Math.PI) / 180), ky = (Math.PI / 180) * R;
    const hw = ((e - w) / 2) * kx, hh = ((n - s) / 2) * ky, a = (rot * Math.PI) / 180;
    corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => [latc + (x * Math.sin(a) + y * Math.cos(a)) / ky, lonc + (x * Math.cos(a) - y * Math.sin(a)) / kx]);
  }
  const mm = [[0, ev.map.h], [ev.map.w, ev.map.h], [ev.map.w, 0], [0, 0]];
  return geoFromPoints(corners.map(([lat, lon], i) => ({ lat, lon, mm: mm[i] })));
}
/** Metres on the ground per map mm along x and y (a check of the georeference against the map's scale). */
export function groundScale(ev) {
  const [la1, lo1] = toLatLon(ev, 0, 0), [la2, lo2] = toLatLon(ev, 100, 0), [la3, lo3] = toLatLon(ev, 0, 100);
  const d = (a, b, c, e) => { const R = 6371000, p = Math.PI / 180; const x = (e - b) * p * Math.cos(((a + c) / 2) * p), y = (c - a) * p; return R * Math.hypot(x, y); };
  return [d(la1, lo1, la2, lo2) / 100, d(la1, lo1, la3, lo3) / 100];
}

// Routes drawn by hand (owner, 2026-11-02, after RouteGadget): a runner without a GPS track clicks their route on the map, control
// to control, and gives the controls' times — the published split times when the race has them, else typed, the total at least.
// The route is then run at an even pace leg by leg (between two timed points), one point a second, and written as a GPX file:
// the pages read it as any trace (« a GPX made by hand »). Its `ozimut:drawn` extension keeps what the drawing was — the points in
// the map's pixels, which are controls, their times, the map's size — and the georeference the pixels were turned into degrees
// with, so that the page lays the route back exactly where it was drawn and the drawing can be edited again. A map without a
// georeference gets a frame of its own around (0, 0) at a scale the page found (`nogeo`: its coordinates mean nothing on the
// globe — no heights asked, no GPX offered to download).
//
// A drawing: { pts: [[x, y]] (px), kind: ["start" | "control" | "finish" | ""] (one a point), at: { index: race seconds } }.

import { frameAt } from "./share.js";

export const DRAWN_NS = "https://ozimut.com/gpx/drawn/1";        // track.js reads it back (`tr.drawn`)

/** The controls of a drawing, in order: [{ i (point index), k (start | control | finish) }]. */
export const anchorsOf = (d) => d.pts.map((p, i) => ({ i, k: d.kind[i] })).filter((a) => a.k);
/** Length in px along the drawing from point a to point b. */
function along(pts, a, b) { let s = 0; for (let i = a + 1; i <= b; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
/** The straight course from control to control, in px (as a course's length is measured). */
export function straightPx(d) {
  const A = anchorsOf(d);
  let s = 0;
  for (let j = 1; j < A.length; j++) s += Math.hypot(d.pts[A[j].i][0] - d.pts[A[j - 1].i][0], d.pts[A[j].i][1] - d.pts[A[j - 1].i][1]);
  return s;
}

/**
 * Each point's race time (s): the controls' times given, those without one spread by the distance drawn between the timed
 * controls around them. Needs the start (0) and the finish's time. Null when they are missing or the times do not rise.
 */
export function timeline(d) {
  const A = anchorsOf(d);
  if (A.length < 2 || A[0].k !== "start" || A[A.length - 1].k !== "finish") return null;
  const known = A.map((a) => (a.k === "start" ? 0 : Number.isFinite(d.at?.[a.i]) ? d.at[a.i] : null));
  if (known[known.length - 1] == null) return null;
  const T = new Array(d.pts.length).fill(null);
  let j0 = 0;
  for (let j = 1; j < A.length; j++) {
    if (known[j] == null) continue;
    const a = A[j0].i, b = A[j].i, ta = known[j0], tb = known[j];
    if (!(tb > ta)) return null;
    const L = along(d.pts, a, b) || 1;
    T[a] = ta;
    for (let i = a + 1; i <= b; i++) T[i] = ta + ((tb - ta) * along(d.pts, a, i)) / L;
    j0 = j;
  }
  return T;
}
/** The route one point a second: [{ x, y, s }]. */
export function sample(d, T) {
  const A = anchorsOf(d), a = A[0].i, b = A[A.length - 1].i, out = [];
  for (let i = a; i < b; i++) {
    const [x0, y0] = d.pts[i], [x1, y1] = d.pts[i + 1], t0 = T[i], t1 = T[i + 1];
    for (let s = Math.ceil(t0); s < t1; s++) { const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0; out.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, s }); }
  }
  out.push({ x: d.pts[b][0], y: d.pts[b][1], s: T[b] });
  return out;
}

/** px -> [lat, lon] by a georeference (lon, lat) -> px. */
export function pxToLatLon(g, x, y) {
  const det = g.a * g.e - g.b * g.d, X = x - g.c, Y = y - g.f;
  return [(g.a * Y - g.d * X) / det, (g.e * X - g.b * Y) / det];
}
/** A frame of its own for a map without georeference: `pxPerM` pixels a metre, north up, the map's centre at (0, 0). */
export function ownGeo(pxPerM, W, H) {
  const F = frameAt(0, 0);
  return { a: pxPerM * F.kx, b: 0, c: W / 2, d: 0, e: -pxPerM * F.ky, f: H / 2 };
}

const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
/**
 * The GPX of a drawing: { d, T (timeline), geo, nogeo, startMs (the race's start, ms), w, h, name }. The extension keeps the
 * drawing, so that it is laid back and edited.
 */
export function toGpx({ d, T, geo, nogeo, startMs, w, h, name = "", km = null }) {
  const S = sample(d, T);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const meta = { v: 1, w, h, geo, nogeo: !!nogeo, start: startMs, km, pts: d.pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), kind: d.kind, at: d.at };
  const pts = S.map((p) => { const [lat, lon] = pxToLatLon(geo, p.x, p.y); return `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${iso(startMs + p.s * 1000)}</time></trkpt>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ozimut" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ozimut="${DRAWN_NS}">
<metadata><name>${esc(name)}</name><time>${iso(startMs)}</time><extensions><ozimut:drawn>${esc(JSON.stringify(meta))}</ozimut:drawn></extensions></metadata>
<trk><name>${esc(name)}</name><type>orienteering</type><trkseg>
${pts.join("\n")}
</trkseg></trk>
</gpx>
`;
}
/** A course's passes (race seconds, as its track's own) timed by the drawing: each control the drawing pointed on its spot, in
 *  order, else null — or null altogether when the drawing cannot be timed. */
export function drawnPasses(d, ctrls, anyOrder = false) {
  const T = timeline(d);
  if (!T) return null;
  const A = anchorsOf(d), used = new Set();
  let k = 0;
  return ctrls.map((c) => {
    for (let j = anyOrder ? 0 : k; j < A.length; j++) {             // a score course: its controls in any order
      const p = d.pts[A[j].i];
      if (!used.has(j) && A[j].k === c.kind && Math.hypot(p[0] - c.x, p[1] - c.y) < 1) { used.add(j); k = j + 1; return T[A[j].i]; }
    }
    return null;
  });
}
/** The drawing's points one a second in degrees and ms: [{ lat, lon, ms }] (track.js fromPoints makes them a track). */
export const latLonPoints = ({ d, T, geo, startMs }) => sample(d, T).map((p) => { const [lat, lon] = pxToLatLon(geo, p.x, p.y); return { lat, lon, ms: startMs + p.s * 1000 }; });
/** A time typed — « 52:10 », « 1:02:30 », « 52 » (minutes) — in seconds; null when empty, NaN when unreadable. */
export function parseClock(s) {
  const v = String(s || "").trim().replace(",", ".");
  if (!v) return null;
  const p = v.split(/[:h']/).map((q) => q.trim()).filter((q) => q !== "");
  if (!p.length || p.some((q) => !/^\d+(\.\d+)?$/.test(q))) return NaN;
  return p.reduce((a, q) => a * 60 + Number(q), 0) * (p.length === 1 ? 60 : 1);
}
/** A drawing kept in a GPX, back as a drawing. */
export const drawingOf = (m) => ({ pts: m.pts.map((p) => [p[0], p[1]]), kind: [...m.kind], at: { ...(m.at || {}) } });

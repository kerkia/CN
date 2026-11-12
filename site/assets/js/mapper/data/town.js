// A town's sprint map from open data (Cartographier, 2026-11-12): IGN's BD TOPO, France's cadastre (Etalab) and OpenStreetMap
// merged by feature kind into ISSprOM 2019-2 objects, by the rules tools/virtually/town_map.py and mkocd.mjs follow since a
// setter and mapper reviewed a generated map (Alec, 2026-11-12; CLAUDE.md « A mapper's review »), as far as the browser's data
// allows — no LiDAR nor photograph here, so no vegetation from the ground's heights, no measured wall heights, no lone trees but
// OpenStreetMap's. Geometry in the map's own metres (map mm × scale / 1000), through JSTS (vendored: buffers, unions, overlays,
// line merging). Outside France (no BD TOPO, no cadastre) OpenStreetMap alone: its streets at their width.
//
// What each symbol comes from:
// - 521 buildings (BD TOPO's, else OSM's), those that touch drawn as one; a shed under 20 m² inside the ground not to be entered
//   left out; 522 canopies (OSM's building=roof|carport);
// - 501 paved area: the public road space — what the cadastre's parcels leave uncovered within their reach, so a street's
//   paving runs to the property line (its grass, OSM's lawns and parks there, open land 401) —, BD TOPO's roads at their
//   carriageway width plus sidewalks in town, OSM's pedestrian areas, squares, parkings, sidewalks and service ways; 501.4 the
//   through roads (BD TOPO's importance 1-3, OSM's trunk to secondary); 501.1 the paved area's edge wherever it meets anything but
//   a building or a wall, fence or hedge, and the carriageways' kerbs in town;
// - 501.6-501.9 paved footways and cycle paths as lines at their width (1.4, 2, 3, 4 m), 505 / 506 unpaved paths, the network
//   joined (noded, merged through its junctions, an end within 4 m of another path drawn on to it), as Bézier curves; BD TOPO's
//   paths and stairways kept wherever OSM has none of the same kind within 4 m (what one source has exists);
// - 532.1-532.6 stairways at their width (OSM's `width`, else 2 m);
// - 520 ground not to be entered: the cadastre's parcels holding a house (under 6 000 m², no church or sports building),
//   schools, OSM's private ground, the railway's corridor; inside it hedges, walls, fences, paths and lone trees left out; 995
//   « boundary to confirm » on its edge where no wall, fence, hedge or building is known (a helper, never printed);
// - sports grounds (OSM's pitches and tracks, else BD TOPO's): grass and turf pitches 401 edged by 415, hard ones 501, the tennis
//   courts paved and fenced all round (518), the athletics track and multi-sport courts paved under 709, goals and rugby posts a
//   531 cross;
// - 411 hedges, 513 / 515 walls and 516 / 518 fences (an OSM wall within 1.2 m of BD TOPO's the same wall), 301 water, 305 / 306
//   streams as curves, 509 railway and tramway, 104 / 105.1 banks, 526 monuments, 311 fountains, 417 / 418 OSM's trees;
// - 990 / 991 every OpenStreetMap way and tagged node, on hidden helper symbols;
// - contours (optional): every 2.5 m from the terrain model smoothed over 4 m, dropped or kept whole (no loop under 600 m², no
//   line under 40 m), cut at the buildings only — a contour ends at a building or the map's edge, nowhere else —, as curves.

import { JSTS } from "../../vendor.js";
import { ocad, areaCoords, bezier, lineCoords, ringArea } from "./frame.js";
import { fetchOverpass, townQuery, rings as relRings, STREET_W } from "./osm.js";
import { layerFeatures, CREDIT as BD_CREDIT } from "./bdtopo.js";
import { loadParcels, CREDIT as CAD_CREDIT } from "./cadastre.js";

export { BD_CREDIT, CAD_CREDIT };
const S = (n, sub = 0) => n * 1000 + sub;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tick = () => new Promise((ok) => setTimeout(ok, 0));
export const BD_LAYERS = ["batiment", "troncon_de_route", "equipement_de_transport", "troncon_de_voie_ferree", "surface_hydrographique", "troncon_hydrographique",
  "haie", "construction_lineaire", "terrain_de_sport", "zone_d_activite_ou_d_interet", "ligne_orographique", "zone_de_vegetation"];

// ---- JSTS ------------------------------------------------------------------------------------------------------------------------
let jP = null;
/** JSTS (a classic script defining window.jsts), loaded once; in Node a test sets globalThis.jsts first. */
export const loadJsts = () => (jP ||= globalThis.jsts ? Promise.resolve(globalThis.jsts) : new Promise((ok, no) => {
  if (typeof document === "undefined") { jP = null; no(new Error("jsts")); return; }
  const s = document.createElement("script"); s.src = JSTS; s.onload = () => ok(window.jsts); s.onerror = () => { jP = null; no(new Error("jsts")); };
  document.head.appendChild(s);
}));

/** Geometry helpers on JSTS, in metres: builders, robust overlays, components, a spatial index with cut / inside tests. */
export function geom(J) {
  const GF = new J.geom.GeometryFactory(), BP = J.operation.buffer.BufferParameters, BO = J.operation.buffer.BufferOp;
  const CAP = { round: BP.CAP_ROUND, flat: BP.CAP_FLAT, square: BP.CAP_SQUARE }, JOIN = { round: BP.JOIN_ROUND, mitre: BP.JOIN_MITRE, bevel: BP.JOIN_BEVEL };
  // coordinates rounded to the centimetre: near-coincident vertices of two sources make JTS's overlay throw and retry slowly
  const C = ([x, y]) => new J.geom.Coordinate(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  const EMPTY = GF.createPolygon(null, null);
  const ok = (g) => g && !g.isEmpty();
  const closed = (pts) => (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) ? [...pts, pts[0]] : pts);
  const line = (pts) => { const q = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]); return q.length >= 2 ? GF.createLineString(q.map(C)) : null; };
  const ring = (pts) => { const q = closed(pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])); return q.length >= 4 ? GF.createLinearRing(q.map(C)) : null; };
  const fix = (g) => (!g ? g : g.isValid() ? g : g.buffer(0));
  const poly = (rs) => { const sh = ring(rs[0]); if (!sh) return null; const p = GF.createPolygon(sh, rs.slice(1).map(ring).filter(Boolean)); return fix(p); };
  const point = ([x, y]) => GF.createPoint(C([x, y]));
  const box = (x0, y0, x1, y1) => poly([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  const parts = (g, out = []) => {
    if (!ok(g)) return out;
    const n = g.getNumGeometries();
    if (n > 1 || g.getGeometryType().startsWith("Multi") || g.getGeometryType() === "GeometryCollection") { for (let i = 0; i < n; i++) parts(g.getGeometryN(i), out); }
    else out.push(g);
    return out;
  };
  const polys = (g) => parts(g).filter((p) => p.getGeometryType() === "Polygon");
  const lines = (g) => parts(g).filter((p) => p.getGeometryType() === "LineString" || p.getGeometryType() === "LinearRing");
  // an overlay that throws (two sources' nearly coincident edges: « non-noded intersection ») is done again on the operands
  // snapped to the centimetre, else on the operands cleaned by a zero buffer
  const PM = new J.geom.PrecisionModel(100), reduce = (g) => (g.getDimension?.() === 2 ? J.precision.GeometryPrecisionReducer.reduce(g, PM) : g);
  const safe = (fn, ...gs) => { try { return fn(...gs); } catch (e0) { try { return fn(...gs.map(reduce)); } catch (e) { try { return fn(...gs.map((g) => (g.getDimension?.() === 2 ? g.buffer(0) : g))); } catch (e2) { return null; } } } };
  const union = (list) => {
    list = list.filter(ok);
    if (!list.length) return EMPTY;
    if (list.length === 1) return list[0].getDimension() === 2 ? fix(list[0]) : list[0];
    const u = safe((...gs) => GF.createGeometryCollection(gs).union(), ...list);
    if (u) return u;
    return list.reduce((a, b) => safe((x, y) => x.union(y), a, b) || a);
  };
  const diff = (a, b) => (!ok(a) ? EMPTY : !ok(b) ? a : safe((x, y) => x.difference(y), a, b) || a);
  const inter = (a, b) => (!ok(a) || !ok(b) ? EMPTY : safe((x, y) => x.intersection(y), a, b) || EMPTY);
  const buf = (g, d, { cap = "round", join = "round", quad = 4 } = {}) => (!ok(g) ? EMPTY : safe((x) => BO.bufferOp(x, d, new BP(quad, CAP[cap], JOIN[join], 5)), g) || EMPTY);
  const simplify = (g, tol) => (!ok(g) ? g : J.simplify.DouglasPeuckerSimplifier.simplify(g, tol));
  const coords = (g) => g.getCoordinates().map((c) => [c.x, c.y]);
  const multiLine = (ls) => GF.createMultiLineString(ls);
  /** An index of a geometry's components: cut(g) takes them out of g, inside(g) says whether one holds g, near(g, d). */
  /** An index of the polygons (else the parts) of a geometry or of a list of them. */
  function index(g) {
    const list = Array.isArray(g) ? g.filter(ok) : [g];
    const items = list.flatMap((x) => (polys(x).length ? polys(x) : parts(x)));
    const t = new J.index.strtree.STRtree();
    for (const p of items) t.insert(p.getEnvelopeInternal(), p);
    const query = (gg, d = 0) => { if (!items.length) return []; const e = new J.geom.Envelope(gg.getEnvelopeInternal()); if (d) e.expandBy(d); return t.query(e).toArray(); };
    return {
      items,
      cut: (gg) => { const c = query(gg).filter((p) => p.intersects(gg)); return c.length ? diff(gg, union(c)) : gg; },
      clip: (gg) => { const c = query(gg); return c.length ? inter(gg, union(c)) : EMPTY; },
      inside: (gg) => query(gg).some((p) => safe((a, b) => a.contains(b), p, gg)),
      hits: (gg, d = 0) => query(gg, d).some((p) => (d ? p.isWithinDistance(gg, d) : p.intersects(gg))),
      query,
    };
  }
  /** An index of lines widened by d: cut(g) takes out of g what lies within d of them, buffering only those near g. */
  function nearIndex(list, d) {
    const t = new J.index.strtree.STRtree(), items = list.filter(ok);
    for (const l of items) t.insert(l.getEnvelopeInternal(), l);
    return {
      cut: (gg) => {
        if (!items.length || !ok(gg)) return gg;
        const e = new J.geom.Envelope(gg.getEnvelopeInternal()); e.expandBy(d);
        const near = t.query(e).toArray().filter((l) => l.isWithinDistance(gg, d));
        return near.length ? diff(gg, buf(union(near), d)) : gg;
      },
    };
  }
  return { J, GF, EMPTY, ok, line, ring, poly, point, box, fix, parts, polys, lines, union, diff, inter, buf, simplify, coords, multiLine, index, nearIndex, C };
}

/** A GeoJSON geometry as JSTS through a coordinate function (each position → [x, y] metres). */
function fromGeoJson(G, g, f) {
  if (!g) return null;
  const P = (p) => f(p);
  switch (g.type) {
    case "Point": return G.point(P(g.coordinates));
    case "LineString": return G.line(g.coordinates.map(P));
    case "MultiLineString": { const ls = g.coordinates.map((l) => G.line(l.map(P))).filter(Boolean); return ls.length ? G.multiLine(ls) : null; }
    case "Polygon": return G.poly(g.coordinates.map((r) => r.map(P)));
    case "MultiPolygon": return G.union(g.coordinates.map((p) => G.poly(p.map((r) => r.map(P)))).filter(Boolean));
  }
  return null;
}

/** The minimum rotated rectangle of a polygon: { c: centre, u (unit, along the long side), L, W } (rotating calipers on the hull). */
function rotatedRect(G, g) {
  const h = G.coords(g.convexHull());
  let best = null;
  for (let i = 1; i < h.length; i++) {
    const dx = h[i][0] - h[i - 1][0], dy = h[i][1] - h[i - 1][1], l = Math.hypot(dx, dy);
    if (!l) continue;
    const ux = dx / l, uy = dy / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of h) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { area, c: [ca * ux - cb * uy, ca * uy + cb * ux], u: [ux, uy], v: [-uy, ux], A: a1 - a0, B: b1 - b0 };
    }
  }
  if (!best) return null;
  return best.A >= best.B ? { c: best.c, u: best.u, L: best.A, W: best.B } : { c: best.c, u: best.v, L: best.B, W: best.A };
}

// ---- the sources ----------------------------------------------------------------------------------------------------------------
const PAVED_SURF = new Set(["asphalt", "paving_stones", "concrete", "sett", "paved", "concrete:plates", "cobblestone", "unhewn_cobblestone", "metal", "wood", "bricks"]);
const UNPAVED_SURF = new Set(["gravel", "fine_gravel", "ground", "dirt", "compacted", "grass", "earth", "mud", "sand", "unpaved", "pebblestone", "woodchips"]);
const PATH_KIND = new Set(["footway", "path", "cycleway", "bridleway", "track", "steps", "pedestrian", "service", "living_street", "corridor"]);
const STREETS = { motorway: 1, trunk: 2, primary: 2, secondary: 3, tertiary: 4, motorway_link: 2, trunk_link: 2, primary_link: 2, secondary_link: 3, tertiary_link: 4,
  residential: 6, unclassified: 6, road: 6, busway: 6 };
const ROAD_W = { "route a 1 chaussee": 5.5, "rond-point": 7, bretelle: 6, "piste cyclable": 2.5, "route a 2 chaussees": 14, "quasi-autoroute": 14, "type autoroutier": 16 };
const OPEN_LANDUSE = new Set(["grass", "village_green", "recreation_ground", "meadow", "greenfield"]);
const SPORT_SURF = { grass: "grass", artificial_turf: "turf", clay: "clay", tartan: "hard", acrylic: "hard", rubber: "hard", asphalt: "asphalt", concrete: "asphalt",
  paved: "asphalt", fine_gravel: "sand", sand: "sand", gravel: "sand", dirt: "sand", ground: "sand", compacted: "sand" };
const SPORT_DEFAULT = { soccer: "grass", rugby: "grass", tennis: "hard", athletics: "hard", multi: "asphalt", basketball: "asphalt", boules: "sand", handball: "asphalt" };
// courts and the track are paved areas not to be entered (a mapper's review: « the track is obviously a paved area »): 501, the
// tennis courts fenced all round, the others under the course setter's 709
const NO_ENTRY = new Set(["tennis", "multi", "basketball", "handball", "padel", "athletics"]);
const HATCHED = new Set(["multi", "basketball", "handball", "athletics"]);
const sportName = (s) => (s.startsWith("rugby") ? "rugby" : s === "athletics" || s === "running" ? "athletics" : s);
const BD_SPORT = { "terrain de rugby": "rugby", "terrain de football": "soccer", "terrain de tennis": "tennis", "stade d'athletisme": "athletics",
  "piste de sport": "athletics", "terrain de basket-ball": "basketball", "terrain de handball": "handball" };
const FOOT_M = [1.4, 2, 3, 4];
const STAIR_MM = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const widthOf = (t, def) => { const w = parseFloat(String(t.width ?? "").replace(",", ".")); return Number.isFinite(w) && w > 0 ? Math.max(0.8, Math.min(12, w)) : def; };
const under = (p) => String(p.position_par_rapport_au_sol ?? "0").trim().startsWith("-");
const nearest = (list, v) => list.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(list[bi] - v) ? i : bi), 0);

/** Fetches what the options ask for over the rectangle (map mm) and its margin. Resolves { bd, osm, cad, failed }. */
export async function fetchSources(frame, rectMm, opts, say = () => {}) {
  const box = frame.areaLatLon(rectMm), failed = [];
  const pOsm = opts.osm ? fetchOverpass(box, { query: townQuery, fetch: opts.fetch, signal: opts.signal, headers: opts.headers }).catch(() => { failed.push("osm"); return null; }) : Promise.resolve(null);
  const pCad = opts.cadastre ? loadParcels(box, { fetch: opts.fetch }).catch(() => { failed.push("cadastre"); return null; }) : Promise.resolve(null);
  const bd = {};
  if (opts.bdtopo) {
    for (let i = 0; i < BD_LAYERS.length; i++) {
      say("map.data.town.reading.bdtopo", { layer: BD_LAYERS[i] }, (0.6 * i) / BD_LAYERS.length);
      try { bd[BD_LAYERS[i]] = await layerFeatures(BD_LAYERS[i], box, opts.fetch); } catch (e) { failed.push(`bdtopo:${BD_LAYERS[i]}`); bd[BD_LAYERS[i]] = []; }
    }
  }
  say("map.data.town.reading.osm", {}, 0.62);
  const osm = await pOsm;
  say("map.data.town.reading.cadastre", {}, 0.66);
  const cad = await pCad;
  return { bd, osm, cad, failed };
}

/**
 * The town's objects over a rectangle of the map ([x0, y0, x1, y1] map mm) through the frame (frame.js). opts: bdtopo, osm,
 * cadastre (booleans: the sources to read), contours ({ interval } or null), fetch, signal, onStage(key, vars, frac).
 * Resolves { objects, counts, failed, credits: [text…], stats }.
 */
export async function loadTown(frame, rect, opts = {}) {
  if (!frame.geo) throw new Error("nogeo");
  const say = (key, vars = {}, frac = null) => opts.onStage?.(key, vars, frac);
  const lap = (name) => opts.onLap?.(name);                                 // timings, for tests
  const J = await loadJsts();
  const G = geom(J);
  const scale = frame.scale || 4000, k = scale / 1000, MARGIN = 30;
  const rectMm = [rect[0] - MARGIN / k, rect[1] - MARGIN / k, rect[2] + MARGIN / k, rect[3] + MARGIN / k];
  const src = opts.data || (await fetchSources(frame, rectMm, opts, say));
  const { bd = {}, osm, cad, failed = [] } = src;
  const R0 = G.box(rect[0] * k, rect[1] * k, rect[2] * k, rect[3] * k), W = G.box(...rectMm.map((v) => v * k));
  const fromL93 = ([X, Y]) => { const [x, y] = frame.fromL93mm(X, Y); return [x * k, y * k]; };
  const fromLL = (la, lo) => { const [x, y] = frame.fromLatLon(la, lo); return [x * k, y * k]; };
  const bdG = (g) => { try { return fromGeoJson(G, g, fromL93); } catch (e) { return null; } };
  const llG = (g) => { try { return fromGeoJson(G, g, ([lo, la]) => fromLL(la, lo)); } catch (e) { return null; } };
  const els = osm?.elements || [];
  const tags = (e) => e.tags || {};
  const llPts = (geo) => (geo || []).filter(Boolean).map((p) => fromLL(p.lat, p.lon));
  const closedLL = (geo) => geo?.length >= 4 && geo[0].lat === geo[geo.length - 1].lat && geo[0].lon === geo[geo.length - 1].lon;
  function osmGeom(e, area = false) {
    try {
      if (e.type === "node") return G.point(fromLL(e.lat, e.lon));
      if (e.type === "way" && e.geometry) {
        const pts = llPts(e.geometry);
        if (area && closedLL(e.geometry)) return G.poly([pts]);
        return area ? null : G.line(pts);
      }
      if (e.type === "relation" && area) {
        const rs = relRings(e), outer = [], inner = [];
        for (const [role, r] of rs) (role === "inner" ? inner : outer).push(G.poly([r.map(([la, lo]) => fromLL(la, lo))]));
        return G.diff(G.union(outer.filter(Boolean)), G.union(inner.filter(Boolean)));
      }
    } catch (e2) { /* a broken element is left out */ }
    return null;
  }
  const isArea = (g) => g && g.getDimension() === 2 && !g.isEmpty();
  const out = [], counts = {};
  const emit = (o) => { out.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  const mm = (pts) => pts.map(([x, y]) => [x / k, y / k]);
  /** An area into objects, clipped to the map's rectangle, its polygons over minArea m². */
  const addArea = (g, sym, minArea = 2, srcId = "town") => {
    for (const p of G.polys(G.inter(g, R0))) {
      if (p.getArea() < minArea) continue;
      const rs = [mm(G.coords(p.getExteriorRing()))];
      for (let i = 0; i < p.getNumInteriorRing(); i++) { const h = G.coords(p.getInteriorRingN(i)); if (Math.abs(ringArea(h)) > 1) rs.push(mm(h)); }
      emit({ sym, otp: 3, ang: 0, coords: areaCoords(rs), src: "town", srcId, draft: true });
    }
  };
  /** A line into objects, clipped; curve: Bézier curves through its points (simplified at 0.6 m first). */
  const addLine = (g, sym, minLen = 1, { curve = false, simplify = 0, srcId = "town", clip = true } = {}) => {
    for (let l of G.lines(clip ? G.inter(g, R0) : g)) {
      if (l.getLength() < minLen) continue;
      if (curve) l = G.simplify(l, 0.6); else if (simplify) l = G.simplify(l, simplify);
      const pts = mm(G.coords(l));
      if (pts.length < 2) continue;
      emit({ sym, otp: 2, ang: 0, coords: curve && pts.length >= 3 ? bezier(pts) : lineCoords(pts), src: "town", srcId, draft: true });
    }
  };
  const addPoint = ([x, y], sym, srcId = "town") => emit({ sym, otp: 1, ang: 0, coords: [ocad(x / k, y / k)], src: "town", srcId, draft: true });
  const inR0 = ([x, y]) => x >= rect[0] * k && x <= rect[2] * k && y >= rect[1] * k && y <= rect[3] * k;

  say("map.data.town.step.buildings", {}, 0.7); await tick();
  // ---- buildings: BD TOPO's (with their use: the gardens below), else OpenStreetMap's ------------------------------------------
  const buildings = [];
  for (const f of bd.batiment || []) {
    const g = G.inter(G.fix(bdG(f.geometry)), W);
    if (isArea(g) && g.getArea() > 3) buildings.push({ g, p: f.properties || {} });
  }
  if (!buildings.length) for (const e of els) {
    const t = tags(e);
    if (!t.building || t.building === "no" || ["roof", "carport"].includes(t.building) || t.location === "underground") continue;
    const g = G.inter(osmGeom(e, true), W);
    if (isArea(g) && g.getArea() > 3) buildings.push({ g, p: {}, home: ["house", "residential", "detached", "apartments", "semidetached_house", "terrace"].includes(t.building) });
  }
  const B = G.union(buildings.map((b) => b.g)), Bi = G.index(B);
  const canopy = G.diff(G.union(els.filter((e) => ["roof", "carport"].includes(tags(e).building) || tags(e)["building:part"] === "roof").map((e) => osmGeom(e, true)).filter(isArea)), B);

  say("map.data.town.step.paving", {}, 0.72); await tick();
  // ---- streets, paths, stairways, the paving ----------------------------------------------------------------------------------
  const paved = [], carrBy = new Map(), pavedBy = new Map(), pathLines = [], smallLines = [], steps = [], rail = [], tram = [], bdPaths = [], bdSteps = [], osmHw = [], osmSteps = [], pavedPaths = [];
  const group = (m, key, g) => { if (!g) return; if (!m.has(key)) m.set(key, []); m.get(key).push(g); };
  for (const f of bd.troncon_de_route || []) {
    const p = f.properties || {}, g = bdG(f.geometry), nat = norm(p.nature);
    if (!g || under(p) || nat.startsWith("bac")) continue;
    if (nat.includes("escalier")) { bdSteps.push(g); continue; }
    if (nat.includes("sentier") || nat.includes("chemin") || nat.includes("empierr")) { bdPaths.push(g); continue; }
    const w = Number(p.largeur_de_chaussee) || ROAD_W[nat] || 5, urb = p.urbain === true || p.urbain === "true" || p.urbain === 1, imp = Number(p.importance) || 6;
    const side = urb ? 1.8 : 0.3;                                           // sidewalks in town
    group(carrBy, `${(w / 2).toFixed(2)}|${imp <= 3 ? 1 : 0}|${urb ? 1 : 0}`, g);
    group(pavedBy, (w / 2 + side).toFixed(2), g);
  }
  const bdRoads = (bd.troncon_de_route || []).length > 0;
  for (const e of els) {
    const t = tags(e), hw = t.highway;
    if (e.type !== "way" || !e.geometry) continue;
    const hidden = ["yes", "building_passage"].includes(t.tunnel) || String(t.layer || "0").startsWith("-") || t.indoor === "yes";
    if (PATH_KIND.has(hw)) { const g0 = osmGeom(e); if (g0) (hw === "steps" ? osmSteps : osmHw).push(g0); }
    if (!bdRoads && STREETS[hw] && !hidden) {
      // OpenStreetMap's streets when no BD TOPO: at their width, their sidewalks beside
      const g = osmGeom(e), w = widthOf(t, STREET_W[hw] || 6), sides = { both: 2, left: 1, right: 1 }[t.sidewalk || t["sidewalk:both"] || ""] || 0, imp = STREETS[hw];
      group(carrBy, `${(w / 2).toFixed(2)}|${imp <= 3 ? 1 : 0}|${sides ? 1 : 0}`, g);
      group(pavedBy, (w / 2 + 1.5 * sides).toFixed(2), g);
      continue;
    }
    if (PATH_KIND.has(hw) || t["area:highway"]) {
      if (hidden) continue;
      const area = t.area === "yes" || !!t["area:highway"], g = osmGeom(e, area && closedLL(e.geometry));
      if (!g) continue;
      if (hw === "steps") { steps.push({ g, w: widthOf(t, 2.0) }); continue; }
      const surf = t.surface || "";
      if (["sidewalk", "crossing", "traffic_island"].includes(t.footway) || t.cycleway === "sidewalk") { group(pavedBy, "1.00", g); continue; }
      if (isArea(g)) { if (!UNPAVED_SURF.has(surf)) paved.push(g); continue; }
      if (UNPAVED_SURF.has(surf) || (["path", "track", "bridleway"].includes(hw) && !PAVED_SURF.has(surf))) (hw === "path" && t.informal === "yes" ? smallLines : pathLines).push(g);
      else if (["footway", "path", "cycleway", "bridleway"].includes(hw)) pavedPaths.push({ g, w: widthOf(t, 2.0) });
      else group(pavedBy, String({ service: 2.2, living_street: 2.5, pedestrian: 2.5, track: 1.5 }[hw] || 1.1), g);
    }
  }
  for (const e of els) {
    const t = tags(e);
    if (e.type === "node") continue;
    if (t.place === "square" || ["parking", "marketplace"].includes(t.amenity) || t.leisure === "schoolyard") {
      if (["underground", "multi-storey", "rooftop"].includes(t.parking)) continue;
      const g = osmGeom(e, true);
      if (isArea(g)) paved.push(g);
    }
  }
  for (const f of bd.equipement_de_transport || []) if (norm(f.properties?.nature).includes("parking")) { const g = bdG(f.geometry); if (isArea(g)) paved.push(g); }
  lap("osm parsed");
  const merged = (list) => { const lm = new J.operation.linemerge.LineMerger(); for (const g of list) lm.add(g); return lm.getMergedLineStrings().toArray(); };
  const carr = [];                                                          // the carriageways: { g, heavy, urb }
  for (const [key, list] of carrBy) {
    const [h, heavy, urb] = key.split("|");
    carr.push({ g: G.buf(G.multiLine(merged(list)), Number(h), { cap: "flat" }), heavy: heavy === "1", urb: urb === "1" });
  }
  lap("carr built");
  for (const [h, list] of pavedBy) paved.push(G.buf(G.multiLine(merged(list)), Number(h), { cap: "flat" }));
  lap("paved buffers");
  // BD TOPO's paths and stairways wherever OpenStreetMap has none of the same kind within 4 m (what one source has exists)
  const OSM_HW = G.nearIndex(osmHw, 4), OSM_ST = G.nearIndex([...osmSteps, ...steps.map((s) => s.g)], 4);
  for (const g of bdPaths) for (const piece of G.lines(OSM_HW.cut(g))) if (piece.getLength() > 10) pathLines.push(piece);
  for (const g of bdSteps) if (g.getLength() && OSM_ST.cut(g).getLength() > 0.5 * g.getLength()) steps.push({ g, w: 2.0 });
  lap("hw index");
  // railways and tramways: BD TOPO's, else OpenStreetMap's
  for (const f of bd.troncon_de_voie_ferree || []) {
    const p = f.properties || {}, g = bdG(f.geometry);
    if (g && !under(p)) (norm(p.nature).includes("tram") ? tram : rail).push(g);
  }
  if (!(bd.troncon_de_voie_ferree || []).length) for (const e of els) {
    const t = tags(e);
    if (e.type !== "way" || !["rail", "light_rail", "narrow_gauge", "tram"].includes(t.railway) || ["yes", "building_passage"].includes(t.tunnel) || String(t.layer || "0").startsWith("-")) continue;
    const g = osmGeom(e); if (g) (t.railway === "tram" ? tram : rail).push(g);
  }
  lap("rail");
  const PAVED = G.inter(G.union(paved), W), RAIL = G.union(rail);

  lap("PAVED union");
  say("map.data.town.step.water", {}, 0.75); await tick();
  // ---- water, hedges, walls and fences -----------------------------------------------------------------------------------------
  let water = G.union((bd.surface_hydrographique || []).map((f) => G.fix(bdG(f.geometry))).filter(isArea));
  if (!(bd.surface_hydrographique || []).length) water = G.union(els.filter((e) => tags(e).natural === "water" || ["reservoir", "basin"].includes(tags(e).landuse) || tags(e).waterway === "riverbank").map((e) => osmGeom(e, true)).filter(isArea));
  const streams = [];                                                       // { g, ditch }
  for (const f of bd.troncon_hydrographique || []) { const p = f.properties || {}; if (!under(p)) { const g = bdG(f.geometry); if (g) streams.push({ g, ditch: !!p.fosse }); } }
  if (!(bd.troncon_hydrographique || []).length) for (const e of els) {
    const w = tags(e).waterway;
    if (e.type === "way" && ["river", "stream", "canal", "ditch", "drain"].includes(w) && !["yes", "culvert"].includes(tags(e).tunnel)) { const g = osmGeom(e); if (g) streams.push({ g, ditch: w === "ditch" || w === "drain" }); }
  }
  const hedges = [...(bd.haie || []).map((f) => bdG(f.geometry)), ...els.filter((e) => e.type === "way" && tags(e).barrier === "hedge").map((e) => osmGeom(e))].filter(Boolean);
  const hedgeAreas = (bd.zone_de_vegetation || []).filter((f) => norm(f.properties?.nature) === "haie").map((f) => bdG(f.geometry)).filter(isArea);
  let walls = [];                                                            // { g, kind: wall|fence|court, ret, imp }
  for (const f of bd.construction_lineaire || []) {
    const nat = norm(f.properties?.nature), g = bdG(f.geometry);
    if (g && nat.startsWith("mur")) walls.push({ g, kind: "wall", ret: nat.includes("soutenement"), imp: !nat.includes("soutenement"), src: "bd" });
  }
  for (const e of els) {
    const t = tags(e);
    if (e.type !== "way" || !["wall", "city_wall", "retaining_wall", "fence", "guard_rail", "handrail"].includes(t.barrier)) continue;
    const g = osmGeom(e); if (!g) continue;
    const kind = ["fence", "guard_rail", "handrail"].includes(t.barrier) ? "fence" : "wall", h = parseFloat(String(t.height ?? "").replace(",", "."));
    const imp = kind === "fence" ? h >= 1.8 && t.barrier === "fence" : t.barrier === "city_wall" || !(h < 1.5);
    walls.push({ g, kind, ret: t.barrier === "retaining_wall", imp: t.barrier === "retaining_wall" ? false : imp, src: "osm" });
  }
  {
    // an OpenStreetMap wall within 1.2 m along a BD TOPO wall of the same kind is that wall
    const bdw = walls.filter((w) => w.src === "bd"), mid = (g) => G.GF.createPoint(new J.linearref.LengthIndexedLine(g).extractPoint(g.getLength() / 2));
    walls = walls.filter((w) => w.src !== "osm" || !(w.g.getLength() > 0 && bdw.some((b) => b.kind === w.kind && b.g.isWithinDistance(w.g, 1.2)
      && w.g.isWithinDistance(mid(b.g), 1.2) && J.algorithm.distance.DiscreteHausdorffDistance.distance(b.g, w.g) < 2)));
  }

  say("map.data.town.step.sports", {}, 0.77); await tick();
  // ---- sports grounds: OpenStreetMap's pitches and tracks, BD TOPO's where OSM has none -----------------------------------------
  const sports = [];
  for (const e of els) {
    const t = tags(e);
    if (!["pitch", "track"].includes(t.leisure) || e.type === "node" || t.indoor === "yes") continue;
    const g = osmGeom(e, true);
    if (!isArea(g) || !g.intersects(W)) continue;
    const sp = sportName(String(t.sport || (t.leisure === "track" ? "athletics" : "multi")).split(";")[0]);
    sports.push({ sport: sp, surface: SPORT_SURF[t.surface || ""] || SPORT_DEFAULT[sp] || "sand", g });
  }
  for (const f of bd.terrain_de_sport || []) {
    const p = f.properties || {}; let g = G.fix(bdG(f.geometry));
    if (!isArea(g) || !g.intersects(W)) continue;
    if (sports.some((s) => G.inter(s.g, g).getArea() > 0.5 * Math.min(g.getArea(), s.g.getArea()))) continue;
    const sp = BD_SPORT[norm(p.nature_detaillee || p.nature)] || "multi";
    if (sp === "athletics" && isArea(G.buf(g, -9))) g = G.diff(g, G.buf(g, -8.5));         // a filled oval: its track, ~7 lanes
    sports.push({ sport: sp, surface: SPORT_DEFAULT[sp] || "sand", g });
  }
  const grassPitch = (s) => !NO_ENTRY.has(s.sport) && ["grass", "turf"].includes(s.surface);

  say("map.data.town.step.private", {}, 0.79); await tick();
  // ---- ground not to be entered: the cadastre's parcels holding houses, schools, OpenStreetMap's private ground, the railway ----
  const parcels = [];
  for (const f of cad?.wgs84 || []) { const g = G.fix(llG(f.geometry)); if (isArea(g) && g.intersects(W)) parcels.push(g); }
  for (const f of cad?.l93 || []) { const g = G.fix(bdG(f.geometry)); if (isArea(g) && g.intersects(W)) parcels.push(g); }
  const bTree = new J.index.strtree.STRtree();
  buildings.forEach((b, i) => bTree.insert(b.g.getEnvelopeInternal(), i));
  const private_ = [];
  for (const pg of parcels) {
    if (pg.getArea() > 6000 || !buildings.length) continue;
    const hits = bTree.query(pg.getEnvelopeInternal()).toArray().map((i) => buildings[i]).filter((b) => b.g.intersects(pg));
    const residential = hits.filter((b) => (b.home || norm(b.p.usage_1).startsWith("residentiel")) && !["eglise", "chapelle"].includes(norm(b.p.nature)))
      .reduce((s, b) => s + G.inter(b.g, pg).getArea(), 0);
    const pub = hits.some((b) => /^(religieux|sportif)/.test(norm(b.p.usage_1)) && G.inter(b.g, pg).getArea() > 20);
    if (residential > 25 && !pub) private_.push(pg);
  }
  for (const f of bd.zone_d_activite_ou_d_interet || []) {
    const p = f.properties || {}, cat = norm(p.categorie), nat = norm(p.nature);
    if (cat.startsWith("science et enseignement") && ["ecole", "college", "lycee", "enseignement"].some((w) => nat.includes(w))) { const g = G.fix(bdG(f.geometry)); if (isArea(g)) private_.push(g); }
  }
  for (const e of els) {
    const t = tags(e);
    if ((["private", "no"].includes(t.access) && (t.landuse || t.leisure || t.amenity) && t.amenity !== "parking") || (t.leisure === "garden" && ["residential", "private"].includes(t["garden:type"]))) {
      const g = osmGeom(e, true); if (isArea(g)) private_.push(g);
    }
  }
  let PRIVATE = G.union(private_);
  if (!RAIL.isEmpty()) PRIVATE = G.union([PRIVATE, G.buf(RAIL, 5, { cap: "flat" })]);
  // the streets and paths are public whatever the cadastre says; the buildings are drawn as buildings
  PRIVATE = G.diff(G.diff(G.inter(PRIVATE, W), G.buf(PAVED, 0.3)), B);
  const OLIVE_IN = G.index(G.buf(PRIVATE, -1.0));
  // the public road space: what the cadastre leaves between its parcels, within their reach (beyond the commune it says nothing)
  let PUBLIC = G.EMPTY;
  if (parcels.length) {
    say("map.data.town.step.public", {}, 0.82); await tick();
    const PARCELS = G.union(parcels);
    const reach = G.buf(G.buf(G.simplify(PARCELS, 0.5), 20, { join: "mitre" }), -20, { join: "mitre" });
    PUBLIC = G.diff(G.inter(G.diff(reach, PARCELS), W), B);
    PUBLIC = G.buf(G.buf(PUBLIC, -0.25), 0.25);                                 // the slivers between two parcels' edges
  }

  say("map.data.town.step.areas", {}, 0.86); await tick();
  // ---- the areas, one coverage: each later source minus what is drawn already ---------------------------------------------------
  const openAreas = els.filter((e) => { const t = tags(e); return e.type !== "node" && !["private", "no"].includes(t.access) && (OPEN_LANDUSE.has(t.landuse) || ["park", "common", "dog_park"].includes(t.leisure) || (t.leisure === "garden" && !["residential", "private"].includes(t["garden:type"])) || t.natural === "grassland"); })
    .map((e) => osmGeom(e, true)).filter(isArea);
  const OPEN = G.union(openAreas), GREEN_PUB = isArea(PUBLIC) ? G.inter(OPEN, PUBLIC) : G.EMPTY;
  const HEDGE_G = G.diff(G.union([G.buf(G.union(hedges), 0.7, { cap: "flat" }), ...hedgeAreas]), G.buf(PRIVATE, -1.0));
  const SP_OPEN = G.union(sports.filter(grassPitch).map((s) => s.g)), SP_PAVED = G.union(sports.filter((s) => !grassPitch(s)).map((s) => s.g));
  // tile by tile (120 m): each source minus what an earlier one drew there, then each kind's pieces put together — small
  // overlays, where one over the whole town took seconds (JTS's overlay throwing on two sources' nearly coincident edges)
  const layers = [["water", water], ["hedge", HEDGE_G], ["private", PRIVATE], ["open", SP_OPEN], ["paved", G.union([SP_PAVED, PAVED, G.diff(PUBLIC, GREEN_PUB)])],
    ["open2", G.union([OPEN, GREEN_PUB])], ["orchard", G.union((bd.zone_de_vegetation || []).filter((f) => ["verger", "peupleraie"].includes(norm(f.properties?.nature))).map((f) => bdG(f.geometry)).filter(isArea))],
    ["vineyard", G.union((bd.zone_de_vegetation || []).filter((f) => norm(f.properties?.nature) === "vigne").map((f) => bdG(f.geometry)).filter(isArea))]];
  const pieces = {}, TILE = 120, [wx0, wy0, wx1, wy1] = rectMm.map((v) => v * k);
  const nTx = Math.ceil((wx1 - wx0) / TILE), nTy = Math.ceil((wy1 - wy0) / TILE);
  for (let ty = 0; ty < nTy; ty++) {
    for (let tx = 0; tx < nTx; tx++) {
      const T = G.box(wx0 + tx * TILE, wy0 + ty * TILE, Math.min(wx1, wx0 + (tx + 1) * TILE), Math.min(wy1, wy0 + (ty + 1) * TILE));
      let taken = G.inter(B, T);
      for (const [key, g] of layers) {
        const c = G.diff(G.inter(g, T), taken);
        if (isArea(c)) { (pieces[key] ||= []).push(c); taken = G.union([taken, c]); }
      }
    }
    say("map.data.town.step.areas", {}, 0.86 + (0.03 * (ty + 1)) / nTy); await tick();
  }
  const cover = {};
  for (const [key] of layers) if (pieces[key]) { cover[key] = G.union(pieces[key]); lap(`cover ${key}`); }
  const PAVED_ALL = cover.paved || G.EMPTY;
  const HEAVY = G.inter(G.union(carr.filter((c) => c.heavy).map((c) => c.g)), PAVED_ALL);
  const PAVED_LIGHT = isArea(HEAVY) ? G.diff(PAVED_ALL, HEAVY) : PAVED_ALL;
  addArea(cover.water, S(301), 2);
  addArea(cover.hedge, S(411), 2);
  addArea(cover.private, S(520), 6);
  addArea(G.union([cover.open, cover.open2]), S(401), 6);
  addArea(PAVED_LIGHT, S(501), 6);
  addArea(HEAVY, S(501, 4), 6);
  addArea(cover.orchard, S(413), 6);
  addArea(cover.vineyard, S(414), 6);
  for (const s of sports) if (HATCHED.has(s.sport)) addArea(s.g, S(709), 6);           // the track and the multi-sport courts under 709
  // buildings that touch drawn as one (« adjoining buildings: don't show the borders »); a shed of under 20 m² inside the ground
  // not to be entered left out
  lap("areas out");
  const blocks = G.buf(G.buf(B, 0.15, { join: "mitre" }), -0.15, { join: "mitre" });
  for (const p of G.polys(blocks)) if (!(p.getArea() < 20 && OLIVE_IN.inside(p))) addArea(G.simplify(p, 0.15), S(521), 0.5);
  addArea(canopy, S(522), 1);

  say("map.data.town.step.lines", {}, 0.9); await tick();
  // ---- the paved area's edge, and the carriageways' kerbs in town --------------------------------------------------------------
  const wallG = G.union(walls.map((w) => w.g)), hedgeG = G.union(hedges);
  lap("before noline");
  const strip = (d) => G.buf(R0.getBoundary(), d);
  const NOLINE = G.index(G.union([G.buf(B, 0.4), strip(0.6), G.buf(wallG, 0.6), G.buf(hedgeG, 0.8)]));
  const urbC = G.union(carr.filter((c) => c.urb).map((c) => G.buf(c.g, 0.02)));
  const kerbs = G.inter(urbC.getBoundary(), G.buf(PAVED_ALL, -0.5));
  for (const l of [...G.lines(PAVED_ALL.getBoundary()), ...G.lines(kerbs)]) for (const piece of G.lines(NOLINE.cut(l))) if (piece.getLength() >= 2) addLine(piece, S(501, 1), 2, { simplify: 0.2 });
  // walls and fences (a tennis court fenced all round); inside the ground not to be entered: generalised away
  for (const s of sports) if (s.sport === "tennis" || s.sport === "padel") for (const l of merged(G.lines(s.g.getBoundary()))) walls.push({ g: l, kind: "court", imp: true, ret: false });
  lap("edges");
  const B03 = G.index(G.buf(B, 0.3));
  for (const w of walls) for (const piece of G.lines(B03.cut(w.g))) {
    if (piece.getLength() < 2 || OLIVE_IN.inside(piece)) continue;
    const sym = w.kind === "wall" ? (w.ret ? S(513, 2) : w.imp ? S(515) : S(513, 1)) : w.imp ? S(518) : S(516);
    addLine(piece, sym, 1.5, { simplify: 0.2 });
  }
  // goals and rugby posts on the pitches one may cross: a black cross, 531, at the middle of each goal line
  for (const s of sports) {
    if (NO_ENTRY.has(s.sport) || !["soccer", "rugby"].includes(s.sport)) continue;
    for (const p of G.polys(s.g)) {
      const F = rotatedRect(G, p);
      if (!F || (s.sport === "soccer" && F.L <= 40) || (s.sport === "rugby" && F.L <= 50)) continue;
      const ing = Math.min(22, Math.max(5, (F.L - 100) / 2)), x = s.sport === "soccer" ? F.L / 2 : (F.L - 2 * ing) / 2;
      for (const sg of [-1, 1]) { const q = [F.c[0] + sg * x * F.u[0], F.c[1] + sg * x * F.u[1]]; if (inR0(q)) addPoint(q, S(531)); }
    }
  }
  // the path network joined, then drawn: paved footways as lines at their width, unpaved paths 505 / 506, as curves
  const network = (list, snap = 4) => {
    const ls = list.flatMap((g) => G.lines(g)).filter((l) => l.getLength() > 0);
    if (!ls.length) return [];
    const parts = merged([G.union(ls)]);
    const ix = new J.index.strtree.STRtree();
    parts.forEach((p, i) => { p.setUserData(i); ix.insert(p.getEnvelopeInternal(), p); });
    return parts.map((l, i) => {
      let cs = G.coords(l);
      for (const end of [0, 1]) {
        const pt = G.point(end ? cs[cs.length - 1] : cs[0]), env = new J.geom.Envelope(pt.getEnvelopeInternal()); env.expandBy(snap);
        let best = null, bd2 = Infinity;
        for (const o of ix.query(env).toArray()) {
          if (o.getUserData() === i) continue;
          const d = o.distance(pt);
          if (d < bd2) { bd2 = d; best = o; }
        }
        if (!best || bd2 < 0.05 || bd2 > snap) continue;
        const q = J.operation.distance.DistanceOp.nearestPoints(best, pt)[0];
        cs = end ? [...cs, [q.x, q.y]] : [[q.x, q.y], ...cs];
      }
      return G.line(cs);
    }).filter(Boolean);
  };
  const PAVED_IN = G.index(G.buf(PAVED_ALL, -0.3), 60), PAVED_I = G.index(PAVED_ALL);
  for (let i = 0; i < FOOT_M.length; i++) {
    for (const g of network(pavedPaths.filter((p) => nearest(FOOT_M, p.w) === i).map((p) => p.g))) addLine([PAVED_IN, Bi, OLIVE_IN].reduce((a, ix) => ix.cut(a), g), S(501, 6 + i), 3, { curve: true });
  }
  lap("footprints");
  for (const g of network(pathLines)) addLine([PAVED_I, Bi, OLIVE_IN].reduce((a, ix) => ix.cut(a), g), S(505), 3, { curve: true });
  for (const g of network(smallLines)) addLine([PAVED_I, Bi, OLIVE_IN].reduce((a, ix) => ix.cut(a), g), S(506), 3, { curve: true });
  // stairways at their width on the ground: 532.1-532.6, the nearest
  for (const s of steps) {
    const wmm = Math.max(0.4, (s.w * 1000) / scale);
    addLine(Bi.cut(s.g), S(532, nearest(STAIR_MM, wmm) + 1), 1);
  }
  // a grass pitch's edge: 415 (distinct cultivation boundary), not where a building, wall, fence or hedge stands
  lap("paths+stairs");
  for (const s of sports) if (grassPitch(s)) for (const piece of G.lines(NOLINE.cut(s.g.getBoundary()))) addLine(piece, S(415), 2);
  // boundaries to confirm: the edge of the ground not to be entered where no wall, fence, hedge or building is known
  lap("415");
  const KNOWN = G.index(G.union([G.buf(wallG, 1.5), G.buf(hedgeG, 1.5), G.buf(B, 1.0), strip(1.0)]));
  for (const l of G.lines(PRIVATE.getBoundary())) for (const piece of G.lines(KNOWN.cut(l))) addLine(piece, S(995), 4, { simplify: 0.3 });
  // watercourses as curves, the railway, banks
  const Wb = G.index(G.buf(water, 0.5));
  for (const s of streams) addLine(Bi.cut(Wb.cut(s.g)), s.ditch ? S(306) : S(305), 3, { curve: true });
  for (const g of rail) addLine(g, S(509, 1), 3);
  for (const g of tram) addLine(g, S(509, 2), 3);
  for (const f of bd.ligne_orographique || []) {
    const nat = norm(f.properties?.nature), g = bdG(f.geometry);
    if (g && (nat === "talus" || nat === "levee")) addLine(g, nat === "talus" ? S(104) : S(105, 1), 2);
  }

  lap("lines done");
  say("map.data.town.step.points", {}, 0.93); await tick();
  // ---- points: OpenStreetMap's trees (outside the ground not to be entered), monuments, fountains; every way and tagged node kept
  for (const e of els) {
    if (e.type !== "node") continue;
    const t = tags(e), q = fromLL(e.lat, e.lon);
    if (!inR0(q)) continue;
    if (["memorial", "monument", "wayside_cross"].includes(t.historic) || t.tourism === "artwork" || t.man_made === "cross") addPoint(q, S(526), `node/${e.id}`);
    else if (["fountain", "drinking_water"].includes(t.amenity) || ["water_well", "water_tap"].includes(t.man_made)) addPoint(q, S(311), `node/${e.id}`);
    else if (t.natural === "tree") {
      const pt = G.point(q);
      if (OLIVE_IN.inside(pt) || Bi.inside(pt)) continue;
      addPoint(q, (parseFloat(t.height) || 0) >= 14 ? S(417) : S(418), `node/${e.id}`);
    }
  }
  let nOsm = 0;
  for (const e of els) {
    if (e.type === "way" && e.geometry?.length >= 2) { const g = G.line(llPts(e.geometry)); if (g && g.intersects(R0)) { addLine(g, S(990), 0, { srcId: `way/${e.id}` }); nOsm++; } }
    else if (e.type === "relation") for (const m of e.members || []) {
      if (m.type !== "way" || !(m.geometry?.length >= 2)) continue;
      const g = G.line(llPts(m.geometry)); if (g && g.intersects(R0)) { addLine(g, S(990), 0, { srcId: `relation/${e.id}` }); nOsm++; }
    }
    else if (e.type === "node" && e.tags && Object.keys(e.tags).length) { const q = fromLL(e.lat, e.lon); if (inR0(q)) { addPoint(q, S(991), `node/${e.id}`); nOsm++; } }
  }
  for (const o of out) if (o.srcId !== "town") o.src = "osm";

  // ---- contours: dropped or kept whole, cut at the buildings only, as curves --------------------------------------------------
  if (opts.contours) {
    say("map.data.town.step.contours", {}, 0.95);
    const C = await import("./contours.js");
    const r = await C.loadContours(frame, rect, { interval: opts.contours.interval || 2.5, smoothM: 4, minLoopArea: 600, minOpenLength: 40, minPiece: 3,
      cut: (pts) => { const l = G.line(pts.map(([x, y]) => [x * k, y * k])); return l ? G.lines(Bi.cut(l)).map((q) => mm(G.coords(q))) : []; },
      onProgress: (x) => say("map.data.town.step.contours", {}, 0.95 + 0.05 * x) }).catch(() => { failed.push("dem"); return null; });
    for (const o of r?.objects || []) emit(o);
    if (r?.credit) src.demCredit = r.credit.text || r.credit;
  }
  // what was read, for the credit line (dataui.js words OpenStreetMap's)
  const used = { bdtopo: Object.values(bd).some((l) => l.length), cadastre: parcels.length > 0, osm: els.length > 0, dem: src.demCredit || null };
  return { objects: out, counts, failed, used, stats: { buildings: buildings.length, parcels: parcels.length, private: Math.round(PRIVATE.getArea()), public: Math.round(isArea(PUBLIC) ? PUBLIC.getArea() : 0), osmKept: nOsm } };
}

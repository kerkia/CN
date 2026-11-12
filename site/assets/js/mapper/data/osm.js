// OpenStreetMap as map objects (Cartographier): the area's roads, paths, buildings, water, walls, fences, railways, power lines
// and open land, read from the Overpass API (the servers and the query of mapgen/osm.py, which draws the same features as
// pixels on the generated maps) and classified as mapgen/osm.py classifies them, in either style:
// - forest (ISOM 2017-2): 502 wide road, 503 road, 504 vehicle track, 505 footpath, 506 / 507 small and less distinct paths (by
//   trail_visibility / informal), 501 paved area, 521 building, 522 canopy, 301 water, 304 / 305 / 306 watercourses, 509
//   railway, 510 / 511 power lines, 513.1 / 515 walls, 513.2 retaining walls, 516 / 518 fences, 401 open land, 520 private ground;
// - sprint (ISSprOM 2019-2): every paved way as paved area 501 at its width on the ground (OSM's width, else its class's,
//   STREET_W, and its sidewalks), unpaved paths 505 / 506, 532 stairway, 521 building, 522 canopy, 515 wall, 513.2
//   retaining wall, 516 / 518 fences, 509.1 railway, 509.2 tramway, 305 / 306 watercourses, 401 open land, 520 private ground.
// Each object is { sym, otp, ang, coords, src: "osm", srcId: "way/123", draft: true } in the map's mm; areas are closed rings,
// a multipolygon's holes after its outer ring. © OpenStreetMap contributors, ODbL: `attribution` says so.

import { t } from "../lang.js";
import { ocad, areaCoords, clipLine, clipRing, inRing } from "./frame.js";

// the public Overpass servers, tried in turn (any may answer 429/502/504 or time out when busy); all answer CORS requests
export const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"];
export const UA = "Ozimut map generator (https://ozimut.com; contact@ozimut.com)";
export const LICENCE = { name: "ODbL 1.0", url: "https://www.openstreetmap.org/copyright" };

const WIDE = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const ROAD = new Set(["residential", "unclassified", "service", "living_street", "road", "busway"]);
const PATH = new Set(["path", "footway", "bridleway", "cycleway", "steps", "pedestrian", "corridor"]);
const FAINT = new Set(["bad", "horrible", "no"]);
const FAINTER = new Set(["horrible", "no"]);
const WATER_LINE = new Set(["river", "canal", "stream", "ditch", "drain"]);
const OPEN_LANDUSE = new Set(["grass", "village_green", "recreation_ground", "meadow", "greenfield"]);
const PAVED = new Set(["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone",
  "unhewn_cobblestone", "metal", "wood", "bricks", "stone"]);
const UNPAVED = new Set(["unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "grass", "sand", "mud", "pebblestone",
  "woodchips", "grass_paver", "rock"]);
/** A street's width on the ground (m) when OSM gives none, by its class (mapgen/osm.py STREET_W). */
export const STREET_W = { motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8, residential: 6.5, unclassified: 6,
  living_street: 5, road: 6, busway: 6, service: 4, pedestrian: 6, footway: 2.5, cycleway: 2.5, steps: 2.5, path: 2, bridleway: 2.5, track: 3, corridor: 2 };
const SIDES = { both: 2, left: 1, right: 1 };
const AREA_KINDS = new Set(["building", "canopy", "water", "paved", "open", "pitch", "private", "residential"]);

/** The Overpass query of the area (degrees), as mapgen/osm.py's. */
export function overpassQuery({ s, w, n, e }) {
  const b = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  return `[out:json][timeout:90];
(
  way["highway"](${b});
  way["building"](${b}); relation["building"](${b});
  way["natural"="water"](${b}); relation["natural"="water"](${b});
  way["landuse"~"^(reservoir|basin)$"](${b}); relation["landuse"~"^(reservoir|basin)$"](${b});
  way["waterway"](${b}); relation["waterway"="riverbank"](${b});
  way["railway"](${b});
  way["power"="line"](${b});
  way["barrier"~"^(wall|city_wall|retaining_wall|fence)$"](${b});
  way["amenity"="parking"](${b}); relation["amenity"="parking"](${b});
  way["area:highway"](${b});
  way["place"="square"](${b});
  way["landuse"~"^(grass|village_green|recreation_ground|meadow|greenfield|residential)$"](${b});
  relation["landuse"~"^(grass|village_green|recreation_ground|meadow|residential)$"](${b});
  way["leisure"~"^(park|playground|pitch|garden|common|dog_park)$"](${b}); relation["leisure"~"^(park|garden|common)$"](${b});
  way["natural"="grassland"](${b});
  way[~"^(landuse|leisure|amenity)$"~"."]["access"~"^(private|no)$"](${b});
);
out geom;`;
}

/**
 * The area's elements from Overpass (one query; the servers tried in turn, each given up after 150 s — a busy one may never
 * answer). opts: fetch (Node), signal, headers, timeoutMs.
 */
export async function fetchOverpass(box, opts = {}) {
  const f = opts.fetch || fetch, body = new URLSearchParams({ data: overpassQuery(box) }).toString();
  let err = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const ac = new AbortController(), stop = () => ac.abort(), tm = setTimeout(stop, opts.timeoutMs || 150000);
    opts.signal?.addEventListener("abort", stop);
    try {
      const r = await f(OVERPASS[attempt % OVERPASS.length], { method: "POST", body, signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...(opts.headers || {}) } });
      if (r.ok) return await r.json();
      err = new Error(`Overpass ${r.status}`);
    } catch (e) { if (opts.signal?.aborted) throw e; err = e; } finally { clearTimeout(tm); opts.signal?.removeEventListener("abort", stop); }
    await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1)));
  }
  throw err || new Error("Overpass");
}

const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
const widthOf = (v) => { const w = num(String(v ?? "").replace("m", "")); return w != null && w >= 0.5 && w <= 60 ? w : null; };
export function paved(hw, surface) {
  if (PAVED.has(surface)) return true;
  if (UNPAVED.has(surface)) return false;
  return !["path", "track", "bridleway"].includes(hw);
}
function ground(tg) {
  const lu = tg.landuse, le = tg.leisure;
  if ((tg.access === "private" || tg.access === "no") && (lu || le || tg.amenity)) return "private";
  if (le === "garden" && ["residential", "private"].includes(tg["garden:type"])) return "private";
  if (le === "pitch" || le === "playground") return "pitch";
  if (OPEN_LANDUSE.has(lu) || ["park", "common", "dog_park", "garden"].includes(le) || tg.natural === "grassland") return "open";
  if (lu === "residential") return "residential";
  return null;
}

/** A multipolygon's rings, its member ways joined end to end: [[role, [[lat, lon]…]]] (mapgen/osm.py _rings). */
function rings(rel) {
  const out = [];
  for (const role of ["outer", "inner"]) {
    const parts = (rel.members || []).filter((m) => m.type === "way" && (m.role || "outer") === role && m.geometry?.length)
      .map((m) => m.geometry.map((p) => [p.lat, p.lon]));
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    while (parts.length) {
      let ring = parts.shift(), grown = true;
      while (!same(ring[0], ring[ring.length - 1]) && grown) {
        grown = false;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (same(p[0], ring[ring.length - 1])) ring = ring.concat(p.slice(1));
          else if (same(p[p.length - 1], ring[ring.length - 1])) ring = ring.concat(p.slice(0, -1).reverse());
          else if (same(p[p.length - 1], ring[0])) ring = p.slice(0, -1).concat(ring);
          else if (same(p[0], ring[0])) ring = p.slice(1).reverse().concat(ring);
          else continue;
          parts.splice(i, 1); grown = true; break;
        }
      }
      if (ring.length >= 3) out.push([role, ring]);
    }
  }
  return out;
}

/**
 * The features worth mapping: { kind, id, tags, rings | line, hw, paved, width, sides } with [lat, lon] points (mapgen/osm.py
 * features: tunnels and things underground left out).
 */
export function features(data) {
  const out = [];
  for (const el of data.elements || []) {
    const tg = el.tags || {};
    if (!["no", undefined].includes(tg.tunnel) || tg.location === "underground" || String(tg.layer || "0").startsWith("-")) continue;
    const hw = tg.highway, ww = tg.waterway;
    let kind = null;
    if (["roof", "carport"].includes(tg.building) || tg["building:part"] === "roof") kind = "canopy";
    else if (tg.building && tg.building !== "no") kind = "building";
    else if (tg.natural === "water" || ["reservoir", "basin"].includes(tg.landuse) || ww === "riverbank") kind = "water";
    else if (tg.amenity === "parking" || tg["area:highway"] || tg.place === "square" || (["pedestrian", "footway"].includes(hw) && tg.area === "yes")) kind = "paved";
    else if (WIDE.has(hw)) kind = "wide";
    else if (ROAD.has(hw)) kind = "road";
    else if (hw === "track") kind = "track";
    else if (PATH.has(hw)) {
      if (tg.footway === "crossing") continue;
      kind = tg.footway === "sidewalk" || tg.path === "sidewalk" ? "sidewalk" : FAINT.has(tg.trail_visibility) || tg.informal === "yes" ? "smallpath" : "path";
    } else if (WATER_LINE.has(ww)) kind = `stream:${ww}`;
    else if (["rail", "light_rail", "narrow_gauge", "tram", "subway"].includes(tg.railway)) kind = "rail";
    else if (tg.power === "line") kind = "power";
    else if (["wall", "city_wall"].includes(tg.barrier)) kind = "wall";
    else if (tg.barrier === "retaining_wall") kind = "lowwall";
    else if (tg.barrier === "fence") kind = "fence";
    kind ||= ground(tg);
    if (!kind) continue;
    const id = `${el.type}/${el.id}`, area = AREA_KINDS.has(kind);
    if (el.type === "relation") { if (area) out.push({ kind, id, tags: tg, rings: rings(el) }); continue; }
    const pts = (el.geometry || []).filter(Boolean).map((p) => [p.lat, p.lon]);
    if (pts.length < 2) continue;
    if (area) {
      if (pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) out.push({ kind, id, tags: tg, rings: [["outer", pts]] });
    } else {
      out.push({ kind, id, tags: tg, line: pts, hw, paved: paved(hw, tg.surface), width: widthOf(tg.width),
        sides: SIDES[tg.sidewalk || tg["sidewalk:both"] || ""] || 0 });
    }
  }
  return out;
}

/** A paved way's width on the ground (m): OSM's, else its class's, and the sidewalks it says it has. */
export const streetW = (f) => (f.width || STREET_W[f.hw] || 4) + 1.5 * (f.sides || 0);
const height = (tg) => num(tg.height);
const S = (n, sub = 0) => n * 1000 + sub;

/**
 * A feature's symbols in a style: [{ sym, otp, band? }] (otp 2 line, 3 area; band: the line drawn as an area of that
 * width on the ground, metres). Empty: not drawn in that style.
 */
export function classify(f, style) {
  const tg = f.tags || {}, k = f.kind, sprint = style === "sprint";
  const area = (n, sub) => [{ sym: S(n, sub), otp: 3 }], line = (n, sub) => [{ sym: S(n, sub), otp: 2 }];
  switch (k) {
    case "building": return area(521);
    case "canopy": return area(522);
    case "water": return area(301);
    case "paved": return area(501);
    case "open": case "pitch": return area(401);
    case "private": return area(520);
    case "residential": return [];          // its gardens need the buildings and the streets cut out: left to the mapper
    case "rail": return sprint ? line(509, tg.railway === "tram" ? 2 : 1) : line(509);
    case "power": return line((num(tg.voltage) || 0) >= 63000 && !sprint ? 511 : 510);
    case "wall": {
      const h = height(tg);
      if (sprint) return line(...(tg.barrier === "wall" && h != null && h < 1.5 ? [513, 1] : [515]));
      return tg.barrier === "city_wall" || (h != null && h >= 1.5) ? line(515) : line(513, 1);
    }
    case "lowwall": return line(513, 2);
    case "fence": return line((height(tg) || 0) >= 1.8 ? 518 : 516);
  }
  if (k.startsWith("stream:")) {
    const w = k.slice(7);
    if (w === "ditch" || w === "drain") return line(306);
    return line(!sprint && (w === "river" || w === "canal") ? 304 : 305);
  }
  if (sprint) {
    if (f.hw === "steps") return line(532);
    if (f.paved) return [{ sym: S(501), otp: 3, band: streetW(f) }];
    if (k === "sidewalk") return [];
    return line(k === "smallpath" ? 506 : 505);
  }
  switch (k) {
    case "wide": return line(502);
    case "road": return line(503);
    case "track": return line(504);
    case "path": return line(505);
    case "smallpath": return line(FAINTER.has(tg.trail_visibility) ? 507 : 506);
    default: return [];                      // a sidewalk: the street says it on a forest map
  }
}

/** A polyline's outline at half-width h (map mm): [ring], split where it turns sharply (no self-crossing bands). */
export function band(pts, h) {
  const pieces = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    if (i < pts.length - 1) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > (100 * Math.PI) / 180) { pieces.push(cur); cur = [pts[i]]; }
    }
  }
  pieces.push(cur);
  const out = [];
  for (const p of pieces) {
    if (p.length < 2) continue;
    const left = [], right = [];
    for (let i = 0; i < p.length; i++) {
      const prev = p[Math.max(0, i - 1)], next = p[Math.min(p.length - 1, i + 1)];
      const d1 = norm(i > 0 ? [p[i][0] - prev[0], p[i][1] - prev[1]] : [next[0] - p[i][0], next[1] - p[i][1]]);
      const d2 = norm(i < p.length - 1 ? [next[0] - p[i][0], next[1] - p[i][1]] : d1);
      const n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]], m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
      const k = Math.min(2, 1 / Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]));      // the miter, limited
      left.push([p[i][0] + m[0] * h * k, p[i][1] + m[1] * h * k]);
      right.push([p[i][0] - m[0] * h * k, p[i][1] - m[1] * h * k]);
    }
    // round ends: a half circle of 5 points at each end
    const cap = (c, d) => { const a0 = Math.atan2(d[1], d[0]); return [1, 2, 3].map((q) => [c[0] + h * Math.cos(a0 - Math.PI / 2 + (q * Math.PI) / 4), c[1] + h * Math.sin(a0 - Math.PI / 2 + (q * Math.PI) / 4)]); };
    const dEnd = norm([p[p.length - 1][0] - p[p.length - 2][0], p[p.length - 1][1] - p[p.length - 2][1]]);
    const dStart = norm([p[0][0] - p[1][0], p[0][1] - p[1][1]]);
    out.push([...left, ...cap(p[p.length - 1], dEnd).reverse(), ...right.reverse(), ...cap(p[0], dStart).reverse(), left[0]]);
  }
  return out;
}
function norm([x, y]) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
const dedupe = (pts) => pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);

/**
 * The objects of Overpass's answer in a style, in the map's mm through the frame (frame.js), clipped to rect
 * ([x0, y0, x1, y1] map mm; none: kept whole). Returns { objects, counts: { <sym>: n }, features }.
 */
export function toObjects(data, frame, style = "forest", rect = null) {
  const feats = features(data), objects = [], counts = {};
  const mm = (pts) => dedupe(pts.map(([la, lo]) => frame.fromLatLon(la, lo)));
  const add = (o) => { objects.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  const scale = frame.scale || (style === "sprint" ? 4000 : 10000);
  for (const f of feats) {
    for (const c of classify(f, style)) {
      const base = { sym: c.sym, otp: c.otp, ang: 0, src: "osm", srcId: f.id, draft: true };
      if (f.line && c.otp === 2) {
        for (const piece of rect ? clipLine(mm(f.line), rect) : [mm(f.line)]) if (piece.length >= 2) add({ ...base, coords: piece.map(([x, y]) => ocad(x, y)) });
      } else if (f.line && c.band) {
        const line = mm(f.line);
        if (line.length < 2) continue;
        for (const ring of band(line, (c.band * 1000) / scale / 2)) {
          const r = rect ? clipRing(ring, rect) : ring;
          if (r) add({ ...base, coords: areaCoords([r]) });
        }
      } else if (f.rings) {
        // each outer ring an object, the inner rings inside it its holes
        const outer = [], inner = [];
        for (const [role, r] of f.rings) (role === "inner" ? inner : outer).push(mm(r));
        for (const o of outer) {
          const ring = rect ? clipRing(o, rect) : o;
          if (!ring || ring.length < 4) continue;
          const holes = inner.filter((h) => inRing(h[0], o)).map((h) => (rect ? clipRing(h, rect) : h)).filter((h) => h && h.length >= 4);
          add({ ...base, coords: areaCoords([ring, ...holes]) });
        }
      }
    }
  }
  return { objects, counts, features: feats.length };
}

/**
 * OpenStreetMap's objects for a rectangle of the map (map mm) in a style: one Overpass query for its extent (+ margin m),
 * then toObjects. Resolves { objects, counts, attribution, licence, elements }. opts: margin, signal, fetch, headers, onStage.
 */
export async function loadOsm(frame, rect, style = "forest", opts = {}) {
  const a = frame.areaLatLon(rect), m = opts.margin ?? 20, dLat = m / 111320, dLon = m / (111320 * Math.cos((((a.s + a.n) / 2) * Math.PI) / 180));
  opts.onStage?.("map.data.osm.asking");
  const data = await fetchOverpass({ s: a.s - dLat, w: a.w - dLon, n: a.n + dLat, e: a.e + dLon }, opts);
  opts.onStage?.("map.data.osm.reading");
  const r = toObjects(data, frame, style, rect);
  return { ...r, attribution: t("map.data.osm.credit"), licence: LICENCE, elements: (data.elements || []).length };
}

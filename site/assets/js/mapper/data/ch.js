// Switzerland's topographic data as map objects (Cartographier, 2026-11-06): swisstopo's base vector tiles
// (vectortiles.geo.admin.ch, ch.swisstopo.base.vt, drawn from swissTLM3D; open data, CORS open, « © swisstopo ») read at
// zoom 14 — a tile of ~1.7 km across in 4096 units, ~0.4 m a unit —, classified in either style as bdtopo.js does France's:
// - forest (ISOM 2017-2): 521 buildings (522 roofs without walls), 502 main roads, 503 minor roads, 504 tracks (« 2 m Weg »),
//   505 footpaths (« 1 m Weg »), 506 small paths (« Wegfragment »), 507 the faintest (marked routes, over rock or scree), 532
//   steps, 509 railways, 301 water, 304 / 305 / 306 watercourses by width and season, 513.1 walls, 401 parks and pitches, 501
//   parkings, 414 vineyards;
// - sprint (ISSprOM 2019-2): every paved road and paved footway as paved area 501 at its class's width on the ground, unpaved
//   paths 505 / 506, steps 532, buildings 521 / canopies 522, walls 515 (dry-stone walls 513.1), railways 509.1, tramways 509.2,
//   water, parkings 501, parks and pitches 401.
// Tunnels and underground buildings are left out; forest (white) and single trees are not drawn. Features cut by the tiles'
// edges are put together again: lines joined end to end, areas united along the edge they share (polygon-clipping through
// boolean.js). Each object { sym, otp, ang, coords, src: "swisstopo", srcId, draft: true }. Walls exist only where swissTLM3D
// has them (« Mauer », « Trockenmauer »); fences and hedges are not in the tiles.

import { ocad, areaCoords, clipLine, clipRing } from "./frame.js";
import { band } from "./osm.js";
import { decodeTile, polygons } from "./mvt.js";

export const TILES = (z, x, y) => `https://vectortiles${(x + y) % 5}.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/${z}/${x}/${y}.pbf`;
export const CREDIT = "© swisstopo (swissTLM3D, base vector tiles)";
const Z = 14, MAX_TILES = 64, PAR = 4;
const LAYERS = new Set(["building", "building_ln", "transportation", "water", "waterway", "landcover", "landuse"]);
const S = (n, sub = 0) => n * 1000 + sub;
/** A road's width on the ground (m) for the sprint style, by its class. */
const ROAD_W = { motorway: 14, trunk: 12, primary: 9, secondary: 8, tertiary: 7, minor: 5, service: 4, footway: 2.5, path: 2 };
const MAIN = new Set(["motorway", "trunk", "primary", "secondary"]);

/** What a tile's feature becomes in a style: [{ sym, otp, band? (width on the ground, m) }]. */
export function classify(layer, p, style) {
  const sprint = style === "sprint", cls = p.class || "", sub = p.subclass || "";
  const line = (n, s) => [{ sym: S(n, s), otp: 2 }], area = (n, s) => [{ sym: S(n, s), otp: 3 }];
  switch (layer) {
    case "building":
      if (cls === "underground") return [];
      return cls === "roof" || cls === "coverage" ? area(522) : area(521);
    case "building_ln":
      if (cls === "wall") return sprint ? line(515) : line(513, 1);
      if (cls === "dry_wall") return line(513, 1);
      return [];
    case "transportation": {
      if (p.brunnel === "tunnel") return [];
      if (cls === "rail" || cls === "rail_construction") return cls === "rail" ? (sprint ? line(509, 1) : line(509)) : [];
      if (cls === "transit") return sprint && sub === "tram" ? line(509, 2) : [];
      if (sub === "steps") return line(532);
      const paved = p.surface === "paved";
      if (MAIN.has(cls) || cls === "tertiary" || cls === "minor" || cls === "service") {
        if (sprint) return paved || cls !== "minor" ? [{ sym: S(501), otp: 3, band: ROAD_W[cls] || 5 }] : line(505);
        return MAIN.has(cls) ? line(502) : paved || cls === "tertiary" ? line(503) : line(504);
      }
      if (cls === "track") return sprint ? line(505) : line(504);
      if (cls === "footway") return sprint ? (paved ? [{ sym: S(501), otp: 3, band: ROAD_W.footway }] : line(505)) : line(505);
      if (cls === "path") return sprint ? (paved ? [{ sym: S(501), otp: 3, band: ROAD_W.path }] : line(506)) : p.surface ? line(506) : line(507);
      if (cls === "mask_terrain" || cls === "trail") return sprint ? line(506) : line(507);
      return [];
    }
    case "water": return area(301);
    case "waterway": {
      if (cls === "stream") return p.intermittent ? line(306) : !sprint && Number(p.width) >= 2 ? line(304) : line(305);
      // a river wider than a few metres is the water area already (its banks drawn by `water`)
      if (cls === "river") return Number(p.width) >= 5 ? [] : sprint ? line(305) : line(304);
      return [];
    }
    case "landcover":
      if (cls === "farmland" && sub === "vineyard") return area(414);
      if (cls === "grass" && sub === "park") return area(401);
      return [];
    case "landuse":
      if (cls === "parking") return area(501);
      if (cls === "pitch") return area(401);
      return [];
  }
  return [];
}

/** The z14 tiles over a box of degrees: [[x, y]…], or null when over MAX_TILES. */
export function tilesOver({ s, w, n, e }, z = Z) {
  const N = 2 ** z, tx = (lon) => Math.floor(((lon + 180) / 360) * N);
  const ty = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N); };
  const out = [];
  for (let x = tx(w); x <= tx(e); x++) for (let y = ty(n); y <= ty(s); y++) out.push([x, y]);
  return out.length > MAX_TILES ? null : out;
}

/** Lines' pieces joined end to end where their ends meet (a line cut at a tile's edge); a junction of three is left. */
export function joinLines(lines) {
  // ends compared to a unit (~0.4 m at zoom 14): a line's two pieces are cut by each tile on its own
  const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`, ends = new Map(), alive = lines.map((l) => l.slice());
  const add = (i) => { for (const p of [alive[i][0], alive[i][alive[i].length - 1]]) { const k = key(p); if (!ends.has(k)) ends.set(k, new Set()); ends.get(k).add(i); } };
  const del = (i) => { for (const p of [alive[i][0], alive[i][alive[i].length - 1]]) ends.get(key(p))?.delete(i); };
  alive.forEach((_, i) => add(i));
  for (let i = 0; i < alive.length; i++) {
    if (!alive[i]) continue;
    for (let grew = true; grew;) {
      grew = false;
      for (const atEnd of [true, false]) {
        const p = atEnd ? alive[i][alive[i].length - 1] : alive[i][0];
        const others = [...(ends.get(key(p)) || [])].filter((j) => j !== i && alive[j]);
        if (others.length !== 1 || (ends.get(key(p))?.size || 0) > 2) continue;      // a junction: left as it is
        const j = others[0];
        let o = alive[j];
        del(i); del(j);
        if (atEnd) { if (key(o[0]) !== key(p)) o = o.slice().reverse(); alive[i] = [...alive[i], ...o.slice(1)]; }
        else { if (key(o[o.length - 1]) !== key(p)) o = o.slice().reverse(); alive[i] = [...o, ...alive[i].slice(1)]; }
        alive[j] = null;
        add(i);
        grew = true;
        break;
      }
    }
  }
  return alive.filter(Boolean);
}

/** Groups of area pieces that share a stretch of a tile's edge: arrays of indices (pieces alone included). */
export function seamGroups(pieces, E) {
  // each piece: { rings (global units), tile: "x/y" }; a seam segment is a ring's edge lying on a multiple of E
  const parent = pieces.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const lines = new Map();
  pieces.forEach((pc, i) => {
    for (const r of pc.rings) for (let k = 1; k < r.length; k++) {
      const [ax, ay] = r[k - 1], [bx, by] = r[k];
      if (ax === bx && ax % E === 0 && ay !== by) (lines.get(`x${ax}`) || lines.set(`x${ax}`, []).get(`x${ax}`)).push([i, Math.min(ay, by), Math.max(ay, by)]);
      else if (ay === by && ay % E === 0 && ax !== bx) (lines.get(`y${ay}`) || lines.set(`y${ay}`, []).get(`y${ay}`)).push([i, Math.min(ax, bx), Math.max(ax, bx)]);
    }
  });
  for (const segs of lines.values()) {
    segs.sort((a, b) => a[1] - b[1]);
    for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length && segs[b][1] < segs[a][2]; b++) {
      const [i, , ] = segs[a], [j] = segs[b];
      if (pieces[i].tile !== pieces[j].tile && Math.min(segs[a][2], segs[b][2]) - segs[b][1] > 0) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  pieces.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}

/**
 * swisstopo's objects for a rectangle of the map (map mm) through the frame (frame.js), clipped to it. opts: onStage("tiles", i, n)
 * per tile read, fetch (tests). Resolves { objects, counts, credit, failed: [tiles not read] }.
 */
export async function loadSwissTlm(frame, rect, style = "forest", opts = {}) {
  if (!frame.geo) throw new Error("nogeo");
  const box = frame.areaLatLon(rect), scale = frame.scale || 10000, f = opts.fetch || fetch;
  const tiles = tilesOver(box);
  if (!tiles) throw new Error("toolarge");
  const failed = [], lines = new Map(), areas = new Map();       // by symbol: line pieces / area pieces in global units
  let E = 4096, done = 0, next = 0;
  const one = async ([x, y]) => {
    let L;
    try {
      const r = await f(TILES(Z, x, y), { credentials: "omit", referrerPolicy: "no-referrer" });
      if (r.status === 404 || r.status === 204) return;                        // nothing there (abroad, a lake)
      if (!r.ok) throw new Error(String(r.status));
      L = decodeTile(new Uint8Array(await r.arrayBuffer()), LAYERS);
    } catch (e) { failed.push(`${x}/${y}`); return; }
    finally { opts.onStage?.("tiles", ++done, tiles.length); }
    for (const [layer, { extent, features }] of Object.entries(L)) {
      E = extent;
      const sq = [0, 0, extent, extent], gx = (p) => [x * extent + p[0], y * extent + p[1]];
      for (const ft of features) for (const c of classify(layer, ft.props, style)) {
        const k = `${c.sym}|${c.otp}|${c.band || 0}`;
        if (ft.type === 2 || (ft.type === 3 && c.otp === 2)) {
          const list = lines.get(k) || lines.set(k, []).get(k);
          for (const part of ft.parts) for (const piece of clipLine(part, sq)) list.push(piece.map(gx));
        } else if (ft.type === 3) {
          const list = areas.get(k) || areas.set(k, []).get(k);
          for (const poly of polygons(ft.parts)) {
            const outer = clipRing(poly[0], sq);
            if (!outer || outer.length < 4) continue;
            const holes = poly.slice(1).map((h) => clipRing(h, sq)).filter((h) => h && h.length >= 4);
            list.push({ tile: `${x}/${y}`, rings: [outer, ...holes].map((r) => r.map(gx)) });
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAR, tiles.length) }, async () => { while (next < tiles.length) await one(tiles[next++]); }));

  const N = 2 ** Z;
  const mm = ([X, Y]) => {
    const lon = (X / (E * N)) * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / (E * N)))) * 180) / Math.PI;
    return frame.fromLatLon(lat, lon);
  };
  const objects = [], counts = {};
  const add = (o) => { objects.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  let seq = 0;
  for (const [k, list] of lines) {
    const [sym, otp, bw] = k.split("|").map(Number);
    for (const l of joinLines(list)) {
      const base = { sym, otp: bw ? 3 : otp, ang: 0, src: "swisstopo", srcId: `vt/${Z}/${sym}/${++seq}`, draft: true };
      const pts = l.map(mm);
      if (bw) { for (const ring of band(pts, (bw * 1000) / scale / 2)) { const r = clipRing(ring, rect); if (r) add({ ...base, coords: areaCoords([r]) }); } }
      else for (const piece of clipLine(pts, rect)) if (piece.length >= 2) add({ ...base, coords: piece.map(([px, py]) => ocad(px, py)) });
    }
  }
  let B = null;
  for (const [k, list] of areas) {
    const [sym] = k.split("|").map(Number);
    for (const g of seamGroups(list, E)) {
      const base = { sym, otp: 3, ang: 0, src: "swisstopo", srcId: `vt/${Z}/${sym}/${++seq}`, draft: true };
      const parts = [];
      for (const i of g) {
        const rings = list[i].rings.map((r) => r.map(mm)), outer = clipRing(rings[0], rect);
        if (!outer || outer.length < 4) continue;
        parts.push(areaCoords([outer, ...rings.slice(1).map((h) => clipRing(h, rect)).filter((h) => h && h.length >= 4)]));
      }
      if (parts.length > 1) {
        // pieces of one feature cut by the tiles: one area again (polygon-clipping; left in pieces if it cannot load)
        try { B ||= await import("../boolean.js"); for (const c of await B.union(parts)) add({ ...base, coords: c }); continue; }
        catch (e) { /* the pieces as they are */ }
      }
      for (const c of parts) add({ ...base, coords: c });
    }
  }
  return { objects, counts, credit: CREDIT, failed };
}

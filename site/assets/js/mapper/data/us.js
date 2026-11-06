// The USA's national data as map objects (Cartographier, 2026-11-06), from public-domain federal services read from the
// browser (ArcGIS REST « query » in GeoJSON, CORS open), classified in either style as bdtopo.js does France's:
// - roads and trails of The National Map (carto.nationalmap.gov, « transportation »: the Census Bureau's TIGER roads by their
//   MTFCC class, the National Digital Trails), forest 502 / 503 / 504 / 505 / 532, sprint paved area 501 at the class's width
//   on the ground (unpaved ways 505);
// - hydrography of the National Hydrography Dataset, high resolution (hydro.nationalmap.gov « nhd »: flowlines by FCode —
//   perennial 305, intermittent and ephemeral 306, canals and ditches 306 —, waterbodies 301, marshes 310, wide rivers 301);
//   its server often answers in 30-70 s or not at all: past NHD_WAIT, the 3D Hydrography Program's (« 3DHP_all », drawn from
//   3DEP's LiDAR, fast, not yet everywhere, no season: its channels all 306, its waterbodies 301) stands in;
// - buildings from FEMA's USA Structures (ORNL's footprints from imagery, services2.arcgis.com, public domain): 521.
// Roads are TIGER's, placed to a few metres; trails as their managers mapped them. Tunnels and pipelines left out. Each
// object { sym, otp, ang, coords, src: "tnm", srcId, draft: true }; the map's own walls, fences, paved areas come from
// OpenStreetMap and the field.

import { ocad, areaCoords, clipLine, clipRing } from "./frame.js";
import { band } from "./osm.js";

export const CREDIT = "USGS The National Map (TIGER roads, National Digital Trails, NHD), FEMA USA Structures — public domain";
const TNM = "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer";
const NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer";
const HP3D = "https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer";
const WAIT = 40000, NHD_WAIT = 75000;          // ms a request may take
const STRUCTURES = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
/** The layers read: [name, service layer URL, fields asked, the layer standing in when it fails: [name, URL, fields]]. NHD's first. */
export const LAYERS = [
  ["flowlines", `${NHD}/6`, "fcode", ["channels-3dhp", `${HP3D}/50`, "featuretype"]],
  ["waterbodies", `${NHD}/12`, "ftype,fcode", ["waterbodies-3dhp", `${HP3D}/60`, "featuretype"]], ["areas", `${NHD}/9`, "ftype,fcode"],
  ["roads-highways", `${TNM}/29`, "mtfcc_code"], ["roads-secondary", `${TNM}/30`, "mtfcc_code"], ["roads-connecting", `${TNM}/31`, "mtfcc_code"],
  ["roads-local", `${TNM}/32`, "mtfcc_code"], ["roads-ramps", `${TNM}/33`, "mtfcc_code"], ["roads-4wd", `${TNM}/35`, "mtfcc_code"],
  ["trails", `${TNM}/37`, "trailtype,hikerpedestrian,trailsurface"], ["buildings", STRUCTURES, "OCC_CLS"],
];
const PAGE = 2000, MAX_PAGES = 10;
const S = (n, sub = 0) => n * 1000 + sub;
/** A road's width on the ground (m) for the sprint style, by MTFCC. */
const ROAD_W = { S1100: 14, S1200: 10, S1400: 7, S1630: 6, S1640: 4, S1730: 4, S1740: 5, S1780: 5, S1710: 2.5, S1820: 2.5 };

/** What a feature becomes in a style: [{ sym, otp, band? (width on the ground, m) }]. */
export function classify(layer, p, style) {
  const sprint = style === "sprint";
  const line = (n, s) => [{ sym: S(n, s), otp: 2 }], area = (n, s) => [{ sym: S(n, s), otp: 3 }];
  if (layer.startsWith("roads")) {
    const m = String(p.mtfcc_code || "");
    if (m === "S1750") return [];                                                   // the Census Bureau's internal ways
    if (m === "S1720") return line(532);                                            // stairway
    if (m === "S1500" || m === "S1830") return sprint || m === "S1830" ? line(505) : line(504);   // 4WD track, bridle path
    if (m === "S1710" || m === "S1820") return sprint ? [{ sym: S(501), otp: 3, band: ROAD_W[m] }] : line(505);
    if (sprint) return [{ sym: S(501), otp: 3, band: ROAD_W[m] || 6 }];
    return m === "S1100" || m === "S1200" ? line(502) : line(503);
  }
  if (layer === "trails") {
    if (p.trailtype && p.trailtype !== "Terra Trail") return [];                    // snow and water trails
    if (p.hikerpedestrian === "No") return [];
    return /paved|asphalt|concrete/i.test(p.trailsurface || "") && sprint ? [{ sym: S(501), otp: 3, band: 2.5 }] : line(505);
  }
  if (layer === "flowlines") {
    const f = Number(p.fcode) || 0, t = Math.floor(f / 100);
    if (t === 460) return f === 46006 ? line(305) : line(306);                  // stream / river: perennial, else intermittent
    if (t === 336 || t === 334) return line(306);                                // canal, ditch; connector
    return [];                                                                    // artificial paths, pipelines, coastline
  }
  if (layer === "waterbodies") {
    const t = Number(p.ftype) || 0;
    if (t === 390 || t === 436 || t === 493) return area(301);                   // lake / pond, reservoir, estuary
    if (t === 466) return area(310);                                             // swamp / marsh
    return [];
  }
  if (layer === "areas") return Number(p.ftype) === 460 ? area(301) : [];       // a wide river's area
  if (layer === "channels-3dhp") return [1, 2].includes(Number(p.featuretype)) ? line(306) : [];   // channel line, canal; not connectors
  if (layer === "waterbodies-3dhp") return area(301);
  if (layer === "buildings") return area(521);
  return [];
}

/** One layer's GeoJSON features over a box of degrees, page by page; each request given up after `wait` ms. */
export async function layerFeatures(url, fields, { s, w, n, e }, f = fetch, wait = WAIT) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ where: "1=1", geometry: [w, s, e, n].map((v) => v.toFixed(6)).join(","), geometryType: "esriGeometryEnvelope",
      inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: fields, returnGeometry: "true", outSR: "4326", f: "geojson",
      resultOffset: String(page * PAGE), resultRecordCount: String(PAGE) });
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), wait);
      let r;
      try { r = await f(`${url}/query?${q}`, { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl.signal }); if (r.ok) j = await r.json(); }
      catch (e) { throw new Error(`${url}: ${e.name === "AbortError" ? "timeout" : e.message}`); }
      finally { clearTimeout(timer); }
      if (j) { if (j.error) throw new Error(`${url} ${j.error.code}`); }
      else if (r.status !== 429 && r.status < 500) throw new Error(`${url} ${r.status}`);
      else await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
    if (!j) throw new Error(`${url}: no answer`);
    const list = j.features || [];
    out.push(...list);
    if (!(j.exceededTransferLimit || j.properties?.exceededTransferLimit) || !list.length) break;
  }
  return out;
}

/**
 * The National Map's objects for a rectangle of the map (map mm) through the frame (frame.js), clipped to it. opts:
 * onStage(layer, i, n), fetch (tests). Resolves { objects, counts, credit, failed: [layers not read] }.
 */
export async function loadTnm(frame, rect, style = "forest", opts = {}) {
  if (!frame.geo) throw new Error("nogeo");
  const box = frame.areaLatLon(rect), scale = frame.scale || 10000;
  const mm = ([lon, lat]) => frame.fromLatLon(lat, lon);
  const objects = [], counts = {}, failed = [];
  const add = (o) => { objects.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  // the layers three at a time, NHD's (slow) first; a layer that fails gives way to the one standing in for it
  const got = new Array(LAYERS.length), names = LAYERS.map((l) => l[0]);
  let next = 0, done = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (next < LAYERS.length) {
      const i = next++, [name, url, fields, alt] = LAYERS[i];
      try { got[i] = await layerFeatures(url, fields, box, opts.fetch, url.startsWith(NHD) ? NHD_WAIT : WAIT); }
      catch (e) {
        got[i] = [];
        if (alt) { try { got[i] = await layerFeatures(alt[1], alt[2], box, opts.fetch); names[i] = alt[0]; } catch (e2) { failed.push(name); } }
        else failed.push(name);
      }
      opts.onStage?.(name, ++done, LAYERS.length);
    }
  }));
  names.forEach((layer, i) => {
    for (const f of got[i]) {
      const g = f.geometry;
      if (!g) continue;
      for (const c of classify(layer, f.properties || {}, style)) {
        const base = { sym: c.sym, otp: c.otp, ang: 0, src: "tnm", srcId: `${layer}/${f.id ?? f.properties?.OBJECTID ?? f.properties?.objectid ?? ""}`, draft: true };
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        if (c.band) {
          for (const l of lines) {
            const pts = l.map(mm);
            if (pts.length < 2) continue;
            for (const ring of band(pts, (c.band * 1000) / scale / 2)) { const r = clipRing(ring, rect); if (r) add({ ...base, coords: areaCoords([r]) }); }
          }
        } else if (c.otp === 2) {
          for (const l of lines) for (const piece of clipLine(l.map(mm), rect)) if (piece.length >= 2) add({ ...base, coords: piece.map(([x, y]) => ocad(x, y)) });
        } else {
          for (const p of polys) {
            const outer = clipRing(p[0].map(mm), rect);
            if (!outer || outer.length < 4) continue;
            const holes = p.slice(1).map((h) => clipRing(h.map(mm), rect)).filter((h) => h && h.length >= 4);
            add({ ...base, coords: areaCoords([outer, ...holes]) });
          }
        }
      }
    }
  });
  return { objects, counts, credit: CREDIT, failed };
}

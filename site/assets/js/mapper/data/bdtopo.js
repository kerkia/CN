// IGN's BD TOPO as map objects (Cartographier, owner 2026-11-06): France's topographic database read from IGN's WFS
// (data.geopf.fr, open, CORS, Licence Ouverte 2.0) in Lambert 93, layer by layer, and classified in either style:
// - forest (ISOM 2017-2): 521 buildings, 502 / 503 roads by their width, 504 tracks (« Chemin », « Route empierrée »), 505 paths
//   (« Sentier »), 532 stairways, 301 water bodies, 304 / 305 / 306 watercourses by width and ditches, 513 / 515 walls, 514 ruins,
//   104 earth banks (« Talus »), 105 earth walls (« Levée »), 412 / 413 / 414 cultivation, 410 hedges, 416 hedge lines, 401 sports
//   grounds, 501 parkings;
// - sprint (ISSprOM 2019-2): every road as paved area 501 at its width on the ground (« largeur de chaussée », sidewalks added in
//   town), paths 505, stairways 532, buildings 521, walls 515 and retaining walls 513.2, water, banks, parkings 501, sports 401.
// Tunnels and underground watercourses are left out. Each object { sym, otp, ang, coords, src: "bdtopo", srcId, draft: true }.
// The forest (white on an orienteering map) is not drawn: the mapper's vegetation comes from the LiDAR and the field.

import { ocad, areaCoords, clipLine, clipRing } from "./frame.js";
import { band } from "./osm.js";

export const WFS = "https://data.geopf.fr/wfs/ows";
export const CREDIT = "© IGN, BD TOPO (Licence Ouverte 2.0)";
const LAYERS = ["batiment", "troncon_de_route", "troncon_hydrographique", "surface_hydrographique", "zone_de_vegetation", "haie", "construction_lineaire",
  "ligne_orographique", "terrain_de_sport", "equipement_de_transport"];
const PAGE = 5000, MAX_PAGES = 8;
const S = (n, sub = 0) => n * 1000 + sub;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** A road's width on the ground (m) when BD TOPO gives none, by its nature. */
const ROAD_W = { "route a 2 chaussees": 14, "quasi-autoroute": 14, "type autoroutier": 16, bretelle: 6, "route a 1 chaussee": 6, "rond-point": 7, "route empierree": 4,
  chemin: 3, sentier: 1.5, escalier: 2.5, "piste cyclable": 2.5, "bac ou liaison maritime": 0 };

/** The WFS request for one layer and page (the area in degrees, lat/lon order of EPSG:4326's URN; the answer in Lambert 93). */
export function url(layer, { s, w, n, e }, start = 0) {
  const q = new URLSearchParams({ SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: `BDTOPO_V3:${layer}`, SRSNAME: "EPSG:2154",
    BBOX: `${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326`, OUTPUTFORMAT: "application/json", COUNT: String(PAGE), STARTINDEX: String(start) });
  return `${WFS}?${q}`;
}
/** One layer's features over an area (degrees), page by page. */
export async function layerFeatures(layer, box, f = fetch) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await f(url(layer, box, page * PAGE), { credentials: "omit" });
    if (!r.ok) throw new Error(`bdtopo ${layer} ${r.status}`);
    const j = await r.json();
    const list = j.features || [];
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

/** What a BD TOPO feature becomes in a style: [{ sym, otp, band? (width on the ground, m) }]. */
export function classify(layer, p, style) {
  const sprint = style === "sprint", nat = norm(p.nature);
  const line = (n, sub) => [{ sym: S(n, sub), otp: 2 }], area = (n, sub) => [{ sym: S(n, sub), otp: 3 }];
  const under = Number(p.position_par_rapport_au_sol) < 0;
  switch (layer) {
    case "batiment": return area(521);
    case "troncon_de_route": {
      if (under || nat.startsWith("bac")) return [];
      if (nat === "escalier") return line(532);
      if (nat === "sentier") return line(505);
      if (nat === "piste cyclable") return sprint ? [{ sym: S(501), otp: 3, band: Number(p.largeur_de_chaussee) || 2.5 }] : line(505);
      if (nat === "chemin" || nat === "route empierree") return sprint ? line(505) : line(504);
      const w = Number(p.largeur_de_chaussee) || ROAD_W[nat] || 6;
      if (sprint) return [{ sym: S(501), otp: 3, band: w + (p.urbain ? 3 : 0) }];
      return line(w >= 6.5 || nat.includes("2 chaussees") || nat.includes("autorout") ? 502 : 503);
    }
    case "troncon_hydrographique": {
      if (under || /retenue|reservoir/.test(nat)) return [];
      if (p.fosse) return line(306);
      const big = /15|50/.test(norm(p.classe_de_largeur));
      return line(!sprint && big ? 304 : 305);
    }
    case "surface_hydrographique": return area(301);
    case "zone_de_vegetation":
      if (nat === "haie") return area(410);
      if (nat === "verger" || nat === "peupleraie") return area(413);
      if (nat === "vigne") return area(414);
      return [];
    case "haie": return line(416);
    case "construction_lineaire":
      if (nat === "mur") return sprint ? line(515) : line(513);
      if (nat === "mur de soutenement") return sprint ? line(513, 2) : line(513);
      if (nat === "ruines") return sprint ? line(513, 1) : line(514);
      if (nat === "quai") return sprint ? line(513, 2) : line(513);
      return [];
    case "ligne_orographique":
      if (nat === "talus") return line(104);
      if (nat === "levee") return sprint ? line(105, 1) : line(105);
      return [];
    case "terrain_de_sport": return area(401);
    case "equipement_de_transport": return /parking|service dedie/.test(nat) ? area(501) : [];
  }
  return [];
}

/** BD TOPO's objects for a rectangle of the map (map mm) through the frame (frame.js), clipped to it. opts: onStage(layer, i, n). */
export async function loadBdtopo(frame, rect, style = "forest", opts = {}) {
  if (!frame.geo) throw new Error("nogeo");
  const box = frame.areaLatLon(rect), scale = frame.scale || 10000;
  const mm = ([X, Y]) => frame.fromL93mm(X, Y);
  const objects = [], counts = {};
  const add = (o) => { objects.push(o); counts[o.sym] = (counts[o.sym] || 0) + 1; };
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    opts.onStage?.(layer, i, LAYERS.length);
    let feats;
    try { feats = await layerFeatures(layer, box, opts.fetch); } catch (e) { (opts.failed ||= []).push(layer); continue; }
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      for (const c of classify(layer, f.properties || {}, style)) {
        const base = { sym: c.sym, otp: c.otp, ang: 0, src: "bdtopo", srcId: `${layer}/${f.properties?.cleabs || f.id || ""}`, draft: true };
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
          for (const p of polys) for (const ring of p) for (const piece of clipLine(ring.map(mm), rect)) if (piece.length >= 2) add({ ...base, coords: piece.map(([x, y]) => ocad(x, y)) });
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
  }
  return { objects, counts, credit: CREDIT, failed: opts.failed || [] };
}

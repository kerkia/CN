// The ground's heights under a calibrated map, for « Analyse solo »'s 3D view (2026-10-24): a regular grid laid over the map
// image (its nodes at map pixels, so the image is the mesh's texture as it is), each node's height from
// - IGN's RGE ALTI in France (Géoplateforme's elevation service: 5,000 points a request at most, about one request a second
//   asked — three at a time here; CORS open; its 1 m model read at the grid's nodes), else, or when IGN fails,
// - the AWS open terrain tiles (« Terrarium » PNGs, the height in the colour: R × 256 + G + B / 256 − 32768; SRTM's 30 m
//   and better national models where Mapzen had them), read at the zoom whose pixel is the grid's step, 15 at most.
// Only the nodes' coordinates leave the browser, never the trace. The grid is kept in IndexedDB (« ocn-analyse », the
// analyses' own base; keys « dem:… », the last DEM_KEEP grids) so that the view opens at once the next time.

const IGN = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const IGN_MAX = 4900, IGN_PAR = 3;
const TILES = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const MAX_NODES = 40000, MIN_STEP = 5, MAX_SIDE = 320;
const DB = "ocn-analyse", STORE = "files", DEM_KEEP = 12;

/** The sources' credits, shown in the view. */
export const CREDIT = {
  ign: { text: "IGN – RGE ALTI®", url: "https://geoservices.ign.fr/rgealti" },
  tiles: { text: "Terrain Tiles (Mapzen, AWS Open Data: SRTM, GMTED, EU-DEM, USGS 3DEP…)", url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md" },
};
CREDIT["ign+tiles"] = { text: `${CREDIT.ign.text}, Terrain Tiles`, url: CREDIT.ign.url };

/**
 * The grid over a map of W × H pixels whose pixels map to metres by toM(px, py): about MAX_NODES nodes, a step of 5 m at
 * least, no side over MAX_SIDE nodes. Returns { nx, ny, step } (step in metres, along the longer side).
 */
export function gridPlan(W, H, toM) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wm = d(toM(0, 0), toM(W, 0)), hm = d(toM(0, 0), toM(0, H));
  let step = Math.max(MIN_STEP, Math.sqrt((wm * hm) / MAX_NODES));
  step = Math.max(step, Math.max(wm, hm) / (MAX_SIDE - 1));
  return { nx: Math.max(2, Math.round(wm / step) + 1), ny: Math.max(2, Math.round(hm / step) + 1), step, wm, hm };
}

/** Whether a place is where IGN's model has data: metropolitan France, Corsica and the overseas départements. */
export function inFrance(lat, lon) {
  const boxes = [[41.2, 51.2, -5.5, 9.8], [15.8, 16.6, -61.9, -60.9], [14.3, 14.9, -61.3, -60.7], [2.0, 5.9, -54.7, -51.5], [-21.5, -20.8, 55.1, 55.9], [-13.1, -12.6, 44.9, 45.4]];
  return boxes.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);
}

// ---- the cache -----------------------------------------------------------------------------------------------------------
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbDo(fn) {
  const db = await idb();
  try { return await new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); const out = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(out?.result); tx.onerror = () => rej(tx.error); }); }
  finally { db.close(); }
}
async function cached(key) { try { return await idbDo((s) => s.get(key)); } catch (e) { return null; } }
async function keep(key, value) {
  try {
    const index = ((await cached("dem:index")) || []).filter((k) => k !== key);
    index.push(key);
    const drop = index.splice(0, Math.max(0, index.length - DEM_KEEP));
    await idbDo((s) => { s.put(value, key); s.put(index, "dem:index"); for (const k of drop) s.delete(k); });
  } catch (e) { /* not kept: fetched again next time */ }
}

// ---- the sources ---------------------------------------------------------------------------------------------------------
/** IGN's heights at the points [[lat, lon]…]: NaN where it has none (-99999). Throws when the service fails. */
async function fromIgn(pts, onProgress) {
  const z = new Float32Array(pts.length).fill(NaN), chunks = [];
  for (let i = 0; i < pts.length; i += IGN_MAX) chunks.push(i);
  let done = 0, next = 0;
  const one = async (from) => {
    const part = pts.slice(from, from + IGN_MAX);
    const body = JSON.stringify({ lon: part.map((p) => p[1].toFixed(6)).join("|"), lat: part.map((p) => p[0].toFixed(6)).join("|"), resource: "ign_rge_alti_wld", zonly: "true", delimiter: "|" });
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(IGN, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "omit", referrerPolicy: "no-referrer" });
      if (r.ok) {
        const j = await r.json();
        // France's lowest land is a few metres below the sea: deeper values are the model's sea (−522 m by Monaco)
        (j.elevations || []).forEach((v, k) => { const h = typeof v === "number" ? v : v?.z; z[from + k] = Number.isFinite(h) && h > -50 ? h : NaN; });
        break;
      }
      if (attempt >= 2 || (r.status !== 429 && r.status < 500)) throw new Error(`IGN ${r.status}`);
      await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
    }
    onProgress?.(++done / chunks.length);
  };
  await Promise.all(Array.from({ length: Math.min(IGN_PAR, chunks.length) }, async () => { while (next < chunks.length) await one(chunks[next++]); }));
  return z;
}

/** The terrain tiles' heights at the points, read bilinearly at the zoom whose pixel is about `step` metres. */
async function fromTiles(pts, step, onProgress) {
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  for (const [la, lo] of pts) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const merc = (lat, lon, z) => { const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180); return [((lon + 180) / 360) * n * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256]; };
  const cosLat = Math.cos((((la0 + la1) / 2) * Math.PI) / 180);
  let z = 15;
  while (z > 8 && (156543.03 * cosLat) / 2 ** (z - 1) <= step) z--;            // the coarsest zoom still finer than the step
  let tx0, tx1, ty0, ty1;
  for (; ; z--) {
    const [ax, ay] = merc(la1, lo0, z), [bx, by] = merc(la0, lo1, z);
    tx0 = Math.floor(ax / 256); tx1 = Math.floor(bx / 256); ty0 = Math.floor(ay / 256); ty1 = Math.floor(by / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 36 || z <= 8) break;
  }
  const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1, W = tw * 256, H = th * 256;
  const hgt = new Float32Array(W * H).fill(NaN);
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d", { willReadFrequently: true });
  let done = 0;
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let next = 0;
  const one = async ([tx, ty]) => {
    const r = await fetch(TILES(z, tx, ty), { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`tiles ${r.status}`);
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    g.clearRect(0, 0, 256, 256); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data, ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = 4 * (y * 256 + x); hgt[(oy + y) * W + ox + x] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768; }
    onProgress?.(++done / jobs.length);
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => { while (next < jobs.length) await one(jobs[next++]); }));
  const out = new Float32Array(pts.length);
  pts.forEach(([la, lo], i) => {
    const [mx, my] = merc(la, lo, z), x = Math.max(0, Math.min(W - 1.001, mx - tx0 * 256 - 0.5)), y = Math.max(0, Math.min(H - 1.001, my - ty0 * 256 - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, at = (xx, yy) => hgt[yy * W + xx];
    out[i] = (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
  });
  return { z: out, zoom: z, tiles: jobs.length };
}

/** The terrain tiles' heights at points [[lat, lon]…] (the Tracer's climb outside France, 2026-10-24): a Float32Array. */
export async function tileHeights(pts, step = 10) { return (await fromTiles(pts, step)).z; }

/** Holes (NaN) filled from their neighbours, repeatedly: a few nodes off IGN's model at a border. */
function fillHoles(z, nx, ny) {
  for (let pass = 0; pass < 50; pass++) {
    let left = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!Number.isNaN(z[k])) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && !Number.isNaN(z[b * nx + a])) { s += z[b * nx + a]; n++; } }
      if (n) z[k] = s / n; else left++;
    }
    if (!left) return true;
  }
  return false;
}

/**
 * The grid of heights: { z (Float32Array, row by row from the map's top), nx, ny, step, source ("ign" | "tiles"), ms,
 * cached }. node(i, j) gives the node's [lat, lon]; key names the map and its placing (the cache's key).
 */
export async function loadGrid({ key, nx, ny, step, node, onProgress }) {
  const ck = `dem:v2:${key}:${nx}x${ny}`;
  const hit = await cached(ck);
  if (hit?.z?.length === nx * ny) return { ...hit, cached: true, ms: 0 };
  const t0 = performance.now(), pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push(node(i, j));
  const [la, lo] = node((nx - 1) / 2, (ny - 1) / 2);
  let z = null, source = "tiles", info = {};
  if (inFrance(la, lo)) {
    try {
      // a probe of 7 × 7 nodes first: a map mostly outside IGN's model (abroad near a border) asks for the tiles at once
      const probe = [];
      for (let b = 0; b < 7; b++) for (let a = 0; a < 7; a++) probe.push(node(Math.round((a / 6) * (nx - 1)), Math.round((b / 6) * (ny - 1))));
      const pz = await fromIgn(probe);
      if (pz.filter((v) => Number.isNaN(v)).length > 24) throw new Error("IGN: outside its model");
      z = await fromIgn(pts, onProgress);
      source = "ign";
      // the nodes IGN has no height for (Monaco, the sea, across a border: 3 % of a map by Monaco, 2026-10-24) from the tiles
      const holes = [];
      z.forEach((v, k) => { if (Number.isNaN(v)) holes.push(k); });
      if (holes.length) {
        try { const r = await fromTiles(holes.map((k) => pts[k]), step); holes.forEach((k, q) => { z[k] = r.z[q]; }); source = "ign+tiles"; info = { holes: holes.length }; }
        catch (e) { console.warn(e); }
        fillHoles(z, nx, ny);
      }
    } catch (e) { console.warn(e); z = null; source = "tiles"; }
  }
  if (!z) { const r = await fromTiles(pts, step, onProgress); z = r.z; info = { zoom: r.zoom, tiles: r.tiles }; if (!fillHoles(z, nx, ny)) throw new Error("dem"); }
  const rec = { z, nx, ny, step, source, ...info, at: Date.now() };
  keep(ck, rec);
  return { ...rec, cached: false, ms: Math.round(performance.now() - t0) };
}

/** The grid's height at map pixel (px, py) of a W × H map, bilinear (the edge's height outside). */
export function heightAt(grid, W, H, px, py) {
  const { z, nx, ny } = grid;
  const x = Math.max(0, Math.min(nx - 1.0001, (px / W) * (nx - 1))), y = Math.max(0, Math.min(ny - 1.0001, (py / H) * (ny - 1)));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * nx + i;
  return (1 - fy) * ((1 - fx) * z[k] + fx * z[k + 1]) + fy * ((1 - fx) * z[k + nx] + fx * z[k + nx + 1]);
}

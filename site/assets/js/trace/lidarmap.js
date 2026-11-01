// Generated orienteering maps for « Analyse solo » (a prototype, 2026-11-01; administrators only): a trace without a map
// gets one made from IGN's LiDAR HD by karttapullautin, with OpenStreetMap's roads, paths, buildings and water over it
// (mapgen/run.py, made on GitHub by lidarmap.yml, kept in R2 as 1 km tiles; functions/api/lidarmap/[[path]].js). The page
// asks for the tiles its trace's area touches — the area only, never the trace —, waits for them, and puts them together
// into one image with its world file and .prj (Lambert 93): files the page then takes as if they had been dropped, so that
// everything else (the calibration, the files kept for the visit, « ↗ ») works as for any georeferenced map. The tiles'
// heights (IGN's MNT every 2 m) give the 3D view its relief (`lidarGrid`).

import { LAMBERT93 } from "./georef.js";

export const PX = 0.4233333333333334;      // a tile's pixel, m: karttapullautin's 600 dpi at 1:10 000
const SIZE = 2362, DEM_STEP = 2, DEM_N = 500;
export const MAX_TILES = 12;
const MAX_PIXELS = 30e6;                    // the image put together: beyond, every second pixel
const API = "/api/lidarmap";
export const PREFIX = "ozimut-lidar-";
export const isGenerated = (name) => typeof name === "string" && name.startsWith(PREFIX);
export const CREDIT_LIDAR = { text: "IGN – LiDAR HD®", url: "https://geoservices.ign.fr/lidarhd" };

const PRJ = 'PROJCS["RGF93_Lambert_93",GEOGCS["GCS_RGF_1993",DATUM["D_RGF_1993",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
  + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",700000.0],'
  + 'PARAMETER["False_Northing",6600000.0],PARAMETER["Central_Meridian",3.0],PARAMETER["Standard_Parallel_1",49.0],'
  + 'PARAMETER["Standard_Parallel_2",44.0],PARAMETER["Latitude_Of_Origin",46.5],UNIT["Meter",1.0]]';

// ---- Lambert 93, forward (georef.js inverts it) ---------------------------------------------------------------------------
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), E = Math.sqrt(E2), rad = (d) => (d * Math.PI) / 180;
const mOf = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const tOf = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - E * Math.sin(p)) / (1 + E * Math.sin(p)), E / 2);
const L = LAMBERT93, P1 = rad(L.lat1), P2 = rad(L.lat2);
const N = Math.log(mOf(P1) / mOf(P2)) / Math.log(tOf(P1) / tOf(P2)), FC = mOf(P1) / (N * Math.pow(tOf(P1), N)), RHO0 = A * FC * Math.pow(tOf(rad(L.lat0)), N);
/** [lat, lon] in degrees -> [X, Y], Lambert 93 metres. */
export function toLambert93(lat, lon) {
  const rho = A * FC * Math.pow(tOf(rad(lat)), N), th = N * rad(lon - L.lon0);
  return [L.fe + rho * Math.sin(th), L.fn + RHO0 - rho * Math.cos(th)];
}

/** Where IGN's LiDAR HD can be: metropolitan France and Corsica. */
export const covered = (lat, lon) => lat >= 41.2 && lat <= 51.2 && lon >= -5.5 && lon <= 9.8;

/** A box in Lambert 93 (X0, Y0, X1, Y1) and the 1 km tiles it touches by IGN's names (west and north edges in km). */
function boxArea(X0, Y0, X1, Y1) {
  const ids = [];
  for (let ky = Math.ceil(Y1 / 1000); ky > Math.floor(Y0 / 1000); ky--) {
    for (let kx = Math.floor(X0 / 1000); kx < Math.ceil(X1 / 1000); kx++) ids.push(`${String(kx).padStart(4, "0")}_${String(ky).padStart(4, "0")}`);
  }
  return { box: [X0, Y0, X1, Y1], ids, km2: ((X1 - X0) * (Y1 - Y0)) / 1e6 };
}
/** The area a trace needs: its extent in Lambert 93 with a margin. { box: [X0, Y0, X1, Y1], ids, km2 }. */
export function areaOf(track, margin = 150) {
  const pts = [];
  const step = Math.max(1, Math.floor(track.n / 4000));
  for (let i = 0; i < track.n; i += step) pts.push([track.lat0 - track.y[i] / track.ky, track.lon0 + track.x[i] / track.kx]);
  return areaOfPoints(pts, margin);
}
/** The area round points [[lat, lon]…] with a margin (m). */
export function areaOfPoints(pts, margin = 150) {
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const [la, lo] of pts) {
    const [x, y] = toLambert93(la, lo);
    X0 = Math.min(X0, x); Y0 = Math.min(Y0, y); X1 = Math.max(X1, x); Y1 = Math.max(Y1, y);
  }
  return boxArea(X0 - margin, Y0 - margin, X1 + margin, Y1 + margin);
}
/** The area w × h metres centred on [lat, lon]. */
export function areaAround(lat, lon, w, h) {
  const [x, y] = toLambert93(lat, lon);
  return boxArea(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
}

async function call(url, opts) {
  const r = await fetch(url, { credentials: "same-origin", ...opts });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || `http ${r.status}`); e.status = r.status; throw e; }
  return body;
}
/** The tiles' state in a style ("forest" | "sprint"), the missing ones asked for: { req?, tiles: { id: "ready" | "none" | "queued" }, started? }. */
export const ask = (ids, style = "forest") => call(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tiles: ids, style }) });
/** A request's state: { status: "queued" | "done" | "failed", result: { id: "done" | "none" | "error…" } }. */
export const poll = (req) => call(`${API}?req=${encodeURIComponent(req)}`);

const tileUrl = (id, ext) => `${API}/t/${id}${ext}`;
const corner = (id) => { const [x, y] = id.split("_").map(Number); return [x * 1000, y * 1000]; };
async function bitmap(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`tile ${r.status}`);
  return createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/**
 * The tiles put together over the area's box, in a style: { files, wf, W, H, px } — the map image (PNG) with its world
 * file and .prj, as File objects named ozimut-lidar-[sprint-]<first tile>…, for a page to take as dropped files; wf the world
 * file's six numbers (Lambert 93). onProgress(f) from 0 to 1.
 */
export async function compose(area, ids, style = "forest", onProgress) {
  const [X0, Y0, X1, Y1] = area.box;
  // the image's pixel grid is the tiles' own (X = k × PX from a tile corner), every second pixel past MAX_PIXELS
  const k = (X1 - X0) * (Y1 - Y0) / (PX * PX) > MAX_PIXELS ? 2 : 1, px = PX * k;
  const ox = Math.floor(X0 / 1000) * 1000, oy = Math.ceil(Y1 / 1000) * 1000;           // a tile corner: the grid's origin
  const c0 = Math.floor((X0 - ox) / px), r0 = Math.floor((oy - Y1) / px);
  const W = Math.ceil((X1 - ox) / px) - c0, H = Math.ceil((oy - Y0) / px) - r0;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = k > 1;
  let done = 0;
  for (const id of ids) {
    const [x0, y1] = corner(id);
    const dx = Math.round((x0 - ox) / px) - c0, dy = Math.round((oy - y1) / px) - r0, s = SIZE / k;
    if (dx + s > 0 && dy + s > 0 && dx < W && dy < H) {
      try { g.drawImage(await bitmap(tileUrl(id, style === "sprint" ? ".s.png" : ".png")), dx, dy, s, s); } catch (e) { console.warn(id, e); }
    }
    onProgress?.(++done / ids.length);
  }
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  // the world file: the first pixel's centre
  const wf = [px, 0, 0, -px, ox + (c0 + 0.5) * px, oy - (r0 + 0.5) * px];
  const base = `${PREFIX}${style === "sprint" ? "sprint-" : ""}${ids[0]}${ids.length > 1 ? `-${ids[ids.length - 1]}` : ""}`;
  const files = [new File([blob], `${base}.png`, { type: "image/png" }), new File([wf.map(String).join("\n")], `${base}.pgw`, { type: "text/plain" }),
    new File([PRJ], `${base}.prj`, { type: "text/plain" })];
  return { files, wf, W, H, px };
}

/**
 * The whole way to a map, for the pages: the tiles asked for, waited for (the request's state every 15 s) and put together.
 * say(key, vars) reports each step by its catalogue key (an.gen.asking, queued, notStarted, composing); stop() true gives
 * up (another request or a page left). Resolves { ...compose(), partial } or null when stopped; throws Error("none") when
 * IGN has no LiDAR anywhere in the area, Error("failed") when no tile could be made.
 */
export async function make(area, style, say, stop = () => false) {
  say("an.gen.asking");
  const r = await ask(area.ids, style), tiles = { ...r.tiles };
  if (r.req) {
    say(r.started ? "an.gen.queued" : "an.gen.notStarted", { n: Object.values(tiles).filter((v) => v === "queued").length });
    for (;;) {
      await new Promise((res) => setTimeout(res, 15000));
      if (stop()) return null;
      const p = await poll(r.req);
      if (p.status === "queued") continue;
      for (const [id, v] of Object.entries(p.result || {})) tiles[id] = v === "done" ? "ready" : v === "none" ? "none" : "failed";
      break;
    }
  }
  const ready = area.ids.filter((id) => tiles[id] === "ready");
  if (!ready.length) throw new Error(Object.values(tiles).every((v) => v === "none") ? "none" : "failed");
  say("an.gen.composing", { p: 0 });
  const out = await compose(area, ready, style, (f) => say("an.gen.composing", { p: Math.round(100 * f) }));
  return stop() ? null : { ...out, partial: ready.length < area.ids.length };
}

/**
 * The 3D view's grid of heights over a generated map (W × H pixels, its world file wf), from the tiles' MNT every 2 m:
 * the shape loadGrid (terrain.js) gives. Nodes outside every tile read IGN's elevation service's way: not here — they
 * take the nearest height.
 */
export async function lidarGrid({ wf, W, H, nx, ny, step }) {
  const t0 = performance.now();
  const [a, , , e, c, f] = wf.map(Number);
  const X = (px) => c + a * (px - 0.5), Y = (py) => f + e * (py - 0.5);
  const xs = [X(0), X(W)], ys = [Y(H), Y(0)];
  const ids = [];
  for (let ky = Math.ceil(ys[1] / 1000); ky > Math.floor(ys[0] / 1000); ky--) for (let kx = Math.floor(xs[0] / 1000); kx < Math.ceil(xs[1] / 1000); kx++) ids.push(`${String(kx).padStart(4, "0")}_${String(ky).padStart(4, "0")}`);
  const dems = new Map();
  const cv = document.createElement("canvas"); cv.width = cv.height = DEM_N;
  const g = cv.getContext("2d", { willReadFrequently: true });
  for (const id of ids) {
    try {
      const bmp = await bitmap(tileUrl(id, ".dem.png"));
      g.clearRect(0, 0, DEM_N, DEM_N); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, DEM_N, DEM_N).data, z = new Float32Array(DEM_N * DEM_N);
      for (let i = 0; i < z.length; i++) z[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
      dems.set(id, z);
    } catch (err) { console.warn(id, err); }
  }
  if (!dems.size) throw new Error("dem");
  const at = (x, y) => {
    const kx = Math.floor(x / 1000), ky = Math.ceil(y / 1000), id = `${String(kx).padStart(4, "0")}_${String(ky).padStart(4, "0")}`, z = dems.get(id);
    if (!z) return NaN;
    const u = Math.min(DEM_N - 1.001, (x - kx * 1000) / DEM_STEP), v = Math.min(DEM_N - 1.001, (ky * 1000 - y) / DEM_STEP);
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, q = j * DEM_N + i;
    return (1 - fy) * ((1 - fx) * z[q] + fx * z[q + 1]) + fy * ((1 - fx) * z[q + DEM_N] + fx * z[q + DEM_N + 1]);
  };
  const z = new Float32Array(nx * ny);
  let last = NaN;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = at(X((i / (nx - 1)) * W), Y((j / (ny - 1)) * H));
    z[j * nx + i] = Number.isFinite(v) ? (last = v) : last;
  }
  if (z.some((v) => !Number.isFinite(v))) { const m = z.find(Number.isFinite) ?? 0; z.forEach((v, q) => { if (!Number.isFinite(v)) z[q] = m; }); }
  return { z, nx, ny, step, source: "lidar", cached: false, ms: Math.round(performance.now() - t0) };
}

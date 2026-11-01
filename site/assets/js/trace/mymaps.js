// « Mes cartes » (Coach; owner, 2026-11-01): what the page, « Analyse solo »'s « Enregistrer dans Mes cartes » and the imports
// share — a run's record, the calls to /api/mymaps, the thumbnails, and Ozimut's own file (a JPEG: the map with its routes
// drawn on it, carrying the map as it came and the runs in an APP9 segment, trace/mapjpeg.js), read back and written. No text
// of the interface here.
//
// A run is kept as it is drawn on the map (owner: « keep what is plotted, not the FIT/GPX »): its points in the map's pixels
// and their times, nothing of the file it came from. Record v1: { v: 1, t0 (ms of the first point), dt (tenths of a second,
// deltas), x, y (tenths of a pixel; the first absolute, then deltas), br (indices where a new segment starts), ch (the
// personal channels, only when the runner ticked them: hr, ele, cad — one value a point, null where none), laps (ms),
// ctl ([{ k: start | control | finish, x, y, t (ms) | null }]) }.

import { FFLATE } from "../vendor.js";
import { kindOf, readQuickRoute, ozimutPayload, withOzimut, affineFit } from "./mapjpeg.js";

export const API = "api/mymaps";
const PERSONAL = ["hr", "ele", "cad"];

// ---- records ----------------------------------------------------------------------------------------------------------
/** A record from points [{ x, y, ms, hr?, ele?, cad? }] (px, ms); `personal` keeps the channels. */
export function encodeRun(pts, { breaks = [], personal = false, laps = [], controls = [] } = {}) {
  const P = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.ms));
  if (P.length < 2) return null;
  const rec = { v: 1, t0: Math.round(P[0].ms), dt: [], x: [], y: [] };
  let pt = 0, px = 0, py = 0;
  P.forEach((p, i) => {
    const t = Math.round((p.ms - rec.t0) / 100), x = Math.round(p.x * 10), y = Math.round(p.y * 10);
    rec.dt.push(i ? t - pt : 0); rec.x.push(i ? x - px : x); rec.y.push(i ? y - py : y);
    pt = t; px = x; py = y;
  });
  if (breaks.length) rec.br = breaks.filter((b) => b > 0 && b < P.length);
  if (personal) {
    const ch = {};
    for (const c of PERSONAL) if (P.some((p) => Number.isFinite(p[c]))) ch[c] = P.map((p) => (Number.isFinite(p[c]) ? Math.round(p[c] * 10) / 10 : null));
    if (Object.keys(ch).length) rec.ch = ch;
  }
  if (laps.length) rec.laps = laps.map(Math.round);
  if (controls.length) rec.ctl = controls.map((c) => ({ k: c.k, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, t: c.t == null ? null : Math.round(c.t) }));
  return rec;
}
/** A record back: { n, ms: Float64Array, x, y, br: Set, ch, laps, ctl }. */
export function decodeRun(rec) {
  const n = rec?.x?.length || 0, ms = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n);
  let t = 0, a = 0, b = 0;
  for (let i = 0; i < n; i++) { t += rec.dt[i] || 0; a += rec.x[i]; b += rec.y[i]; ms[i] = rec.t0 + t * 100; x[i] = a / 10; y[i] = b / 10; }
  return { n, ms, x, y, br: new Set(rec.br || []), ch: rec.ch || null, laps: rec.laps || [], ctl: rec.ctl || [] };
}
/** Does a set of points hold any personal channel? */
export const hasPersonal = (pts) => pts.some((p) => PERSONAL.some((c) => Number.isFinite(p[c])));

const RAD = Math.PI / 180;
const hav = (a, b) => {
  const dl = (b.lat - a.lat) * RAD, dn = (b.lon - a.lon) * RAD, s = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dn / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
};
/** Length in metres of points with lat/lon; else, with a georeference, of their pixels. */
export function lengthOf(pts, geo, breaks = []) {
  const br = new Set(breaks);
  let d = 0;
  const ll = pts[0]?.lat != null ? pts : geo ? pts.map((p) => toLatLon(geo, p.x, p.y)) : null;
  if (!ll) return null;
  for (let i = 1; i < ll.length; i++) if (!br.has(i)) d += hav(ll[i - 1], ll[i]);
  return Math.round(d);
}
/** A pixel of the map in latitude/longitude, by its georeference (lon, lat -> px). */
export function toLatLon(g, x, y) {
  const det = g.a * g.e - g.b * g.d, X = x - g.c, Y = y - g.f;
  return { lon: (g.e * X - g.b * Y) / det, lat: (g.a * Y - g.d * X) / det };
}

// ---- files ------------------------------------------------------------------------------------------------------------
export async function sha256(blob) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("canvas"))), type, q));
/** A thumbnail of the map, 480 px wide at most (WebP, else JPEG). */
export async function thumbnail(image) {
  const k = Math.min(1, 480 / image.width, 480 / image.height), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(image.width * k)); c.height = Math.max(1, Math.round(image.height * k));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(image, 0, 0, c.width, c.height);
  const w = await toBlob(c, "image/webp", 0.8).catch(() => null);
  return w && w.type === "image/webp" ? w : toBlob(c, "image/jpeg", 0.82);
}
const typeOf = (blob, name = "") => (/^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type
  : ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[(name.split(".").pop() || "").toLowerCase()] || "");

let ffP = null;
function fflate() {
  if (window.fflate) return Promise.resolve(window.fflate);
  return ffP || (ffP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = FFLATE; s.onload = () => res(window.fflate); s.onerror = () => { ffP = null; rej(new Error("fflate")); };
    document.head.appendChild(s);
  }));
}

// ---- the server -------------------------------------------------------------------------------------------------------
async function call(path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(`${API}${path}`, { method, credentials: "same-origin", headers: body && !(body instanceof Blob) ? { "Content-Type": "application/json", ...headers } : headers,
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (r.status === 401) window.dispatchEvent(new Event("cnx:unauthorised"));
  if (!r.ok) { const e = new Error(d?.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return d;
}
export const list = () => call("");
export const shared = (token) => call(`/s/${token}`);
export const updateMap = (id, fields) => call(`/maps/${id}`, { method: "PUT", body: fields });
export const deleteMap = (id) => call(`/maps/${id}`, { method: "DELETE" });
export const updateRun = (id, fields) => call(`/runs/${id}`, { method: "PUT", body: fields });
export const deleteRun = (id) => call(`/runs/${id}`, { method: "DELETE" });
/** A link made, changed or deleted: { map | maps | token, on, traces } -> { token | null, traces }. */
export const setLink = (body) => call("/link", { method: "POST", body });
/** Where a map's image, a thumbnail or a run is read: one's own, or through a link. */
export const mapUrl = (id, part, token) => (token ? `${API}/s/${token}/maps/${id}/${part}` : `${API}/maps/${id}/${part}`);
export const runUrl = (id, token) => (token ? `${API}/s/${token}/runs/${id}` : `${API}/runs/${id}`);
const runCache = new Map();
export async function getRun(id, token) {
  const k = `${token || ""}:${id}`;
  if (!runCache.has(k)) runCache.set(k, fetch(runUrl(id, token), { credentials: "same-origin" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .catch((e) => { runCache.delete(k); throw e; }));
  return runCache.get(k);
}

/**
 * Keep a map and its runs: the map once per account (the same image again goes to the map kept), its thumbnail, then each run.
 * entry: { blob (the image as it came), name, image (drawn: ImageBitmap or canvas), title, day, place, notes, geo,
 * runs: [{ title, day, source, start, dur, dist, rec }] }, personal: keep the runs' channels -> { map, existed, runs }.
 */
export async function save(entry, { personal = false } = {}) {
  const type = typeOf(entry.blob, entry.name);
  if (!type) throw new Error("type");
  const blob = entry.blob.type === type ? entry.blob : new Blob([entry.blob], { type });
  const sha = await sha256(blob);
  const meta = { sha, title: entry.title || "", day: entry.day || null, place: entry.place || "", notes: entry.notes || "",
    w: entry.image.width, h: entry.image.height, geo: entry.geo || null };
  const { map, existed } = await call("/maps", { method: "POST", body: blob, headers: { "Content-Type": type, "X-Meta": encodeURIComponent(JSON.stringify(meta)) } });
  if (!existed || !map.thumb) await call(`/maps/${map.id}/thumb`, { method: "PUT", body: await thumbnail(entry.image) }).catch(() => {});
  const runs = [];
  for (const r of entry.runs || []) {
    const rec = personal ? r.rec : { ...r.rec, ch: undefined };
    runs.push((await call(`/maps/${map.id}/runs`, { method: "POST", body: { title: r.title || "", day: r.day || null, start: r.start ?? rec.t0, dur: r.dur, dist: r.dist,
      source: r.source || "", personal: personal && !!rec.ch, rec } })).run);
  }
  return { map, existed, runs };
}

// ---- reading files: QuickRoute's and Ozimut's JPEGs, a zip of them ------------------------------------------------------
const day = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) : null);
const stem = (name) => String(name || "").replace(/\.[a-z0-9]+$/i, "");

/**
 * The entries (see `save`) a file holds: an Ozimut or QuickRoute JPEG, or a zip of them; else a map without a run (owner,
 * 2026-11-01): any JPEG, PNG or WebP image, a PDF's first page, a KMZ's image (georeferenced by its overlay). In a zip only
 * QuickRoute's and Ozimut's JPEGs count (a DOMA folder's « .blank.jpg » would make each map twice). Throws "unknown" otherwise.
 */
export async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {                       // a zip, or a KMZ
    if (/\.kmz$/i.test(file.name)) return [await readKmz(bytes, file.name)];
    const ff = await fflate();
    const all = ff.unzipSync(bytes, { filter: (f) => /\.jpe?g$/i.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name) });
    const out = [];
    for (const [name, b] of Object.entries(all)) {
      try { out.push(...(await readBytes(b, name.split("/").pop()))); } catch (e) { /* not one of ours: skipped */ }
    }
    if (!out.length) throw new Error("unknown");
    return out;
  }
  try { return await readBytes(bytes, file.name); }
  catch (e) { if (e.message !== "unknown") throw e; }
  return [await readPlain(file, bytes)];
}
async function readBytes(bytes, name) {
  const kind = kindOf(bytes);
  if (kind === "ozimut") return [await readOzimut(bytes, name)];
  if (kind === "quickroute") return [await readQr(bytes, name)];
  throw new Error("unknown");
}
const blank = (blob, name, image, geo = null, from = "image") => ({ blob, name, image, title: stem(name), day: null, place: "", notes: "", geo, runs: [], from });
/** An image or a PDF as a map without a run, kept as it came (a PDF's page as a PNG: mapfile.imageBlob). */
async function readPlain(file, bytes) {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isImg = (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50)
    || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50);
  if (!isPdf && !isImg) throw new Error("unknown");
  const { readMap, imageBlob } = await import("./mapfile.js");
  const image = await readMap(isPdf ? new File([bytes], file.name, { type: "application/pdf" }) : file).catch(() => { throw new Error("unknown"); });
  const blob = await imageBlob(file, image);
  return blank(blob, isPdf ? `${stem(file.name)}.png` : file.name, image);
}
/** A KMZ's map: its overlay's image, georeferenced by the overlay's corners. */
async function readKmz(bytes, name) {
  const { readZip, parseKml, kmlCorners } = await import("./georef.js");
  const files = await readZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const kml = files.find((f) => /\.kml$/i.test(f.name));
  const ov = kml && parseKml(new TextDecoder().decode(kml.data))[0];
  const img = ov && (files.find((f) => f.name === ov.href) || files.find((f) => /\.(jpe?g|png|webp)$/i.test(f.name)));
  if (!img) throw new Error("unknown");
  const type = /\.png$/i.test(img.name) ? "image/png" : /\.webp$/i.test(img.name) ? "image/webp" : "image/jpeg";
  const blob = new Blob([img.data], { type }), image = await createImageBitmap(blob);
  const [tl, tr, br, bl] = kmlCorners(ov), W = image.width, H = image.height;
  const geo = affineFit([[tl[1], tl[0], 0, 0], [tr[1], tr[0], W, 0], [br[1], br[0], W, H], [bl[1], bl[0], 0, H]]);
  return blank(blob, `${stem(name)}.${type === "image/jpeg" ? "jpg" : type.slice(6)}`, image, geo, "kmz");
}

async function readQr(bytes, name) {
  const q = readQuickRoute(bytes);
  const pic = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  // the map without QuickRoute's header and frame: the route stays painted on it (QuickRoute keeps no clean map)
  const { x, y, w, h } = q.crop, c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(pic, x, y, w, h, 0, 0, w, h);
  pic.close?.();
  const blob = await toBlob(c, "image/jpeg", 0.95);
  const runs = [];
  let geoPairs = [];
  for (const s of q.sessions) {
    const pts = [], breaks = [];
    for (const seg of s.segs) {
      if (pts.length) breaks.push(pts.length);
      for (const p of seg) if (Number.isFinite(p.x) && Number.isFinite(p.ms)) pts.push(p);
    }
    if (pts.length < 2) continue;
    geoPairs = geoPairs.concat(pts.filter((p, i) => i % 5 === 0).map((p) => [p.lon, p.lat, p.x, p.y]));
    const laps = s.laps.filter((l) => l.type === 1).map((l) => l.ms);
    runs.push({ title: s.name || "", day: day(pts[0].ms), source: "quickroute", start: pts[0].ms, dur: (pts.at(-1).ms - pts[0].ms) / 1000,
      dist: lengthOf(pts, null, breaks), personal: hasPersonal(pts), rec: encodeRun(pts, { breaks, personal: true, laps }) });
  }
  // the map's georeference: the routes' own points as QuickRoute laid them, else its corners
  const geo = (geoPairs.length >= 3 && affineFit(geoPairs)) || q.geo;
  return { blob, name: `${stem(name)}.jpg`, image: c, title: q.sessions[0]?.description || stem(name), day: runs[0]?.day || null, place: "", notes: "",
    geo, runs, from: "quickroute" };
}

async function readOzimut(bytes, name) {
  const ff = await fflate();
  const files = ff.unzipSync(ozimutPayload(bytes));
  const doc = JSON.parse(new TextDecoder().decode(files["ozimut-map.json"]));
  if (doc?.format !== "ozimut-map" || !(doc.version >= 1)) throw new Error("unknown");
  if (doc.version > FORMAT_VERSION) throw new Error("newer");
  const m = doc.map || {};
  const raw = m.file && files[m.file];
  // the clean map when the file carries it, else the picture itself (its routes painted on it)
  const blob = raw ? new Blob([raw], { type: m.type || "image/jpeg" }) : new Blob([bytes], { type: "image/jpeg" });
  const image = await createImageBitmap(blob);
  return { blob, name: m.file || `${stem(name)}.jpg`, image, title: m.title || stem(name), day: m.day || null, place: m.place || "", notes: m.notes || "",
    geo: m.geo || null, from: "ozimut",
    runs: (doc.runs || []).filter((r) => r?.rec?.v === 1).map((r) => ({ title: r.title || "", day: r.day || null, source: r.source || "ozimut", start: r.start, dur: r.dur,
      dist: r.dist, personal: !!r.rec.ch, rec: r.rec })) };
}

// ---- writing Ozimut's file --------------------------------------------------------------------------------------------
export const FORMAT_VERSION = 1;
export const COLOURS = ["#c2185b", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#00838f", "#5d4037", "#ad1457"];

/** Draw runs (decoded) on a 2D context at the map's scale; `width` in px. */
export function drawRuns(g, runs, { width = 4, alpha = 0.85, colours = COLOURS } = {}) {
  g.save();
  g.lineJoin = "round"; g.lineCap = "round"; g.globalAlpha = alpha; g.lineWidth = width;
  runs.forEach((r, k) => {
    g.strokeStyle = r.colour || colours[k % colours.length];
    g.beginPath();
    for (let i = 0; i < r.n; i++) { if (!i || r.br.has(i)) g.moveTo(r.x[i], r.y[i]); else g.lineTo(r.x[i], r.y[i]); }
    g.stroke();
  });
  g.restore();
}

/**
 * Ozimut's file of a map: a JPEG of the map with its runs drawn, carrying the map as it came and the runs.
 * map: { title, day, place, notes, geo, type }, blob: the map's image, image: drawn, runs: [{ title, day, source, start, dur,
 * dist, rec }] -> Blob (image/jpeg).
 */
export async function ozimutFile(map, blob, image, runs, { personal = false } = {}) {
  const c = document.createElement("canvas");
  c.width = image.width; c.height = image.height;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(image, 0, 0);
  drawRuns(g, runs.map((r) => decodeRun(r.rec)), { width: Math.max(4, Math.round(Math.max(c.width, c.height) / 450)) });
  const jpeg = new Uint8Array(await (await toBlob(c, "image/jpeg", 0.9)).arrayBuffer());
  const ext = ({ "image/png": "png", "image/webp": "webp" })[blob.type] || "jpg";
  const doc = { format: "ozimut-map", version: FORMAT_VERSION, app: "Ozimut", saved: new Date().toISOString(),
    map: { title: map.title || "", day: map.day || null, place: map.place || "", notes: map.notes || "", geo: map.geo || null, w: image.width, h: image.height,
      type: blob.type || "image/jpeg", file: `map.${ext}` },
    runs: runs.map((r) => ({ title: r.title || "", day: r.day || null, source: r.source || "", start: r.start ?? r.rec.t0, dur: r.dur ?? null, dist: r.dist ?? null,
      rec: personal ? r.rec : { ...r.rec, ch: undefined } })) };
  const ff = await fflate();
  // the map stored as it is (already compressed), the description deflated
  const zip = ff.zipSync({ "ozimut-map.json": [new TextEncoder().encode(JSON.stringify(doc)), { level: 6 }], [doc.map.file]: [new Uint8Array(await blob.arrayBuffer()), { level: 0 }] });
  return new Blob([withOzimut(jpeg, zip)], { type: "image/jpeg" });
}
/** Several files in one zip (stored: JPEGs do not compress). files: [{ name, blob }] -> Blob. */
export async function zipOf(files) {
  const ff = await fflate(), entries = {}, used = new Set();
  for (const f of files) {
    let n = f.name, k = 2;
    while (used.has(n.toLowerCase())) n = f.name.replace(/(\.[a-z0-9]+)?$/i, ` (${k++})$1`);
    used.add(n.toLowerCase());
    entries[n] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([ff.zipSync(entries)], { type: "application/zip" });
}
/** A file name from a title and a day. */
export const fileName = (title, day, ext = "jpg") => `${[day, title].filter(Boolean).join(" ").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 100) || "ozimut"}.${ext}`;
export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// « Mes cartes »: maps read from any file, and a folder of maps imported at once (owner, 2026-11-06: « import a bunch of maps
// into the library from a folder which contains files in a hierarchy of folders, inferring all needed information from it »).
// Pure logic, no text of the interface: errors are codes the page words.
//
// The folder's format (the page shows it):
//   <the folder chosen>/<country>/<region or, in France, département>/[<département or province>]/[<place>…]/<map name>.<ext>
// - the country: its name in French, English, German, Spanish… or its code (« France », « Suede », « Sweden », « SE »);
// - in France: a département (« 77 - Seine-et-Marne », « 77 ») or a région (« Île-de-France »), then possibly a département;
//   elsewhere: a region, then possibly a province written with its code (« 28 - Segovia »);
// - any further folder is the map's place (a forest with several maps: « La Chèvre »); a folder that is a year or a date
//   (« 2023 », « 2023-05-14 ») gives the map's date instead;
// - the file's name is the map's name; a date in it (« 2023-05-14 », « 14.05.2023 », « 20230514 ») is its date;
// - a GPS track (GPX, FIT, TCX) of the same name in the same folder is a run on that map (placed when the map is
//   georeferenced: a KMZ, a world file — .jgw, .pgw… with its .prj — of the same name, an OCAD or Mapper file, a GeoTIFF);
// - maps: JPEG, PNG, WebP, GIF, BMP, TIFF, PDF (its first page), KMZ, OCAD (.ocd), Mapper (.omap, .xmap), and the JPEGs of
//   QuickRoute and of Ozimut (with their routes).

import * as MM from "./mymaps.js";
import { affineFit } from "./mapjpeg.js";
import { countryCode, frDept, frRegion, fold } from "./mymapsplace.js";

export const MAP_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|pdf|kmz|ocd|omap|xmap)$/i;
export const TRACK_EXT = /\.(gpx|fit|tcx)$/i;
const WORLD_EXT = /\.(jgw|pgw|tfw|gfw|bpw|wld|jpgw|pngw|tifw|wf)$/i;
const SIDE_EXT = /\.(prj|aux\.xml)$/i;
const JUNK = /(^|\/)(\.[^/]*|thumbs\.db|desktop\.ini|__macosx)(\/|$)/i;
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.pdf,.kmz,.ocd,.omap,.xmap,image/*,application/pdf";
export const ACCEPT_TRACK = ".gpx,.fit,.tcx";
const stem = (name) => String(name || "").replace(/\.[a-z0-9]+$/i, "");
const pad = (n) => String(n).padStart(2, "0");

// ---- dates in names -----------------------------------------------------------------------------------------------------
const okDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 1950 && y <= 2100; };
/** A full date a name holds: { day (YYYY-MM-DD), rest (the name without it) } or null. */
export function dayIn(s) {
  const tries = [
    [/(?<![0-9])((?:19|20)\d{2})[-_.\s](\d{1,2})[-_.\s](\d{1,2})(?![0-9])/, (m) => [+m[1], +m[2], +m[3]]],
    [/(?<![0-9])(\d{1,2})[-_.\s/](\d{1,2})[-_.\s/]((?:19|20)\d{2})(?![0-9])/, (m) => [+m[3], +m[2], +m[1]]],
    [/(?<![0-9])((?:19|20)\d{2})(\d{2})(\d{2})(?![0-9])/, (m) => [+m[1], +m[2], +m[3]]],
  ];
  for (const [re, f] of tries) {
    const m = re.exec(String(s || ""));
    if (!m) continue;
    const [y, mo, d] = f(m);
    if (okDay(y, mo, d)) return { day: `${y}-${pad(mo)}-${pad(d)}`, rest: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").replace(/^[\s\-–_,.]+|[\s\-–_,.]+$/g, "") };
  }
  return null;
}
/** A year a name holds (« Ball-Trap S 2019 »), or "". */
export const yearIn = (s) => /(?<![0-9])((?:19|20)\d{2})(?![0-9])/.exec(String(s || ""))?.[1] || "";

// ---- reading one map ----------------------------------------------------------------------------------------------------
/** The georeference (lon, lat → px) of an image W × H from a world file's text and its .prj's (or the numbers' system). */
export async function geoFromWorld(text, prj, W, H) {
  const G = await import("./georef.js");
  const wf = G.parseWorldFile(text);
  if (!wf) return null;
  const [a, d, b, e, c, f] = wf;
  let crs = prj ? G.crsFromWkt(prj) : null;
  if (!crs) { const g = G.guessCrs(c, f, 0); crs = g && !(g.kind === "tm" && !prj) ? g : null; }   // (a UTM zone cannot be guessed)
  if (!crs) return null;
  const inv = G.projector(crs), pairs = [];
  for (const [px, py] of [[0, 0], [W, 0], [W, H], [0, H], [W / 2, H / 2]]) {
    const col = px - 0.5, row = py - 0.5, [lat, lon] = inv(a * col + b * row + c, d * col + e * row + f);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    pairs.push([lon, lat, px, py]);
  }
  return affineFit(pairs);
}

/**
 * The map entries (trace/mymaps.js `save`'s) a file holds — any format —, with its companions (`world`, `prj`: File) for an
 * image's georeference. Throws Error("unknown"), ("newer"), ("pdf") or a message (a TIFF it cannot read).
 */
export async function readMap(file, { world = null, prj = null } = {}) {
  const name = file.name, head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let entries;
  if (/\.(ocd|omap|xmap)$/i.test(name)) entries = [await readVectorMap(file)];
  else if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 42) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 42)) entries = [await readTiff(file)];
  else entries = await MM.readFile(file);
  if (world) {
    for (const e of entries) {
      if (e.geo) continue;
      e.geo = await geoFromWorld(await world.text(), prj ? await prj.text() : "", e.image.width, e.image.height).catch(() => null);
      if (e.geo) e.from = e.from === "image" ? "world" : e.from;
    }
  }
  return entries;
}
async function readVectorMap(file) {
  const V = await import("./vectorroutes.js");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const v = await V.readVector(bytes, file.name), r = await V.renderVector(bytes, file.name);
  const { imageBlob } = await import("./mapfile.js");
  const image = r.image, blob = await imageBlob(null, image), ll = V.latLonOf(v);
  const geo = ll ? affineFit([[0, 0], [image.width, 0], [image.width, image.height], [0, image.height]].map(([x, y]) => { const [lat, lon] = ll(x / r.k, v.h - y / r.k); return [lon, lat, x, y]; })) : null;
  return { blob, name: `${stem(file.name)}.png`, image, title: stem(file.name), day: null, place: "", notes: "", geo, runs: [], from: "vector" };
}
async function readTiff(file) {
  const { decodeTiff } = await import("../tracer/tiff.js");
  const r = await decodeTiff(new Uint8Array(await file.arrayBuffer()));
  const { imageBlob } = await import("./mapfile.js");
  const blob = await imageBlob(null, r.canvas);
  let geo = null;
  if (r.world) {
    const G = await import("./georef.js"), [a, d, b, e, c, f] = r.world.wf, inv = G.projector(r.world.crs), pairs = [];
    for (const [px, py] of [[0, 0], [r.width, 0], [r.width, r.height], [0, r.height]]) { const [lat, lon] = inv(a * px + b * py + c, d * px + e * py + f); pairs.push([lon, lat, px, py]); }
    if (pairs.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) geo = affineFit(pairs);
  }
  return { blob, name: `${stem(file.name)}.png`, image: r.canvas, title: stem(file.name), day: null, place: "", notes: "", geo, runs: [], from: geo ? "world" : "image" };
}

// ---- a GPS track on a map -------------------------------------------------------------------------------------------------
const parisDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
/**
 * A track file read: { track, day, start: [lat, lon] }. Throws Error("track") when it is not one, ("time") without times.
 */
export async function readTrack(file) {
  const { parseTrace } = await import("./track.js");
  let tr;
  try { tr = parseTrace(file.name, await file.arrayBuffer()); } catch (e) { throw new Error(e.message === "time" ? "time" : "track"); }
  const lat = tr.lat0 - tr.y[0] / tr.ky, lon = tr.lon0 + tr.x[0] / tr.kx;
  return { track: tr, day: parisDay(tr.ms0), start: [lat, lon] };
}
/**
 * The run (trace/mymaps.js `save`'s) of a track on a georeferenced map W × H: its points in the map's pixels, its times and
 * channels. Throws Error("outside") when most of the track is off the map.
 */
export function runOn(tr, geo, W, H, title = "") {
  const pts = [];
  let inMap = 0;
  for (let i = 0; i < tr.n; i++) {
    const lat = tr.lat0 - tr.y[i] / tr.ky, lon = tr.lon0 + tr.x[i] / tr.kx;
    const p = { x: geo.a * lon + geo.b * lat + geo.c, y: geo.d * lon + geo.e * lat + geo.f, ms: tr.ms0 + tr.t[i] * 1000 };
    if (p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H) inMap++;
    if (tr.ch.hr) p.hr = tr.ch.hr[i];
    if (tr.ch.ele) p.ele = tr.ch.ele[i];
    if (tr.ch.cad) p.cad = tr.ch.cad[i];
    pts.push(p);
  }
  if (inMap < tr.n * 0.5) throw new Error("outside");
  const rec = MM.encodeRun(pts, { personal: true });
  return { title, day: parisDay(tr.ms0), source: "track", start: tr.ms0, dur: tr.dur, dist: Math.round(tr.cum[tr.n - 1]), personal: MM.hasPersonal(pts), rec };
}

// ---- a folder ---------------------------------------------------------------------------------------------------------------
/** The files of a drop, folders walked: [{ file, path }] (path: the folders from the dropped item, with the file's name). */
export async function filesOfDrop(dt) {
  const items = [...(dt?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...(dt?.files || [])].map((f) => ({ file: f, path: f.name }));
  const out = [];
  const readAll = (dir) => new Promise((res) => {
    const r = dir.createReader(), all = [];
    const next = () => r.readEntries((batch) => { if (!batch.length) res(all); else { all.push(...batch); next(); } }, () => res(all));
    next();
  });
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res, () => res(null)));
      if (file) out.push({ file, path: `${prefix}${entry.name}` });
    } else if (entry.isDirectory) {
      for (const e of await readAll(entry)) await walk(e, `${prefix}${entry.name}/`);
    }
  }
  for (const e of items) await walk(e, "");
  return out;
}
/** The files an `<input webkitdirectory>` gave: [{ file, path }]. */
export const filesOfInput = (files) => [...files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
/** Does a drop hold a folder? */
export const dropHasFolder = (dt) => [...(dt?.items || [])].some((i) => i.webkitGetAsEntry?.()?.isDirectory);

/**
 * What a folder holds, read from its paths alone (nothing opened yet): { maps, errors, ignored, root }.
 * maps: [{ file, path, title, day, country, region, dept, place, world, prj, tracks: [File] }];
 * errors: [{ path, code, arg }] — codes: rootFile (a map outside any country's folder), country (the first folder is no
 * country: arg its name), frUnit (in France, a folder that is neither a région nor a département: arg), trackAlone (a track
 * without a map of its name); ignored: [path] (files that are not maps: spreadsheets, documents…).
 * fr: mymapsplace.france()'s.
 */
export function plan(list, fr) {
  const items = list.filter((x) => !JUNK.test(x.path)).map((x) => ({ ...x, segs: x.path.split("/").filter(Boolean) }));
  // the folder chosen: the first folder all paths share, unless it is itself a country (a country's folder chosen)
  let root = "";
  const firsts = new Set(items.map((x) => (x.segs.length > 1 ? x.segs[0] : "")));
  if (firsts.size === 1 && !firsts.has("") && !countryCode([...firsts][0])) root = [...firsts][0];
  for (const x of items) if (root) x.segs = x.segs.slice(1);
  const maps = [], errors = [], ignored = [];
  const byDir = new Map();
  for (const x of items) {
    const dir = x.segs.slice(0, -1).join("/");
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(x);
  }
  for (const [dir, files] of byDir) {
    const segs = dir ? dir.split("/") : [];
    const where = place(segs, fr);
    const companions = (s, re) => files.find((f) => re.test(f.file.name) && fold(stem(f.file.name)) === fold(s));
    const mapsHere = [];
    for (const x of files) {
      const n = x.file.name;
      if (MAP_EXT.test(n)) {
        if (where.error) { errors.push({ path: x.path, ...where.error }); continue; }
        const s = stem(n), dt = dayIn(s) || where.date;
        const m = { file: x.file, path: x.path, title: (dayIn(s)?.rest || s).trim() || s, day: dt?.day || null, year: dt ? "" : yearIn(s) || where.year,
          country: where.country, region: where.region, dept: where.dept, place: where.place,
          world: companions(s, WORLD_EXT)?.file || null, prj: companions(s, /\.prj$/i)?.file || null, tracks: [] };
        mapsHere.push(m);
        maps.push(m);
      }
    }
    for (const x of files) {
      const n = x.file.name;
      if (TRACK_EXT.test(n)) {
        const s = fold(stem(n));
        // a track goes to the map of its name, or of the start of its name (« Apremont N - course 2.gpx » → « Apremont N »)
        const m = mapsHere.find((mm) => fold(stem(mm.file.name)) === s) || mapsHere.filter((mm) => s.startsWith(`${fold(stem(mm.file.name))} `))
          .sort((a, b) => b.file.name.length - a.file.name.length)[0];
        if (m) m.tracks.push(x.file);
        else if (!where.error) errors.push({ path: x.path, code: "trackAlone" });
      } else if (!MAP_EXT.test(n) && !WORLD_EXT.test(n) && !SIDE_EXT.test(n)) ignored.push(x.path);
    }
  }
  return { maps, errors, ignored, root };
}
/** A folder's path read: { country, region, dept, place, date, year } or { error: { code, arg } }. */
function place(segs, fr) {
  if (!segs.length) return { error: { code: "rootFile" } };
  const country = countryCode(segs[0]);
  if (!country) return { error: { code: "country", arg: segs[0] } };
  let date = null, year = "";
  const rest = segs.slice(1).filter((s) => {                     // year and date folders give the date, not a place
    const d = dayIn(s);
    if (d && !d.rest) { date = d; return false; }
    if (/^(19|20)\d{2}$/.test(s.trim())) { year = s.trim(); return false; }
    return true;
  });
  let region = "", dept = "", i = 0;
  if (country === "FR") {
    const r = rest[0] != null ? frRegion(fr, rest[0]) : null;
    if (r) { region = r.name; i = 1; }
    const d = rest[i] != null ? frDept(fr, rest[i]) : null;
    if (d) { dept = d.code; region = d.region || region; i++; }
    else if (!r && rest.length) return { error: { code: "frUnit", arg: rest[0] } };
  } else if (rest.length) {
    region = rest[0].trim(); i = 1;
    if (rest[1] != null && /^[A-Za-z0-9]{1,4}\s*[-–]\s*\S/.test(rest[1])) { dept = rest[1].trim(); i = 2; }
  }
  return { country, region, dept, place: rest.slice(i).map((s) => s.trim()).join(" › "), date, year };
}

/**
 * One map of a folder read and kept: the map (skipped when the library already has it: `known`, its SHA-256s), its runs from
 * its tracks when it is georeferenced. -> { status: "saved" | "known", map, notes: [{ code, file }] } — notes: tracks not
 * placed (noGeo: the map has no georeference; outside: the track is off the map; track: not a track; time: without times).
 */
export async function importOne(m, known, { personal = false } = {}) {
  const head = /\.(jpe?g|png|webp)$/i.test(m.file.name) ? await MM.sha256(m.file) : null;
  if (head && known.has(head) && !m.tracks.length) return { status: "known", notes: [] };
  const entries = await readMap(m.file, { world: m.world, prj: m.prj });
  const e = entries[0], notes = [], runs = [...(e.runs || [])];
  let pos = null, day = m.day || e.day || null;
  for (const f of m.tracks) {
    try {
      const t = await readTrack(f);
      day = day || t.day;
      if (!e.geo) { pos = pos || t.start; notes.push({ code: "noGeo", file: f.name }); continue; }
      runs.push(runOn(t.track, e.geo, e.image.width, e.image.height, stem(f.name)));
    } catch (err) { notes.push({ code: ["outside", "time"].includes(err.message) ? err.message : "track", file: f.name }); }
  }
  const r = await MM.save({ ...e, title: m.title || e.title, day, place: m.place || e.place || "", country: m.country, region: m.region, dept: m.dept, pos,
    runs }, { personal });
  for (const x of entries) x.image?.close?.();
  // the server could not keep the place (migration 0024 not applied): stop rather than lose the folders' sorting
  if (!r.placed) { const err = new Error("not ready"); err.status = 503; throw err; }
  return { status: r.existed && !runs.length ? "known" : "saved", map: r.map, notes };
}

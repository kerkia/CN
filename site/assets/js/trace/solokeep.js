// The solo analyses an account keeps (owner, 2026-11-05): « Analyse solo »'s « Enregistrer l'analyse », beside « Voir la
// course », sends the map (once per account: by its hash) and the run as the playback draws it — positions in the map's pixels
// and times, the controls placed, never the watch's other channels — to /api/solo (functions/api/solo). « Analyse de carte »
// lists them (pages/mapanalysis.js), replays one (`#/analyse-solo?analyse=<id>`: pages/analysis.js opens it straight on the
// playback through `load`) or deletes it. Not « Mes cartes »: that keeps what the playback's « Export » saves there. No text here.

import { imageBlob } from "./mapfile.js";
import * as MM from "./mymaps.js";
import { runOf } from "./mymapsave.js";

const API = "api/solo";

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(`${API}${path}`, { method, credentials: "same-origin",
    headers: body && !(body instanceof Blob) ? { "Content-Type": "application/json", ...headers } : headers,
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => null);
  if (r.status === 401) window.dispatchEvent(new Event("cnx:unauthorised"));
  if (!r.ok) { const e = new Error(d?.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return d;
}

/** The account's kept analyses (their summaries), the latest first. */
export const list = () => call("").then((d) => d.analyses || []);
/** An analysis deleted, and this browser's note of the trace it was kept for (pages/analysis.js `ocn.an.kept.<trace>`). */
export async function remove(id) {
  await call(`/${id}`, { method: "DELETE" });
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("ocn.an.kept.") && JSON.parse(localStorage.getItem(k) || "null")?.id === id) localStorage.removeItem(k);
  } catch (e) { /* the page checks the list anyway */ }
}
export const thumbUrl = (sha) => `${API}/maps/${sha}/thumb`;
/** An analysis renamed: { analysis } (its summary). */
export const rename = (id, title) => call(`/${id}`, { method: "PATCH", body: { title } });

/** The map's bytes and type, sent unless the account holds them already (and its thumbnail). */
async function sendMap(s) {
  const raw = await imageBlob(s.file || null, s.image);          // the map as it came; a PDF's or a generated map's page as a PNG
  const type = MM.typeOf(raw, s.file?.name || "");
  if (!type) throw new Error("type");
  const blob = raw.type === type ? raw : new Blob([raw], { type });
  const sha = await MM.sha256(blob);
  const has = await call(`/maps/${sha}/has`);
  if (!has.map) await call(`/maps/${sha}`, { method: "PUT", body: blob, headers: { "Content-Type": type } });
  if (!has.thumb) { const th = await MM.thumbnail(s.image); await call(`/maps/${sha}/thumb`, { method: "PUT", body: th, headers: { "Content-Type": th.type } }).catch(() => {}); }
  return { sha, type, w: s.image.width, h: s.image.height };
}

/**
 * Keep the analysis of state s (trace/mymapsave.js `mount`'s state): { id }. id: the one kept before for this trace, replaced
 * (a calibration made again); gone meanwhile, a new one is made. extra: { title, source, orga: { id, n } }.
 */
export async function save(s, { id = null, title = "", source = "solo", orga = null } = {}) {
  const run = runOf(s, false);
  const map = await sendMap(s);
  const body = { title, day: run.day, source, map, geo: s.geo || null, start: run.start, dur: run.dur, dist: run.dist, rec: run.rec, orga };
  if (id) {
    try { return { id: (await call(`/${id}`, { method: "PUT", body })).id }; }
    catch (e) { if (e.status !== 404) throw e; }
  }
  return { id: (await call("", { method: "POST", body })).id };
}

/**
 * A kept analysis read back to be played: { a (the analysis), files: [the map, the run as a GPX] } — the GPX of « Mes
 * cartes »' « Rejouer » (mymaps.replayGpx), so that « Analyse solo » lays the run through the georeference and controls kept.
 */
export async function load(id) {
  const res = await fetch(`${API}/${id}`, { credentials: "same-origin" });
  if (res.status === 401) window.dispatchEvent(new Event("cnx:unauthorised"));
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  const a = await res.json();
  const named = res.headers.get("X-Title");                     // renamed since it was kept
  if (named != null) a.title = decodeURIComponent(named);
  const gpx = MM.replayGpx({ w: a.map.w, h: a.map.h, geo: a.geo }, MM.decodeRun(a.rec), a.title || "", { dist: a.dist });
  if (!gpx) throw new Error("geo");
  const r = await fetch(`${API}/maps/${a.map.sha}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const ext = /png/.test(a.map.type) ? "png" : /webp/.test(a.map.type) ? "webp" : "jpg";
  return { a, files: [new File([blob], MM.fileName(a.title, a.day, ext), { type: a.map.type }),
    new File([gpx], MM.fileName(a.title, a.day, "gpx"), { type: "application/gpx+xml" })] };
}

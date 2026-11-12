// Pixel's map options (owner, 2026-11-12: the map as a training exercise): what the race's map shows — the whole map, no paths, no
// vegetation, relief only, contours only (the Tracer's training maps' choices, tracer/vmap/presets.js) — and « map at the controls
// only » (`memory`: the map shows within MEM_R metres of the last control punched, the start included, and for MEM_S seconds of
// race after a punch; a memory exercise). A training on a map: the runner's choice on the start screen (kept in this browser); an
// event: its creator's, fixed (`mapOpt` in the event, the server's cleanMapOpt), the same for every runner. A race from the LiDAR
// alone draws its map as an image without symbols: only « map at the controls » applies there (`usable`). A run keeps the options
// it was run with (`mo`, its summary's « nopaths », « contours+mem »…), shown with its time.

import { PRESETS } from "../tracer/vmap/presets.js";

export const LAYERS = PRESETS;            // full, nopaths, noveg, relief, contours
export const MEM_R = 25, MEM_S = 45;      // metres round the last control, race seconds after a punch (15 s of play)

/** The options, anything unknown taken as the whole map (the server's cleanMapOpt). */
export function mapOptOf(o) {
  return { layer: LAYERS.includes(o?.layer) ? o.layer : "full", memory: o?.memory === true || o?.memory === 1 || o?.memory === "1" };
}
export const plainMap = (o) => { const v = mapOptOf(o); return v.layer === "full" && !v.memory; };
/** A map drawn as an image (a race from the LiDAR alone): no symbols to leave out. */
export const imageMap = (race) => race?.map === "webp" || race?.source === "lidaronly";
/** The options a map can honour: the layer only on a map with symbols. */
export const usable = (o, race) => { const v = mapOptOf(o); return imageMap(race) ? { layer: "full", memory: v.memory } : v; };

/** The options in words (t: the catalogue's), « Sans chemins · Carte aux postes seulement »; "" for the whole map. */
export function mapOptText(t, o) {
  const v = mapOptOf(o), parts = [];
  if (v.layer !== "full") parts.push(t(`vt.mo.l.${v.layer}`));
  if (v.memory) parts.push(t("vt.mo.memory"));
  return parts.join(" · ");
}
/** A run's code « nopaths+mem » (its summary's `mo`) and back. */
export const moCode = (o) => { const v = mapOptOf(o); return plainMap(v) ? "" : [v.layer !== "full" ? v.layer : "", v.memory ? "mem" : ""].filter(Boolean).join("+"); };
export const moOf = (code) => { const p = String(code || "").split("+"); return mapOptOf({ layer: p.find((x) => LAYERS.includes(x)), memory: p.includes("mem") }); };

/** The training's choice, kept in this browser. */
const KEY = "ocn.vt.mapopt";
export function savedOpt() { try { return mapOptOf(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { return mapOptOf(null); } }
export function saveOpt(o) { try { localStorage.setItem(KEY, JSON.stringify(mapOptOf(o))); } catch (e) { /* not kept */ } }

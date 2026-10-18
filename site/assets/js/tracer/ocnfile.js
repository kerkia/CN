// The O'CN course-setting file (.ocnt, « fichier O'CN »; owner, 2026-10-17): ours to evolve. A zip holding
//   event.json   { format: "ocn-trace", version, app, saved, title, map: { file, type, size } | null, event }
//                where `event` is the Tracer's own event (model.js: everything a Purple Pen .ppen holds — controls, courses,
//                forks and loops, legs, specials, descriptions, print areas, appearance — plus what O'CN adds: georeferencing,
//                the legs' routes, the publication's links…), in the event's own frame (an OCAD map's offset kept in map.ox/oy);
//   map/<name>   the map file itself, when it is included (it is by default): one file carries the whole event, where a
//                .ppen needs its map beside it.
// `version` is the container's layout; `event.v` the model's (model.js VERSION). A newer file than this code reads is refused
// with a plain message rather than half read.

import * as M from "./model.js";
import { readZip } from "../trace/georef.js";
import { t } from "./lang.js";

export const EXT = ".ocnt";
export const FORMAT = "ocn-trace";
export const FORMAT_VERSION = 1;
export const isOcnFile = (f) => /\.ocnt$/i.test(f?.name || "");

import { FFLATE } from "../vendor.js";
function script(src) {
  if (window.fflate) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("fflate")); document.head.appendChild(s); });
}

/** The .ocnt's bytes: the event, and the map when given ({ name, type, bytes }). */
export async function writeOcn(ev, { map = null } = {}) {
  await script(FFLATE);
  const enc = new TextEncoder();
  const name = map ? String(map.name || t("trc.ocn.mapName")).split(/[\\/]/).pop() : null;
  const head = {
    format: FORMAT, version: FORMAT_VERSION, app: "O'CN — https://ocn.kerkia.com", saved: new Date().toISOString(),
    title: ev.title || "", map: map ? { file: name, type: map.type || "", size: map.bytes.length } : null, event: ev,
  };
  const files = { "event.json": [enc.encode(JSON.stringify(head)), { level: 6 }] };
  if (map) files[`map/${name}`] = [map.bytes, { level: /\.(png|jpe?g|gif|webp|pdf)$/i.test(name) ? 0 : 6 }];   // compressed images gain nothing
  return window.fflate.zipSync(files);
}

/** A .ocnt read: { ev, map: { name, type, bytes } | null, saved }. Throws an Error with a French message when unreadable. */
export async function readOcn(buf) {
  let entries;
  try { entries = await readZip(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); }
  catch (e) { throw new Error(t("trc.ocn.notOcn")); }
  const ej = entries.find((x) => x.name === "event.json");
  if (!ej) throw new Error(t("trc.ocn.noEvent"));
  let head;
  try { head = JSON.parse(new TextDecoder().decode(ej.data)); } catch (e) { throw new Error(t("trc.ocn.badEvent")); }
  if (head.format !== FORMAT || !head.event) throw new Error(t("trc.ocn.notTrace"));
  if (head.version > FORMAT_VERSION || (head.event.v || 1) > M.VERSION) throw new Error(t("trc.ocn.newer"));
  const ev = head.event;
  for (const k of ["controls", "courses", "courseControls", "legs", "specials"]) ev[k] = ev[k] || {};
  const me = head.map && entries.find((x) => x.name === `map/${head.map.file}`);
  const map = me ? { name: head.map.file, type: head.map.type || "", bytes: me.data } : null;
  return { ev, map, saved: head.saved || null };
}

// What Cartographier has for a place, and the way to ask for more (owner, 2026-11-06): national data, terrain models, LiDAR and
// backgrounds are supported country by country (France, Switzerland, the USA, Canada, New Zealand so far); elsewhere OpenStreetMap
// and the worldwide terrain tiles stand in, and the mapper is told what is missing and invited to ask Ozimut for that country.
// Mappers work across countries: this is about the place mapped, never about the countries of the account or of Ozimut's rankings.

import { t } from "./lang.js";
import { LINZ_KEY } from "./backgrounds.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** What is supported at [lat, lon]: { cc, dem, vectors, lidar, backgrounds, missing: [keys] }. */
export async function at(lat, lon) {
  const T = await import("../trace/terrain.js"), LM = await import("../trace/lidarmap.js");
  const cc = T.countryAt(lat, lon);
  const s = {
    cc,
    dem: T.sourcesAt(lat, lon).length > 0,
    vectors: cc === "FR" || cc === "CH" || cc === "US",
    lidar: LM.countryAt(lat, lon) !== null,
    backgrounds: cc === "FR" || cc === "CH" || cc === "US" || (cc === "NZ" && !!LINZ_KEY),
  };
  s.missing = ["dem", "vectors", "lidar", "backgrounds"].filter((k) => !s[k]);
  return s;
}

/** The link to « Nous écrire » with the place in its subject, opened beside the editor. */
export function askHref(lat, lon) {
  const where = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "?";
  return `#/contact?${new URLSearchParams({ sujet: t("map.support.subject", { where }), from: location.hash || "#/" })}`;
}

/** The note for a place: what is missing there (`only`: those keys alone), and the invitation to ask. "" when nothing is missing. */
export function noteHtml(s, lat, lon, only = null) {
  const missing = s.missing.filter((k) => !only || only.includes(k));
  if (!missing.length) return "";
  const list = missing.map((k) => t(`map.support.what.${k}`)).join(", ");
  return `<div class="mp-support" role="note"><p>${esc(t("map.support.missing", { list }))}</p>
    <p>${esc(t("map.support.ask"))} <a href="${esc(askHref(lat, lon))}" target="_blank" rel="noopener">${esc(t("map.support.link"))}</a></p></div>`;
}

/** The same note in a dialog of its own (a command that cannot run at that place). */
export async function explain(E, s, lat, lon, only = null) {
  const { modal } = await import("../tracer/dialogs.js");
  await modal(E, { title: t("map.support.title"), body: noteHtml(s, lat, lon, only), ok: t("map.support.close"), cancel: false });
}

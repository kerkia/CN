// The live GPS tracking of a competition, run by another service (owner, 2026-10-24): its organiser gives the link to the
// service's page (« Organisation › Direct », pages/orgdirect.js), and Agenda, Résultats and En direct show it as a button that
// opens it. Ozimut reads no position: only the link, kept by functions/api/tracking.js.

import { html } from "./util.js";
import { t } from "./i18n.js";

const TTL = 5 * 60e3;                      // read again after 5 minutes (the server lets the browser keep it as long)
let memo = null, at = 0;

/** Every competition's tracking link: Map race key -> { race, url, date, mine }. */
export async function links({ fresh = false } = {}) {
  if (!memo || fresh || Date.now() - at > TTL) {
    at = Date.now();
    memo = fetch("api/tracking", { credentials: "same-origin", ...(fresh ? { cache: "reload" } : {}) })
      .then((r) => (r.ok ? r.json() : { links: [] })).catch(() => ({ links: [] }))
      .then((j) => new Map((j.links || []).map((l) => [l.race, l])));
  }
  return memo;
}

/** The link of the first of these competition keys that has one (a race of « Résultats » and its agenda key), or null. */
export const linkOf = (map, ...keys) => keys.filter(Boolean).map((k) => map.get(k)).find(Boolean) || null;

// the services used in orienteering, by their address (i18n-ignore-next 9)
const SERVICES = [[/(^|\.)loggator\.com$/, "Loggator"], [/(^|\.)(gpsseuranta\.net|tulospalvelu\.fi)$/, "GPSSeuranta"],
  [/(^|\.)tractrac\.com$/, "TracTrac"], [/(^|\.)livelox\.com$/, "Livelox"], [/(^|\.)routechoices\.com$/, "Routechoices"],
  [/(^|\.)sportrec\.eu$/, "SportRec"], [/(^|\.)worldofo\.com$/, "2DRerun"]];
/** The service's name from its address (« Loggator »), else the address's host. */
export function serviceOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (SERVICES.find(([re]) => re.test(host)) || [null, host])[1];
  } catch (e) { return ""; }
}

/** The button that opens a tracking page (`primary`: the main button of its box). */
export const button = (l, { primary = false, cls = "btn-sm" } = {}) => (l ? html`<a class="btn ${cls}${primary ? " btn-primary" : ""}"
  href="${l.url}" target="_blank" rel="noopener" title="${t("trk.tip", { s: serviceOf(l.url) })}">${t("trk.button")} ↗</a>` : "");

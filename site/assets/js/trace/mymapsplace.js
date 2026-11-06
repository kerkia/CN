// « Mes cartes »: where a map is (owner, 2026-11-06: the library's map, its filters and folders by country, region and
// département). A map keeps its country (ISO alpha-2), its region and its département (in France the région's name and the
// département's number, elsewhere the names as given). Countries are named and recognised by the browser's own names
// (Intl.DisplayNames, in several languages: « Suède », « Sweden », « Schweden », « Suecia », « SE »); France's régions and
// départements come from the site's own outlines (site/assets/geo/regions.json, departements.json). No map service is asked
// anything. No text of the interface here.

import { lang } from "../i18n.js";

/** A name folded for comparisons: no accents, lower case, words separated by one space. */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---- countries --------------------------------------------------------------------------------------------------------
const NAME_LANGS = ["fr", "en", "de", "es", "it", "pt", "nl", "sv", "cs", "pl"];
// names the browser does not give (the nations of Britain, old names, short forms)
const ALIAS = { uk: "GB", angleterre: "GB", england: "GB", ecosse: "GB", scotland: "GB", "pays de galles": "GB", wales: "GB",
  "irlande du nord": "GB", "northern ireland": "GB", "grande bretagne": "GB", "great britain": "GB", usa: "US", "etats unis": "US",
  "republique tcheque": "CZ", "czech republic": "CZ", tcheque: "CZ", hollande: "NL", holland: "NL", "coree": "KR", korea: "KR",
  russie: "RU", "nouvelle zelande": "NZ", suisse: "CH", "kosovo": "XK" };
let codes = null, table = null;
/** Every country code the browser names (ISO 3166 alpha-2), groupings (EU, UN…) left out. */
export function countryCodes() {
  if (codes) return codes;
  const d = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  codes = [];
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const c = String.fromCharCode(a, b);
    // groupings and the exceptional reservations (FX « France métropolitaine » took « France », IC the Canaries…)
    if (/^(EU|EZ|UN|QO|XA|XB|ZZ|AA|Q[M-Z]|X[A-JL-Z]|FX|IC|EA|DG|CP|TA|AC|CQ)$/.test(c)) continue;
    let n;
    try { n = d.of(c); } catch (e) { n = null; }
    if (n && n !== c) codes.push(c);
  }
  return codes;
}
function names() {
  if (table) return table;
  table = new Map();
  const dn = NAME_LANGS.map((l) => { try { return new Intl.DisplayNames([l], { type: "region", fallback: "none" }); } catch (e) { return null; } }).filter(Boolean);
  for (const c of countryCodes()) {
    if (!table.has(fold(c))) table.set(fold(c), c);
    for (const d of dn) {
      let n;
      try { n = d.of(c); } catch (e) { n = null; }
      if (!n) continue;
      if (!table.has(fold(n))) table.set(fold(n), c);             // (the first country named so keeps the name)
      const short = fold(n.replace(/\s*\(.*\)\s*/g, " "));             // « Corée (République de) » → « Corée »
      if (short && !table.has(short)) table.set(short, c);
    }
  }
  for (const [k, v] of Object.entries(ALIAS)) table.set(fold(k), v);
  return table;
}
/** The country a name says (any of several languages, or its code), or "". */
export const countryCode = (name) => names().get(fold(name)) || "";
/** A country's name in the site's language. */
export function countryName(cc) {
  if (!cc) return "";
  try { return new Intl.DisplayNames([lang()], { type: "region" }).of(cc) || cc; } catch (e) { return cc; }
}
/** Every country, named in the site's language and sorted by name: [[code, name]]. */
export function countryList() {
  const coll = new Intl.Collator(lang());
  return countryCodes().map((c) => [c, countryName(c)]).sort((a, b) => coll.compare(a[1], b[1]));
}

// ---- France's régions and départements ------------------------------------------------------------------------------
const ringsOf = (g) => (g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : []);
const area = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
function centroid(rings) {
  const r = rings.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  let x = 0, y = 0, A = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f; A += f;
  }
  return A ? [y / (3 * A), x / (3 * A)] : [r[0][1], r[0][0]];                // [lat, lon]
}
function inside(rings, lat, lon) {
  let n = 0;
  for (const r of rings) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > lat) !== (r[j][1] > lat) && lon < ((r[j][0] - r[i][0]) * (lat - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    if (c) n++;
  }
  return n > 0;
}
let frP = null;
/** France's régions and départements: { regions: [{ code, name, rings, c }], depts: [{ code, name, rings, c, region }] }. */
export function france() {
  return frP || (frP = Promise.all(["regions", "departements"].map((f) => fetch(`/assets/geo/${f}.json`).then((r) => (r.ok ? r.json() : { features: [] }))))
    .then(([R, D]) => {
      const regions = R.features.map((f) => { const rings = ringsOf(f.geometry); return { code: f.properties.code, name: f.properties.nom, rings, c: rings.length ? centroid(rings) : null }; });
      const depts = D.features.map((f) => {
        const rings = ringsOf(f.geometry), c = rings.length ? centroid(rings) : null;
        const reg = c && regions.find((r) => inside(r.rings, c[0], c[1]));
        return { code: String(f.properties.code), name: f.properties.nom, rings, c, region: reg?.name || "" };
      }).sort((a, b) => a.code.localeCompare(b.code));
      return { regions: regions.sort((a, b) => a.name.localeCompare(b.name, "fr")), depts };
    }).catch(() => { frP = null; return { regions: [], depts: [] }; }));
}
/** A French département from what a folder or a field says: « 77 », « 77 - Seine-et-Marne », « Seine-et-Marne », « 2A ». */
export function frDept(fr, s) {
  const v = String(s ?? "").trim();
  const m = /^(\d{2,3}|2[ABab])(?:\s*[-–—_.:]\s*|\s+|$)/.exec(v);
  if (m) return fr.depts.find((d) => d.code === m[1].toUpperCase()) || null;
  const f = fold(v);
  return f ? fr.depts.find((d) => fold(d.name) === f) || null : null;
}
/** A French région by its name (folded). */
export const frRegion = (fr, s) => { const f = fold(s); return f ? fr.regions.find((r) => fold(r.name) === f) || null : null; };
/** In France, the département and région of a point: { dept, region } or null. */
export function frAt(fr, lat, lon) {
  const d = fr.depts.find((x) => inside(x.rings, lat, lon));
  return d ? { dept: d.code, region: d.region } : null;
}
/** A département as shown: « 77 Seine-et-Marne » in France, the name as given elsewhere. */
export const deptLabel = (fr, cc, dept) => {
  if (cc !== "FR" || !dept) return dept || "";
  const d = fr?.depts.find((x) => x.code === dept);
  return d ? `${d.code} ${d.name}` : dept;
};

// ---- a country's centre (its outline's frame, site/assets/geo/<cc>.json) -----------------------------------------------
const boxes = new Map();
function countryBox(cc) {
  if (!boxes.has(cc)) boxes.set(cc, fetch(`/assets/geo/${cc.toLowerCase()}.json`).then((r) => (r.ok ? r.json() : null)).then((g) => g?.box || null).catch(() => null));
  return boxes.get(cc);
}
/**
 * Where a map is drawn on the library's map: [lat, lon, approximate?] — its own position (the georeference's centre, a track's
 * first point), else its département's or région's centre in France, else its country's; null when nothing is known.
 */
export async function position(m, fr) {
  // (a map without a georeference whose run was drawn by hand has a frame of its own round (0, 0): no place)
  if (Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) + Math.abs(m.lon) > 0.1) return [m.lat, m.lon, false];
  if (m.country === "FR" && fr) {
    const d = fr.depts.find((x) => x.code === m.dept) || null, r = frRegion(fr, m.region);
    const c = d?.c || r?.c;
    if (c) return [c[0], c[1], true];
  }
  if (!m.country) return null;
  const b = await countryBox(m.country);
  return b ? [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2, true] : null;
}

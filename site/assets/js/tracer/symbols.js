// The control description symbols (Purple Pen's symbols.xml, as assets/tracer/symbols.json; BSD licence,
// assets/tracer/LICENSE-PurplePen.txt): a symbol by id for a description standard, its name and texts in a language
// (Purple Pen's Symbol.FindBestText: the language's own text, else English; singular or plural, gender, case), and its
// drawing as paths in a box (a square cell, or eight cells for an instruction line).

let DB = null, LOADING = null, ALL_TEXTS = null;
const URL_MAIN = "assets/tracer/symbols.json", URL_TEXTS = "assets/tracer/symbol-texts.json";

/** Load the symbols (once). */
export async function loadSymbols() {
  if (DB) return DB;
  if (!LOADING) LOADING = fetch(URL_MAIN).then((r) => r.json()).then((j) => {
    const byId = {};
    for (const s of Object.values(j.symbols)) (byId[s.id] ||= []).push(s);
    DB = { languages: j.languages, byId, all: Object.values(j.symbols) };
    return DB;
  });
  return LOADING;
}
/** The texts of every language (for an event described in neither French nor English). */
export async function loadAllTexts() {
  if (ALL_TEXTS) return ALL_TEXTS;
  await loadSymbols();
  const j = await fetch(URL_TEXTS).then((r) => r.json());
  ALL_TEXTS = j.symbols;
  for (const [key, v] of Object.entries(j.symbols)) {
    const s = DB.all.find((x) => (x.std ? `${x.id}@${x.std.join(",")}` : x.id) === key) || DB.byId[key.split("@")[0]]?.[0];
    if (s) { s.n = v.n; s.t = v.t; }
  }
  return ALL_TEXTS;
}
export const symbolsLoaded = () => !!DB;
export const languages = () => DB?.languages || {};

/** The symbol with this id in a standard ("2004" or "2018"), or null. */
export function symbol(id, standard = "2018") {
  const list = DB?.byId[id];
  if (!list) return null;
  return list.find((s) => !s.std || s.std.includes(standard)) || null;
}
export const existsIn = (id, standard) => !!symbol(id, standard);
/** Symbols offered for a column (C…H, or a directive letter), in the standard, in Purple Pen's order. */
export function symbolsFor(kind, standard = "2018") {
  return (DB?.all || []).filter((s) => s.k === kind && (!s.std || s.std.includes(standard)));
}

// ---- texts ---------------------------------------------------------------------------------------------------------
/** Purple Pen's FindBestText over a list of { t, p, g, c, mc } (or custom texts { text, plural, gender, case, modCase, lang }). */
function bestText(texts, lang, plural, gender = "", nounCase = "") {
  const L = DB?.languages?.[lang];
  const defCase = L?.cases?.length ? L.cases[0] : "";
  let best = null, bestM = 1e9;
  for (const [tl, list] of texts) for (const x of list) {
    const xl = x.lang ?? tl, xp = !!(x.p ?? x.plural), xg = x.g ?? x.gender ?? "", xc = x.c ?? x.case ?? "";
    let m = 0;
    if (xl !== lang && xl !== "en") m += 100;
    if (xl !== lang && xl === "en") m += 50;
    if (xp !== !!plural) m += 10;
    if (gender && xg !== gender) m += 5;
    if (nounCase && xc !== nounCase) m += 3;
    if (!nounCase && xc && xc !== defCase) m += 1;
    if (m < bestM) { bestM = m; best = x; }
  }
  return best;
}
const textsOf = (s) => Object.entries(s?.t || {});
export function symbolText(s, lang, { plural = false, gender = "", nounCase = "", custom = null } = {}) {
  if (!s) return null;
  if (custom?.length && custom.some((x) => x.lang === lang)) return bestText([["", custom]], lang, plural, gender, nounCase)?.text ?? null;
  const b = bestText(textsOf(s), lang, plural, gender, nounCase);
  return b ? b.t : null;
}
export function symbolGender(s, lang, custom = null) {
  if (custom?.length && custom.some((x) => x.lang === lang)) return bestText([["", custom]], lang, false, "", "")?.gender ?? "";
  return bestText(textsOf(s), lang, false, null, "")?.g ?? "";
}
export function modifiedCase(s, lang, custom = null) {
  if (custom?.length && custom.some((x) => x.lang === lang)) return bestText([["", custom]], lang, false, "", "")?.modCase ?? "";
  return bestText(textsOf(s), lang, false, "", "")?.mc ?? "";
}
/** The symbol's name in a language (the user interface's), else English. */
export const symbolName = (s, lang = "fr") => s?.n?.[lang] || s?.n?.en || s?.id || "";

// ---- drawing ---------------------------------------------------------------------------------------------------------
/**
 * The symbol's strokes as path commands in a box (left, top, width, height; y down, as on a page): returns
 * [{ d: [["M",x,y],["L",x,y],["C",…],["Z"]], stroke: width|0, fill: bool, cap: "round"|"butt", join: "round"|"miter" }].
 * Instruction lines (kinds T and after) span 1600 units across, other symbols 200.
 */
export function symbolPaths(s, left, top, width, height) {
  if (!s?.g) return [];
  const wide = s.k >= "T";
  const sx = width / (wide ? 1600 : 200), sy = height / 200, cx = left + width / 2, cy = top + height / 2;
  const P = (x, y) => [cx + x * sx, cy - y * sy];
  const k = (sx + sy) / 2;
  const out = [];
  const poly = (pts, close) => {
    const d = [];
    for (let i = 0; i < pts.length; i += 2) d.push([i ? "L" : "M", ...P(pts[i], pts[i + 1])]);
    if (close) d.push(["Z"]);
    return d;
  };
  const bez = (pts, close) => {
    const d = [["M", ...P(pts[0], pts[1])]];
    for (let i = 2; i + 5 < pts.length; i += 6) d.push(["C", ...P(pts[i], pts[i + 1]), ...P(pts[i + 2], pts[i + 3]), ...P(pts[i + 4], pts[i + 5])]);
    if (close) d.push(["Z"]);
    return d;
  };
  const circle = (x, y, r) => {
    const [px, py] = P(x, y), rx = r * sx, ry = r * sy, c = 0.5522847498;
    return [["M", px + rx, py], ["C", px + rx, py + ry * c, px + rx * c, py + ry, px, py + ry], ["C", px - rx * c, py + ry, px - rx, py + ry * c, px - rx, py],
      ["C", px - rx, py - ry * c, px - rx * c, py - ry, px, py - ry], ["C", px + rx * c, py - ry, px + rx, py - ry * c, px + rx, py], ["Z"]];
  };
  for (const g of s.g) {
    switch (g[0]) {
      case "l": out.push({ d: poly(g[4], false), stroke: g[1] * k, cap: g[2] === "f" ? "butt" : "round", join: g[3] === "s" ? "miter" : "round" }); break;
      case "p": out.push({ d: poly(g[3], true), stroke: g[1] * k, cap: "round", join: g[2] === "s" ? "miter" : "round" }); break;
      case "fp": out.push({ d: poly(g[1], true), fill: true }); break;
      case "c": out.push({ d: circle(g[3][0], g[3][1], g[2]), stroke: g[1] * k, cap: "round", join: "round" }); break;
      case "fc": out.push({ d: circle(g[2][0], g[2][1], g[1]), fill: true }); break;
      case "b": out.push({ d: bez(g[3], false), stroke: g[1] * k, cap: g[2] === "f" ? "butt" : "round", join: "round" }); break;
      case "fb": out.push({ d: bez(g[1], true), fill: true }); break;
      default: break;
    }
  }
  return out;
}

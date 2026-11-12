// Cartographier's « Données »: open data brought in as objects the mapper can edit — contours from the terrain model (IGN's
// RGE ALTI in France, else the world's terrain tiles), OpenStreetMap's roads, paths, buildings, water and fences, and the
// LiDAR's contours, cliffs, knolls and pits (karttapullautin's results, the tiles made by the « lidarmap » workflow) with its
// vegetation as a background. Everything comes in a part of its own, « Brouillon », each object marked with its source
// (`src`) and `draft`, never mixed silently with what was surveyed: « Accepter » moves it into the map, « Rejeter » drops it.
// The area: the print area, else what is on the screen. Owner, 2026-11-06: the Tracer's « Générer une carte » moved here.
// « Plan de ville (sprint) » (2026-11-12): a sprint map's town from BD TOPO, the cadastre and OpenStreetMap merged by the rules
// a mapper's review gave tools/virtually/town_map.py (data/town.js); « Nouvelle carte » sprint uses it in place of the separate
// national and OpenStreetMap imports.

import * as G from "./geom.js";
import { modal, field, sel } from "../tracer/dialogs.js";
import { setBar } from "../waitbar.js";
import { t, tn } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DRAFT = "draft";

/** The rectangle (map mm) the data is asked for: the one chosen, else the print area, else the screen. */
function areaOf(E) { return E.dataArea || E.doc.printArea || E.view.visibleRect(); }
const styleOf = (E) => (/ISSprOM/i.test(E.doc.standard || "") || E.doc.scale <= 5000 ? "sprint" : "forest");
function draftPart(E) {
  if (!E.doc.parts.some((p) => p.id === DRAFT)) E.live.setDocField("parts", [...E.doc.parts, { id: DRAFT, name: t("map.parts.draft"), hidden: false, locked: false }]);
  return DRAFT;
}
/** Objects from a data module into the document, in the draft part; symbols the map lacks are named and their objects left out. */
function bring(E, objects, label) {
  const have = new Set(E.doc.symbols.map((s) => s.sym)), missing = new Map();
  let n = 0;
  E.live.transact(label, () => {
    const part = draftPart(E);
    for (const o of objects) {
      if (!have.has(o.sym)) { missing.set(o.sym, (missing.get(o.sym) || 0) + 1); continue; }
      E.live.add({ ang: 0, col: 0, lineWidth: 0, diamFlags: 0, ...o, part, draft: true });
      n++;
    }
  });
  if (missing.size) E.say(t("map.data.missing", { list: [...missing.keys()].map((s) => `${Math.floor(s / 1000)}${s % 1000 ? "." + (s % 1000) : ""}`).join(", ") }), "bad");
  return n;
}
async function frameOrSay(E) {
  const f = E.frame || (await import("./data/frame.js").then((F) => F.frameOf(E.doc)).catch(() => null));
  if (!f?.geo) { E.say(t("map.data.nogeo"), "bad"); return null; }
  return f;
}
/** A progress bar in the toast (waitbar.js: the browser's own <progress>, none while the share is unknown). */
function progress(E) {
  const el = E.$("#mp-toast");
  return (msg, frac = null) => { el.hidden = false; el.className = "mp-toast busy"; el.innerHTML = `${esc(msg)} ${setBar ? "" : ""}<progress class="wait-bar" max="1"${frac != null ? ` value="${frac}"` : ""}></progress>`; };
}

export async function act(E, act) {
  if (act === "data-area") return chooseArea(E);
  if (act === "data-contours") return contours(E);
  if (act === "data-osm") return osm(E);
  if (act === "data-bdtopo" || act === "data-national") return national(E);
  if (act === "data-town") return townDialog(E);
  if (act === "data-lidar") return lidar(E);
  if (act === "draft-accept") return accept(E, false);
  if (act === "draft-acceptKind") return accept(E, true);
  if (act === "draft-reject") return reject(E);
}
async function chooseArea(E) {
  const v = await modal(E, { title: t("map.rib.data-area"), body: field(t("map.data.area"), sel("a", [["screen", t("map.data.area.screen")], ["print", t("map.data.area.print")], ["map", t("map.data.area.map")]], "screen")) });
  if (!v) return;
  E.dataArea = v.a === "print" ? E.doc.printArea : v.a === "map" ? E.live.bounds() : E.view.visibleRect();
  E.say(t("map.data.areaSet"));
}
/** The middle of the area the data is read for, [lat, lon], and what Cartographier supports there (support.js). */
async function placeOf(E, f) {
  const b = areaOf(E), [lat, lon] = f.toLatLon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  const SP = await import("./support.js");
  return { lat, lon, s: await SP.at(lat, lon), SP };
}
async function contours(E) {
  const f = await frameOrSay(E); if (!f) return;
  const P = await placeOf(E, f).catch(() => null);
  const v = await modal(E, { title: t("map.rib.data-contours"), body: field(t("map.data.interval"), sel("i", [["2.5", "2,5 m"], ["5", "5 m"], ["10", "10 m"]], styleOf(E) === "sprint" ? "2.5" : "5")) + `<p class="mp-hint">${esc(t("map.data.contoursHint"))}</p>` + (P ? P.SP.noteHtml(P.s, P.lat, P.lon, ["dem"]) : "") });
  if (!v) return;
  const say = progress(E);
  say(t("map.data.loadingDem"));
  const C = await import("./data/contours.js");
  const r = await C.loadContours(f, areaOf(E), { interval: Number(v.i), onProgress: (x) => say(t("map.data.loadingDem"), x) });
  const n = bring(E, r.objects, t("map.undo.data"));
  E.say(tn("map.data.brought", n) + (r.credit ? ` · ${r.credit.text || r.credit}` : ""));
}
async function osm(E) {
  const f = await frameOrSay(E); if (!f) return;
  const style = styleOf(E);
  const say = progress(E);
  const O = await import("./data/osm.js");
  say(t("map.data.osm.asking"));
  const r = await O.loadOsm(f, areaOf(E), style, { onStage: (k) => say(t(k)) });
  const n = bring(E, r.objects, t("map.undo.data"));
  E.say(tn("map.data.brought", n) + ` · ${r.attribution}`);
}
/** The country's own vectors (buildings, roads, paths, water…): IGN's BD TOPO in France, swisstopo's swissTLM3D in Switzerland,
 *  The National Map in the USA (data/bdtopo.js, ch.js, us.js); elsewhere OpenStreetMap is the source. */
export async function nationalSource(E, f) {
  const b = areaOf(E), [la, lo] = f.toLatLon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  const { countryAt } = await import("../trace/terrain.js");
  const cc = countryAt(la, lo) || (f.epsg === 2154 ? "FR" : null);
  return { FR: "bdtopo", CH: "swisstopo", US: "tnm" }[cc] || null;
}
async function national(E) {
  const f = await frameOrSay(E); if (!f) return;
  const src = await nationalSource(E, f);
  if (!src) {
    // no national data here yet: OpenStreetMap offered, and the way to ask Ozimut for that country
    const P = await placeOf(E, f).catch(() => null);
    if (P) await P.SP.explain(E, P.s, P.lat, P.lon, ["vectors"]); else E.say(t("map.data.national.none"), "bad");
    return;
  }
  const say = progress(E);
  let r;
  try {
    const onStage = (layer, i, n) => say(t(`map.data.national.reading.${src}`), n ? i / n : null);
    if (src === "bdtopo") r = await (await import("./data/bdtopo.js")).loadBdtopo(f, areaOf(E), styleOf(E), { onStage });
    else if (src === "swisstopo") r = await (await import("./data/ch.js")).loadSwissTlm(f, areaOf(E), styleOf(E), { onStage });
    else r = await (await import("./data/us.js")).loadTnm(f, areaOf(E), styleOf(E), { onStage });
  } catch (e) { E.say(e.message === "nogeo" ? t("map.data.nogeo") : /toolarge/i.test(e.message) ? t("map.data.tooLarge") : e.message, "bad"); return; }
  if (!r.objects.length) { E.say(t("map.data.bdtopo.none"), "bad"); return; }
  const n = bring(E, r.objects, t("map.undo.data"));
  E.say(tn("map.data.brought", n) + ` · ${t({ bdtopo: "map.lay.creditBdtopo", swisstopo: "map.lay.creditSwisstopo", tnm: "map.lay.creditTnm" }[src])}`);
}
// ---- a town's sprint map -------------------------------------------------------------------------------------------------------
/** The ISSprOM set's symbols the town's map uses that a document made before them lacks (501.4, 501.6-501.9, 532.1-532.6, 990,
 *  991, 995), added from the set at the map's scale. */
async function ensureTownSymbols(E) {
  if (!/ISSprOM/i.test(E.doc.standard || "")) return;
  const want = [501004, 501006, 501007, 501008, 501009, 532001, 532002, 532003, 532004, 532005, 532006, 990000, 991000, 995000];
  const have = new Set(E.doc.symbols.map((s) => s.sym)), miss = want.filter((n) => !have.has(n));
  if (!miss.length) return;
  const L = await import("./layout.js");
  const set = await L.loadSet("issprom2019-2");
  const add = L.scaled(set, E.doc.scale).filter((s) => miss.includes(s.sym));
  E.live.transact(t("map.undo.data"), () => { for (const s of add) E.live.addSymbol({ ...s, set: "issprom2019-2" }); });
}
async function townDialog(E) {
  const f = await frameOrSay(E); if (!f) return;
  if (styleOf(E) !== "sprint") { E.say(t("map.data.town.notSprint"), "bad"); return; }
  const fr = (await nationalSource(E, f)) === "bdtopo";
  const box = (name, key) => `<label><input type="checkbox" name="${name}" checked> ${esc(t(key))}</label>`;
  const v = await modal(E, { title: t("map.rib.data-town"), body: `<p class="mp-hint">${esc(t("map.data.town.hint"))}</p>
    <fieldset class="mp-choice"><legend>${esc(t("map.data.town.sources"))}</legend>
    ${fr ? box("bdtopo", "map.data.town.src.bdtopo") + box("cadastre", "map.data.town.src.cadastre") : ""}${box("osm", "map.data.town.src.osm")}${box("contours", "map.data.town.src.contours")}</fieldset>
    ${fr ? "" : `<p class="mp-hint">${esc(t("map.data.town.notFrance"))}</p>`}`,
    validate: (x) => (x.bdtopo || x.osm || x.cadastre ? null : t("map.data.town.none")) });
  if (!v) return;
  return town(E, { bdtopo: fr && !!v.bdtopo, cadastre: fr && !!v.cadastre, osm: !!v.osm, contours: !!v.contours });
}
/** A town's sprint map into the draft part (data/town.js). o: { bdtopo, cadastre, osm, contours } — the sources to read. */
export async function town(E, o) {
  const f = await frameOrSay(E); if (!f) return;
  const b = areaOf(E), k = (E.doc.scale || 4000) / 1000;
  if ((b[2] - b[0]) * (b[3] - b[1]) * k * k > 9e6) { E.say(t("map.data.tooLarge"), "bad"); return; }
  const say = progress(E);
  say(t("map.data.town.starting"));
  await ensureTownSymbols(E);
  const T = await import("./data/town.js");
  let r;
  try { r = await T.loadTown(f, b, { ...o, contours: o.contours ? { interval: 2.5 } : null, onStage: (key, vars, frac) => say(t(key, vars), frac) }); }
  catch (e) { E.say(e.message === "nogeo" ? t("map.data.nogeo") : e.message === "jsts" ? t("map.data.town.noLib") : e.message, "bad"); return; }
  if (!r.objects.length) { E.say(t("map.data.town.empty"), "bad"); return; }
  const n = bring(E, r.objects, t("map.undo.data"));
  const credits = [r.used.bdtopo && T.BD_CREDIT, r.used.cadastre && T.CAD_CREDIT, r.used.osm && t("map.data.osm.credit"), r.used.dem].filter(Boolean);
  const failed = [...new Set(r.failed.map((x) => x.split(":")[0]))].map((x) => t(`map.data.town.src.short.${x}`));
  E.say(tn("map.data.brought", n) + (credits.length ? ` · ${credits.join(" · ")}` : "") + (failed.length ? ` · ${t("map.data.town.failed", { list: failed.join(", ") })}` : ""), failed.length ? "bad" : undefined);
}
async function lidar(E) {
  const f = await frameOrSay(E); if (!f) return;
  const P = await placeOf(E, f).catch(() => null);
  if (P && !P.s.lidar) { await P.SP.explain(E, P.s, P.lat, P.lon, ["lidar"]); return; }
  // the style first, nothing chosen beforehand (owner, 2026-11-01)
  const v = await modal(E, { title: t("map.rib.data-lidar"), body: `<fieldset class="mp-choice"><legend>${esc(t("map.data.kind"))}</legend>
    <label><input type="radio" name="s" value="sprint" required> ${esc(t("map.data.kind.sprint"))}</label>
    <label><input type="radio" name="s" value="forest" required> ${esc(t("map.data.kind.forest"))}</label></fieldset><p class="mp-hint">${esc(t("map.data.lidarHint"))}</p>`,
    validate: (x) => (x.s ? null : t("map.data.needKind")) });
  if (!v) return;
  const say = progress(E);
  const L = await import("./data/lidar.js");
  let r;
  try { r = await L.loadLidar(f, areaOf(E), v.s, { say: (key, vars, frac) => say(t(key, { n: "", t: "", ...vars }), frac), progress: (key, vars, frac) => say(t(key, vars), frac), stop: () => E._stopData }); }
  catch (e) { E.say(e.message === "tooLarge" ? t("map.data.tooLarge") : e.message === "nogeo" ? t("map.data.nogeo") : e.message, "bad"); return; }
  if (!r) { E.say(""); return; }
  const n = bring(E, r.objects, t("map.undo.data"));
  if (r.backgrounds?.length) { const B = await import("./backgrounds.js"); await B.addUrls(E, r.backgrounds); }
  E.say(tn("map.data.brought", n) + ` · ${r.credit?.text || r.credit}` + (r.tiles?.noVectors?.length ? ` · ${tn("map.data.noVectors", r.tiles.noVectors.length)}` : ""));
}
function accept(E, kind) {
  const sel = E.selected().filter((o) => o.draft);
  let list = sel.length ? sel : E.doc.objects.filter((o) => o.draft);
  if (kind && sel.length) { const syms = new Set(sel.map((o) => o.sym)); list = E.doc.objects.filter((o) => o.draft && syms.has(o.sym)); }
  E.live.transact(t("map.undo.accept"), () => { for (const o of list) E.live.update(o.id, { draft: false, part: E.part === DRAFT ? "p1" : E.part }); });
  E.say(tn("map.data.accepted", list.length));
  E.selChanged();
}
function reject(E) {
  const sel = E.selected().filter((o) => o.draft);
  const list = sel.length ? sel : E.doc.objects.filter((o) => o.draft);
  E.live.transact(t("map.undo.reject"), () => { for (const o of list) E.live.remove(o.id); });
  E.sel.clear(); E.selChanged();
  E.say(tn("map.data.rejected", list.length));
}
export { bring, styleOf };
void G;

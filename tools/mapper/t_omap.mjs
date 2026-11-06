// Cartographier: Mapper files to OCAD's records and back (mapper/fromomap.js, mapper/toomap.js), checked against oom.js's and
// ocad.js's own rendering. Run from the repository: node --import ./tools/mapper/shim.mjs tools/mapper/t_omap.mjs [files…]
//  (a) omapToDoc, the records compiled by ocad.js, against readOom: objects per symbol, each symbol's bounds, the symbols drawn in
//      each colour, the ink of each colour drawn on a recording target;
//  (b) docToOmap then readOom, against readOom of the file (with the source's XML kept, and rebuilt from the records alone);
//  (c) OCAD files (9+): readOcad's records as a document, docToOmap, readOom, against readOcad.
import "./omapshim.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { readOom } from "../../site/assets/js/tracer/vmap/oom.js";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
import { omapToDoc } from "../../site/assets/js/mapper/fromomap.js";
import { union, dev, fin, emptyText, inkOf, compareInk, oomStats, mapperKeys, compileDoc, cmpSyms, cmpColors, show, ocadDoc } from "./omaplib.mjs";
let docToOmap = null;
try { ({ docToOmap } = await import("../../site/assets/js/mapper/toomap.js")); } catch (e) { console.log("toomap.js:", e.message); }

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const OMAPS = [
  ...["complete map.omap", "forest sample.omap", "overprinting.omap"].map((f) => `${ROOT}site/data/_trtest/omap/${f}`),
  ...readdirSync(`${ROOT}site/data/_trtest/ocad/oom`).filter((f) => /\.(omap|xmap)$/.test(f)).map((f) => `${ROOT}site/data/_trtest/ocad/oom/${f}`),
  "C:/kerkia/cn-data/Test files/GifTest.omap",
].filter(existsSync);
const OCADS = readdirSync(`${ROOT}site/data/_trtest/ocad`).filter((f) => /\.ocd$/.test(f)).map((f) => `${ROOT}site/data/_trtest/ocad/${f}`);
const args = process.argv.slice(2);
const only = (list) => (args.length ? list.filter((f) => args.some((a) => f.includes(a))) : list);

// ---- (a) Mapper → records, compiled, against readOom -------------------------------------------------------------------------
function statsOfDoc(doc, keys) {
  const { map, inst } = compileDoc(doc);
  const syms = new Map(), perColor = new Map(), seen = new Map();
  let pieces = 0;
  doc.objects.forEach((o, i) => {
    const s = inst[i];
    if (!s) return;
    const key = keys.get(o.omap?.sym) ?? `?${o.sym}`;
    const e = syms.get(key) || { n: 0, b: null, text: s.def.kind === "text" };
    if (!seen.has(key)) seen.set(key, new Set());
    if (!seen.get(key).has(o.omap?.o)) { seen.get(key).add(o.omap?.o); e.n++; }
    if (o.omap?.piece) pieces++;
    else if (!o.omap?.ring && fin(s.bbox) && !emptyText(s)) e.b = union(e.b, s.bbox);
    syms.set(key, e);
    if (!s.def.visible) return;
    for (const c of map.colors) if (s.def.hasColor(c)) { if (!perColor.has(c.id)) perColor.set(c.id, new Set()); perColor.get(c.id).add(key); }
  });
  return { syms, perColor, map, pieces };
}
const totals = { a: [], b: [], c: [] };
for (const f of only(OMAPS)) {
  const name = f.split("/").pop(), bytes = new Uint8Array(readFileSync(f));
  let A, doc;
  try { A = readOom(bytes); } catch (e) { console.log(`(a) ${name}: readOom failed: ${e.message}`); continue; }
  try { doc = omapToDoc(bytes); } catch (e) { console.log(`(a) ${name}: omapToDoc failed: ${e.stack}`); totals.a.push([name, false]); continue; }
  const keys = mapperKeys(bytes), SA = oomStats(A.map), SB = statsOfDoc(doc, keys);
  const s = cmpSyms(SA, SB), cb = cmpColors(SA, SB);
  const inkA = inkOf(A.map), inkB = inkOf(SB.map), ink = compareInk(inkA, inkB);
  const bd = dev(A.map.bounds(), SB.map.bounds());
  const ok = !s.countBad.length && !s.bBad.length && !cb.length;
  totals.a.push([name, ok]);
  console.log(`(a) ${name}: ${doc.symbols.length} records, ${doc.objects.length} objects; symbols with objects ${SA.syms.size}: counts ok ${s.countOk}, bounds ok ${s.bOk}`
    + ` (text dev ${s.textDev.toFixed(3)}); map bounds dev ${bd.toFixed(3)}; extra pieces ${SB.pieces}; colours ${cb.length ? "DIFF" : "same"}; ink dev ${ink.worst.toFixed(3)} mm (colour ${ink.which})`
    + `${ink.miss.length ? ` ink only one side: ${ink.miss.join(",")}` : ""}; losses ${doc.omap.losses.length}`);
  for (const l of [show("  count", s.countBad), show("  bounds", s.bBad), show("  colours", cb, 3)]) if (l) console.log(l);
}

// ---- (b) Mapper → records → Mapper, against readOom of the file ----------------------------------------------------------------
if (docToOmap) for (const f of only(OMAPS)) {
  const name = f.split("/").pop(), bytes = new Uint8Array(readFileSync(f));
  let A;
  try { A = readOom(bytes); } catch (e) { continue; }
  const SA = oomStats(A.map), inkA = inkOf(A.map);
  for (const keepSource of [true, false]) {
    let B;
    try { B = readOom(docToOmap(omapToDoc(bytes), { keepSource })); } catch (e) { console.log(`(b) ${name} keep=${keepSource}: failed: ${e.stack}`); totals.b.push([name, false]); continue; }
    const SB = oomStats(B.map), s = cmpSyms(SA, SB), cb = cmpColors(SA, SB);
    const ink = compareInk(inkA, inkOf(B.map)), bd = dev(A.map.bounds(), B.map.bounds());
    const ok = !s.countBad.length && !s.bBad.length;
    totals.b.push([`${name} keep=${keepSource}`, ok]);
    console.log(`(b) ${name} keep=${keepSource}: symbols ${SA.syms.size}: counts ok ${s.countOk}, bounds ok ${s.bOk} (text dev ${s.textDev.toFixed(3)}); map bounds dev ${bd.toFixed(3)};`
      + ` colours ${cb.length ? "DIFF" : "same"}; ink dev ${ink.worst.toFixed(3)} mm${ink.miss.length ? ` ink only one side: ${ink.miss.join(",")}` : ""}`);
    for (const l of [show("  count", s.countBad), show("  bounds", s.bBad), show("  colours", cb, 3)]) if (l) console.log(l);
  }
}

// ---- (c) OCAD → records → Mapper, against readOcad -----------------------------------------------------------------------------
const codeKey = (code) => { const m = /^(\d+)(?:\.(\d+))?/.exec(code || ""); return m ? `${Number(m[1])}.${Number(m[2] || 0)}` : code; };
function codeStats(map, graphicsKey) {
  const syms = new Map();
  for (const d of map.symdefs) {
    if (!d.symbols.length) continue;
    const key = graphicsKey(d) ?? codeKey(d.id), e = syms.get(key) || { n: 0, b: null, text: d.kind === "text" };
    e.n += d.symbols.length;
    for (const s of d.symbols) if (fin(s.bbox) && !emptyText(s)) e.b = union(e.b, s.bbox);
    syms.set(key, e);
  }
  return { syms, perColor: new Map() };
}
if (docToOmap) for (const f of only(OCADS)) {
  const name = f.split("/").pop();
  let r;
  try { r = readOcad(new Uint8Array(readFileSync(f))); } catch (e) { console.log(`(c) ${name}: readOcad failed: ${e.message}`); continue; }
  if (r.version < 9) { console.log(`(c) ${name}: OCAD ${r.version} skipped (records of OCAD 6-8 are renumbered by doc.js)`); continue; }
  let B, losses = [];
  try { B = readOom(docToOmap(ocadDoc(r), { losses })); } catch (e) { console.log(`(c) ${name}: failed: ${e.stack}`); totals.c.push([name, false]); continue; }
  const layer = (d) => (d.id === "-2" ? "graphics" : d.id === "-3" ? "image" : d.id === "-4" || d.id === "-5" ? "layout" : null);
  const toKey = (d) => (/^Graphics/.test(d.name) ? "graphics" : /^Image layer/.test(d.name) ? "image" : /^Layout layer/.test(d.name) ? "layout" : null);
  const SA = codeStats(r.map, layer), SB = codeStats(B.map, toKey), s = cmpSyms(SA, SB);
  const inkA = inkOf(r.map), inkB = inkOf(B.map);
  // OCAD's colour numbers against Mapper's priorities: the same table, top first
  const top = r.map.colors.slice().reverse(), byNum = new Map(top.map((c, i) => [c.id, i]));
  const ink = compareInk(inkA, inkB, (id) => byNum.get(id) ?? id);
  const bd = dev(r.map.bounds(), B.map.bounds());
  totals.c.push([name, !s.countBad.length]);
  console.log(`(c) ${name} (OCAD ${r.version}): symbols with objects ${SA.syms.size}: counts ok ${s.countOk}, bounds ok ${s.bOk} (text dev ${s.textDev.toFixed(3)}); map bounds dev ${bd.toFixed(3)};`
    + ` ink dev ${ink.worst.toFixed(3)} mm (colour ${ink.which})${ink.miss.length ? ` ink only one side: ${ink.miss.slice(0, 6).join(",")}` : ""}; losses ${[...new Set(losses.map((l) => l.key.split(".").pop()))].join(",") || "none"}`);
  for (const l of [show("  count", s.countBad), show("  bounds", s.bBad)]) if (l) console.log(l);
}

for (const k of ["a", "b", "c"]) if (totals[k].length) console.log(`(${k}) ${totals[k].filter((x) => x[1]).length}/${totals[k].length} files with every count and bound within tolerance`);

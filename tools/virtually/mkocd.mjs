// An OCAD map from town_map.py's objects, with Cartographier's own modules (a blank document of the ISSprOM 2019-2 or ISOM 2017-2
// set at the map's scale, the objects added, written as OCAD 2018): the file the game draws and build.py reads.
//   node --import ../mapper/shim.mjs mkocd.mjs <objects.json> <out.ocd>      (from tools/virtually)
// objects.json: { title, scale, set, realWorld: { x, y, epsg }, objects: [{ sym, otp, ang?, rings: [[[x, y]…]…] (map mm, y up),
// text?, curve? }] } — an area's first ring is its outline, the others its holes; a line or a point has one ring; a line with
// `curve` is written as OCAD Bézier curves through its points (Catmull-Rom tangents: each segment's two handles a sixth of the
// way along its neighbours' chord; a closed line keeps its tangent across the join).
import { readFileSync, writeFileSync } from "node:fs";
import * as D from "../../site/assets/js/mapper/doc.js";
import { scaled } from "../../site/assets/js/mapper/layout.js";
import { writeOcadDoc } from "../../site/assets/js/mapper/ocadout.js";
import { areaCoords, ocad, bezier } from "../../site/assets/js/mapper/data/frame.js";

const [, , inFile, outFile] = process.argv;
const J = JSON.parse(readFileSync(inFile, "utf8"));
const set = JSON.parse(readFileSync(new URL(`../../site/assets/js/mapper/sets/${J.set}.json`, import.meta.url), "utf8"));
const doc = D.blank({ title: J.title, scale: J.scale, standard: set.standard || J.set, colors: set.colors,
  symbols: scaled(set, J.scale).map((s) => ({ ...s, set: J.set })) });
doc.realWorld = { x: J.realWorld.x, y: J.realWorld.y, angle: 0, grid: 0, paperGrid: 0, on: true, zone: 0, epsg: J.realWorld.epsg || 2154, gridScale: 1 };
// the symbols the town's map uses beyond the specification's — 501.6-501.9 (paved footprints), 532.1-532.6 (stairways at their
// width), 995 (boundary to confirm), 990 / 991 (OpenStreetMap, hidden) — are the set's own since 2026-11-12 (docs/mapper/sets.mjs),
// as Cartographier's « Plan de ville » uses them (site/assets/js/mapper/data/town.js); the curves are frame.js's `bezier`
const have = new Set(doc.symbols.map((s) => s.sym));
const L = new D.Live(doc);
let n = 0, missing = {};
L.transact("town", () => {
  for (const o of J.objects) {
    if (!have.has(o.sym)) { missing[o.sym] = (missing[o.sym] || 0) + 1; continue; }
    let coords;
    if (o.otp === 3) coords = areaCoords(o.rings);
    else if (o.curve && o.otp === 2 && o.rings[0].length >= 3) coords = bezier(o.rings[0]);
    else coords = o.rings[0].map(([x, y]) => ocad(x, y));
    if (o.otp === 3 && coords.length < 4) continue;
    if (o.otp === 2 && coords.length < 2) continue;
    const rec = { sym: o.sym, otp: o.otp, ang: o.ang || 0, coords };
    if (o.text) rec.text = o.text;
    L.add(rec); n++;
  }
});
const bytes = writeOcadDoc(L.toJSON(), null, { version: 2018 });
writeFileSync(outFile, bytes);
console.log(outFile, n, "objects", bytes.length, "bytes", Object.keys(missing).length ? "missing symbols " + JSON.stringify(missing) : "");

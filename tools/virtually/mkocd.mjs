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
import { areaCoords, ocad } from "../../site/assets/js/mapper/data/frame.js";

const [, , inFile, outFile] = process.argv;
const J = JSON.parse(readFileSync(inFile, "utf8"));
const set = JSON.parse(readFileSync(new URL(`../../site/assets/js/mapper/sets/${J.set}.json`, import.meta.url), "utf8"));
const doc = D.blank({ title: J.title, scale: J.scale, standard: set.standard || J.set, colors: set.colors,
  symbols: scaled(set, J.scale).map((s) => ({ ...s, set: J.set })) });
doc.realWorld = { x: J.realWorld.x, y: J.realWorld.y, angle: 0, grid: 0, paperGrid: 0, on: true, zone: 0, epsg: J.realWorld.epsg || 2154, gridScale: 1 };
// symbols the town's map adds to the set (tools/virtually/town_map.py): stairways at their width on the ground (532.1-532.6, the
// double line's width and its treads from the set's 532), a « boundary to confirm » (995: purple 50 %, for the mapper to replace
// by a wall, a fence or a hedge; the race's map does not draw 900 and up) and OpenStreetMap's objects (990 lines, 991 points: hidden)
const bySym = (n) => doc.symbols.find((s) => s.sym === n);
const clone = (s) => JSON.parse(JSON.stringify(s));
const purple50 = (set.colors.find((c) => /purple 50/i.test(c.name)) || {}).num ?? 27;
const st = bySym(532000);
if (st) [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].forEach((w, i) => {
  const s = clone(st); s.sym = 532001 + i; s.description = `Stairway ${w} mm`;
  const half = (s.dblWidth || 156) / 2, tick = Math.abs(s.prim?.[0]?.coords?.[0]?.y || 21248) / 256 - half;
  s.dblWidth = Math.round(w * 100);
  for (const p of s.prim || []) p.coords = p.coords.map((c) => ({ x: c.x, y: Math.sign(c.y) * Math.round((w * 50 + tick) * 256) }));
  doc.symbols.push(s);
});
// paved area as a line, « footprint » 1.4 / 2 / 3 / 4 m (OpenOrienteering Mapper's 501.6-501.9): a paved footway — brown 30 %
// between two thin black edges, at its width on the ground
const fp = bySym(505000), brown30 = (set.colors.find((c) => /brown 30/i.test(c.name)) || {}).num ?? 15;
if (fp) [1.4, 2, 3, 4].forEach((m, i) => {
  const s = clone(fp), w = m * 1000 / J.scale;
  Object.assign(s, { sym: 501006 + i, description: `Paved area, footprint ${m} m`, dblMode: 1, dblFlags: 1, dblFillColor: brown30, dblLeftColor: 25,
    dblRightColor: 25, dblWidth: Math.round(w * 100), dblLeftWidth: 10, dblRightWidth: 10, dblLength: 0, dblGap: 0, note: undefined });
  doc.symbols.push(s);
});
const ln = bySym(528000);
if (ln) {
  const line = (sym, desc, color, width, status) => {
    const s = clone(ln); Object.assign(s, { sym, description: desc, lineColor: color, lineWidth: width, mainLength: 0, nPrimSym: 0, prim: [], primDSize: 0, status });
    doc.symbols.push(s);
  };
  line(995000, "Boundary to confirm (wall, fence or hedge)", purple50, 25, 0);
  line(990000, "OpenStreetMap (hidden)", purple50, 10, 2);
}
const pt = bySym(418000);
if (pt) {
  const s = clone(pt); Object.assign(s, { sym: 991000, description: "OpenStreetMap point (hidden)", status: 2 });
  s.elts = s.elts.map((e) => ({ ...e, color: purple50, diameter: 30, lineWidth: 10 }));
  doc.symbols.push(s);
}
const have = new Set(doc.symbols.map((s) => s.sym));
/** A polyline's points as OCAD Bézier curves: point, handle (x flag 1), handle (x flag 2), point… */
function bezier(pts) {
  const n = pts.length, closed = pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1];
  const P = (i) => closed ? pts[((i % (n - 1)) + (n - 1)) % (n - 1)] : pts[Math.max(0, Math.min(n - 1, i))];
  const out = [ocad(pts[0][0], pts[0][1])];
  for (let i = 0; i < n - 1; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    out.push(ocad(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, 1), ocad(c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, 2), ocad(pts[i + 1][0], pts[i + 1][1]));
  }
  return out;
}
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

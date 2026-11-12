// A town's sprint map from open data (mapper/data/town.js) for Gif-sur-Yvette's centre (BD TOPO, the cadastre and OpenStreetMap,
// live; the answers kept in a cache file so that a second run reads no service), written as an OCAD file to compare with
// tools/virtually's map.
//   node --import ./tools/mapper/shim.mjs tools/mapper/t_town.mjs [out.ocd] [cache.json] [lat lon half-side-m]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import vm from "node:vm";
vm.runInThisContext(readFileSync(new URL("../../site/assets/vendor/jsts@2.12.1/dist/jsts.min.js", import.meta.url), "utf8"));
const { makeFrame, toL93, L93_DEF } = await import("../../site/assets/js/mapper/data/frame.js");
const T = await import("../../site/assets/js/mapper/data/town.js");
const D = await import("../../site/assets/js/mapper/doc.js");
const { scaled } = await import("../../site/assets/js/mapper/layout.js");
const { writeOcadDoc } = await import("../../site/assets/js/mapper/ocadout.js");

const [, , outFile, cacheFile, la = "48.7006", lo = "2.1357", halfM = "300"] = process.argv;
const scale = 4000, [x, y] = toL93(Number(la), Number(lo));
const doc0 = { scale, realWorld: { x, y, angle: 0, on: true, epsg: 2154 } };
const frame = makeFrame(doc0, { def: L93_DEF, epsg: 2154, name: "Lambert 93" });
const half = (Number(halfM) * 1000) / scale, rect = [-half, -half, half, half];
let data = null;
if (cacheFile && existsSync(cacheFile)) data = JSON.parse(readFileSync(cacheFile, "utf8"));
else {
  const k = scale / 1000, m = 30 / k;
  const t0 = Date.now();
  data = await T.fetchSources(frame, [rect[0] - m, rect[1] - m, rect[2] + m, rect[3] + m], { bdtopo: true, osm: true, cadastre: true, headers: { "User-Agent": (await import("../../site/assets/js/mapper/data/osm.js")).UA } }, (key, v) => process.stdout.write(`${key} ${v.layer || ""}\n`));
  console.log("fetched in", Date.now() - t0, "ms; failed", data.failed);
  if (cacheFile) writeFileSync(cacheFile, JSON.stringify(data));
}
const t1 = Date.now();
const r = await T.loadTown(frame, rect, { data, contours: process.env.CONTOURS ? { interval: 2.5 } : null, onStage: (key) => process.stdout.write(`  ${key} ${Date.now() - t1} ms\n`),
  onLap: (n) => process.stdout.write(`    · ${n} ${Date.now() - t1} ms\n`) });
console.log("built in", Date.now() - t1, "ms", r.objects.length, "objects", JSON.stringify(r.counts), r.stats, r.failed, r.used);
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(r.objects.map((o) => ({ sym: o.sym, otp: o.otp, pts: o.coords.filter((c) => !(c.x & 3)).map((c) => [(c.x >> 8) / 100, (c.y >> 8) / 100, c.y & 2 ? 1 : 0]) }))));
if (outFile) {
  const set = JSON.parse(readFileSync(new URL("../../site/assets/js/mapper/sets/issprom2019-2.json", import.meta.url), "utf8"));
  const doc = D.blank({ title: "town test", scale, standard: set.standard, colors: set.colors, symbols: scaled(set, scale).map((s) => ({ ...s, set: "issprom2019-2" })) });
  doc.realWorld = { ...doc0.realWorld, grid: 0, paperGrid: 0, zone: 0, gridScale: 1 };
  const L = new D.Live(doc), have = new Set(doc.symbols.map((s) => s.sym)), missing = {};
  L.transact("town", () => { for (const o of r.objects) { if (!have.has(o.sym)) { missing[o.sym] = (missing[o.sym] || 0) + 1; continue; } L.add({ col: 0, lineWidth: 0, diamFlags: 0, ...o }); } });
  writeFileSync(outFile, writeOcadDoc(L.toJSON(), null, { version: 2018 }));
  console.log("wrote", outFile, Object.keys(missing).length ? `missing ${JSON.stringify(missing)}` : "");
}

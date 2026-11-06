// Cartographier's LiDAR vectors outside France: each tile placed by its own grid (data/lidar.js toMm) in a map gridded as
// Cartographier makes it there (LV95, NAD83 / UTM, NZTM2000). Needs the tiles mapgen made locally (argument: their folder,
// <dir>/<cc>/out/t/<id>.forest.vec.json; skipped without it). A 1 km tile at 1:10 000 is 100 mm: the objects must fill it.
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
globalThis.window ??= globalThis;
vm.runInThisContext(fs.readFileSync(`${ROOT}site/assets/vendor/proj4@2.12.1/dist/proj4.js`, "utf8"));
const L = await import("../../site/assets/js/mapper/data/lidar.js");
const { makeFrame } = await import("../../site/assets/js/mapper/data/frame.js");
const LM = await import("../../site/assets/js/trace/lidarmap.js");
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.log("(no tiles folder: skipped)"); process.exit(0); }
const tab = JSON.parse(fs.readFileSync(`${ROOT}site/assets/tracer/crs.json`, "utf8"));
const cases = [["ch", "ch_2583_1219", 2056], ["us", "us_13_0475_4427", 26913], ["ca", "ca_18_0433_5038", 26918], ["nz", "nz_1571_5172", 2193], ["fr", "0391_6819", 2154]];
for (const [cc, id, epsg] of cases) {
  const file = `${dir}/${cc}/out/t/${id}.forest.vec.json`;
  if (!fs.existsSync(file)) { console.log(`(${id}: no file)`); continue; }
  const vec = JSON.parse(fs.readFileSync(file, "utf8"));
  const g = L.gridOfTile(id), [x0, y1] = g.corner(id), [lat, lon] = g.inv(x0 + 500, y1 - 500);
  const def = tab.epsg[String(epsg)] || (epsg === 2154 ? "" : null);
  const [X, Y] = epsg === 2154 ? [x0 + 500, y1 - 500] : window.proj4("WGS84", def, [lon, lat]);
  const doc = { scale: 10000, realWorld: { x: X, y: Y, angle: 0, gridScale: 1, epsg, on: true } };
  const frame = makeFrame(doc, epsg === 2154 ? { def: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m", epsg, name: "Lambert 93" } : { def, epsg, name: `EPSG:${epsg}` }, window.proj4);
  const t0 = Date.now(), r = L.vectorObjects([vec], frame), ms = Date.now() - t0;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of r.objects) for (const c of o.coords) { const x = (c.x >> 8) / 100, y = (c.y >> 8) / 100; box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  ok(r.objects.length > 0 && box.every((v) => Math.abs(v) < 53) && box[2] - box[0] > 90 && box[3] - box[1] > 90,
    `${id}: ${r.objects.length} objects in ${ms} ms (${r.dense} cliff strokes thinned out) over ${box.map((v) => v.toFixed(1)).join(", ")} mm · ${LM.CREDITS[g.country].text}`);
}

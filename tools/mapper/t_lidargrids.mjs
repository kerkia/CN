// The generated maps' grids in the browser (site/assets/js/trace/lidarmap.js) against mapgen/grids.py (pyproj), 2026-11-06:
// the countries told apart, the projections, the tile ids, the world files.
//   node tools/mapper/t_lidargrids.mjs
// The expected numbers come from `py -3 -m mapgen.grids` / pyproj (EPSG:2056, 32613, 32618, 2193, 32632).
import { countryAt, covered, tileIdsFor, gridOf, gridOfName, creditOf } from "../../site/assets/js/trace/lidarmap.js";
import { projector } from "../../site/assets/js/trace/georef.js";

let bad = 0;
const check = (what, ok, more = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${what}${more ? `  ${more}` : ""}`); };

// which country
for (const [lat, lon, cc] of [[47.13, 7.22, "ch"], [46.2, 6.1, "ch"], [46.19, 6.25, "fr"], [46.95, 7.45, "ch"], [47.556, 7.59, "ch"], [48.39, -1.17, "fr"],
  [41.9, 9.0, "fr"], [40.0, -105.29, "us"], [45.5, -75.85, "ca"], [45.3, -73.6, "ca"], [44.9, -73.4, "us"], [49.5, -123.1, "ca"],
  [48.5, -122.5, "us"], [61.2, -149.9, "us"], [-43.6, 172.65, "nz"], [-36.85, 174.76, "nz"], [51.5, -0.1, null], [47.5, 10.5, null]]) {
  check(`countryAt(${lat}, ${lon})`, countryAt(lat, lon) === cc, `${countryAt(lat, lon)}`);
}
check("covered", covered(40, -105.29) && !covered(51.5, -0.1));

// projections against pyproj (m)
const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
for (const [cc, zone, lat, lon, ref, tol] of [["ch", null, 47.13, 7.22, [2583412.12, 1219914.04], 1.5], ["ch", null, 46.2, 6.1, [2496673.76, 1117388.06], 1.5],
  ["us", 13, 40.0, -105.29, [475245.67, 4427797.49], 0.05], ["ca", 18, 45.5, -75.85, [433592.26, 5038847.86], 0.05],
  ["nz", null, -43.6, 172.65, [1571751.22, 5172493.22], 0.05], ["nz", null, -36.85, 174.76, [1756911.94, 5920321.82], 0.05]]) {
  const g = gridOf(cc, zone), xy = g.fwd(lat, lon), back = g.inv(...xy);
  check(`${cc} forward ${lat}, ${lon}`, near(xy, ref, tol), xy.map((v) => v.toFixed(2)).join(", "));
  check(`${cc} inverse`, Math.abs(back[0] - lat) < 1e-7 && Math.abs(back[1] - lon) < 1e-7, back.map((v) => v.toFixed(7)).join(", "));
}

// tile ids (mapgen.grids.ids_for, margin 150)
const want = {
  ch: [[[47.13, 7.22], [47.14, 7.235]], ["ch_2583_1221", "ch_2584_1221", "ch_2583_1220", "ch_2584_1220", "ch_2583_1219", "ch_2584_1219"]],
  us: [[[40.0, -105.29], [40.012, -105.27]], ["us_13_0475_4429", "us_13_0476_4429", "us_13_0477_4429", "us_13_0475_4428", "us_13_0476_4428", "us_13_0477_4428", "us_13_0475_4427", "us_13_0476_4427", "us_13_0477_4427"]],
  ca: [[[45.5, -75.85], [45.51, -75.83]], ["ca_18_0433_5040", "ca_18_0434_5040", "ca_18_0435_5040", "ca_18_0433_5039", "ca_18_0434_5039", "ca_18_0435_5039", "ca_18_0433_5038", "ca_18_0434_5038", "ca_18_0435_5038"]],
  nz: [[[-43.6, 172.65], [-43.59, 172.66]], ["nz_1571_5173", "nz_1572_5173", "nz_1571_5172", "nz_1572_5172"]],
  fr: [[[48.39, -1.17], [48.4, -1.15]], ["0391_6820", "0392_6820", "0393_6820", "0391_6819", "0392_6819", "0393_6819", "0391_6818", "0392_6818", "0393_6818"]],
};
for (const [cc, [pts, ids]] of Object.entries(want)) {
  const a = tileIdsFor(cc, pts, 150);
  check(`tileIdsFor ${cc}`, JSON.stringify(a.ids) === JSON.stringify(ids), a.ids.join(" "));
}
// a tile's corner and the tile holding a point agree
for (const id of ["ch_2583_1219", "us_13_0475_4427", "nz_1571_5172", "0391_6819"]) {
  const g = gridOfName(`ozimut-lidar-${id}.png`), [x0, y1] = g.corner(id);
  check(`corner/idAt ${id}`, g.idAt(x0 + 500, y1 - 500) === id, `${x0}, ${y1}`);
}
check("creditOf", creditOf("ozimut-lidar-sprint-nz_1571_5172.png").text.startsWith("LINZ") && creditOf("ozimut-lidar-0391_6819.png").text.startsWith("IGN"));

// Switzerland's world file in UTM 32: every pixel of a 4 × 3 km map within a few centimetres of LV95 → lat/lon → UTM 32
// (the LV95 formulas themselves are swisstopo's approximate ones, ~1 m against pyproj: checked above)
{
  const g = gridOf("ch"), px = 0.4233333333333334, W = 9450, H = 7090, wf = [px, 0, 0, -px, 2582000 + px / 2, 1222000 - px / 2];
  const fw = g.fileWf(wf, W, H), utm = { kind: "tm", lon0: 9, k0: 0.9996, lat0: 0, fe: 500000, fn: 0 }, inv = projector(utm);
  let worst = 0;
  for (const [i, j] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W / 2, H / 3], [W / 5, H / 2]]) {
    const X = fw[0] * i + fw[2] * j + fw[4], Y = fw[1] * i + fw[3] * j + fw[5];
    const [lat, lon] = inv(X, Y), [E, Nn] = g.fwd(lat, lon);
    worst = Math.max(worst, Math.hypot(E - (wf[0] * i + wf[4]), Nn - (wf[3] * j + wf[5])));
  }
  check("Switzerland's UTM 32 world file", worst < 0.1, `worst ${worst.toFixed(3)} m; rotation ${(Math.atan2(fw[1], fw[0]) * 180 / Math.PI).toFixed(3)}°`);
}

console.log(bad ? `${bad} failed` : "all passed");
process.exit(bad ? 1 : 0);

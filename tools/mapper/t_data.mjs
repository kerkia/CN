// Cartographier's open data (site/assets/js/mapper/data/): node --import ./tools/mapper/shim.mjs tools/mapper/t_data.mjs
// - frame: map mm ↔ grid ↔ lat/lon (Lambert 93 without proj4js; UTM and a turned grid with it);
// - contours: a cone, a saddle, a pit, small knolls; closed rings, index lines, form lines;
// - OpenStreetMap: a saved Overpass answer round Fougères' old town (site/data/_trtest/mapper/osm-fougeres.json, git-ignored;
//   fetched once when missing — one query), classified in both styles;
// - LiDAR: a hand-made DXF through mapgen/dxf.py, and karttapullautin's real output when kept (lidar-<tile>.forest.vec.json).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { makeFrame, frameOf, gridDef, toL93, fromL93, mmX, mmY, clipRing, ringArea } from "../../site/assets/js/mapper/data/frame.js";
import { isolines, contourObjects, SYM } from "../../site/assets/js/mapper/data/contours.js";
import { toObjects, overpassQuery, OVERPASS, UA, band } from "../../site/assets/js/mapper/data/osm.js";
import { decode, joinLines, cliffLines, vectorObjects, backgrounds, kpRows, variantOf, HELP_SYM } from "../../site/assets/js/mapper/data/lidar.js";

const ROOT = new URL("../../", import.meta.url), TR = new URL("site/data/_trtest/mapper/", ROOT);
mkdirSync(TR, { recursive: true });
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const proj4 = createRequire(import.meta.url)(new URL("site/assets/vendor/proj4@2.12.1/dist/proj4.js", ROOT).pathname.replace(/^\/([A-Z]:)/, "$1"));
const table = JSON.parse(readFileSync(new URL("site/assets/tracer/crs.json", ROOT), "utf8"));

// ---- frame -------------------------------------------------------------------------------------------------------------
const [FX, FY] = toL93(48.352, -1.204);
ok(near(FX, 388697.27, 0.05) && near(FY, 6814032.19, 0.05), `Lambert 93 forward as proj4 (${FX.toFixed(2)}, ${FY.toFixed(2)})`);
const back = fromL93(FX, FY);
ok(near(back[0], 48.352, 1e-8) && near(back[1], -1.204, 1e-8), "Lambert 93 both ways");
const docL93 = (scale) => ({ scale, realWorld: { x: FX, y: FY, angle: 0, epsg: 2154 } });
{
  const f = makeFrame(docL93(10000), gridDef(docL93(10000).realWorld, table), null);
  const [la, lo] = f.toLatLon(0, 0), [x, y] = f.fromLatLon(la, lo), [X] = f.toReal(10, 0);
  ok(f.geo && f.epsg === 2154 && near(la, 48.352, 1e-7) && near(x, 0, 1e-6) && near(y, 0, 1e-6) && near(X - FX, 100, 1e-6), "L93 frame: origin and 10 mm = 100 m at 1:10 000");
  const f2 = makeFrame({ scale: 10000, realWorld: { x: FX, y: FY, angle: 2.5 } }, null, null);  // no grid named: the numbers say Lambert 93
  const [la2, lo2] = f2.toLatLon(40, -30), [x2, y2] = f2.fromLatLon(la2, lo2);
  ok(f2.geo && near(x2, 40, 1e-5) && near(y2, -30, 1e-5), "a turned grid without a name: Lambert 93 guessed, both ways");
  const a = f.areaLatLon([-25, -25, 25, 25]), d = (f.toLatLon(0, 25)[0] - f.toLatLon(0, -25)[0]) * 111200;
  // the grid's north is 3° off true north at 1.2° W (the meridians converge): the corners reach 13 m further each way
  ok(a.s < 48.352 && a.n > 48.352 && a.w < -1.204 && a.e > -1.204 && near(d, 500, 2) && near((a.n - a.s) * 111200, 526, 3),
    `a 50 mm square at 1:10 000: ${d.toFixed(1)} m north to south through its middle, ${((a.n - a.s) * 111200).toFixed(1)} m in latitude`);
}
{
  const [E, N] = proj4("WGS84", table.epsg["32630"], [-1.204, 48.352]);
  const doc = { scale: 15000, realWorld: { x: E, y: N, angle: -1.7, epsg: 32630 } };
  const f = await frameOf(doc, { table, proj4 });
  const [la, lo] = f.toLatLon(12, 34), [x, y] = f.fromLatLon(la, lo), [la0, lo0] = f.toLatLon(0, 0);
  ok(f.geo && /UTM|EPSG/.test(f.name) && near(la0, 48.352, 1e-7) && near(lo0, -1.204, 1e-7) && near(x, 12, 1e-5) && near(y, 34, 1e-5), `UTM 30N by proj4 (${f.name}), turned, both ways`);
  const [lx, ly] = f.fromL93mm(FX, FY);
  ok(near(lx, 0, 0.01) && near(ly, 0, 0.01), "Lambert 93 metres into a UTM map's mm");
}
{
  const f = makeFrame({ scale: 10000, realWorld: { x: 0, y: 0 } }, null, null);
  ok(!f.geo, "a map without georeference: no lat/lon");
}

// ---- contours ------------------------------------------------------------------------------------------------------------
{
  const nx = 201, ny = 201, z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 200 - 0.5 * Math.hypot(i - 100, j - 100);   // a cone, 0.5 m a node
  const iso = isolines(z, nx, ny, 5);
  const loops = iso.filter((l) => l.closed);
  ok(loops.length >= 9 && loops.every((l) => l.pts[0][0] === l.pts[l.pts.length - 1][0] && l.pts[0][1] === l.pts[l.pts.length - 1][1]),
    `cone: the rings above the grid's edge closed (${loops.length}), each ending where it starts`);
  const r = contourObjects({ z, nx, ny, x0: 0, y0: 100, step: 0.5 }, { interval: 5, scale: 10000 });
  // levels 130…195 inside (closed: 135…195 = 13 + the ones cut by the edge); index every 25 m: 150, 175
  const idx = r.objects.filter((o) => o.sym === SYM.index);
  ok(idx.length >= 2 && r.counts.contour > 10, `cone: ${r.counts.contour} contours, ${r.counts.index} index`);
  const lvl = (o) => { const x = mmX(o.coords[0]), y = mmY(o.coords[0]); return 200 - 0.5 * Math.hypot(x / 0.5 - 100, (100 - y) / 0.5 - 100); };
  ok(idx.every((o) => [150, 175].some((L) => near(lvl(o), L, 0.6))), "index contours at 150 and 175 m");
  ok(r.objects.every((o) => o.src === "dem" && o.draft && (o.otp === 2 ? o.coords.length >= 2 : o.otp === 1 && o.coords.length === 1)), "objects tagged src dem, draft");
  ok(r.counts.knoll === 1, `the cone's top a knoll point (${r.counts.knoll})`);
  const ring = r.objects.find((o) => o.sym === SYM.contour && o.coords[0].x === o.coords[o.coords.length - 1].x && o.coords[0].y === o.coords[o.coords.length - 1].y);
  ok(!!ring, "a closed contour repeats its first point");
  const pts = r.objects[0].coords.length;
  ok(pts < 150, `simplified: ${pts} points on the first line`);
}
{
  // a saddle z = x² − y²: lines never closed, the saddle level cut consistently (four branches)
  const nx = 81, ny = 81, z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i - 40) / 4, y = (j - 40) / 4; z[j * nx + i] = 100 + x * x - y * y; }
  const iso = isolines(z, nx, ny, 5);
  ok(iso.length > 0 && iso.every((l) => !l.closed), `saddle: ${iso.length} open lines, none closed`);
  const at100 = iso.filter((l) => l.level === 100);
  ok(at100.length >= 2 && at100.length <= 4, `saddle: the saddle level in ${at100.length} pieces`);
  // the higher ground on each line's right, in the grid's frame (y down)
  let right = 0, all = 0;
  for (const l of iso) for (let k = 0; k + 1 < l.pts.length; k += 7) {
    const [x0, y0] = l.pts[k], [x1, y1] = l.pts[k + 1], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (!L) continue;
    const px = (x0 + x1) / 2 - dy / L * 0.5, py = (y0 + y1) / 2 + dx / L * 0.5;          // half a node to the right (y down)
    const h = 100 + ((px - 40) / 4) ** 2 - ((py - 40) / 4) ** 2;
    all++; if (h > l.level) right++;
  }
  ok(right / all > 0.95, `saddle: higher ground on the right ${right}/${all}`);
}
{
  // small knolls and a pit on gentle ground: points, and form lines where it is flat
  const nx = 301, ny = 301, z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let h = 100 + 0.02 * i;                                                           // 2 % slope: 2 m across 100 m
    h += 1.6 * Math.exp(-((i - 80) ** 2 + (j - 80) ** 2) / 18);                          // a small knoll
    h += 1.5 * Math.exp(-((i - 200) ** 2 + (j - 150) ** 2) / 14);                        // another
    h -= 2.2 * Math.exp(-((i - 150) ** 2 + (j - 240) ** 2) / 14);                        // a pit
    h += 0.1 * Math.exp(-((i - 250) ** 2 + (j - 50) ** 2) / 4);                          // noise
    z[j * nx + i] = h;
  }
  // 1 m nodes at 1:10 000: 0.1 mm a node
  const r = contourObjects({ z, nx, ny, x0: 0, y0: 30, step: 0.1 }, { interval: 2.5, scale: 10000, formLines: true });
  ok(r.counts.knoll === 2 && r.counts.depression === 1, `small loops as points: ${r.counts.knoll} knolls (109), ${r.counts.depression} depression (111)`);
  ok(r.objects.filter((o) => o.otp === 1).every((o) => o.coords.length === 1 && [109000, 111000].includes(o.sym)), "points have one coordinate");
  ok(r.counts.form > 0, `form lines on gentle ground: ${r.counts.form}`);
}

// ---- OpenStreetMap -------------------------------------------------------------------------------------------------------
{
  const file = new URL("osm-fougeres.json", TR);
  if (!existsSync(file)) {
    const box = { s: 48.352 - 0.00225, n: 48.352 + 0.00225, w: -1.204 - 0.0034, e: -1.204 + 0.0034 };
    const r = await fetch(OVERPASS[0], { method: "POST", body: new URLSearchParams({ data: overpassQuery(box) }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA } });
    writeFileSync(file, await r.text());
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const [style, scale] of [["forest", 10000], ["sprint", 4000]]) {
    const doc = docL93(scale), f = makeFrame(doc, gridDef(doc.realWorld, table), null), half = (250 * 1000) / scale;
    const rect = [-half, -half, half, half];
    const r = toObjects(data, f, style, rect);
    const by = Object.entries(r.counts).sort((a, b) => a[0] - b[0]).map(([s, n]) => `${Math.floor(s / 1000)}.${s % 1000}:${n}`).join(" ");
    console.log(`     ${style}: ${data.elements.length} elements, ${r.features} features, ${r.objects.length} objects — ${by}`);
    const closed = r.objects.filter((o) => o.otp === 3).every((o) => { const rings = splitRings(o.coords); return rings.every((q) => q.length >= 4 && q[0].x === q[q.length - 1].x && q[0].y === q[q.length - 1].y); });
    ok(closed, `${style}: every area's rings closed`);
    ok(r.objects.every((o) => o.src === "osm" && o.draft && /^(way|relation)\/\d+$/.test(o.srcId)), `${style}: src osm, srcId, draft`);
    ok(r.objects.every((o) => o.coords.every((c) => mmX(c) >= rect[0] - 0.01 && mmX(c) <= rect[2] + 0.01 && mmY(c) >= rect[1] - 0.01 && mmY(c) <= rect[3] + 0.01)), `${style}: clipped to the area`);
    ok((r.counts[521000] || 0) > 100, `${style}: buildings ${r.counts[521000] || 0}`);
    if (style === "forest") ok((r.counts[503000] || 0) + (r.counts[502000] || 0) > 10 && !r.counts[532000], "forest: roads as lines, no stairways");
    else ok((r.counts[501000] || 0) > 50 && !r.counts[503000] && !r.counts[502000], "sprint: streets as paved areas, no road lines");
    const holes = r.objects.filter((o) => o.coords.some((c) => (c.y & 255) === 2));
    console.log(`     ${style}: ${holes.length} areas with holes`);
  }
  const b = band([[0, 0], [10, 0], [10, 10]], 1);
  ok(b.length === 1 && near(Math.abs(ringArea(b[0])), 40 + Math.PI * 0.5 + 0.8, 1.5), `a band of width 2 round an L: area ${Math.abs(ringArea(b[0])).toFixed(1)} mm²`);
  ok(clipRing([[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], [0, 0, 10, 10]).length === 5, "a ring clipped to a corner");
}
function splitRings(coords) {
  const out = [];
  for (const c of coords) { if (!out.length || (c.y & 255) === 2) out.push([]); out[out.length - 1].push(c); }
  return out;
}

// ---- LiDAR ---------------------------------------------------------------------------------------------------------------
{
  // a hand-made DXF: two contour pieces across a tile's east edge, an index contour, cliff strokes, knolls
  const dxfLines = ["0", "SECTION", "2", "ENTITIES"];
  const poly = (layer, z, pts) => { dxfLines.push("0", "POLYLINE", "66", "1", "8", layer, ...(z != null ? ["38", String(z)] : [])); for (const [x, y] of pts) dxfLines.push("0", "VERTEX", "8", layer, "10", String(x), "20", String(y)); dxfLines.push("0", "SEQEND"); };
  poly("contour", 130, [[391800, 6818500], [391900, 6818520], [392000, 6818540], [392100, 6818560]]);       // runs 100 m into the next tile
  poly("contour_index", 150, [[391100, 6818100], [391200, 6818120]]);
  poly("contour_intermed", 132.5, [[391100, 6818200], [391200, 6818220]]);                                 // left out
  for (let k = 0; k < 6; k++) poly("cliff3", null, [[391300 + 2 * k, 6818300 + 0.2 * k], [391302.9 + 2 * k, 6818300.2 + 0.2 * k]]);
  poly("cliff2", null, [[391500, 6818500], [391502.9, 6818500]]);
  for (const [l, x, y] of [["dotknoll", 391400, 6818400], ["udepression", 391410, 6818420], ["dotknoll", 392000, 6818400]]) dxfLines.push("0", "POINT", "8", l, "10", String(x), "20", String(y), "30", "0");
  dxfLines.push("0", "ENDSEC", "0", "EOF");
  const dir = new URL("dxf/", TR); mkdirSync(dir, { recursive: true });
  // one drawing under each of karttapullautin's names: dxf.py keeps each file's own layers only
  for (const name of ["contours", "formlines", "c2g", "c3g", "dotknolls"]) writeFileSync(new URL(`LHD_0391_6819.copc_${name}.dxf`, dir), dxfLines.join("\n"));
  const py = spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "mapgen.dxf", fileOf(dir), "0391_6819", fileOf(new URL("hand.vec.json", TR))], { cwd: fileOf(ROOT), encoding: "utf8" });
  ok(py.status === 0, `mapgen/dxf.py on a hand-made DXF: ${(py.stdout || py.stderr).trim()}`);
  const vec = JSON.parse(readFileSync(new URL("hand.vec.json", TR), "utf8"));
  const d = decode(vec);
  ok(d.lines.find((l) => l.layer === "contour")?.pts.at(-1)[0] === 392000 && !d.lines.some((l) => l.layer === "contour_intermed"), "cut at the tile's east edge; intermediate contours left out");
  ok(d.points.length === 2 && !d.points.some((p) => p.X === 392000), "points on the east edge belong to the next tile");
  ok(d.lines.filter((l) => l.layer === "cliff3").length === 6, "six cliff strokes kept");
  // the next tile's half of the contour, joined back
  const next = { lines: [{ layer: "contour", z: 130, pts: [[392000, 6818540], [392100, 6818560]] }] };
  const joined = joinLines([...d.lines.filter((l) => l.layer === "contour"), ...next.lines]);
  ok(joined.length === 1 && joined[0].pts.length === 4, `contour pieces joined across tiles (${joined.length}, ${joined[0].pts.length} points)`);
  const cl = cliffLines(d.lines.filter((l) => l.layer === "cliff3").map((l) => l.pts));
  ok(cl.length === 1 && near(cl[0][0][0], 391300, 0.2) && near(cl[0].at(-1)[0], 391312.9, 0.2), `six strokes, one cliff line from ${cl[0][0][0].toFixed(1)} to ${cl[0].at(-1)[0].toFixed(1)}`);
  const doc = { scale: 10000, realWorld: { x: 391500, y: 6818500, angle: 0, epsg: 2154 } }, f = makeFrame(doc, gridDef(doc.realWorld, table), null);
  const r = vectorObjects([vec], f);
  // karttapullautin's « cliff3 » (its steep spots, not cliffs) left out since 2026-11-12: no 201.0
  const want = { 101000: 1, 102000: 1, 202000: 1, 109000: 1, 111000: 1 };
  ok(Object.entries(want).every(([s, n]) => r.counts[s] === n) && !r.counts[201000], `hand-made tile → ${JSON.stringify(r.counts)}`);
  const k = r.objects.find((o) => o.sym === 109000);
  ok(near(mmX(k.coords[0]), -10, 0.01) && near(mmY(k.coords[0]), -10, 0.01) && k.src === "lidar" && k.draft, "a knoll at its place in map mm, src lidar");
  const bg = backgrounds([{ id: "0391_6819", record: { x0: 391000, y1: 6819000, vec: { forest: 1 } } }], "forest", f);
  ok(bg[0].url.endsWith("0391_6819.forest.vege.png?v=1") && near(bg[0].cornersMm[0][0], -50, 1e-6) && near(bg[0].cornersMm[2][1], -50, 1e-6), "the vegetation background: its address and corners in map mm");
  // the helper contours (karttapullautin's « basemap » layer « cont », 2026-11-12) and the variants
  const help = vectorObjects([{ id: "0391_6819", x0: 391000, y0: 6818000, q: 0.1, lines: { cont: [[null, 4000, 4000, 1000, 0, 1000, 500]] }, points: {} }], f);
  ok(help.objects.length === 1 && help.objects[0].sym === HELP_SYM && help.objects[0].src === "lidar-help", `helper contour → ${HELP_SYM}, src lidar-help`);
  ok(variantOf("sprint", 2.5) === "sprint" && variantOf("sprint", 2) === "sprint-20" && variantOf("forest", 2.5) === "forest-25" && variantOf("forest", null) === "forest", "variants by contour interval");
  const kv = Object.fromEntries(kpRows("sprint", 2)); const kf = Object.fromEntries(kpRows("forest", 2.5));
  ok(kv.contour_interval === "10" && kv.indexcontours === "10" && kv.basemapinterval === "0.5" && kf.contour_interval === "2.5" && kf.basemapinterval === "0.5"
    && Object.fromEntries(kpRows("forest"))["basemapinterval"] === "1", "karttapullautin's settings as mapgen/run.py kp_settings");
  const bgv = backgrounds([{ id: "0391_6819", record: { x0: 391000, y1: 6819000, v: { "sprint-20": 1 }, vec: {} } }], "sprint-20", f);
  ok(bgv[0].url.endsWith("0391_6819.sprint-20.png?v=1"), "a variant's image without vectors: its own file");
}
for (const id of ["0391_6819", "0392_6819"]) {
  const file = new URL(`lidar-${id}.forest.vec.json`, TR);
  if (!existsSync(file)) { console.log(`     (no ${id}: python -m mapgen.dxf <karttapullautin out> ${id} ${fileOf(file)})`); continue; }
}
{
  const files = ["0391_6819", "0392_6819"].map((id) => new URL(`lidar-${id}.forest.vec.json`, TR)).filter(existsSync);
  if (files.length) {
    const vecs = files.map((u) => JSON.parse(readFileSync(u, "utf8")));
    const doc = { scale: 10000, realWorld: { x: 391500, y: 6818500, angle: 0, epsg: 2154 } }, f = makeFrame(doc, gridDef(doc.realWorld, table), null);
    const t0 = performance.now(), r = vectorObjects(vecs, f), ms = Math.round(performance.now() - t0);
    const by = Object.entries(r.counts).map(([s, n]) => `${Math.floor(s / 1000)}.${s % 1000}:${n}`).join(" ");
    const raw = vecs.reduce((a, v) => a + Object.values(v.lines).reduce((b, l) => b + l.length, 0), 0);
    console.log(`     karttapullautin, ${files.length} tiles: ${raw} lines → ${r.objects.length} objects in ${ms} ms — ${by}`);
    ok(r.counts[101000] > 0 && r.counts[102000] > 0 && r.counts[103000] > 0 && r.counts[201000] > 0 && r.counts[109000] > 0, "real tiles: contours, index, form lines, cliffs, knolls");
  }
}
// --live: contours from IGN's elevation service for 300 m × 300 m of the Fougères forest (about 5 requests)
if (process.argv.includes("--live")) {
  const { loadContours } = await import("../../site/assets/js/mapper/data/contours.js");
  const [X, Y] = toL93(48.3895, -1.165);
  const doc = { scale: 10000, realWorld: { x: X, y: Y, angle: 0, epsg: 2154 } }, f = makeFrame(doc, gridDef(doc.realWorld, table), null);
  const t0 = performance.now(), r = await loadContours(f, [-15, -15, 15, 15], { interval: 5, formLines: true });
  console.log(`     IGN live: ${r.grid.nx} × ${r.grid.ny} nodes at ${r.grid.stepM} m, ${r.source}, ${Math.round(performance.now() - t0)} ms — ${JSON.stringify(r.counts)}`);
  ok(r.source.startsWith("ign") && r.counts.contour + r.counts.index > 0, "contours from IGN's model");
}
function fileOf(u) { return decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, "$1"); }

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);

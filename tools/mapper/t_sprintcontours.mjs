// Sprint contours (data/contours.js sprintObjects): node --import ./tools/mapper/shim.mjs tools/mapper/t_sprintcontours.mjs
import { contourObjects, cutLine, areaIndex } from "../../site/assets/js/mapper/data/contours.js";
import * as G from "../../site/assets/js/mapper/geom.js";
const ok = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok", m); };

// cutLine: a line across a square leaves two pieces ending on its edges
const sq = areaIndex([[[[10, -5], [20, -5], [20, 5], [10, 5]]]]);
const p = cutLine([[0, 0], [30, 0]], sq);
ok(p.length === 2 && Math.abs(p[0][1][0] - 10) < 1e-9 && Math.abs(p[1][0][0] - 20) < 1e-9, "cut exactly at a building's edges");

// a 1 km slope at 1:4000 (2 m grid = 0.5 mm), 6 % rising north, with 15 cm kerbs every 6 m (sidewalks) and a 0.4 m bump of 6 m across
const scale = 4000, stepM = 2, step = stepM * 1000 / scale, nx = 251, ny = 251, z = new Float64Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = i * stepM, y = (ny - 1 - j) * stepM;
  z[j * nx + i] = 100 + 0.06 * y + ((Math.floor(x / 6) % 2) ? 0.15 : 0) + 0.4 * Math.exp(-((x - 250) ** 2 + (y - 250) ** 2) / 18);
}
const grid = { z, nx, ny, x0: 0, y0: 0, step };
const raw = contourObjects(grid, { interval: 2.5, scale, curve: false });
// a building 60 × 40 m in the middle (map mm: x 0…125, y 0…-125)
const b = [[[50, -55], [65, -55], [65, -65], [50, -65]]];
const r = contourObjects(grid, { interval: 2.5, scale, curve: false, sprint: true, buildings: [b] });
console.log("raw", raw.counts, "sprint", r.counts);
ok(r.counts.knoll === 0 && r.counts.depression === 0 && r.counts.form === 0, "no points or form lines");
const lines = r.objects.map((o) => G.partsOf(o.coords)[0].pts.map(([x, y]) => [x, y]));
// every end on the grid's edge or on the building's outline
const W = (nx - 1) * step, H = (ny - 1) * step, eps = 0.05;
const onEdge = ([x, y]) => x < eps || x > W - eps || y > -eps || y < -H + eps;
const onB = ([x, y]) => (Math.abs(x - 50) < eps || Math.abs(x - 65) < eps) && y <= -55 + eps && y >= -65 - eps || (Math.abs(y + 55) < eps || Math.abs(y + 65) < eps) && x >= 50 - eps && x <= 65 + eps;
const ends = lines.flatMap((l) => [l[0], l[l.length - 1]]).filter((e) => !onEdge(e) && !onB(e));
ok(!ends.length, `every end on the map's edge or a building (${lines.length} lines, ${ends.length} loose)`);
ok(lines.some((l) => l.some(onB)), "some contours cut at the building");
// the kerbs' steps no longer make the lines zigzag: a contour's y spread small
const spread = Math.max(...lines.map((l) => { const ys = l.map((q) => q[1]); return Math.max(...ys) - Math.min(...ys); }));
ok(spread < 3, `kerbs smoothed out (largest y spread ${spread.toFixed(2)} mm)`);
const rawSpread = Math.max(...raw.objects.map((o) => { const ys = G.partsOf(o.coords)[0].pts.map((q) => q[1]); return Math.max(...ys) - Math.min(...ys); }));
ok(rawSpread > spread * 2, `the raw isolines zigzag more (${rawSpread.toFixed(2)} mm)`);

// the LiDAR import in a sprint map (data/lidar.js vectorObjects): no cliffs, no contours where the map has its own relief
const Lm = await import("../../site/assets/js/mapper/data/lidar.js");
const vec = { id: "0450_6800", x0: 450000, y0: 6799000, q: 0.1,
  lines: { contour: [[100, 0, 5000, 10000, 0]], cliff3: [[null, 2000, 2000, 20, 0], [null, 2025, 2000, 20, 0]] },
  points: { dotknoll: [3000, 3000, 5000, 0] } };
const frame = { scale: 4000, fromL93mm: (X, Y) => [(X - 450000) / 4, (Y - 6800000) / 4] };
const all = Lm.vectorObjects([vec], frame);
ok(all.objects.some((o) => Math.floor(o.sym / 1000) === 201), "forest: cliffs imported");
const covered = (x) => x > 100;                                    // the town plan's relief east of 400 m
const sp = Lm.vectorObjects([vec], frame, null, { cliffs: false, covered });
ok(!sp.objects.some((o) => Math.floor(o.sym / 1000) === 201), "sprint: no cliffs");
const c = sp.objects.filter((o) => o.sym === 101000).map((o) => G.partsOf(o.coords)[0].pts);
ok(c.length === 1 && Math.max(...c[0].map((q) => q[0])) <= 100.01, "sprint: contours only outside the town plan's relief");
ok(sp.objects.filter((o) => o.sym === 109000).length === 1, "sprint: a knoll outside it kept, one inside left out");

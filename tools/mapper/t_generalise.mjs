// The generalisation's steps on the Desquinemarre map, without the page (a stub editor).
import { readFileSync } from "node:fs";
import * as D from "../../site/assets/js/mapper/doc.js";
import * as GZ from "../../site/assets/js/mapper/generalise.js";
import { createRequire } from "node:module";
globalThis.window ??= { polygonClipping: createRequire(import.meta.url)("../../site/assets/vendor/polygon-clipping@0.15.7/dist/polygon-clipping.umd.min.js") };
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const live = new D.Live(D.fromOcad(new Uint8Array(readFileSync("C:/kerkia/Ozimut/work/Test files/deski 8 nov 26 F.ocd")), "d"));
const E = { live, get doc() { return live.doc; }, strip: (o) => { const r = { ...o }; for (const k of ["id", "inst", "bb", "cellKeys", "ord", "rawAt", "dirty", "e", "__rec"]) delete r[k]; return r; },
  view: { setLive() {}, fit() {} } };
let t0 = Date.now();
const dense = GZ.findDense(E, 0.1);
ok(dense.length > 0, `too many points: ${dense.length} objects, ${dense.reduce((s, x) => s + x.before - x.after, 0)} points to remove (${Date.now() - t0} ms)`);
t0 = Date.now(); const ov = GZ.findOverlaps(E); ok(true, `overlapping areas of one symbol: ${ov.length} groups (${Date.now() - t0} ms)`);
t0 = Date.now(); const cr = GZ.findCrowded(E, 0.6); ok(true, `crowded points: ${cr.length} (${Date.now() - t0} ms)`);
const n = live.doc.objects.length;
GZ.applyDense(E, dense, 0.1);
ok(GZ.findDense(E, 0.1).length < dense.length / 4, "simplified: few left to simplify");
let left = ov; for (let k = 0; k < 4 && left.length; k++) { await GZ.applyOverlaps(E, left); left = GZ.findOverlaps(E); }
ok(left.length === 0, `united (${n} → ${live.doc.objects.length} objects)`);
const b0 = live.bounds();
GZ.changeScale(E, 15000, true);
const b1 = live.bounds();
ok(Math.abs((b1[2] - b1[0]) / (b0[2] - b0[0]) - 10000 / 15000) < 0.02 && live.doc.scale === 15000, `1:10 000 → 1:15 000: extent ${(b0[2] - b0[0]).toFixed(1)} → ${(b1[2] - b1[0]).toFixed(1)} mm`);
live.undo(); ok(live.doc.scale === 10000, "undone");

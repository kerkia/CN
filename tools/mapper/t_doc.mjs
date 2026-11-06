import { readFileSync } from "node:fs";
import { fromOcad, Live } from "../../site/assets/js/mapper/doc.js";
import * as G from "../../site/assets/js/mapper/geom.js";
const f = process.argv[2];
let t0 = performance.now();
const doc = fromOcad(new Uint8Array(readFileSync(f)), "t");
const L = new Live(doc, { onChange: (c) => (L.last = c) });
console.log("load ms", Math.round(performance.now() - t0), "objs", doc.objects.length, "placed", doc.objects.filter((o) => o.inst).length, "bounds", L.bounds().map((v) => v.toFixed(1)).join(" "));
const b = L.bounds(), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
t0 = performance.now();
const hit = L.pick(cx, cy, 2);
console.log("pick", hit && hit.sym, hit && hit.otp, "ms", (performance.now() - t0).toFixed(1));
if (hit) {
  const n = doc.objects.length;
  L.transact("move", () => L.update(hit.id, { coords: hit.coords.map((c) => G.moved(c, 1, 1)) }));
  console.log("moved; box", L.last.box.map((v) => v.toFixed(1)).join(" "), "dirty", hit.dirty);
  L.transact("del", () => L.remove(hit.id));
  console.log("after delete", doc.objects.length === n - 1);
  L.undo(); L.undo();
  const back = L.object(hit.id);
  console.log("after 2 undo", doc.objects.length === n, back && back.coords[0].x === hit.coords[0].x ? "coords restored?" : "", L.canRedo);
}
const json = JSON.stringify(L.toJSON());
console.log("json MB", (json.length / 1e6).toFixed(2));

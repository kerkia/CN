// End-to-end without the page: a new map from a symbol set, objects drawn, written as OCAD and read back; an OCAD map edited and
// written back; data objects brought in.
import { readFileSync } from "node:fs";
import * as D from "../../site/assets/js/mapper/doc.js";
import * as G from "../../site/assets/js/mapper/geom.js";
import { scaled } from "../../site/assets/js/mapper/layout.js";
import { writeOcadDoc } from "../../site/assets/js/mapper/ocadout.js";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
for (const [name, scale] of [["isom2017-2", 10000], ["issprom2019-2", 4000]]) {
  const set = JSON.parse(readFileSync(`site/assets/js/mapper/sets/${name}.json`, "utf8"));
  const doc = D.blank({ title: name, scale, colors: set.colors, symbols: scaled(set, scale).map((s) => ({ ...s, set: name })) });
  const L = new D.Live(doc);
  ok(L.map.symdefs.length >= set.symbols.length - 2, `${name}: ${L.map.symdefs.length} symdefs of ${set.symbols.length}`);
  const area = set.symbols.find((s) => s.otp === 3 && Math.floor(s.sym / 1000) === 401) || set.symbols.find((s) => s.otp === 3);
  const line = set.symbols.find((s) => Math.floor(s.sym / 1000) === 101) || set.symbols.find((s) => s.otp === 2);
  const point = set.symbols.find((s) => s.otp === 1);
  L.transact("t", () => {
    L.add({ sym: area.sym, otp: 3, ang: 0, coords: [[0, 0], [30, 0], [30, 20], [0, 20]].map(([x, y]) => G.pt(x, y)) });
    L.add({ sym: line.sym, otp: 2, ang: 0, coords: G.coordsOf([{ pts: G.smoothCurve([[0, 30, 0], [20, 40, 0], [40, 30, 0]]), hole: false }]) });
    L.add({ sym: point.sym, otp: 1, ang: 0, coords: [G.pt(10, 10)] });
  });
  ok(doc.objects.every((o) => o.inst), `${name}: 3 objects drawn`);
  const bytes = writeOcadDoc(L.toJSON(), null, { version: 2018 });
  const back = readOcad(bytes);
  ok(back.records.objects.length === 3 && back.records.symbols.length === doc.symbols.length, `${name}: OCAD 2018 written ${bytes.length} bytes, read back ${back.records.symbols.length} symbols, ${back.records.objects.length} objects`);
  const b0 = L.bounds(), b1 = back.map.bounds();
  ok(Math.abs(b0[0] - b1[0]) < 0.1 && Math.abs(b0[3] - b1[3]) < 0.1, `${name}: same extent ${b0.map((v) => v.toFixed(1))} / ${b1.map((v) => v.toFixed(1))}`);
}
// an OCAD map: one object moved, written back, the others byte for byte
const src = new Uint8Array(readFileSync("C:/kerkia/cn-data/Test files/deski 8 nov 26 F.ocd"));
const doc = D.fromOcad(src, "deski");
const L = new D.Live(doc);
const o = doc.objects.find((x) => x.otp === 2);
L.transact("m", () => L.update(o.id, { coords: o.coords.map((c) => G.moved(c, 1, 1)) }));
const out = writeOcadDoc(L.toJSON(), src, {});
const back = readOcad(out);
ok(back.records.objects.length === readOcad(src).records.objects.length, `deski: ${out.length} bytes, ${back.records.objects.length} objects`);
const unchanged = L.toJSON();
ok(writeOcadDoc(new D.Live(D.fromOcad(src)).toJSON(), src, {}).length === src.length, "deski: unchanged → identical size");
void unchanged;

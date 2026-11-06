// The three-way merge of collab.js on a real map: two mappers' edits, then a conflict decided by the sector.
import { readFileSync } from "node:fs";
import * as D from "../../site/assets/js/mapper/doc.js";
import * as G from "../../site/assets/js/mapper/geom.js";
import { merge3 } from "../../site/assets/js/mapper/collab.js";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const src = new Uint8Array(readFileSync("C:/kerkia/cn-data/Test files/deski 8 nov 26 F.ocd"));
const base = new D.Live(D.fromOcad(src, "d")).toJSON();
const A = new D.Live(JSON.parse(JSON.stringify(base))), B = new D.Live(JSON.parse(JSON.stringify(base)));
const lines = A.doc.objects.filter((o) => o.otp === 2);
const o1 = lines[0], o2 = lines[1], o3 = lines[2];
const x1 = G.mmX(base.objects.find((o) => o.id === o1.id).coords[0]);
A.transact("a", () => { A.update(o1.id, { coords: o1.coords.map((c) => G.moved(c, 1, 0)) }); A.remove(o3.id); A.add({ sym: o1.sym, otp: 2, ang: 0, coords: [G.pt(0, 0), G.pt(5, 5)] }); });
B.transact("b", () => { B.update(o2.id, { coords: B.object(o2.id).coords.map((c) => G.moved(c, 0, 1)) }); B.add({ sym: o1.sym, otp: 2, ang: 0, coords: [G.pt(1, 0), G.pt(6, 5)] }); });
const theirs = B.toJSON(), mine = A.toJSON();
const { doc, conflicts } = merge3(base, mine, theirs);
const by = new Map(doc.objects.map((o) => [o.id, o]));
ok(doc.objects.length === base.objects.length - 1 + 2, `objects ${doc.objects.length} = ${base.objects.length} − 1 + 2`);
ok(G.mmX(by.get(o1.id).coords[0]) === x1 + 1, "mine moved");
ok(G.mmY(by.get(o2.id).coords[0]) === G.mmY(o2.coords[0]) + 1, "theirs moved");
ok(!by.has(o3.id), "mine deleted");
ok(conflicts.length === 0, "no conflict");
// both move o1: theirs wins outside my sector, mine inside
const C2 = new D.Live(JSON.parse(JSON.stringify(base)));
const y1 = G.mmY(base.objects.find((o) => o.id === o1.id).coords[0]);
C2.transact("c", () => C2.update(o1.id, { coords: C2.object(o1.id).coords.map((c) => G.moved(c, 0, 3)) }));
const r1 = merge3(base, mine, C2.toJSON());
ok(r1.conflicts.length === 1 && G.mmY(new Map(r1.doc.objects.map((o) => [o.id, o])).get(o1.id).coords[0]) === y1 + 3, "conflict: theirs kept outside my sector");
const r2 = merge3(base, mine, C2.toJSON(), { mySector: [-1e5, -1e5, 1e5, 1e5] });
ok(G.mmX(new Map(r2.doc.objects.map((o) => [o.id, o])).get(o1.id).coords[0]) === x1 + 1, "conflict: mine kept inside my sector");
// a sector guard refuses an edit there
const L = new D.Live(JSON.parse(JSON.stringify(base)));
L.guard = () => false; L.guardMsg = "locked";
let refused = false;
try { L.transact("x", () => L.update(o1.id, { coords: o1.coords })); } catch (e) { refused = e.code === "sector"; }
ok(refused, "an edit in another's sector refused");

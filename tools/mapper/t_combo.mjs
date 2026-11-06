// A Mapper map's combined objects (several OCAD objects for one Mapper object): moved, reshaped and deleted together.
import { readFileSync } from "node:fs";
import { omapToDoc } from "../../site/assets/js/mapper/fromomap.js";
import * as D from "../../site/assets/js/mapper/doc.js";
import * as G from "../../site/assets/js/mapper/geom.js";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
// The sample's combined symbols all become one OCAD record (an area with its border line): give the canopy (526.2: area 116 +
// line 117) a second line part and the passable water (305.1) a line-only form, so that the file makes real copies.
const xml = readFileSync("site/data/_trtest/omap/complete map.omap", "utf8")
  .replace('<combined_symbol parts="2"><part symbol="116"/><part symbol="117"/>', '<combined_symbol parts="3"><part symbol="116"/><part symbol="117"/><part symbol="5"/>')
  .replace('<combined_symbol parts="2"><part symbol="47"/><part symbol="46"/>', '<combined_symbol parts="2"><part symbol="5"/><part symbol="6"/>');
const doc = await omapToDoc(new TextEncoder().encode(xml));
const L = new D.Live(doc);
const groups = new Map();
for (const o of doc.objects) if (o.omap?.o != null) { const k = o.omap.o; groups.set(k, [...(groups.get(k) || []), o]); }
const multi = [...groups.values()].filter((g) => g.length > 1);
console.log("objects", doc.objects.length, "groups with copies", multi.length, "with omap", doc.objects.filter((o) => o.omap).length, JSON.stringify(doc.objects.find((o) => o.omap)?.omap));
const g = multi.find((x) => x.every((o) => o.omap.ring == null && (o.omap.piece || 0) === 0)) || multi[0];
const a = g[0], x0 = G.mmX(g[1].coords[0]);
L.transact("m", () => L.update(a.id, { coords: a.coords.map((c) => G.moved(c, 2, 0)) }));
ok(Math.abs(G.mmX(L.object(g[1].id).coords[0]) - (x0 + 2)) < 0.011, `a copy follows a move (${g.length} copies, syms ${g.map((o) => o.sym).join(",")})`);
const ring = multi.find((x) => x.some((o) => o.otp === 3) && x.some((o) => o.omap.ring != null));
if (ring) {
  const area = ring.find((o) => o.otp === 3), line = ring.find((o) => o.omap.ring === 0);
  L.transact("m", () => L.update(area.id, { coords: area.coords.map((c) => G.moved(c, 0, 3)) }));
  ok(Math.abs(G.mmY(L.object(line.id).coords[0]) - G.mmY(L.object(area.id).coords[0])) < 0.011, "an area's border line follows its ring");
} else console.log("(no area with border lines in this file)");
const n = doc.objects.length;
L.transact("d", () => L.remove(a.id));
ok(doc.objects.length === n - g.filter((o) => (o.omap.piece || 0) === (a.omap.piece || 0)).length, "deleted together");
L.undo();
ok(doc.objects.length === n, "undo brings them all back");

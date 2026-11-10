// Dump an OCAD file's symbols and objects (map mm, flags kept) and its course setting to JSON.
// node --import ../mapper/shim.mjs dump.mjs <file.ocd> <out.json>   (from tools/virtually; build.py reads it)
import { readFileSync, writeFileSync } from "node:fs";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";

const [, , file, out] = process.argv;
const { map, version, records } = readOcad(readFileSync(file));
const syms = records.symbols.map((s) => ({ sym: s.sym, otp: s.otp, desc: s.description, status: s.status, elts: s.otp === 1 ? (s.elts || []).map((e) => e.coords.map((p) => [p.x >> 8, p.y >> 8])) : undefined }));
const objs = [];
for (const { e, o } of records.objects) {
  if (!o.coords?.length) continue;
  objs.push({ sym: o.sym, otp: o.otp, ang: o.ang, view: e.viewType, c: o.coords.map((p) => [p.x >> 8, p.y >> 8, p.x & 255, p.y & 255]), text: o.text || undefined });
}
const cs = map.courseSetting;
writeFileSync(out, JSON.stringify({ version, scale: map.scale, realWorld: map.realWorld, syms, objs, courseSetting: cs }));
console.log(file, "v", version, "scale", map.scale, "rw", JSON.stringify(map.realWorld), "syms", syms.length, "objs", objs.length,
  "courses", cs ? cs.courses?.map((c) => c.name).join(", ") : "none", "controls", cs?.controls?.length);

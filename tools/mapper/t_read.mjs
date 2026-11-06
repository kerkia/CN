import { readFileSync } from "node:fs";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
const f = process.argv[2];
const t0 = performance.now();
const r = readOcad(new Uint8Array(readFileSync(f)));
console.log(f.split("/").pop(), "v", r.version, "syms", r.records.symbols.length, "objs", r.records.objects.length, "params", r.records.params.length,
  "inst", r.records.objects.filter((x) => x.o.inst).length, "ms", Math.round(performance.now() - t0), "notes", r.map.notes.length);

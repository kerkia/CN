import { readFileSync } from "node:fs";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
for (const f of process.argv.slice(2)) {
  const r = readOcad(new Uint8Array(readFileSync(f)));
  const p9 = r.records.params.filter((p) => p.type === 9), p10 = r.records.params.filter((p) => p.type === 10);
  console.log(f.split("/").pop(), "colours", p9.length, "spots", p10.length);
  for (const p of p9.slice(0, 4)) console.log("  9:", JSON.stringify(p.str));
  for (const p of p10.slice(0, 6)) console.log(" 10:", JSON.stringify(p.str));
}

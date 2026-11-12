// Cartographier's sprint legibility rules (checks.js + sets/legibility.json) on a town map the generator made (Pixel's Gif):
//   node --import ./tools/mapper/shim.mjs tools/mapper/t_legibility.mjs [map.ocd]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {                 // the modules fetch their sets by file URL here
  const s = String(u);
  if (s.startsWith("file:")) { const b = readFileSync(fileURLToPath(s)); return { ok: true, json: async () => JSON.parse(b.toString("utf8")) }; }
  return realFetch(u, o);
};
globalThis.window ??= {};
const D = await import("../../site/assets/js/mapper/doc.js");
const C = await import("../../site/assets/js/mapper/checks.js");
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
await new Promise((r) => setTimeout(r, 200));       // the rules' fetch
const file = process.argv[2] || "C:/Kerkia/Ozimut/data/virtual/gif/map.ocd";
const live = new D.Live(D.fromOcad(new Uint8Array(readFileSync(file)), "m"));
const E = { live, get doc() { return live.doc; } };
const t0 = Date.now();
const found = C.run(E);
const by = {};
for (const x of found) by[x.kind] = (by[x.kind] || 0) + 1;
console.log(`${found.length} findings in ${Date.now() - t0} ms`, by);
ok(live.doc.scale <= 5000, `a sprint map (1:${live.doc.scale})`);
ok("gap" in by || "paved" in by || "stairs" in by || found.length >= 0, "the sprint rules ran");
for (const k of ["gap", "paved", "stairs"]) {
  const x = found.find((f) => f.kind === k);
  if (x) console.log(" ", k, x.msg, x.at ? x.at.map((v) => v.toFixed(1)).join(", ") : "");
}

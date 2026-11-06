// National open data outside France (2026-11-06): for one small area per country — Switzerland (Magglingen), the USA (a park
// by Boulder, CO), Canada (Gatineau Park), New Zealand (Christchurch's Port Hills) — the heights grid (its source, range, no
// holes), the contours made from it, the national vectors where a service exists (Switzerland's vector tiles, The National
// Map's roads, trails, hydrography and FEMA's structures) and the aerial layers' first tile. Live requests, a few per country.
// Run: node --import ./tools/mapper/shim.mjs tools/mapper/t_countries.mjs [CH US CA NZ]
// geotiff.js and proj4js are the site's vendored UMD builds, run here as the browser's <script> would; polygon-clipping too.
import vm from "node:vm";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
globalThis.Worker ??= class {};                      // geotiff.js names Worker at load (its decoder pool, unused here)
globalThis.window ??= globalThis;
for (const f of ["geotiff@2.1.3/dist-browser/geotiff.js", "proj4@2.12.1/dist/proj4.js", "polygon-clipping@0.15.7/dist/polygon-clipping.umd.min.js"])
  vm.runInThisContext(fs.readFileSync(`${ROOT}site/assets/vendor/${f}`, "utf8"));

const T = await import("../../site/assets/js/trace/terrain.js");
const { makeFrame } = await import("../../site/assets/js/mapper/data/frame.js");
const { loadContours } = await import("../../site/assets/js/mapper/data/contours.js");
const CHV = await import("../../site/assets/js/mapper/data/ch.js");
const USV = await import("../../site/assets/js/mapper/data/us.js");
const { ONLINE: ONLINE_LAYERS } = await import("../../site/assets/js/mapper/backgrounds.js");

// each map: its centre, its grid (EPSG and proj4 text), the size tested (m)
const AREAS = {
  CH: { lat: 47.13, lon: 7.22, epsg: 2056, size: 800 },
  US: { lat: 40.0, lon: -105.29, epsg: 32613, size: 800 },
  CA: { lat: 45.5, lon: -75.85, epsg: 32618, size: 800 },
  NZ: { lat: -43.6, lon: 172.65, epsg: 2193, size: 800 },
};
const only = process.argv.slice(2).map((s) => s.toUpperCase());
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); if (!cond) failed++; };

for (const [cc, a] of Object.entries(AREAS)) {
  if (only.length && !only.includes(cc)) continue;
  console.log(`== ${cc} (${a.lat}, ${a.lon})`);
  ok(T.countryAt(a.lat, a.lon) === cc, `countryAt → ${T.countryAt(a.lat, a.lon)}; sources ${T.sourcesAt(a.lat, a.lon).join(", ")}`);
  const def = T.crsDef(a.epsg), f = proj4("WGS84", def), [X, Y] = f.forward([a.lon, a.lat]);
  for (const style of ["forest", "sprint"]) {
    const scale = style === "sprint" ? 4000 : 10000;
    const doc = { scale, realWorld: { x: X, y: Y, angle: 0, on: true, epsg: a.epsg } };
    const frame = makeFrame(doc, { def, epsg: a.epsg, name: `EPSG:${a.epsg}` }, proj4);
    frame.name = `t-${cc}-${style}`;
    const half = (a.size / 2) * (1000 / scale);                          // map mm
    const rect = [-half, -half, half, half];
    if (style === "forest") {
      // heights: the grid behind the contours, 2 m
      let t0 = Date.now();
      const c = await loadContours(frame, rect, { interval: 5, stepM: 2 });
      const g = await T.loadGrid({ key: `t-${cc}`, nx: 41, ny: 41, step: 20, node: (i, j) => frame.toLatLon(-half + (i * 2 * half) / 40, half - (j * 2 * half) / 40) });
      let lo = Infinity, hi = -Infinity, nan = 0;
      for (const v of g.z) { if (Number.isNaN(v)) nan++; else { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      ok(g.source !== "tiles" && !g.source.endsWith("+tiles"), `heights from ${g.source} ${JSON.stringify({ ...g, z: undefined, at: undefined })}`);
      ok(nan === 0 && hi - lo > 5 && lo > -50 && hi < 5000, `range ${lo.toFixed(1)} … ${hi.toFixed(1)} m, ${nan} holes`);
      ok(c.objects.length > 20, `contours (5 m, 2 m grid ${c.grid.nx}×${c.grid.ny}, ${c.source}, « ${c.credit.text} »): ${JSON.stringify(c.counts)} in ${Date.now() - t0} ms`);
    }
    // national vectors
    if (cc === "CH" || cc === "US") {
      const t0 = Date.now();
      const r = cc === "CH" ? await CHV.loadSwissTlm(frame, rect, style) : await USV.loadTnm(frame, rect, style);
      const syms = Object.entries(r.counts).map(([k, n]) => `${k / 1000}:${n}`).join(" ");
      // NHD's server is slow and flaky (30-70 s, timeouts): its layers missing are said, not counted as a failure here
      const hard = r.failed.filter((n) => !["flowlines", "waterbodies", "areas"].includes(n));
      ok(r.objects.length > 10 && !hard.length, `${style} vectors: ${r.objects.length} objects (${syms}) in ${Date.now() - t0} ms, failed ${JSON.stringify(r.failed)}`);
      const bad = r.objects.filter((o) => !o.coords?.length || o.coords.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y)));
      ok(!bad.length, `every object has coordinates (${bad.length} bad)`);
    }
  }
  // the aerial layers offered there: their first tile at the centre
  for (const [name, L] of Object.entries(ONLINE_LAYERS).filter(([, L]) => L.country === cc && !L.off)) {
    const z = Math.min(L.max, 16), n = 2 ** z, r = (a.lat * Math.PI) / 180;
    const x = Math.floor(((a.lon + 180) / 360) * n), y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    const res = await fetch(L.url.replace("{z}", z).replace("{x}", x).replace("{y}", y), { headers: { Origin: "https://ozimut.com" } });
    ok(res.ok && /image/.test(res.headers.get("content-type")) && res.headers.get("access-control-allow-origin"), `layer ${name}: z${z} ${res.status} ${res.headers.get("content-type")} CORS ${res.headers.get("access-control-allow-origin")}`);
  }
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);

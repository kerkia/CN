// BD TOPO for Fougères' old town (one live request per layer), in both styles.
import { makeFrame } from "../../site/assets/js/mapper/data/frame.js";
import { loadBdtopo } from "../../site/assets/js/mapper/data/bdtopo.js";
import { toL93 } from "../../site/assets/js/mapper/data/frame.js";
for (const [style, scale] of [["sprint", 4000], ["forest", 10000]]) {
  const [x, y] = toL93(48.3524, -1.2045);
  const doc = { scale, realWorld: { x, y, angle: 0, on: true, epsg: 2154 } };
  const frame = makeFrame(doc, { def: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m", epsg: 2154, name: "Lambert 93" });
  const half = 250000 / scale / 2 * 2;
  const t0 = Date.now();
  const r = await loadBdtopo(frame, [-half, -half, half, half], style);
  console.log(style, r.objects.length, "objects in", Date.now() - t0, "ms", JSON.stringify(r.counts), r.failed);
}

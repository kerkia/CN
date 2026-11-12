// The shared print engine (site/assets/js/tracer/vmap/inks.js): an OCAD map's spot inks read, drawn as a composite in spot inks
// and as plates, the PDFs written next to the map and checked (colour spaces, overprint, plates).
// Run: node --import ./tools/mapper/shim.mjs tools/mapper/t_inks.mjs <map.ocd> [out folder]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
import { PdfTarget } from "../../site/assets/js/tracer/vmap/target.js";
import { Matrix } from "../../site/assets/js/tracer/vmap/geom.js";
import * as I from "../../site/assets/js/tracer/vmap/inks.js";

const L = createRequire(import.meta.url)("../../site/assets/vendor/pdf-lib@1.17.1/dist/pdf-lib.min.js");
const [file, out = "."] = process.argv.slice(2);
const { map } = readOcad(new Uint8Array(readFileSync(file)));
const ok = (c, msg) => { console.log(c ? "ok  " : "FAIL", msg); if (!c) process.exitCode = 1; };

ok(map.spots?.length > 0, `inks read: ${map.spots.map((s) => s.name).join(", ")}`);
const withInk = map.colors.filter((c) => c.spot?.length);
ok(withInk.length > 0, `${withInk.length} of ${map.colors.length} colours printed with inks (e.g. ${withInk[0]?.name}: ${JSON.stringify(withInk[0]?.spot)})`);
const multi = map.colors.find((c) => I.inksOf(c).length > 1);
console.log("     a colour of several inks:", multi ? `${multi.name} ${JSON.stringify(multi.spot)}` : "none");

const b = map.bounds(), box = [b[0], b[1], Math.min(b[2], b[0] + 120), Math.min(b[3], b[1] + 120)];
const pt = 72 / 25.4, W = (box[2] - box[0]) * pt, H = (box[3] - box[1]) * pt;
const base = new Matrix(pt, 0, 0, pt, -box[0] * pt, -box[1] * pt);

async function draw(doc, page, painter) {
  const op = painter?.kind === "spot" ? I.overprintGs(L, doc, page) : null;
  const tg = new PdfTarget(L, page, base, { painter, darken: op, minRes: 0.01 });
  map.draw(tg, box, { minRes: 0.01, overprint: painter?.kind === "spot" });
  await tg.finish();
}
const content = async (bytes) => {
  const d = await L.PDFDocument.load(bytes), pages = d.getPages();
  return pages.map((p) => {
    const c = p.node.Contents(), arr = c instanceof L.PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
    return arr.map((s) => new TextDecoder().decode(L.decodePDFRawStream(s).decode())).join("\n");
  });
};

// the composite in spot inks
{
  const doc = await L.PDFDocument.create(), page = doc.addPage([W, H]), painter = I.spotPainter(L, doc, map.spots);
  await draw(doc, page, painter);
  I.plateMarks(L, page, painter, { m: 20, label: "", font: null });
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(`${out}/inks-composite.pdf`, bytes);
  const [s] = await content(bytes), raw = new TextDecoder("latin1").decode(bytes);
  ok(/\/Separation/.test(raw), "Separation colour spaces written");
  ok(!multi || /\/DeviceN/.test(raw), "DeviceN for a colour of several inks");
  ok(/\/All/.test(raw), "registration marks in « All »");
  ok(/\bscn\b/.test(s) && /\/CS\d+ cs/.test(s), "map colours painted in their inks");
  ok(!map.colors.some((c) => c.overprint) || /\/OP true/.test(raw), "real overprint for the colours that overprint");
}
// the plates
{
  const list = I.plates(map.spots, map.colors);
  ok(list.length > 0, `plates: ${list.map((p) => p.name).join(", ")}`);
  const doc = await L.PDFDocument.create();
  for (const plate of list) { const page = doc.addPage([W, H]); await draw(doc, page, I.platePainter(L, plate, map.spots, list)); }
  const bytes = await doc.save();
  writeFileSync(`${out}/inks-plates.pdf`, bytes);
  const pages = await content(bytes);
  ok(pages.every((s) => !/\bk\b|\bK\b|\bscn\b/.test(s)), "plates are grey only (no CMYK, no spot ink)");
  // inked: a grey set (clips and frames alone are no ink); a plate may be empty in the box drawn
  const inked = pages.map((s) => (s.match(/[\d.]+ [gG]\n/g) || []).length);
  ok(inked.filter((n) => n > 0).length >= 3, `plates inked in the box: ${list.map((p, i) => `${p.name} ${inked[i]}`).join(", ")}`);
  // a colour printed with one ink alone is on its plate and nowhere else (it knocks out, or is left out if it overprints)
  const one = map.colors.find((c) => I.inksOf(c).length === 1 && I.inksOf(c)[0].pct === 1);
  if (one) {
    const ink = one.spot[0].name, on = list.filter((p) => p.share(one) > 0).map((p) => p.name);
    ok(on.length === 1 && on[0] === ink, `${one.name} on the ${ink} plate only`);
  }
  const pp = I.plates(map.spots, map.colors, { process: true });
  ok(pp.map((p) => p.name).join("") === "CMYK", "process plates C, M, Y, K");
}
console.log("written", `${out}/inks-composite.pdf`, `${out}/inks-plates.pdf`);

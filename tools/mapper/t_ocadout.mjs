// Tests of mapper/ocadout.js (writeOcadDoc) on OCAD files: run from the repository's root with
//   node --import ./tools/mapper/shim.mjs tools/mapper/t_ocadout.mjs [files…]
// For each file (Purple Pen's test maps in site/data/_trtest/ocad/ and the two of « Test files »), a document is made straight
// from readOcad's records, then:
//   A  written unchanged: the source itself;
//   B  written unchanged, the file rebuilt: every record's bytes as they were, read back equal, the same extent;
//   C  every symbol and object dirty, the colours, georeference and print strings too (written over their raw bytes): the same;
//   D  every symbol and object dirty without their raw bytes (the serializer alone): read back equal, the same extent;
//   E  written in another version (9-11 → 2018, 12/2018 → 12; OCAD 6-8 → 2018: read back with as many records): read back equal.
// Outputs go to OCADOUT_DIR (default: the session's scratchpad). The sources are never written.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
import { writeOcadDoc } from "../../site/assets/js/mapper/ocadout.js";

const OUT = process.env.OCADOUT_DIR || "C:/Users/YANN~1.LEH/AppData/Local/Temp/claude/701b9676897871f9/fb0778f4-a6c5-4a19-991d-11187bb51e7d/scratchpad/ocadout";
mkdirSync(OUT, { recursive: true });
const DIR = "site/data/_trtest/ocad", TEST = "C:/kerkia/Ozimut/work/Test files";
let files = process.argv.slice(2);
if (!files.length) {
  files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".ocd")).map((f) => join(DIR, f));
  for (const f of ["deski 8 nov 26 F.ocd", "ent opa 8 nov26 deski P.ocd"]) if (existsSync(join(TEST, f))) files.push(join(TEST, f));
}

/** The document as model.md describes it, from readOcad's result. */
function docOf(r) {
  const { map, version, records } = r;
  return {
    format: "ozimut-map", version: 1, ocad: { version, header: records.header },
    scale: map.scale, printScale: map.printScale, printArea: map.printArea || null, realWorld: map.realWorld || null, dirty: {},
    colors: map.colors.map((c) => ({ num: c.id, name: c.name, cmyk: c.cmyk, overprint: c.overprint })),
    symbols: records.symbols,
    objects: records.objects.map((x, i) => { const o = { ...x.o, id: i + 1, e: x.e, rawAt: x.rawAt }; delete o.inst; return o; }),
    params: records.params, layoutImages: [],
  };
}
const SYM_SKIP = new Set(["rawAt", "size", "dirty"]);
const OBJ_KEYS = ["sym", "otp", "ang", "coords", "text", "col", "lineWidth", "diamFlags", "objStr", "objStrType"];
const falsy = (x) => x == null || x === 0 || x === false || x === "";
/** Deep equality, a key missing on one side equal to a falsy value on the other. Returns the first difference or null. */
function diff(a, b, path = "", skip = SYM_SKIP) {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b) ? null : `${path}: ${a} ≠ ${b}`;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return falsy(a) && falsy(b) ? null : `${path}: ${JSON.stringify(a)?.slice(0, 60)} ≠ ${JSON.stringify(b)?.slice(0, 60)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`, skip); if (d) return d; }
    return null;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.has(k)) continue;
    const d = diff(a[k], b[k], `${path}.${k}`, skip);
    if (d) return d;
  }
  return null;
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
/** Compares two readings: symbols, objects (with their index entries), colours, settings, extent. */
function compareReadings(r1, r2, { loose = false, skip = [], fresh = false, noBounds = false } = {}) {
  const out = [];
  const s1 = r1.records.symbols, s2 = r2.records.symbols;
  if (s1.length !== s2.length) out.push(`symbols ${s1.length} ≠ ${s2.length}`);
  // in another version: the colour list is the writer's, a description may be cut (OCAD 9-10: 31 characters), and the
  // « use » flags of line glyphs and the rectangles' cell font size are set so that the symbol looks the same (ocadout adapt)
  const symSkip = new Set([...SYM_SKIP, ...skip, ...(loose ? ["nColors", "description", "useSymbolFlags"] : [])]);
  for (let i = 0; i < Math.min(s1.length, s2.length) && out.length < 4; i++) {
    const a = { ...s1[i] }, b = { ...s2[i] };
    if (loose && (a.otp === 5 || a.otp === 7)) { delete a.fontSize; delete b.fontSize; }
    if (loose && a.description !== undefined) { if (!String(b.description).startsWith(String(a.description).slice(0, 31).trimEnd()) && !String(a.description).startsWith(String(b.description))) out.push(`symbol ${a.sym} description`); }
    const d = diff(a, b, `sym ${a.sym}`, symSkip);
    if (d) out.push(d);
  }
  const o1 = r1.records.objects, o2 = r2.records.objects;
  if (o1.length !== o2.length) out.push(`objects ${o1.length} ≠ ${o2.length}`);
  for (let i = 0; i < Math.min(o1.length, o2.length) && out.length < 6; i++) {
    const keys = OBJ_KEYS.filter((k) => !skip.includes(k)), ekeys = ["objType", "status", "viewType", "layoutFont", ...(fresh ? [] : ["objIndex"])];
    const d = diff(pick(o1[i].o, keys), pick(o2[i].o, keys), `obj #${i}`) || diff(pick(o1[i].e, ekeys), pick(o2[i].e, ekeys), `entry #${i}`);
    if (d) out.push(d);
  }
  const m1 = r1.map, m2 = r2.map;
  const c = diff(m1.colors.map((x) => [x.id, x.name, x.cmyk, x.overprint]), m2.colors.map((x) => [x.id, x.name, x.cmyk, x.overprint]), "colors");
  if (c) out.push(c);
  const st = diff(pick(m1, ["scale", "printScale", "printArea", "realWorld"]), pick(m2, ["scale", "printScale", "printArea", "realWorld"]), "settings");
  if (st) out.push(st);
  const b1 = m1.bounds(), b2 = m2.bounds();
  if (!noBounds && b1.some((x, i) => Math.abs(x - b2[i]) > 1e-6)) out.push(`bounds ${b1.map((x) => x.toFixed(2))} ≠ ${b2.map((x) => x.toFixed(2))}`);
  if (!fresh && r1.records.params.length !== r2.records.params.length) out.push(`params ${r1.records.params.length} ≠ ${r2.records.params.length}`);
  return out;
}
/** Every record's bytes in the output against the source's (a symbol's own file position set aside). */
function compareBlocks(src, r1, out, r2) {
  const bad = [];
  const eq = (a1, a2, mask) => {
    const x = src.subarray(a1[0], a1[0] + a1[1]), y = out.subarray(a2[0], a2[0] + a2[1]);
    if (x.length !== y.length) return `length ${x.length} ≠ ${y.length}`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(mask && i >= 20 && i < 24)) return `byte ${i}: ${x[i]} ≠ ${y[i]}`;
    return null;
  };
  r1.records.symbols.forEach((s, i) => { const d = r2.records.symbols[i] && eq(s.rawAt, r2.records.symbols[i].rawAt, true); if (d) bad.push(`symbol ${s.sym} ${d}`); });
  r1.records.objects.forEach((o, i) => { const d = r2.records.objects[i] && eq(o.rawAt, r2.records.objects[i].rawAt); if (d) bad.push(`object #${i} (sym ${o.o.sym}) ${d}`); });
  r1.records.params.forEach((p, i) => { const d = r2.records.params[i] && eq(p.rawAt, r2.records.params[i].rawAt); if (d) bad.push(`param ${p.type} ${d}`); });
  return bad;
}
const dirtyDoc = (doc, keepRaw) => ({
  ...doc, dirty: { colors: true, georef: true, print: true },
  symbols: doc.symbols.map((s) => { const c = { ...s, dirty: true }; if (!keepRaw) delete c.rawAt; return c; }),
  objects: doc.objects.map((o) => { const c = { ...o, dirty: true }; if (!keepRaw) delete c.rawAt; return c; }),
});

/** The hidden objects (index status 2) of a file. */
function hiddenCount(u) {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let n = 0;
  for (let b = dv.getInt32(12, true), g = 0; b > 0 && b + 10244 <= u.length && g < 10000; b = dv.getInt32(b, true), g++) for (let i = 0; i < 256; i++) {
    const a = b + 4 + i * 40; if (dv.getInt32(a + 24, true) && u[a + 30] === 2) n++;
  }
  return n;
}
/** The document as a new map would have it: no source, no raw bytes, no index entries. */
function newDoc(doc) {
  return { ...doc, ocad: { version: doc.ocad.version, header: null }, params: [], dirty: {}, symbols: doc.symbols.map((s) => { const c = { ...s }; delete c.rawAt; return c; }),
    objects: doc.objects.map((o) => { const c = { ...o, e: o.e && { ...o.e } }; delete c.rawAt; if (c.e) delete c.e.objIndex; return c; }) };
}
/** Some edits, then what the file says: the changes there, the rest as it was (untouched records byte for byte). */
function edits(r, doc, src, v) {
  const out = [];
  const objs = doc.objects.slice();
  const iMove = objs.findIndex((o) => o.otp === 2 && o.sym > 0 && o.coords?.length > 1), iDel = objs.findIndex((o, i) => i !== iMove);
  const moved = { ...objs[iMove], coords: objs[iMove].coords.map((c) => ({ x: c.x + (100 << 8), y: c.y })), dirty: true };
  objs[iMove] = moved;
  objs.splice(iDel, 1);
  const added = { ...moved, id: 1e6, coords: moved.coords.map((c) => ({ x: c.x, y: c.y + (500 << 8) })), dirty: true };
  delete added.rawAt; delete added.e;
  objs.push(added);
  const iSym = doc.symbols.findIndex((s) => s.otp === 2 && !s.symTp && s.lineWidth > 0);
  const symbols = doc.symbols.slice();
  symbols[iSym] = { ...symbols[iSym], lineWidth: symbols[iSym].lineWidth + 7, description: "Ozimut é", dirty: true };
  const newSym = { ...doc.symbols[iSym], sym: 999001, description: "Nouveau", dirty: true };
  delete newSym.rawAt;
  symbols.push(newSym);
  const colors = doc.colors.map((c, i) => (i === 0 ? { ...c, name: "Couleur modifiée", cmyk: [0.1, 0.2, 0.3, 0.4] } : c));
  colors.push({ num: 999, name: "Nouvelle", cmyk: [0, 1, 0, 0], overprint: true });
  const rw = { ...(doc.realWorld || {}), x: 123456, y: 654321, angle: 2.5, on: true, grid: 500 };
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const ed = { ...doc, objects: objs, symbols, colors, realWorld: rw, scale: 15000, printScale: 7500, printArea: [1, 2, 300, 400], dirty: { colors: true, georef: true, print: true },
    layoutImages: [{ name: "logo.png", type: "image/png", data: png, x: 10, y: 20, u: 0.5, v: 0.5 }] };
  const bytes = writeOcadDoc(ed, src);
  writeFileSync(join(OUT, "edit-" + basename(String(r.name || v)) + ".ocd"), bytes);
  const r2 = readOcad(bytes);
  const o2 = r2.records.objects, m2 = r2.map;
  if (o2.length !== r.records.objects.length) out.push(`objects ${o2.length} ≠ ${r.records.objects.length}`);
  const byIdx = new Map(o2.map((x) => [x.e.objIndex, x]));
  const mv = byIdx.get(r.records.objects[iMove].e.objIndex);
  if (!mv || mv.o.coords[0].x !== moved.coords[0].x) out.push("moved object not moved");
  if (byIdx.has(r.records.objects[iDel].e.objIndex)) out.push("deleted object still there");
  const last = o2[o2.length - 1];
  if (last.o.coords[0].y !== added.coords[0].y || last.e.objIndex <= Math.max(...r.records.objects.map((x) => x.e.objIndex))) out.push("added object not last");
  // untouched objects: same slot, same bytes
  let same = 0;
  for (const x of r.records.objects) {
    if (x === r.records.objects[iMove] || x === r.records.objects[iDel]) continue;
    const y = byIdx.get(x.e.objIndex);
    const a = src.subarray(x.rawAt[0], x.rawAt[0] + x.rawAt[1]), b = y && bytes.subarray(y.rawAt[0], y.rawAt[0] + y.rawAt[1]);
    if (b && a.length === b.length && a.every((q, i) => q === b[i])) same++;
  }
  if (same !== r.records.objects.length - 2) out.push(`untouched objects kept byte for byte: ${same} of ${r.records.objects.length - 2}`);
  const s2 = r2.records.symbols.find((s) => s.sym === symbols[iSym].sym);
  if (!s2 || s2.lineWidth !== symbols[iSym].lineWidth || s2.description !== "Ozimut é") out.push(`edited symbol: ${s2?.lineWidth} ${s2?.description}`);
  if (!r2.records.symbols.some((s) => s.sym === 999001 && s.description === "Nouveau")) out.push("new symbol missing");
  const c0 = m2.colors.find((c) => c.id === colors[0].num), cn = m2.colors.find((c) => c.id === 999);
  if (!c0 || c0.name !== "Couleur modifiée" || c0.cmyk.some((x, i) => Math.abs(x - colors[0].cmyk[i]) > 1e-9)) out.push(`edited colour ${JSON.stringify(c0 && [c0.name, c0.cmyk])}`);
  if (!cn || !cn.overprint || m2.colors[m2.colors.length - 1].id !== 999) out.push("new colour not on top");
  if (m2.colors.length !== colors.length) out.push(`colours ${m2.colors.length} ≠ ${colors.length}`);
  if (m2.scale !== 15000 || m2.realWorld.x !== 123456 || m2.realWorld.y !== 654321 || m2.realWorld.angle !== 2.5 || m2.realWorld.grid !== 500) out.push(`georef ${JSON.stringify([m2.scale, m2.realWorld])}`);
  if (m2.printScale !== 7500 || String(m2.printArea) !== "1,2,300,400") out.push(`print ${m2.printScale} ${m2.printArea}`);
  if (v >= 11 && m2.layoutImages.length !== r.map.layoutImages.length + 1) out.push(`layout images ${m2.layoutImages.length} ≠ ${r.map.layoutImages.length} + 1`);
  // the other parameter strings unchanged
  const others = (rr) => rr.records.params.filter((p) => ![9, 1039, 1026].includes(p.type) && !(p.type === 27 && p.str.startsWith("logo.png"))).map((p) => `${p.type}:${p.objIndex}:${p.str}`).join("\n");
  if (others(r) !== others(r2)) out.push("other parameter strings changed");
  // the codes Ozimut does not manage stay in the georeference string
  const rest = (rr) => rr.records.params.find((p) => p.type === 1039)?.str.split("\t").slice(1).filter((x) => !"mgrxyadi".includes(x[0])).join("\t");
  if (rest(r) !== rest(r2)) out.push(`georef's other codes: ${rest(r)} ≠ ${rest(r2)}`);
  return out;
}

const EXTRA = new Set(["deski 8 nov 26 F.ocd", "ent opa 8 nov26 deski P.ocd", "Lake Sammamish OCAD11.ocd", "SampleMap.ocd", "teanwest2018.ocd", "Lake Sammamish OCAD12.ocd", "textpoint10.ocd", "linegaps10.ocd"]);
let pass = 0, fail = 0;
const summary = [];
for (const f of files) {
  const name = basename(f), src = new Uint8Array(readFileSync(f));
  let r;
  try { r = readOcad(src); } catch (e) { console.log(`${name}: unreadable (${e.message})`); continue; }
  const v = r.version, lines = [];
  const ok = (label, problems) => {
    if (problems.length) { fail++; lines.push(`  ${label}: FAIL ${problems.slice(0, 4).join(" | ")}`); } else { pass++; lines.push(`  ${label}: ok`); }
  };
  const save = (tag, bytes) => writeFileSync(join(OUT, name.replace(/\.ocd$/i, `.${tag}.ocd`)), bytes);
  const t0 = performance.now();
  try {
    const doc = docOf(r);
    if (v >= 9) {
      const a = writeOcadDoc(doc, src);
      ok("A unchanged = source", a.length === src.length && a.every((x, i) => x === src[i]) ? [] : ["differs"]);
      const b = writeOcadDoc(doc, src, { rebuild: true });
      save("B", b);
      const rb = readOcad(b);
      const same = b.length === src.length && b.every((x, i) => x === src[i]);
      ok(`B rebuilt (${b.length} bytes, source ${src.length}${same ? ", identical" : ""})`, [...compareBlocks(src, r, b, rb), ...compareReadings(r, rb)]);
      const c = writeOcadDoc(dirtyDoc(doc, true), src);
      save("C", c);
      const rc = readOcad(c);
      ok("C all dirty, over raw bytes", [...compareBlocks(src, r, c, rc), ...compareReadings(r, rc)]);
      const d = writeOcadDoc(dirtyDoc(doc, false), src);
      save("D", d);
      ok("D all dirty, serializer", compareReadings(r, readOcad(d), { skip: ["nColors"] }));
      ok("H hidden objects kept", hiddenCount(src) === hiddenCount(d) ? [] : [`${hiddenCount(src)} ≠ ${hiddenCount(d)}`]);
    }
    const to = v >= 12 ? 12 : 2018;
    const e = writeOcadDoc(doc, src, { version: to });
    save(`E${to}`, e);
    const re = readOcad(e);
    if (v >= 9 && hiddenCount(src) !== hiddenCount(e)) ok("H hidden objects in another version", [`${hiddenCount(src)} ≠ ${hiddenCount(e)}`]);
    if (EXTRA.has(name)) {
      r.name = name;
      for (const lower of v >= 12 ? [11, 9] : []) {
        const x = writeOcadDoc(doc, src, { version: lower });
        save(`I${lower}`, x);
        // OCAD 12's course-setting objects (view type 1, not drawn there) are ordinary objects in OCAD 11 and before: the extent grows
        const cs = r.records.objects.some((o) => o.e.viewType);
        ok(`I v${v} → ${lower}${cs ? " (course-setting objects: extent not compared)" : ""}`, compareReadings(r, readOcad(x), { noBounds: cs, loose: true, skip: ["decSymbolWidth", "decSymbolDistance", "structDraw", "irrX", "irrY", "irrMin", "pointSym", "pointSymOn", "alignment", "objStr", "objStrType"] }));
      }
      ok("F edits", edits(r, doc, src, v));
      const g = writeOcadDoc(newDoc(doc), null);
      save("G", g);
      ok("G a new map (no source) as 2018", compareReadings(r, readOcad(g), { loose: true, fresh: true }));
    }
    if (v >= 9) ok(`E v${v} → ${to}`, compareReadings(r, re, { loose: true }));
    else ok(`E v${v} → ${to} (counts)`, [r.records.symbols.length === re.records.symbols.length ? null : `symbols ${r.records.symbols.length} ≠ ${re.records.symbols.length}`,
      r.records.objects.length === re.records.objects.length ? null : `objects ${r.records.objects.length} ≠ ${re.records.objects.length}`].filter(Boolean));
  } catch (err) { fail++; lines.push(`  ERROR ${err.stack.split("\n").slice(0, 3).join(" ")}`); }
  console.log(`${name} (v${v}, ${r.records.symbols.length} symbols, ${r.records.objects.length} objects, ${Math.round(performance.now() - t0)} ms)\n${lines.join("\n")}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;

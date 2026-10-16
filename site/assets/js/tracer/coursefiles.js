// « Fichier › Fichiers OCAD ou Mapper des circuits » (Purple Pen's Create OCAD Files, OcadCreation; BSD licence, see
// /assets/tracer/LICENSE-PurplePen.txt): each course (or part, variation) becomes a map file that holds only the course —
// control circles, start, finish and crossing points as point symbols (a circle's gaps kept in its object, as Purple Pen and
// OCAD do), lines, numbers, special objects and the description sheet as objects of course symbols in the course colours
// (purple, lower purple, 50 % purple, black, white), images placed on the map as layout images (OCAD 11 and later, kept in
// the file) or as templates beside it — with the event's map as its background template, to be finished or
// printed in OCAD (9 to 12, 2018) or OpenOrienteering Mapper. On an OCAD or Mapper map the course is written in the map
// file's own millimetres (it lies on the map exactly, the template needs no adjusting); on an image or a PDF in the sheet's,
// the image placed under it (a PDF given as a PNG of the page, as Purple Pen does).

import * as M from "./model.js";
import { layoutCourse } from "./layout.js";
import { itemsFor } from "./draw.js";
import { modal, field, sel, saveFiles, fileName } from "./dialogs.js";
import { printBox } from "./pdf.js";
import { coursePurple } from "./appear.js";
import { textWidth, ASCENT, DESCENT } from "./fonts.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// the course colours, as Purple Pen numbers them (NormalCourseAppearance), from the bottom of the table to its top
const ROLE = { white: { id: 44, name: "White" }, purple50: { id: 13, name: "50% purple" }, lower: { id: 12, name: "Lower purple" }, upper: { id: 11, name: "Purple" }, black: { id: 0, name: "Black" } };
// symbol numbers and names by course object (ISOM's 7xx course symbols)
const KIND = {
  start: ["701", "Départ"], control: ["702", "Poste"], dot: ["702", "Point central du poste"], number: ["703", "Numéro de poste"], code: ["703", "Code de poste"],
  leg: ["704", "Interposte"], flagged: ["705", "Itinéraire balisé"], finish: ["706", "Arrivée"], boundary: ["707", "Limite infranchissable"],
  crossing: ["708", "Point de passage"], "optional-crossing-point": ["708", "Point de passage"], "out-of-bounds": ["709", "Zone interdite"], "dangerous-area": ["710", "Zone dangereuse"],
  "forbidden-route": ["711", "Passage interdit"], "first-aid": ["712", "Poste de secours"], water: ["713", "Ravitaillement"], "registration-mark": ["714", "Repère de calage"],
  issue: ["715", "Point de remise des cartes"], "temporary-construction": ["716", "Construction temporaire"], line: ["720", "Trait"], rect: ["721", "Cadre"], text: ["722", "Texte"],
  descriptions: ["790", "Définitions"], "white-out": ["890", "Masque blanc"], exchange: ["702", "Poste avec échange de carte"], other: ["799", "Objet du circuit"],
};
const DEG = Math.PI / 180;
const POINT_T = new Set(["control", "finish", "start", "crossing", "issue", "point"]);
const deg360 = (a) => ((a % 360) + 360) % 360;
/**
 * A course object drawn as a point symbol, as Purple Pen's course objects are: { kind, parts (the glyph, mm around the point,
 * unturned), angle, gaps, rotatable }, or null for one drawn otherwise. Controls and the finish are circles (their gaps go in
 * the object); the start, crossing points and point specials take their drawing, turned back by their orientation.
 */
function pointOf(o, its, colorOf) {
  if (!POINT_T.has(o.t) || !o.ctr || !its.length || its.some((it) => it.t !== "path")) return null;
  if (o.t === "control" || o.t === "finish") {
    const lower = colorOf("lower"), angle = o.t === "control" && o.exchangeTriangle != null ? o.exchangeTriangle : 0;
    const parts = (o.t === "control" ? [o.r] : [o.rIn, o.rOut]).map((r) => ({ type: "circle", x: 0, y: 0, r: r3(r), width: r3(o.lw), color: lower }));
    if (o.t === "control" && o.dot) parts.push({ type: "dot", x: 0, y: 0, d: r3(o.dot), color: colorOf("upper") });
    if (o.t === "control" && o.exchangeTriangle != null) {
      const pts = [0, 120, 240].map((a) => [-o.r * Math.sin(a * DEG), o.r * Math.cos(a * DEG)].map(r3));
      parts.push({ type: "line", path: [["M", ...pts[0]], ["L", ...pts[1]], ["L", ...pts[2]], ["Z"]], width: r3(o.lw), cap: "butt", join: "round", color: lower });
    }
    const gaps = o.gaps?.length ? o.gaps.flatMap(([a, b]) => [deg360(a - angle), deg360(b - angle)]).map(r3) : null;
    return { kind: o.t === "finish" ? "finish" : o.exchangeTriangle != null ? "exchange" : "control", parts, angle, gaps, rotatable: o.exchangeTriangle != null };
  }
  const angle = o.orientation || 0, c = Math.cos(-angle * DEG), sn = Math.sin(-angle * DEG), [cx, cy] = o.ctr;
  const local = (d) => d.map((q) => (q[0] === "Z" ? q : [q[0], ...pairs(q.slice(1)).flatMap(([x, y]) => [r3((x - cx) * c - (y - cy) * sn), r3((x - cx) * sn + (y - cy) * c)])]));
  const parts = [];
  for (const it of its) {
    const color = colorOf(it.color), d = local(it.d);
    if (it.fill) parts.push({ type: "area", paths: subpaths(d), color });
    if (it.stroke) for (const pth of subpaths(d)) parts.push({ type: "line", path: pth, width: r3(it.stroke), cap: it.cap || "butt", join: it.join || "miter", color });
  }
  if (!parts.length) return null;
  const kind = o.t === "point" ? (KIND[o.kind] ? o.kind : "other") : o.t;
  return { kind, parts, angle, gaps: null, rotatable: "orientation" in o };
}
const pairs = (a) => { const out = []; for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]); return out; };
/** An image's bytes from the event's base 64, and its type by its first bytes. */
function imageBytes(img) {
  const bytes = Uint8Array.from(atob(img.data), (ch) => ch.charCodeAt(0));
  const type = bytes[0] === 0x89 ? "png" : bytes[0] === 0xff ? "jpg" : bytes[0] === 0x47 ? "gif" : bytes[0] === 0x42 ? "bmp" : String(img.format || "png").toLowerCase().replace("jpeg", "jpg");
  return { bytes, type };
}
const OCAD_FONT = { Arial: "Arial", Times: "Times New Roman", Courier: "Courier New", Roboto: "Roboto", "Roboto Condensed": "Roboto Condensed" };

/** What a drawing item is, for its symbol: a key of KIND. */
function kindOf(it) {
  const o = it.obj || {};
  if (it.desc || o.t === "descriptions") return "descriptions";
  if (o.t === "control") return it.fill ? "dot" : "control";
  if (o.t === "leg") return it.color === "upper" ? "flagged" : "leg";
  if (["start", "finish", "number", "code", "crossing", "issue", "text"].includes(o.t)) return o.t;
  if (o.t === "rect") return "rect";
  if (o.t === "point" || o.t === "line" || o.t === "area") return KIND[o.kind] ? o.kind : o.t === "line" ? "line" : "other";
  return "other";
}
/** Split a path's commands at each move. */
function subpaths(d) {
  const out = [];
  for (const c of d) { if (c[0] === "M" || !out.length) out.push([]); out[out.length - 1].push(c); }
  return out.filter((p) => p.length > 1);
}
const shift = (d, dx, dy) => d.map((c) => (c[0] === "Z" ? c : [c[0], ...c.slice(1).map((v, i) => v + (i % 2 ? dy : dx))]));
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The course model of a course designator (ocadwrite.js describes it): its items as symbols and objects in the map file's frame.
 * opts: { overprint (the purples printed over the map), map (the editor's map source), variationName, team, leg }.
 */
export function courseModel(E, cd, { overprint = true, variationName = "", team = null, leg = null, title = "" } = {}) {
  const ev = E.ev, layout = layoutCourse(ev, cd, { variationName, team, leg });
  const items = itemsFor(ev, layout);
  const [fx, fy] = M.fileOffset(ev);
  const P = coursePurple(ev, E.map);
  const colors = [], byRole = new Map();
  const colorOf = (role) => {
    const key = Array.isArray(role) ? role.join(",") : role;
    if (byRole.has(key)) return byRole.get(key);
    let c;
    if (Array.isArray(role)) c = { id: 61 + colors.filter((x) => x.id >= 61).length, name: `Couleur ${role.map((x) => Math.round(x * 100)).join("/")}`, cmyk: role, overprint: false };
    else {
      const r = ROLE[role] || ROLE.black;
      c = { ...r, cmyk: role === "white" ? [0, 0, 0, 0] : role === "black" ? [0, 0, 0, 1] : role === "purple50" ? P.map((x) => x / 2) : P, overprint: ["upper", "lower", "purple50"].includes(role) && overprint };
    }
    byRole.set(key, c.id); colors.push(c);
    return c.id;
  };
  const symbols = [], symKey = new Map(), fracs = new Map(), objects = [];
  const symbolFor = (kind, spec) => {
    const key = `${kind}|${JSON.stringify(spec)}`;
    if (symKey.has(key)) return symKey.get(key);
    const [base, name] = KIND[kind] || KIND.other, f = fracs.get(base) || 0;
    fracs.set(base, f + 1);
    symbols.push({ code: `${base}.${f}`, name, ...spec });
    symKey.set(key, symbols.length - 1);
    return symbols.length - 1;
  };
  // controls, start, finish, crossing points and point specials as point symbols; everything else item by item
  const byObj = new Map(), asPoint = new Set();
  for (const it of items) if (it.obj) (byObj.get(it.obj) || byObj.set(it.obj, []).get(it.obj)).push(it);
  for (const [o, its] of byObj) {
    const pt = pointOf(o, its, colorOf);
    if (!pt) continue;
    asPoint.add(o);
    objects.push({ sym: symbolFor(pt.kind, { kind: "point", parts: pt.parts, rotatable: pt.rotatable }), kind: "point", x: o.ctr[0] + fx, y: o.ctr[1] + fy, angle: pt.angle, gaps: pt.gaps });
  }
  let skipped = 0;
  const images = [];
  for (const it of items) {
    if (asPoint.has(it.obj)) continue;
    const kind = kindOf(it);
    if (it.t === "path") {
      const d = shift(it.d, fx, fy), color = colorOf(it.color === "white" ? "white" : it.color);
      if (it.fill) objects.push({ sym: symbolFor(kind, { kind: "area", fill: color, hatch: null }), kind: "area", paths: subpaths(d) });
      if (it.stroke) {
        const sym = symbolFor(kind, { kind: "line", color, width: r3(it.stroke), cap: it.cap || "butt", join: it.join || "miter" });
        for (const p of subpaths(d)) objects.push({ sym, kind: "line", paths: [p] });
      }
    } else if (it.t === "hatch") {
      const hatch = { color: colorOf(it.color), width: r3(it.width), spacing: r3(it.spacing), angles: it.angles.slice(0, 2) };
      objects.push({ sym: symbolFor(kind, { kind: "area", fill: null, hatch }), kind: "area", paths: subpaths(shift(it.d, fx, fy)) });
    } else if (it.t === "text") {
      const fam = it.family || (it.condensed ? "Roboto Condensed" : "Roboto");
      const font = { name: OCAD_FONT[fam] || fam, size: r3(it.size), bold: !!it.bold, italic: !!it.italic, ascent: it.size * ASCENT, descent: it.size * DESCENT };
      const frame = it.outline > 0 ? { color: colorOf("white"), width: r3(it.outline) } : null;
      const sym = symbolFor(kind, { kind: "text", color: colorOf(it.color), font, align: it.align === "center" ? "center" : "left", frame });
      objects.push({ sym, kind: "text", text: it.text, x: it.x + fx, y: it.y + fy, width: textWidth(it.text, !!it.bold, fam, !!it.italic) * it.size });
    } else if (it.t === "image" && it.image?.data) {
      const { bytes, type } = imageBytes(it.image), b = it.box;
      images.push({ name: String(it.obj?.name || "").split(/[\\/]/).pop(), bytes, type, box: [b[0] + fx, b[1] + fy, b[2] + fx, b[3] + fy] });
    } else skipped++;
  }
  // the colour table: Purple Pen's order, from the bottom up
  const order = [44, ...colors.filter((c) => c.id >= 61).map((c) => c.id), 13, 12, 11, 0];
  colors.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const { box } = printBox(E, cd, layout);
  const ps = cd.course ? ev.courses[cd.course].printScale : ev.allControls.printScale;
  return { scale: ev.map.scale, printScale: ps || ev.map.scale, printArea: [box[0] + fx, box[1] + fy, box[2] + fx, box[3] + fy],
    notes: `${title || ev.title} — créé par O'CN (ocn.kerkia.com)`, colors, symbols, objects, skipped, images, realWorld: null, templates: [], layoutImages: [] };
}

/**
 * The images placed on the map, for a format (Purple Pen's BitmapsToWrite): each one's file — a PNG becomes a GIF for OCAD 9
 * and 10, which do not read PNG — and its size in pixels, once per image whatever the number of courses.
 */
async function prepareImages(models, fmt, ver) {
  const done = new Map();
  let n = 0;
  for (const m of models) for (const im of m.images) {
    const key = `${im.name}|${im.bytes.length}|${im.bytes[100] ?? 0}`;
    if (done.has(key)) { im.file = done.get(key); continue; }
    const bmp = await createImageBitmap(new Blob([im.bytes], { type: `image/${im.type === "jpg" ? "jpeg" : im.type}` }));
    let bytes = im.bytes, ext = im.type;
    if (fmt === "ocad" && ver <= 10 && ext !== "jpg" && ext !== "bmp" && ext !== "gif") {
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
      bytes = (await import("./gif.js")).encodeGif(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height); ext = "gif";
    }
    const base = fileName((im.name || `image ${++n}`).replace(/\.[^.]+$/, "")) || `image ${++n}`;
    const file = { name: `${base}.${ext}`, bytes, w: bmp.width, h: bmp.height };
    done.set(key, file); im.file = file;
  }
}

/** The map under the course: the map file itself (OCAD, Mapper, image), or a PNG of a PDF page (made once, added to the files). */
async function mapTemplate(E, files) {
  const ev = E.ev;
  if (!E.map || ev.map.kind === "none") return null;
  if (ev.map.kind === "ocad") return { file: ev.map.file, x: 0, y: 0, mmPerPx: 0 };
  if (ev.map.kind === "bitmap") return { file: ev.map.file, x: ev.map.w / 2, y: ev.map.h / 2, mmPerPx: 25.4 / (ev.map.dpi || E.map.dpi || 254) };
  // a PDF: its page as an image at about 10 px per mm (254 dpi), at most 9000 px a side
  const k = Math.min(10, 9000 / Math.max(ev.map.w, ev.map.h));
  const c = await E.map.renderRegion([0, 0, ev.map.w, ev.map.h], k);
  const name = `${String(ev.map.file || "carte").replace(/\.[^.]+$/, "")}.png`;
  files[name] = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
  return { file: name, x: ev.map.w / 2, y: ev.map.h / 2, mmPerPx: 1 / k };
}
/** The map's real-world coordinates for the course file (an OCAD or Mapper map's own), in the form the format keeps. */
async function realWorldFor(E, format) {
  const rw = E.map?.kind === "vector" ? E.map.vmap.realWorld : null;
  if (!rw || (!rw.x && !rw.y)) return null;
  const out = { on: rw.on !== false, x: rw.x, y: rw.y, angle: rw.angle || 0, grid: rw.grid || 500, paperGrid: rw.paperGrid || 100, gridScale: rw.gridScale || 1, zone: rw.zone || 0, epsg: rw.epsg || 0, proj4: rw.proj4 || "" };
  if (format !== "ocad" && out.zone && !(Math.abs(out.zone) > 2000 && Math.abs(out.zone) <= 2060) && !out.proj4) {
    const g = await (await import("./vmap/georef.js")).gridOf(rw).catch(() => null);
    if (g) out.proj4 = g.proj4;
  }
  if (format === "ocad" && !out.zone && out.epsg) {
    // OCAD keeps its own grid ids: a Mapper map's UTM zone in EPSG form (326zz / 327zz) has one
    const z = out.epsg % 100, s = Math.floor(out.epsg / 100);
    if ((s === 326 || s === 327) && z >= 1 && z <= 60) out.zone = (s === 327 ? -1 : 1) * (2000 + z);
  }
  return out;
}

export async function courseFilesDialog(E) {
  const ev = E.ev, ids = M.courseIds(ev);
  const anyVars = ids.some((id) => M.hasVariations(ev, id));
  const kindLabel = { ocad: "OCAD", bitmap: "image", pdf: "PDF", none: "" }[ev.map.kind] || "";
  const v = await modal(E, { title: "Fichiers OCAD ou Mapper des circuits", wide: true, ok: "Créer", body: `
    <div class="tr-checks">${[0, ...ids].map((id) => `<label class="tr-check"><input type="checkbox" name="c${id}" ${id ? "checked" : ""}> ${id ? esc(ev.courses[id].name) : "Tous les postes"}</label>`).join("")}</div>
    <div class="tr-grid2">${field("Format", sel("fmt", [["ocad2018", "OCAD 2018 et suivants"], ["ocad12", "OCAD 12"], ["ocad11", "OCAD 11"], ["ocad10", "OCAD 10"], ["ocad9", "OCAD 9"],
      ["omap", "OpenOrienteering Mapper (.omap)"], ["xmap", "OpenOrienteering Mapper (.xmap)"]], "ocad2018"))}
    ${anyVars ? field("Variantes", sel("vars", [["all", "Chaque variante à part"], ["combined", "Toutes ensemble"]], "all")) : ""}
    ${field("Préfixe des noms de fichiers", `<input name="prefix" value="">`, "Facultatif")}</div>
    <label class="tr-check"><input type="checkbox" name="over" ${ev.appearance.blend !== "none" ? "checked" : ""}> Violet en surimpression (le noir de la carte reste visible)</label>
    <p class="tr-hint">Chaque circuit devient une carte qui ne contient que le circuit — postes, traits, numéros, objets spéciaux et définitions, en symboles 7xx —, avec la carte de l'événement en modèle (fond)${kindLabel ? ` : ${ev.map.kind === "pdf" ? "la page du PDF est jointe en image PNG" : `« ${esc(ev.map.file)} »`}, à mettre dans le même dossier que les fichiers créés` : ""}.
    ${ev.map.kind === "ocad" ? "Les postes sont écrits dans les coordonnées du fichier de la carte : ils tombent juste sur elle." : ""}</p>` });
  if (!v) return;
  E.status("Création des fichiers…", "busy");
  try {
    const [fmt, ver] = v.fmt.startsWith("ocad") ? ["ocad", Number(v.fmt.slice(4))] : [v.fmt, 0];
    const designators = [];
    for (const id of [0, ...ids]) {
      if (!v[`c${id}`]) continue;
      if (!id) { designators.push({ cd: M.cdAll(), name: "Tous les postes" }); continue; }
      const c = ev.courses[id];
      let list = [{ cd: M.cdCourse(id), name: c.name }];
      if (M.hasVariations(ev, id) && v.vars !== "combined") list = M.allVariations(ev, id).map((x) => ({ cd: M.cdCourse(id, -1, x.path), name: `${c.name} ${x.code}`, variation: x.code }));
      for (const d of list) {
        const parts = M.countParts(ev, d.cd);
        if (parts > 1) for (let p = 0; p < parts; p++) designators.push({ ...d, cd: { ...d.cd, part: p }, name: `${d.name}-${p + 1}` });
        else designators.push(d);
      }
    }
    if (!designators.length) { E.toast("Aucun circuit choisi."); E.status("Prêt", "ok"); return; }
    const files = {};
    const template = await mapTemplate(E, files);
    const rw = await realWorldFor(E, fmt);
    const W = fmt === "ocad" ? await import("./vmap/ocadwrite.js") : await import("./vmap/oomwrite.js");
    let skipped = 0;
    const models = designators.map((d) => ({ d, model: courseModel(E, d.cd, { overprint: v.over, variationName: d.variation || "", title: `${ev.title} — ${d.name}` }) }));
    await prepareImages(models.map((x) => x.model), fmt, ver);
    for (const { d, model } of models) {
      model.realWorld = rw; model.templates = template ? [template] : [];
      skipped += model.skipped;
      // the images: in OCAD 11 and later in the layout layer, kept in the file; else templates in front of the map, beside it
      for (const im of model.images) {
        const f = im.file, [l, b, r, t] = im.box, u = (r - l) / f.w, vv = (t - b) / f.h;
        if (fmt === "ocad" && ver >= 11) model.layoutImages.push({ file: f.name, data: f.bytes, x: l, y: t, u, v: vv });
        else { model.templates.push({ file: f.name, x: (l + r) / 2, y: (b + t) / 2, mmPerPx: u, mmPerPxY: vv, front: true }); files[f.name] = f.bytes; }
      }
      const base = fileName(`${v.prefix || ""}${d.name}`);
      if (fmt === "ocad") files[`${base}.ocd`] = W.writeOcad(model, ver);
      else files[`${base}.${fmt}`] = new TextEncoder().encode(W.writeOom(model, { xmap: fmt === "xmap" }));
    }
    await saveFiles(E, files, `${fileName(ev.title)} - ${fmt === "ocad" ? "OCAD" : "Mapper"}.zip`);
    E.status("Fichiers créés", "ok");
    if (skipped) E.toast(`${skipped} objet(s) du circuit n'ont pas pu être repris dans ces fichiers.`, 6000);
    else if (fmt !== "ocad" || ver <= 10) { if (models.some((x) => x.model.images.length)) E.toast("Les images placées sur la carte sont des modèles à part : gardez leurs fichiers à côté des cartes créées.", 6000); }
  } catch (err) { console.error(err); E.status("Fichiers impossibles", "bad"); E.toast(`Création impossible : ${err.message}`); }
}

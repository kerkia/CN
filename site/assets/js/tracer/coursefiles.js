// « Fichier › Fichiers OCAD ou Mapper des circuits » (Purple Pen's Create OCAD Files, OcadCreation; BSD licence, see
// /assets/tracer/LICENSE-PurplePen.txt): each course (or part, variation) becomes a map file that holds only the course —
// circles, lines, numbers, special objects and the description sheet as objects of course symbols in the course colours
// (purple, lower purple, 50 % purple, black, white) — with the event's map as its background template, to be finished or
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
  descriptions: ["790", "Définitions"], "white-out": ["890", "Masque blanc"], other: ["799", "Objet du circuit"],
};
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
  let skipped = 0;
  for (const it of items) {
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
    } else skipped++;
  }
  // the colour table: Purple Pen's order, from the bottom up
  const order = [44, ...colors.filter((c) => c.id >= 61).map((c) => c.id), 13, 12, 11, 0];
  colors.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const { box } = printBox(E, cd, layout);
  const ps = cd.course ? ev.courses[cd.course].printScale : ev.allControls.printScale;
  return { scale: ev.map.scale, printScale: ps || ev.map.scale, printArea: [box[0] + fx, box[1] + fy, box[2] + fx, box[3] + fy],
    notes: `${title || ev.title} — créé par O'CN (ocn.kerkia.com)`, colors, symbols, objects, skipped, realWorld: null, templates: [] };
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
    for (const d of designators) {
      const model = courseModel(E, d.cd, { overprint: v.over, variationName: d.variation || "", title: `${ev.title} — ${d.name}` });
      model.realWorld = rw; model.templates = template ? [template] : [];
      skipped += model.skipped;
      const base = fileName(`${v.prefix || ""}${d.name}`);
      if (fmt === "ocad") files[`${base}.ocd`] = W.writeOcad(model, ver);
      else files[`${base}.${fmt}`] = new TextEncoder().encode(W.writeOom(model, { xmap: fmt === "xmap" }));
    }
    await saveFiles(E, files, `${fileName(ev.title)} - ${fmt === "ocad" ? "OCAD" : "Mapper"}.zip`);
    E.status("Fichiers créés", "ok");
    if (skipped) E.toast("Les images placées sur la carte (objet « image ») ne sont pas reprises dans ces fichiers.", 6000);
  } catch (err) { console.error(err); E.status("Fichiers impossibles", "bad"); E.toast(`Création impossible : ${err.message}`); }
}

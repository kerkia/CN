// The editor's menus and dialogs (tracer/editor.js): one entry, action(E, name), for every menu item, toolbar button and
// right-click choice; the dialogs (event and course properties, appearance, IOF standards, numbering, codes, punch
// patterns, competitor loads, team, versions, encryption, variations…) are small forms in a modal box. The outputs
// (PDF, files, reports) load their modules when first asked for.

import * as M from "./model.js";
import * as S from "./store.js";
import { symbol, symbolName, loadSymbols, languages } from "./symbols.js";
import { family, FAMILY_LABEL } from "./fonts.js";
import { readPpen, writePpen } from "./ppen.js";
import { SPECIAL_NAME } from "./actions.js";
import * as A from "./actions.js";
import { mapPurple, mapColors, defaultLayer } from "./appear.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v) => new Intl.NumberFormat("fr-FR").format(v);

// ---- the modal box ---------------------------------------------------------------------------------------------------------
/** A modal form: returns a promise of the form's values (an object by input name) or null when cancelled. */
export function modal(E, { title, body, ok = "OK", cancel = "Annuler", wide = false, onOpen = null, validate = null, extra = "" }) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "tr-modal";
    m.innerHTML = `<div class="tr-dialog ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2><form class="tr-form" novalidate>${body}<p class="tr-err" hidden></p>
      <div class="tr-dlg-btns">${extra}${cancel ? `<button type="button" class="btn" data-x="cancel">${esc(cancel)}</button>` : ""}${ok ? `<button type="submit" class="btn btn-primary">${esc(ok)}</button>` : ""}</div></form></div>`;
    (E?.root || document.body).appendChild(m);
    const form = m.querySelector("form");
    const done = (v) => { m.remove(); resolve(v); };
    const values = () => {
      const o = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === "checkbox") o[el.name] = el.checked;
        else if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
        else if (el.type === "file") o[el.name] = el.files;
        else if (el.multiple) o[el.name] = [...el.selectedOptions].map((x) => x.value);
        else o[el.name] = el.value;
      }
      return o;
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = values();
      const err = validate ? await validate(v, form) : null;
      if (err) { const p = form.querySelector(".tr-err"); p.textContent = err; p.hidden = false; return; }
      done(v);
    });
    m.querySelector('[data-x="cancel"]')?.addEventListener("click", () => done(null));
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } });
    m.addEventListener("pointerdown", (e) => { if (e.target === m) done(null); });
    onOpen?.(form, done);
    (form.querySelector("input:not([type=hidden]), select, textarea") || form.querySelector("button[type=submit]"))?.focus();
  });
}
/** A drop zone: files dropped on it, anywhere on its dialog, or picked by a click on it go to onFiles (a list of File). */
export const dropHtml = (id, text, accept = "", multiple = true) => `<div class="tr-drop" id="${id}" tabindex="0" role="button" aria-label="${esc(text)}">
  <input type="file" ${multiple ? "multiple" : ""} ${accept ? `accept="${accept}"` : ""} hidden><span class="tr-drop-ico" aria-hidden="true">⇩</span><span>${esc(text)}</span></div>`;
export function dropZone(zone, onFiles) {
  const input = zone.querySelector("input[type=file]"), host = zone.closest(".tr-modal") || zone;
  const take = (files) => { if (files?.length) onFiles([...files]); };
  zone.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { take(input.files); input.value = ""; });
  host.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); zone.classList.add("over"); } });
  host.addEventListener("dragleave", (e) => { if (e.target === host || e.target === zone) zone.classList.remove("over"); });
  host.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); zone.classList.remove("over"); take(e.dataTransfer.files); });
}
export const confirm = (E, text, okLabel, then) => modal(E, { title: "Confirmer", body: `<p>${esc(text)}</p>`, ok: okLabel }).then((v) => { if (v) then(); });
const field = (label, input, hint = "") => `<label class="tr-field"><span>${esc(label)}</span>${input}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const num = (v) => { const x = Number(String(v).replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

/** A small menu at a screen point: items [action, label] or "-". */
export function popupMenu(E, cx, cy, items, onPick) {
  const pop = document.createElement("div");
  pop.className = "tr-pop tr-ctx";
  pop.innerHTML = items.map((it) => (it === "-" ? "<hr>" : `<button type="button" data-a="${it[0]}">${esc(it[1])}</button>`)).join("");
  E.root.appendChild(pop);
  const W = window.innerWidth, H = window.innerHeight;
  pop.style.left = `${Math.min(cx, W - pop.offsetWidth - 8)}px`; pop.style.top = `${Math.min(cy, H - pop.offsetHeight - 8)}px`;
  const close = () => { pop.remove(); document.removeEventListener("pointerdown", off, true); };
  const off = (e) => { if (!pop.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  pop.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => { close(); onPick(b.dataset.a); }));
}
export function specialMenu(E, btn) {
  const r = btn.getBoundingClientRect();
  const groups = [["Points", ["water", "first-aid", "optional-crossing-point", "forbidden-route", "registration-mark"]],
    ["Lignes et zones", ["boundary", "out-of-bounds", "dangerous-area", "temporary-construction", "white-out", "line"]], ["Cadres", ["text", "image", "rectangle", "ellipse"]]];
  const items = [];
  for (const [, ks] of groups) { if (items.length) items.push("-"); for (const k of ks) items.push([k, SPECIAL_NAME[k]]); }
  popupMenu(E, r.left, r.bottom + 4, items, (k) => E.setTool(`special:${k}`));
}

// ---- actions -------------------------------------------------------------------------------------------------------------------
const lazy = { pdf: () => import("./pdf.js"), out: () => import("./exports.js"), rep: () => import("./reports.js"), relay: () => import("./relay.js"), more: () => import("./extras.js") };
const needCourse = (E) => { if (!E.cd.course) { E.toast("Choisissez d'abord un circuit (onglet en haut)."); return false; } return true; };
const needSel = (E, kind) => { if (E.sel?.kind !== kind && !(kind === "control" && E.sel?.kind === "number")) { E.toast(kind === "control" ? "Choisissez d'abord un poste." : "Choisissez d'abord un interposte."); return false; } return true; };

export async function action(E, act, btn, at = {}) {
  const ev = E.ev, s = E.sel;
  const ro = () => { if (E.readOnly) { E.toast("Lecture seule."); return true; } return false; };
  switch (act) {
    case "save": await E.saveNow(true); break;
    case "version-save": versionSave(E); break;
    case "versions": versions(E); break;
    case "import-ppen": if (!ro()) importPpen(E); break;
    case "export-ppen": exportPpen(E); break;
    case "pdf-courses": (await lazy.pdf()).coursesDialog(E); break;
    case "pdf-descriptions": (await lazy.pdf()).descriptionsDialog(E); break;
    case "pdf-punch": (await lazy.pdf()).punchDialog(E); break;
    case "export-iof3": (await lazy.out()).iofXml(E, 3); break;
    case "export-iof2": (await lazy.out()).iofXml(E, 2); break;
    case "export-gpx": (await lazy.out()).gpx(E); break;
    case "export-kml": (await lazy.out()).kml(E); break;
    case "export-images": (await lazy.out()).imagesDialog(E); break;
    case "export-ocad": (await import("./coursefiles.js")).courseFilesDialog(E); break;
    case "export-routegadget": (await lazy.out()).routeGadget(E); break;
    case "export-csv": (await lazy.rep()).csvAll(E); break;
    case "publish": (await lazy.more()).publish(E); break;
    case "send-results": (await lazy.more()).sendCourses(E); break;
    case "offline": (await import("./offline.js")).offlineDialog(E); break;
    case "map-change": if (!ro()) (await lazy.more()).changeMap(E); break;
    case "event-props": if (!ro()) eventProps(E); break;
    case "appearance": if (!ro()) appearance(E); break;
    case "standards": if (!ro()) standards(E); break;
    case "numbering": if (!ro()) numbering(E); break;
    case "codes": if (!ro()) changeCodes(E); break;
    case "renumber": if (!ro()) confirm(E, "Renuméroter tous les postes à partir du premier code de l'événement ?", "Renuméroter", () => E.change((x) => M.autoRenumber(x), "Renumérotation")); break;
    case "remove-unused": if (!ro()) { const n = M.unusedControls(ev).length; if (!n) E.toast("Aucun poste inutilisé."); else confirm(E, `Supprimer ${n} poste(s) qui ne servent dans aucun circuit ?`, "Supprimer", () => E.change((x) => { M.removeUnused(x); }, "Postes inutilisés supprimés")); } break;
    case "move-all": if (!ro()) moveAll(E); break;
    case "calage": if (!ro()) (await import("./calage.js")).calage(E, { fromPpen: false }); break;
    case "custom-text": if (!ro()) customText(E); break;
    case "punch": if (!ro()) (await lazy.more()).punchPatterns(E); break;
    case "georef": (await lazy.more()).georef(E); break;
    case "load": if (!ro()) loads(E); break;
    case "team": team(E); break;
    case "encryption": encryption(E); break;
    case "course-new": if (!ro()) courseProps(E, 0); break;
    case "course-props": if (!ro() && needCourse(E)) courseProps(E, E.cd.course); break;
    case "course-dup": if (!ro() && needCourse(E)) { const v = await modal(E, { title: "Dupliquer le circuit", body: field("Nom de la copie", `<input name="name" value="${esc(E.course().name)} (copie)" required>`), ok: "Dupliquer" }); if (v?.name) { let id; E.change((x) => { id = M.duplicateCourse(x, E.cd.course, v.name.trim()); }, "Circuit dupliqué"); E.setCourse(id); } } break;
    case "course-delete": if (!ro() && needCourse(E)) confirm(E, `Supprimer le circuit « ${E.course().name} » ? (ses postes restent dans « Tous les postes »)`, "Supprimer", () => { const id = E.cd.course; E.change((x) => M.deleteCourse(x, id), "Circuit supprimé"); E.setCourse(M.courseIds(E.ev)[0] || 0); }); break;
    case "course-order": if (!ro()) courseOrder(E); break;
    case "var-fork": case "var-loop": if (!ro() && needCourse(E) && needSel(E, "control")) addVariation(E, act === "var-loop"); break;
    case "var-delete": if (!ro() && needCourse(E) && needSel(E, "control")) E.change((x) => M.deleteVariation(x, E.cd, s.cc), "Variante supprimée"); break;
    case "relay": if (needCourse(E)) (await lazy.relay()).relayDialog(E); break;
    case "print-area": (await lazy.pdf()).printAreaDialog(E); break;
    case "part-options": if (!ro() && needCourse(E)) partOptions(E); break;
    case "rep-summary": (await lazy.rep()).summary(E); break;
    case "rep-legs": (await lazy.rep()).legLengthsReport(E); break;
    case "rep-cross": (await lazy.rep()).crossRefReport(E); break;
    case "rep-load": (await lazy.rep()).loadReportDialog(E); break;
    case "rep-audit": (await lazy.rep()).auditReport(E); break;
    case "rep-climb": (await lazy.more()).climb(E); break;
    case "rep-times": (await lazy.more()).winningTimes(E); break;
    case "rep-pickup": (await lazy.more()).pickup(E); break;
    case "rep-after": (await lazy.more()).afterRace(E); break;
    case "comments": (await lazy.more()).comments(E); break;
    case "field": (await lazy.more()).fieldMode(E); break;
    case "view-course": E.fitCourse(); break;
    case "view-map": E.fitMap(); break;
    case "view-all": E.opts.allControls = !E.opts.allControls; E.refresh(); E.toast(E.opts.allControls ? "Tous les postes affichés en pâle." : "Postes des autres circuits masqués."); break;
    case "view-printarea": E.opts.printArea = !E.opts.printArea; E.redraw(); break;
    case "save-to": { const v = await modal(E, { title: "Plusieurs fichiers", body: `<label class="tr-check"><input type="radio" name="how" value="folder"> Les écrire dans un dossier de mon choix (Chrome, Edge)</label>
      <label class="tr-check"><input type="radio" name="how" value="zip"> Les télécharger en un .zip</label><label class="tr-check"><input type="radio" name="how" value="" checked> Me demander à chaque fois</label>` });
      if (v) { try { const o = JSON.parse(localStorage.getItem("ocn.tr.prefs") || "{}"); o.saveTo = v.how || null; localStorage.setItem("ocn.tr.prefs", JSON.stringify(o)); } catch (e) { /* not kept */ } } break; }
    case "view-others": (await lazy.more()).otherCourses(E); break;
    case "import-course": if (!ro()) (await lazy.more()).readCourseFromMap(E); break;
    case "take-lock": await E.takeLock(); break;
    // right-click and pane buttons
    case "delete": A.deleteSelection(E); break;
    case "control-props": if (s?.control) controlProps(E, s.control); break;
    case "rotate": rotateStretch(E, "rotate"); break;
    case "stretch": rotateStretch(E, "stretch"); break;
    case "toggle-exchange": if (!ro() && s?.cc) E.change((x) => { const cc = x.courseControls[s.cc]; cc.exchange = !cc.exchange; if (!cc.exchange) delete cc.flip; }, "Échange de carte"); break;
    case "points": if (!ro() && s?.cc) { const v = await modal(E, { title: "Points du poste", body: field("Points", `<input name="p" type="number" min="0" value="${ev.courseControls[s.cc].points || 0}">`) }); if (v) E.change((x) => { x.courseControls[s.cc].points = Math.max(0, Math.round(num(v.p)) || 0); }, "Points"); } break;
    case "text-before": case "text-after": if (!ro() && s?.control) textLine(E, { control: s.control, cc: s.cc, textKind: act === "text-before" ? "beforeCourseControl" : "afterCourseControl" }); break;
    case "gap-add-circle": if (!ro() && s?.control && at.p) { const c = ev.controls[s.control], a = M.angleDeg([c.x, c.y], at.p), r = 10; E.change((x) => M.addCircleGap(x, s.control, M.gapScale(x, E.course()?.printScale || x.allControls.printScale), [c.x + Math.cos((a - r) * Math.PI / 180), c.y + Math.sin((a - r) * Math.PI / 180)], [c.x + Math.cos((a + r) * Math.PI / 180), c.y + Math.sin((a + r) * Math.PI / 180)]), "Coupure du cercle"); } break;
    case "number-auto": if (!ro() && s?.control) E.change((x) => { if (s.cc && x.courseControls[s.cc]) delete x.courseControls[s.cc].number; else delete x.controls[s.control].codeAngle; }, "Numéro automatique"); break;
    case "bend-add": if (!ro() && s?.kind === "leg" && at.p) E.change((x) => M.addBend(x, s.c1, s.c2, M.nearest(M.legPoints(x, s.c1, s.c2), at.p).at), "Coude ajouté"); break;
    case "bend-remove": { const h = A.handleAt(E, at.sx, at.sy); if (!ro() && h?.type === "bend") E.change((x) => M.removeBend(x, h.c1, h.c2, h.pt), "Coude retiré"); break; }
    case "gap-add-leg": if (!ro() && s?.kind === "leg" && at.p) { const pts = M.legPoints(ev, s.c1, s.c2), n = M.nearest(pts, at.p), w = 1.2 * (E.layout?.ratio || 1); E.change((x) => M.addLegGap(x, s.c1, s.c2, M.pointAt(pts, n.len - w), M.pointAt(pts, n.len + w)), "Coupure"); } break;
    case "gap-remove-leg": if (!ro() && s?.kind === "leg" && at.p) E.change((x) => M.removeLegGap(x, s.c1, s.c2, at.p), "Coupure refermée"); break;
    case "route-clear": if (!ro() && s?.kind === "leg") E.change((x) => M.setLegRoute(x, s.c1, s.c2, null), "Itinéraire effacé"); break;
    case "flag-none": case "flag-all": case "flag-begin": case "flag-end": if (!ro() && s?.kind === "leg") E.change((x) => M.setFlagging(x, s.c1, s.c2, act.slice(5)), "Balisage"); break;
    case "special-props": if (!ro() && s?.kind === "special") specialProps(E, s.id); break;
    case "corner-add": if (!ro() && s?.kind === "special" && at.p) E.change((x) => M.addSpecialCorner(x, s.id, at.p), "Sommet ajouté"); break;
    case "corner-remove": { const h = A.handleAt(E, at.sx, at.sy); if (!ro() && h?.type === "corner") E.change((x) => M.removeSpecialCorner(x, h.id, h.pt), "Sommet retiré"); break; }
    case "displayed-courses": if (!ro() && s?.kind === "special") displayedCourses(E, s.id); break;
    default: E.toast(`Action inconnue : ${act}`);
  }
  void btn;
}

// ---- dialogs -------------------------------------------------------------------------------------------------------------------
export async function eventTitle(E) {
  const v = await modal(E, { title: "Titre de l'événement", body: field("Titre (une barre | sépare deux lignes)", `<input name="t" value="${esc(E.ev.title)}" required>`) });
  if (v) E.change((x) => { x.title = v.t.trim(); }, "Titre");
}
/** The languages of Purple Pen's symbol file, by their own names (the event's, if another, kept). */
function langChoices(cur) {
  const L = languages(), up = (s, k) => { try { return s.charAt(0).toLocaleUpperCase(k) + s.slice(1); } catch (e) { return s; } };
  const list = Object.entries(L).map(([k, v]) => [k, up(v.name || k, k)]).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  if (cur && !L[cur]) list.unshift([cur, `${cur} (pas dans le fichier de symboles : textes en anglais)`]);
  return list;
}
/** The fonts a text object offers, with the one it already names (a .ppen may name any). */
function fontChoices(cur) {
  const list = [["Arial", "Arial"], ["Roboto", "Roboto"], ["Roboto Condensed", "Roboto Condensed"], ["Times New Roman", "Times New Roman"], ["Courier New", "Courier New"]];
  if (cur && !list.some(([v]) => v === cur)) list.push([cur, `${cur} (imprimée en ${FAMILY_LABEL[family(cur)]})`]);
  return list;
}
async function eventProps(E) {
  const ev = E.ev;
  await loadSymbols();
  const v = await modal(E, { title: "Propriétés de l'événement", body: `
    ${field("Titre (une barre | sépare deux lignes sur les définitions)", `<input name="title" value="${esc(ev.title)}" required>`)}
    ${field("Échelle de la carte (1:…)", `<input name="scale" value="${ev.map.scale}" inputmode="numeric" required>`, "L'échelle de la carte elle-même ; chaque circuit a son échelle d'impression.")}
    ${ev.map.kind === "bitmap" ? field("Résolution de l'image (points par pouce)", `<input name="dpi" value="${ev.map.dpi}" inputmode="numeric">`, "Sert à mesurer les distances : vérifiez une distance connue.") : ""}
    ${field("Échelle d'impression de « Tous les postes »", `<input name="acScale" value="${ev.allControls.printScale}" inputmode="numeric">`)}
    ${field("Langue des définitions en texte", sel("lang", langChoices(ev.lang), ev.lang), "Les langues du fichier de symboles de Purple Pen")}
    ${field("Notes", `<textarea name="notes" rows="3">${esc(ev.notes || "")}</textarea>`)}`,
  validate: (o) => (!(num(o.scale) > 100) ? "Échelle de carte invalide." : ev.map.kind === "bitmap" && !(num(o.dpi) > 10) ? "Résolution invalide." : null) });
  if (!v) return;
  if (!["fr", "en"].includes(v.lang)) await (await import("./symbols.js")).loadAllTexts();
  E.change((x) => {
    x.title = v.title.trim(); x.notes = v.notes;
    const scale = num(v.scale);
    if (x.map.kind === "bitmap") { const dpi = num(v.dpi); x.map.w = x.map.w * x.map.dpi / dpi; x.map.h = x.map.h * x.map.dpi / dpi; x.map.dpi = dpi; }
    x.map.scale = scale; x.allControls.printScale = num(v.acScale) || scale; x.lang = v.lang;
  }, "Propriétés de l'événement");
}
async function appearance(E) {
  const a = E.ev.appearance;
  // the default purple is the map's own when an OCAD or Mapper map has one (Purple Pen), else the IOF's
  const mp = mapPurple(E.map), dflt = mp || M.PURPLE, purple = a.purple || dflt, pct = (c) => c.map((x) => Math.round(x * 100)).join(" ");
  const cols = mapColors(E.map), vector = cols.length > 0;
  const layerId = cols.some(([id]) => id === a.lowerPurpleLayer) ? a.lowerPurpleLayer : defaultLayer(E.map);
  const blends = [["none", "Aucun"], ["blend", "Mélange (le noir reste visible)"], ...(vector ? [["layer", "Couches (le violet sous les couleurs de la carte choisies)"]] : [])];
  const v = await modal(E, { title: "Apparence des circuits", wide: true, body: `
    <div class="tr-grid2">
    ${field("Taille des cercles (× norme)", `<input name="cs" value="${a.controlCircleSize}">`)}
    ${field("Épaisseur des traits (× norme)", `<input name="lw" value="${a.lineWidth}">`)}
    ${field("Hauteur des numéros (× norme)", `<input name="nh" value="${a.numberHeight}">`)}
    ${field("Point central (mm, 0 = aucun)", `<input name="dot" value="${a.centerDot}">`)}
    ${field("Police des numéros", sel("font", [["Roboto", "Roboto"], ["Arial", "Arial (ISOM 2017)"]], a.numberFont))}
    <label class="tr-check"><input type="checkbox" name="bold" ${a.numberBold ? "checked" : ""}> Numéros en gras</label>
    ${field("Contour blanc des numéros (mm)", `<input name="outline" value="${a.numberOutline}">`)}
    ${field("Coupure automatique des interpostes (mm)", `<input name="gap" value="${a.autoLegGap}">`, "0 : pas de coupure aux croisements")}
    ${field("Taille selon l'échelle d'impression", sel("scaling", [["None", "Ne pas agrandir"], ["RelativeToMap", "Relative à l'échelle de la carte"], ["RelativeTo15000", "Relative au 1:15 000 (ISOM 2017)"]], a.itemScaling))}
    ${field("Mélange du violet avec la carte", sel("blend", blends, a.blend === "layer" && !vector ? "blend" : a.blend), vector ? "" : "La mise en couches demande une carte OCAD ou OpenOrienteering Mapper.")}
    ${vector ? field("Violet inférieur sous la couleur", sel("layer", cols.map(([id, n]) => [id, n]), layerId), "Mode « Couches » : les cercles et les traits passent sous les couleurs de la carte au-dessus de celle-ci ; les numéros restent dessus.") : ""}
    <label class="tr-check"><input type="checkbox" name="dpurple" ${a.purple ? "" : "checked"}> Violet par défaut : ${esc(mp ? `celui de la carte (${pct(mp)})` : `IOF (${pct(M.PURPLE)})`)}</label>
    ${field("Violet CMJN (%)", `<input name="cmyk" value="${pct(purple)}">`, "4 nombres : cyan magenta jaune noir")}
    ${vector ? `<label class="tr-check"><input type="checkbox" name="over" ${a.ocadOverprint ? "checked" : ""}> Effets de surimpression de la carte (couleurs « surimpression » fondues, comme à l'impression)</label>` : ""}
    <label class="tr-check"><input type="checkbox" name="descPurple" ${a.descriptionsPurple ? "checked" : ""}> Définitions sur la carte en violet</label>
    </div>`,
  onOpen: (f) => {
    const sync = () => {
      f.elements.cmyk.disabled = f.elements.dpurple.checked;
      if (f.elements.dpurple.checked) f.elements.cmyk.value = pct(dflt);
      if (f.elements.layer) f.elements.layer.disabled = f.elements.blend.value !== "layer";
    };
    f.elements.dpurple.addEventListener("change", sync); f.elements.blend.addEventListener("change", sync); sync();
  },
  validate: (o) => ([o.cs, o.lw, o.nh].some((x) => !(num(x) > 0)) ? "Les tailles doivent être positives." : !o.dpurple && o.cmyk.trim().split(/[\s,;]+/).length !== 4 ? "Quatre nombres pour le violet." : null) });
  if (!v) return;
  E.change((x) => {
    const ap = x.appearance;
    ap.controlCircleSize = num(v.cs); ap.lineWidth = num(v.lw); ap.numberHeight = num(v.nh); ap.centerDot = Math.max(0, num(v.dot) || 0);
    ap.numberFont = v.font; ap.numberBold = v.bold; ap.numberOutline = Math.max(0, num(v.outline) || 0); ap.autoLegGap = Math.max(0, num(v.gap) || 0);
    ap.itemScaling = v.scaling; ap.blend = v.blend; ap.descriptionsPurple = v.descPurple;
    if (vector && v.blend === "layer" && v.layer != null) ap.lowerPurpleLayer = Number(v.layer);
    if (vector) ap.ocadOverprint = !!v.over;
    const cm = v.dpurple ? null : v.cmyk.trim().split(/[\s,;]+/).map((y) => Math.min(100, Math.max(0, num(y))) / 100);
    ap.purple = !cm || cm.every((y, i) => Math.abs(y - dflt[i]) < 0.005) ? null : cm;
  }, "Apparence");
}
async function standards(E) {
  const v = await modal(E, { title: "Normes IOF", body: `
    ${field("Définitions de postes", sel("desc", [["2018", "IOF 2018/2024"], ["2004", "IOF 2004"]], E.ev.descStandard))}
    ${field("Carte (tailles des symboles)", sel("map", [["2017", "ISOM 2017 (forêt)"], ["Spr2019", "ISSprOM 2019 (sprint)"], ["2000", "ISOM 2000"]], E.ev.appearance.mapStandard))}` });
  if (!v) return;
  E.change((x) => {
    x.descStandard = v.desc; x.appearance.mapStandard = v.map;
    // symbols that do not exist in the new standard take their replacement (ChangeEvent.UpdateDescriptionToMatchStandard)
    for (const c of Object.values(x.controls)) c.symbols = c.symbols.map((id) => {
      if (!id || symbol(id, v.desc)) return id;
      const old = symbol(id, v.desc === "2018" ? "2004" : "2018");
      return old?.repl && symbol(old.repl, v.desc) ? old.repl : id;
    });
  }, "Normes IOF");
}
async function numbering(E) {
  const n = E.ev.numbering;
  const v = await modal(E, { title: "Numérotation automatique", body: `${field("Premier code", `<input name="start" value="${n.start}" inputmode="numeric">`)}
    <label class="tr-check"><input type="checkbox" name="inv" ${n.noInvertible ? "checked" : ""}> Éviter les codes lisibles à l'envers (61, 68, 86…)</label>
    <label class="tr-check"><input type="checkbox" name="now"> Renuméroter tous les postes maintenant</label>`,
  validate: (o) => (!(num(o.start) >= 1 && num(o.start) < 1000) ? "Un code de 1 à 999." : null) });
  if (!v) return;
  E.change((x) => { x.numbering = { start: Math.round(num(v.start)), noInvertible: v.inv }; if (v.now) M.autoRenumber(x); }, "Numérotation");
}
async function changeCodes(E) {
  const ids = Object.keys(E.ev.controls).map(Number).filter((id) => E.ev.controls[id].kind === "normal").sort((a, b) => M.compareControls(E.ev, a, b));
  const v = await modal(E, { title: "Changer les codes", wide: true, body: `<div class="tr-codes">${ids.map((id) => `<label>${esc(E.ev.controls[id].code)} → <input name="c${id}" value="${esc(E.ev.controls[id].code)}" size="4" maxlength="3"></label>`).join("")}</div>`,
    validate: (o) => {
      const codes = ids.map((id) => o[`c${id}`].trim());
      if (codes.some((c) => !c || c.length > 3 || /\s/.test(c))) return "Chaque code a de 1 à 3 caractères, sans espace.";
      const dup = codes.find((c, i) => codes.indexOf(c) !== i);
      return dup ? `Le code ${dup} est en double.` : null;
    } });
  if (v) E.change((x) => { for (const id of ids) x.controls[id].code = v[`c${id}`].trim(); }, "Codes changés");
}
async function moveAll(E) {
  const v = await modal(E, { title: "Déplacer tous les postes", body: `<p>Après une mise à jour de la carte : décaler, tourner ou mettre à l'échelle tous les objets.</p>
    <div class="tr-grid2">${field("Décalage vers la droite (mm)", '<input name="dx" value="0">')}${field("Décalage vers le haut (mm)", '<input name="dy" value="0">')}
    ${field("Rotation (degrés, sens inverse des aiguilles)", '<input name="rot" value="0">')}${field("Facteur d'échelle", '<input name="k" value="1">')}</div>
    <p class="tr-hint">Rotation et échelle autour du centre des postes.</p>` });
  if (!v) return;
  const dx = num(v.dx) || 0, dy = num(v.dy) || 0, a = (num(v.rot) || 0) * Math.PI / 180, k = num(v.k) || 1;
  const cs = Object.values(E.ev.controls), cx = cs.reduce((s, c) => s + c.x, 0) / (cs.length || 1), cy = cs.reduce((s, c) => s + c.y, 0) / (cs.length || 1);
  const c = Math.cos(a) * k, sn = Math.sin(a) * k;
  E.change((x) => M.transformAll(x, [c, -sn, sn, c, cx - c * cx + sn * cy + dx, cy - sn * cx - c * cy + dy]), "Tous les postes déplacés");
}
export async function courseProps(E, courseId, focus = null) {
  const c = courseId ? E.ev.courses[courseId] : null;
  const isNew = !c;
  const d = c || { kind: "normal", name: "", printScale: E.ev.map.scale, climb: -1, length: null, secondary: "", descKind: "symbols", labels: "sequence", firstNumber: 1, scoreColumn: 0, hideFromReports: false, load: -1 };
  const v = await modal(E, { title: isNew ? "Nouveau circuit" : `Propriétés du circuit ${c.name}`, wide: true, body: `<div class="tr-grid2">
    ${field("Nom", `<input name="name" value="${esc(d.name)}" required>`)}
    ${field("Type", sel("kind", [["normal", "Circuit normal"], ["score", "Circuit au score"]], d.kind))}
    ${field("Catégories (2e ligne des définitions)", `<input name="secondary" value="${esc(d.secondary || "")}" placeholder="H21E, D21E">`, "Séparées par des virgules pour l'export IOF XML")}
    ${field("Dénivelée (m, vide = aucune)", `<input name="climb" value="${d.climb >= 0 ? d.climb : ""}" inputmode="numeric">`)}
    ${field("Longueur (km, vide = calculée)", `<input name="length" value="${d.length ?? ""}" inputmode="decimal">`)}
    ${field("Échelle d'impression (1:…)", `<input name="ps" value="${d.printScale}" inputmode="numeric" required>`)}
    ${field("Définitions", sel("descKind", [["symbols", "Symboles"], ["text", "Texte"], ["symbols-and-text", "Symboles et texte"]], d.descKind))}
    ${field("Étiquettes des postes", sel("labels", [["sequence", "Numéro d'ordre"], ["code", "Code"], ["sequence-and-code", "Numéro et code (VTT)"], ["sequence-and-score", "Numéro et points"], ["code-and-score", "Code et points"], ["score", "Points"]], d.labels))}
    ${field("Premier numéro", `<input name="first" value="${d.firstNumber}" inputmode="numeric">`)}
    ${field("Points du score (colonne)", sel("scoreCol", [["0", "A"], ["1", "B"], ["7", "H"], ["-1", "aucune"]], d.scoreColumn ?? 0))}
    ${field("Concurrents attendus", `<input name="load" value="${d.load >= 0 ? d.load : ""}" inputmode="numeric">`)}
    <label class="tr-check"><input type="checkbox" name="hide" ${d.hideFromReports ? "checked" : ""}> Circuit d'essai (hors rapports)</label></div>`,
  onOpen: (f) => { if (focus) f.elements[focus]?.focus(); },
  validate: (o) => (!o.name.trim() ? "Un nom." : !(num(o.ps) > 100) ? "Échelle d'impression invalide." : o.climb && !(num(o.climb) >= 0) ? "Dénivelée invalide." : o.length && !(num(o.length) > 0) ? "Longueur invalide." : null) });
  if (!v) return;
  const props = { name: v.name.trim(), kind: v.kind, secondary: v.secondary.trim() || null, climb: v.climb === "" ? -1 : num(v.climb), length: v.length === "" ? null : num(v.length),
    printScale: num(v.ps), descKind: v.descKind, labels: v.kind === "score" ? v.labels : ["sequence", "code", "sequence-and-code"].includes(v.labels) ? v.labels : "sequence",
    firstNumber: Math.max(1, Math.round(num(v.first)) || 1), scoreColumn: v.kind === "score" ? Number(v.scoreCol) : -1, hideFromReports: v.hide, load: v.load === "" ? -1 : Math.round(num(v.load)) };
  if (isNew) {
    let id;
    E.change((x) => { id = M.createCourse(x, props); Object.assign(x.courses[id], props); }, "Nouveau circuit");
    E.setCourse(id);
  } else E.change((x) => Object.assign(x.courses[courseId], props), "Propriétés du circuit");
}
async function courseOrder(E) {
  const ids = M.courseIds(E.ev);
  const v = await modal(E, { title: "Ordre des circuits", body: `<ol class="tr-order">${ids.map((id) => `<li data-id="${id}"><span>${esc(E.ev.courses[id].name)}</span>
    <button type="button" class="btn btn-sm" data-up>▲</button><button type="button" class="btn btn-sm" data-down>▼</button></li>`).join("")}</ol><input type="hidden" name="order">`,
  onOpen: (f) => {
    const list = f.querySelector(".tr-order");
    const sync = () => { f.elements.order.value = [...list.children].map((li) => li.dataset.id).join(","); };
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li"); if (!li) return;
      if (e.target.closest("[data-up]") && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (e.target.closest("[data-down]") && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      sync();
    });
    sync();
  } });
  if (v) E.change((x) => { v.order.split(",").map(Number).forEach((id, i) => { x.courses[id].order = i + 1; }); }, "Ordre des circuits");
}
async function addVariation(E, loop) {
  const prob = M.variationProblem(E.ev, E.cd, E.sel.cc);
  if (prob) { E.toast({ all: "Pas de variante dans « Tous les postes ».", score: "Pas de variante dans un circuit au score.", none: "Choisissez un poste.", finish: "Pas de variante sur le dernier poste.", exists: "Une variante part déjà de ce poste." }[prob]); return; }
  const v = await modal(E, { title: loop ? "Boucles" : "Fourche", body: field(loop ? "Nombre de boucles" : "Nombre de branches", `<input name="n" type="number" min="2" max="8" value="${loop ? 2 : 2}">`,
    loop ? "Le poste choisi est le point de passage des boucles ; ajoutez ensuite les postes de chaque boucle." : "Ajoutez ensuite les postes de chaque branche : choisissez la branche avec le sélecteur de variante.") });
  if (!v) return;
  E.change((x) => M.addVariation(x, E.cd, E.sel.cc, loop, Math.max(2, Math.min(8, Math.round(num(v.n)) || 2))), loop ? "Boucles" : "Fourche");
}
async function partOptions(E) {
  if (E.cd.part < 0) { E.toast("Choisissez une partie (au-dessus de la carte)."); return; }
  const o = M.partOptions(E.ev, E.cd);
  const v = await modal(E, { title: `Partie ${E.cd.part + 1}`, body: `<label class="tr-check"><input type="checkbox" name="sf" ${o.showFinish ? "checked" : ""}> Montrer l'arrivée sur cette partie</label>` });
  if (v) E.change((x) => { x.courses[E.cd.course].partOptions = { ...(x.courses[E.cd.course].partOptions || {}), [E.cd.part]: { showFinish: v.sf } }; }, "Options de la partie");
}
async function loads(E) {
  const ids = M.courseIds(E.ev);
  const v = await modal(E, { title: "Charge des concurrents", body: `<p>Le nombre de concurrents attendus par circuit : la charge de chaque poste et interposte en découle.</p>
    <table class="tr-table"><tbody>${ids.map((id) => `<tr><td>${esc(E.ev.courses[id].name)}</td><td><input name="l${id}" value="${E.ev.courses[id].load >= 0 ? E.ev.courses[id].load : ""}" size="5" inputmode="numeric"></td></tr>`).join("")}</tbody></table>
    <p class="tr-hint">Inscriptions connues de la course : <button type="button" class="btn btn-sm" id="tr-loads-fill">Remplir d'après les inscriptions FFCO</button></p>`,
  onOpen: (f) => f.querySelector("#tr-loads-fill").addEventListener("click", async () => {
    const fill = await (await import("./extras.js")).registrationLoads(E);
    if (!fill) return;
    for (const id of ids) if (fill[id] != null) f.elements[`l${id}`].value = fill[id];
  }) });
  if (v) E.change((x) => { for (const id of ids) x.courses[id].load = v[`l${id}`] === "" ? -1 : Math.max(0, Math.round(num(v[`l${id}`])) || 0); }, "Charge des concurrents");
}
export async function customText(E, controlId = null) {
  if (controlId) {
    const c = E.ev.controls[controlId];
    const v = await modal(E, { title: "Texte de la définition", body: field("Texte propre à ce poste (vide = texte calculé)", `<textarea name="t" rows="3">${esc(c.descText || "")}</textarea>`) });
    if (v) E.change((x) => { x.controls[controlId].descText = v.t.trim() || undefined; if (!v.t.trim()) delete x.controls[controlId].descText; }, "Texte de la définition");
    return;
  }
  (await import("./extras.js")).customSymbolText(E);
}
export async function textLine(E, line) {
  const cc = line.cc ? E.ev.courseControls[line.cc] : null, c = E.ev.controls[line.control];
  const before = line.textKind?.startsWith("before"), onCourse = line.textKind?.includes("Course");
  const cur = onCourse ? (before ? cc?.before : cc?.after) : (before ? c.before : c.after);
  const v = await modal(E, { title: before ? "Ligne de texte avant le poste" : "Ligne de texte après le poste", body: `${field("Texte (vide = pas de ligne ; | pour deux lignes)", `<input name="t" value="${esc(cur || "")}">`)}
    <label class="tr-check"><input type="checkbox" name="all" ${!onCourse ? "checked" : ""}> Sur tous les circuits qui passent à ce poste</label>` });
  if (!v) return;
  E.change((x) => {
    const t = v.t.trim() || undefined, key = before ? "before" : "after";
    if (v.all) { x.controls[line.control][key] = t; if (cc) delete x.courseControls[line.cc][key]; }
    else if (line.cc) { x.courseControls[line.cc][key] = t; }
    for (const o of [x.controls[line.control], line.cc ? x.courseControls[line.cc] : null]) if (o && !o[key]) delete o[key];
  }, "Ligne de texte");
}
export async function codeEdit(E, controlId) {
  const c = E.ev.controls[controlId];
  const v = await modal(E, { title: "Code du poste", body: field("Code (1 à 3 caractères)", `<input name="code" value="${esc(c.code)}" maxlength="3" required>`),
    validate: (o) => { const p = M.codeProblem(E.ev, o.code.trim()), other = M.findCode(E.ev, o.code.trim()); return p === "length" || p === "space" ? "1 à 3 caractères, sans espace." : other && other !== controlId ? "Ce code est déjà pris." : null; } });
  if (v) E.change((x) => { x.controls[controlId].code = v.code.trim(); }, "Code changé");
}
export async function controlProps(E, controlId) {
  const c = E.ev.controls[controlId];
  const v = await modal(E, { title: c.kind === "normal" ? `Poste ${c.code}` : "Départ", body: `
    ${c.kind === "normal" ? field("Code", `<input name="code" value="${esc(c.code)}" maxlength="3">`) : ""}
    ${field("Dimensions (colonne F)", `<input name="f" value="${esc(c.colF || "")}" placeholder="2.5, 3x4, 2/1">`)}
    ${field("Texte de la définition (vide = calculé)", `<textarea name="t" rows="2">${esc(c.descText || "")}</textarea>`)}
    ${field("Notes de l'équipe (non imprimées)", `<textarea name="notes" rows="2">${esc(c.notes || "")}</textarea>`)}
    <p class="tr-hint">Les symboles se choisissent dans les cases des définitions, à gauche.</p>`,
  validate: (o) => { if (c.kind !== "normal") return null; const p = M.codeProblem(E.ev, o.code.trim()), other = M.findCode(E.ev, o.code.trim()); return p === "length" || p === "space" ? "Code : 1 à 3 caractères." : other && other !== controlId ? "Ce code est déjà pris." : null; } });
  if (!v) return;
  E.change((x) => {
    const k = x.controls[controlId];
    if (k.kind === "normal") k.code = v.code.trim();
    k.colF = v.f.trim() || null; if (k.colF) k.symbols[3] = null;
    if (v.t.trim()) k.descText = v.t.trim(); else delete k.descText;
    if (v.notes.trim()) k.notes = v.notes.trim(); else delete k.notes;
  }, "Poste modifié");
}
async function rotateStretch(E, what) {
  const s = E.sel;
  const obj = s?.kind === "special" ? E.ev.specials[s.id] : s?.control ? E.ev.controls[s.control] : null;
  if (!obj || !(obj.kind === "crossing" || obj.kind === "optional-crossing-point")) { E.toast("Choisissez un point de passage."); return; }
  const v = await modal(E, { title: what === "rotate" ? "Orientation" : "Étirement", body: what === "rotate"
    ? field("Orientation (degrés, sens inverse des aiguilles)", `<input name="v" value="${Math.round(obj.orientation || 0)}">`)
    : field("Étirement (mm)", `<input name="v" value="${obj.stretch || 0}">`) });
  if (!v) return;
  E.change((x) => { const o = s.kind === "special" ? x.specials[s.id] : x.controls[s.control]; if (what === "rotate") o.orientation = num(v.v) || 0; else o.stretch = Math.max(0, num(v.v) || 0); }, what === "rotate" ? "Orientation" : "Étirement");
}
export async function specialProps(E, id) {
  const sp = E.ev.specials[id];
  if (sp.kind === "text") return textProps(E, id, (look) => E.change((x) => Object.assign(x.specials[id], look), "Texte modifié"));
  if (["line", "rectangle", "ellipse"].includes(sp.kind)) return lineAppearance(E, id, (look) => E.change((x) => Object.assign(x.specials[id], look), "Apparence"));
  if (sp.kind === "descriptions") {
    const v = await modal(E, { title: "Définitions sur la carte", body: field("Nombre de colonnes", `<input name="c" type="number" min="1" max="6" value="${sp.columns || 1}">`) });
    if (v) E.change((x) => { x.specials[id].columns = Math.max(1, Math.min(6, Math.round(num(v.c)) || 1)); }, "Colonnes");
  }
}
const COLOR_OPTS = [["purple", "Violet"], ["lower-purple", "Violet (sous la carte)"], ["black", "Noir"], ["custom", "Couleur CMJN…"]];
export async function textProps(E, id, then) {
  const sp = id ? E.ev.specials[id] : { text: "$(CourseName)", font: { name: "Arial", bold: true, italic: false, height: -1 }, color: "purple" };
  const col = Array.isArray(sp.color) ? "custom" : sp.color;
  const v = await modal(E, { title: "Texte", body: `
    ${field("Texte", `<textarea name="text" rows="3">${esc(sp.text)}</textarea>`, "Champs : $(EventTitle) $(CourseName) $(CourseLength) $(CourseClimb) $(ClassList) $(PrintScale) $(CoursePart) $(Variation) $(RelayTeam) $(RelayLeg)")}
    <div class="tr-grid2">${field("Police", sel("font", fontChoices(sp.font?.name || "Arial"), sp.font?.name || "Arial"), "Imprimée en Roboto, Helvetica (Arial), Times ou Courier, avec son gras et son italique")}
    ${field("Hauteur des capitales (mm, vide = remplir le cadre)", `<input name="h" value="${sp.font?.height > 0 ? sp.font.height : ""}">`)}
    <label class="tr-check"><input type="checkbox" name="bold" ${sp.font?.bold ? "checked" : ""}> Gras</label><label class="tr-check"><input type="checkbox" name="italic" ${sp.font?.italic ? "checked" : ""}> Italique</label>
    ${field("Couleur", sel("color", COLOR_OPTS, col))}${field("CMJN (%)", `<input name="cmyk" value="${Array.isArray(sp.color) ? sp.color.map((x) => Math.round(x * 100)).join(" ") : "0 0 0 100"}">`)}</div>` });
  if (!v) return;
  then({ text: v.text, font: { name: v.font, bold: v.bold, italic: v.italic, height: v.h === "" ? -1 : num(v.h) }, color: v.color === "custom" ? v.cmyk.trim().split(/[\s,;]+/).map((x) => (num(x) || 0) / 100) : v.color });
}
export async function lineAppearance(E, idOrKind, then) {
  const sp = typeof idOrKind === "number" ? E.ev.specials[idOrKind] : { lineKind: "single", lineWidth: 0.35, gapSize: 0.5, dashSize: 1.5, radius: 0, color: "purple" };
  const col = Array.isArray(sp.color) ? "custom" : sp.color || "purple";
  const v = await modal(E, { title: "Apparence du trait", body: `<div class="tr-grid2">
    ${field("Trait", sel("kind", [["single", "Simple"], ["double", "Double"], ["dashed", "Tirets"]], sp.lineKind || "single"))}
    ${field("Épaisseur (mm)", `<input name="w" value="${sp.lineWidth || 0.35}">`)}
    ${field("Écart (mm)", `<input name="gap" value="${sp.gapSize || 0.5}">`)}${field("Longueur des tirets (mm)", `<input name="dash" value="${sp.dashSize || 1.5}">`)}
    ${(sp.kind === "rectangle" || idOrKind === "rectangle") ? field("Rayon des coins (mm)", `<input name="r" value="${sp.radius || 0}">`) : '<input type="hidden" name="r" value="0">'}
    ${field("Couleur", sel("color", COLOR_OPTS, col))}${field("CMJN (%)", `<input name="cmyk" value="${Array.isArray(sp.color) ? sp.color.map((x) => Math.round(x * 100)).join(" ") : "0 0 0 100"}">`)}</div>` });
  if (!v) return;
  then({ lineKind: v.kind, lineWidth: num(v.w) || 0.35, gapSize: num(v.gap) || 0, dashSize: num(v.dash) || 0, radius: num(v.r) || 0,
    color: v.color === "custom" ? v.cmyk.trim().split(/[\s,;]+/).map((x) => (num(x) || 0) / 100) : v.color });
}
export async function imageFile(E, then) {
  const v = await modal(E, { title: "Image", body: field("Image (PNG, JPEG)", '<input type="file" name="f" accept="image/png,image/jpeg">'), validate: (o) => (!o.f?.length ? "Choisissez une image." : null) });
  if (!v) return;
  const f = v.f[0], buf = new Uint8Array(await f.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  then({ image: { format: /png/i.test(f.type) ? "png" : "jpeg", data: btoa(s) }, text: f.name });
}
async function displayedCourses(E, id) {
  const sp = E.ev.specials[id], ids = M.courseIds(E.ev);
  const on = (c, part = -1) => sp.all || sp.courses.some((x) => x.course === c && (x.part ?? -1) === part);
  const v = await modal(E, { title: "Circuits où l'objet apparaît", body: `<div class="tr-checks">
    <label class="tr-check"><input type="checkbox" name="c0" ${on(0) ? "checked" : ""}> Tous les postes</label>
    ${ids.map((c) => `<label class="tr-check"><input type="checkbox" name="c${c}" ${on(c) ? "checked" : ""}> ${esc(E.ev.courses[c].name)}</label>`).join("")}</div>
    <p><button type="button" class="btn btn-sm" id="tr-all">Tous</button> <button type="button" class="btn btn-sm" id="tr-none">Aucun</button></p>`,
  onOpen: (f) => {
    f.querySelector("#tr-all").addEventListener("click", () => f.querySelectorAll("input[type=checkbox]").forEach((x) => { x.checked = true; }));
    f.querySelector("#tr-none").addEventListener("click", () => f.querySelectorAll("input[type=checkbox]").forEach((x) => { x.checked = false; }));
  } });
  if (!v) return;
  const cds = [0, ...ids].filter((c) => v[`c${c}`]).map((c) => ({ course: c, part: -1 }));
  E.change((x) => M.setDisplayedCourses(x, id, cds), "Circuits de l'objet");
}
export function issueKind(E, then) {
  modal(E, { title: "Point de remise de carte", body: `<p>Où les coureurs reçoivent-ils la carte ?</p>
    <label class="tr-check"><input type="radio" name="k" value="beginning" checked> Au début du trajet balisé vers le départ</label>
    <label class="tr-check"><input type="radio" name="k" value="middle"> Au milieu du trajet balisé</label>
    <label class="tr-check"><input type="radio" name="k" value="end"> Au triangle de départ</label>` }).then((v) => { if (v) then(v.k); });
}
export async function sharedMove(E, hit, others, to) {
  const names = others.map((x) => E.ev.courses[x].name).join(", ");
  const v = await modal(E, { title: "Poste commun", body: `<p>Ce poste sert aussi sur : ${esc(names)}.</p>
    <label class="tr-check"><input type="radio" name="w" value="all" checked> Le déplacer dans tous les circuits</label>
    <label class="tr-check"><input type="radio" name="w" value="new"> Créer un nouveau poste pour ce circuit seulement</label>` });
  if (!v) { E.redraw(); return; }
  if (v.w === "all") E.change((x) => M.moveControl(x, hit.control, to), "Poste commun déplacé");
  else {
    let nid;
    E.change((x) => {
      const old = x.controls[hit.control];
      nid = M.addControl(x, old.kind, to);
      x.controls[nid].symbols = old.symbols.slice(); x.controls[nid].colF = old.colF;
      x.courseControls[hit.cc].control = nid;
      delete x.courseControls[hit.cc].number;
    }, "Nouveau poste pour ce circuit");
    E.select({ kind: "control", control: nid, cc: hit.cc });
  }
}
export async function conflict(E, info) {
  const v = await modal(E, { title: "Modifié ailleurs", body: `<p>${esc(info?.by || "Un autre membre de l'équipe")} a enregistré l'événement ${info?.at ? `à ${new Date(info.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""} pendant que vous travailliez.</p>
    <label class="tr-check"><input type="radio" name="w" value="reload" checked> Recharger sa version (vos dernières modifications sont perdues)</label>
    <label class="tr-check"><input type="radio" name="w" value="mine"> Garder ma version (la sienne est gardée dans les versions)</label>`, cancel: null });
  if (!v) return;
  if (v.w === "reload") {
    const r = await S.loadJson(E.meta.id, "event", E.key);
    if (r) { E.ev = r.data; E.version = r.version; E.dirty = false; E.undo = []; E.redo = []; E.refresh(); E.status("Version de l'équipe rechargée", "ok"); }
  } else {
    const r = await S.loadJson(E.meta.id, "event", E.key);
    if (r) await S.saveVersion(E.meta.id, r.data, E.key, `Version de ${info?.by || "l'équipe"} remplacée`, A.summaryOf(r.data)).catch(() => {});
    E.version = info?.version ?? E.version;
    await E.saveNow(true);
  }
}

// ---- files -----------------------------------------------------------------------------------------------------------------
export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/**
 * Several files at once: written into a folder the user picks (Chrome, Edge: the File System Access API), or one zip. The
 * choice is asked once and kept (Affichage's preferences, « ocn.tr.prefs » saveTo). files: { name: Uint8Array | string }.
 */
export async function saveFiles(E, files, zipName) {
  const names = Object.keys(files);
  if (!names.length) return;
  if (names.length === 1) { download(names[0], files[names[0]], "application/octet-stream"); return; }
  let how = "zip";
  if (typeof window.showDirectoryPicker === "function") {
    let pref = null;
    try { pref = JSON.parse(localStorage.getItem("ocn.tr.prefs") || "{}").saveTo || null; } catch (e) { /* none */ }
    if (!pref) {
      const v = await modal(E, { title: `${names.length} fichiers`, ok: "Enregistrer", body: `
        <label class="tr-check"><input type="radio" name="how" value="folder" checked> Les écrire dans un dossier de mon choix</label>
        <label class="tr-check"><input type="radio" name="how" value="zip"> Les télécharger en un seul fichier .zip</label>
        <label class="tr-check"><input type="checkbox" name="keep" checked> Ne plus me demander (modifiable dans Affichage)</label>` });
      if (!v) return;
      pref = v.how;
      if (v.keep) { try { const o = JSON.parse(localStorage.getItem("ocn.tr.prefs") || "{}"); o.saveTo = pref; localStorage.setItem("ocn.tr.prefs", JSON.stringify(o)); } catch (e) { /* this time only */ } }
    }
    how = pref;
  }
  if (how === "folder") {
    try {
      const dir = await window.showDirectoryPicker({ id: "ocn-tracer", mode: "readwrite" });
      for (const n of names) {
        const fh = await dir.getFileHandle(n, { create: true }), w = await fh.createWritable();
        await w.write(files[n]); await w.close();
      }
      E.toast(`${names.length} fichiers écrits dans « ${dir.name} ».`, 5000);
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      E.toast("Le dossier n'a pas pu être écrit : téléchargement en .zip.");
    }
  }
  const { zip } = await import("./pdf.js");
  const enc = new TextEncoder(), bin = {};
  for (const n of names) bin[n] = typeof files[n] === "string" ? enc.encode(files[n]) : files[n];
  download(zipName, new Blob([await zip(bin)], { type: "application/zip" }));
}
export const fileName = (s) => String(s || "evenement").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
function exportPpen(E) {
  download(`${fileName(E.ev.title)}.ppen`, writePpen(E.ev), "application/xml");
  E.toast(`Fichier .ppen enregistré : à mettre dans le même dossier que la carte « ${E.ev.map.file || "(carte)"} » pour l'ouvrir dans Purple Pen.`, 7000);
}
export async function importPpen(E, preset = null) {
  let file = preset;
  const v = await modal(E, { title: "Importer un fichier Purple Pen", body: `${dropHtml("tr-ip-drop", "Déposez ici le fichier .ppen, ou cliquez pour le choisir", ".ppen,.xml", false)}
    <p class="tr-hint" id="tr-ip-file">${file ? `✓ « ${esc(file.name)} »` : "Aucun fichier choisi."}</p>
    <p>Les circuits de cet événement sont remplacés par ceux du fichier ; la carte reste celle de l'événement.</p>
    <label class="tr-check"><input type="checkbox" name="calage"> Ce .ppen a été fait sur un autre fichier de carte (autre PDF, image, ou une carte OCAD quand celle de l'événement n'en est pas une) : caler ensuite les postes sur cette carte</label>`,
  onOpen: (f) => dropZone(f.querySelector("#tr-ip-drop"), (list) => {
    const p = list.find((x) => /\.(ppen|xml)$/i.test(x.name));
    f.querySelector("#tr-ip-file").textContent = p ? `✓ « ${p.name} »` : `« ${list[0].name} » n'est pas un fichier .ppen.`;
    if (p) file = p;
  }),
  validate: () => (!file ? "Déposez ou choisissez le fichier .ppen." : null), ok: "Importer" });
  if (!v) return;
  try {
    const imported = readPpen(await file.text());
    // both on an OCAD or Mapper map: the .ppen's positions are the map file's own mm (Purple Pen), the Tracer's are moved
    if (E.ev.map.kind === "ocad" && imported.map.kind === "ocad") M.shiftToFile({ ...imported, map: E.ev.map }, -1);
    E.change((x) => {
      const keep = { map: x.map, title: x.title };
      for (const k of Object.keys(x)) delete x[k];
      Object.assign(x, imported);
      x.map = { ...imported.map, ...keep.map, scale: imported.map.scale || keep.map.scale, dpi: keep.map.kind === "bitmap" ? (imported.map.dpi || keep.map.dpi) : keep.map.dpi };
      if (keep.map.kind === "bitmap" && imported.map.dpi && imported.map.dpi !== keep.map.dpi) { x.map.w = keep.map.w * keep.map.dpi / imported.map.dpi; x.map.h = keep.map.h * keep.map.dpi / imported.map.dpi; }
      if (!x.title) x.title = keep.title;
    }, "Import .ppen");
    E.setCourse(M.courseIds(E.ev)[0] || 0); E.fitCourse();
    E.toast(`${Object.keys(E.ev.courses).length} circuit(s), ${Object.keys(E.ev.controls).length} poste(s) importés.`);
    if (v.calage) (await import("./calage.js")).calage(E, { fromPpen: true });
  } catch (err) { E.toast("Ce fichier n'est pas un événement Purple Pen lisible."); }
}

// ---- team, versions, encryption ----------------------------------------------------------------------------------------------
async function team(E) {
  const meta = E.meta;
  const owner = E.role === "owner" || E.role === "setter";
  const rows = (meta.team || []).map((m) => ({ ...m }));
  const render = (box) => {
    box.innerHTML = `<table class="tr-table"><thead><tr><th>Licencié</th><th>Rôle</th><th></th></tr></thead><tbody>
      <tr><td>${esc(meta.ownerName)} <small>(${esc(meta.ownerLic || "")})</small></td><td>Créateur</td><td></td></tr>
      ${rows.map((m, i) => `<tr><td>${esc(m.name || "?")} <small>(${esc(m.lic)})</small></td><td>${owner ? sel(`r${i}`, [["setter", "Traceur"], ["controller", "Contrôleur"], ["viewer", "Lecteur"]], m.role) : esc(m.role)}</td>
      <td>${owner ? `<button type="button" class="btn btn-sm" data-rm="${i}">Retirer</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
    box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { rows.splice(Number(b.dataset.rm), 1); render(box); }));
    box.querySelectorAll("select").forEach((s2) => s2.addEventListener("change", () => { rows[Number(s2.name.slice(1))].role = s2.value; }));
  };
  const v = await modal(E, { title: "Équipe et partage", wide: true, ok: owner ? "Enregistrer" : "Fermer", cancel: owner ? "Annuler" : null, body: `
    <p>Seule l'équipe ouvre l'événement : les circuits restent secrets jusqu'à la course. Le traceur et le contrôleur modifient, le lecteur lit et commente.</p>
    <div id="tr-team"></div>
    ${owner ? `<div class="tr-row">${field("Numéro de licence", '<input id="tr-lic" inputmode="numeric" size="9">')}<button type="button" class="btn btn-sm" id="tr-add">Ajouter</button></div>` : ""}`,
  onOpen: (f) => {
    const box = f.querySelector("#tr-team");
    render(box);
    f.querySelector("#tr-add")?.addEventListener("click", async () => {
      const lic = f.querySelector("#tr-lic").value.trim();
      if (!/^\d{1,8}$/.test(lic)) { E.toast("Un numéro de licence."); return; }
      if (rows.some((m) => m.lic === lic)) return;
      const r = await S.api(`/${meta.id}/member?lic=${encodeURIComponent(lic)}`).catch(() => null);
      if (!r?.name) { E.toast("Licence introuvable dans le fichier des licenciés."); return; }
      rows.push({ lic, name: r.name, role: "controller" }); render(box); f.querySelector("#tr-lic").value = "";
    });
  } });
  if (!v || !owner) return;
  const r = await S.api(`/${meta.id}`, { method: "PUT", body: { team: rows.map((m) => ({ lic: m.lic, name: m.name, role: m.role })) } });
  E.meta = r.event;
  E.toast("Équipe enregistrée.");
}
async function versionSave(E) {
  const v = await modal(E, { title: "Enregistrer une version", body: field("Note (ce qui a changé)", '<input name="note" maxlength="280" placeholder="Après la visite de terrain du 12/11">') });
  if (!v) return;
  await E.saveNow(true);
  await S.saveVersion(E.meta.id, E.ev, E.key, v.note.trim(), A.summaryOf(E.ev));
  E.toast("Version enregistrée.");
}
async function versions(E) {
  const r = await S.api(`/${E.meta.id}/versions`);
  const list = r.versions || [];
  const v = await modal(E, { title: "Versions", wide: true, ok: null, cancel: "Fermer", body: list.length ? `<div class="table-wrap"><table class="tr-table"><thead><tr><th>Date</th><th>Par</th><th>Note</th><th>Contenu</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${new Date(x.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td><td>${esc(x.by)}</td><td>${esc(x.note)}</td><td><small>${esc(x.summary)}</small></td>
    <td><button type="button" class="btn btn-sm" data-diff="${x.n}">Différences</button> <button type="button" class="btn btn-sm" data-restore="${x.n}">Rétablir</button></td></tr>`).join("")}</tbody></table></div><div id="tr-diff"></div>`
    : "<p>Aucune version enregistrée pour l'instant. Une version se garde à la demande (Fichier › Enregistrer une version) et automatiquement toutes les 30 minutes de travail.</p>",
  onOpen: (f, done) => {
    f.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", async () => {
      const old = await S.loadVersion(E.meta.id, b.dataset.diff, E.key);
      f.querySelector("#tr-diff").innerHTML = `<h3>Depuis cette version</h3><ul>${(await import("./extras.js")).diff(old, E.ev).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>Aucune différence.</li>"}</ul>`;
    }));
    f.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", async () => {
      if (E.readOnly) { E.toast("Lecture seule."); return; }
      const old = await S.loadVersion(E.meta.id, b.dataset.restore, E.key);
      if (!old) return;
      done(null);
      E.change((x) => { for (const k of Object.keys(x)) delete x[k]; Object.assign(x, old); }, "Version rétablie");
      E.toast("Version rétablie (Ctrl+Z pour revenir).");
    }));
  } });
  void v;
}
async function encryption(E) {
  const on = !!E.meta.encrypted, owner = E.role === "owner";
  if (!owner) { E.toast(on ? "L'événement est chiffré ; seul son créateur change ce réglage." : "Seul le créateur de l'événement peut le chiffrer."); return; }
  const v = await modal(E, { title: "Chiffrement", wide: true, ok: on ? "Retirer le chiffrement" : "Chiffrer", body: on
    ? "<p>L'événement est chiffré dans le navigateur : le serveur ne garde que des données illisibles. Le retirer renvoie l'événement, sa carte et ses commentaires en clair.</p>"
    : `<p>Chiffré dans votre navigateur avec une phrase de passe, l'événement (circuits, carte, commentaires, versions futures) devient illisible pour le serveur et ses administrateurs.
      Donnez la phrase de passe à votre équipe par un autre moyen ; <strong>perdue, l'événement est perdu</strong> (exportez un .ppen d'abord).</p>
      ${field("Phrase de passe (12 caractères au moins)", '<input name="p1" type="password" autocomplete="new-password">')}${field("Encore une fois", '<input name="p2" type="password" autocomplete="new-password">')}`,
  validate: (o) => (on ? null : o.p1.length < 12 ? "12 caractères au moins." : o.p1 !== o.p2 ? "Les deux phrases diffèrent." : null) });
  if (!v) return;
  E.status("Chiffrement…", "busy");
  const map = await S.loadMap(E.meta.id, E.key);
  const comments = await S.loadJson(E.meta.id, "comments", E.key).catch(() => null);
  let key = null, setting = null;
  if (!on) ({ key, setting } = await S.newEncryption(v.p1));
  if (map) await S.saveMap(E.meta.id, map.bytes, E.meta.map?.type || map.type, key);
  if (comments) await S.saveJson(E.meta.id, "comments", comments.data, key);
  // the versions are written again under the new setting, and the old copies removed
  const list = (await S.api(`/${E.meta.id}/versions`).catch(() => ({ versions: [] }))).versions || [];
  const old = [];
  for (const x of list.slice().reverse()) { const data = await S.loadVersion(E.meta.id, x.n, E.key).catch(() => null); if (data) old.push([x, data]); }
  let first = null;
  for (const [x, data] of old) { const w = await S.saveVersion(E.meta.id, data, key, x.note, x.summary); if (first == null) first = w.n; }
  if (first != null) await S.api(`/${E.meta.id}/versions?below=${first}`, { method: "DELETE" }).catch(() => {});
  E.key = key; S.setKey(E.meta.id, key);
  const r = await S.api(`/${E.meta.id}`, { method: "PUT", body: { encrypted: setting } });
  E.meta = r.event;
  E.dirty = true; await E.saveNow(true);
  E.toast(on ? "Chiffrement retiré." : "Événement chiffré, versions comprises.", 7000);
}
export { field, sel, num, symbolName };

// The Tracer's ribbon — the « O'CN mode », by default (owner, 2026-10-17; the menus stay as the « Purple Pen mode »). Drawn from
// ribbon-data.js: tabs in the order of the setter's work, contextual tabs that come with the selection (a control, a leg, an
// object, a shape being drawn) and hold what applies to it, the « Fichier » page (backstage), a quick-access bar, a command
// search (Alt+Q), key hints (Alt), live figures (the event audit's problems, open comments, the course's length and climb),
// settings in place (print scale, standards, sizes, the purple's blend, a leg's flagging), tooltips that say what a command
// does, why it is greyed and where it is in the Purple Pen mode. The ribbon shrinks with the window (groups fold into one
// button each), can be a single line or only its tabs (Ctrl+F1). Every command goes through the editor's own actions
// (dialogs.js action, the tools of editor.js), as the menus do.

import * as M from "./model.js";
import * as S from "./store.js";
import * as D from "./dialogs.js";
import * as A from "./actions.js";
import { svg, ACT_ICON } from "./icons.js";
import { TABS, CONTEXT, BACKSTAGE, GALLERY, INFO, commands, menuAt } from "./ribbon-data.js";
import { hasGeo } from "./geo.js";
import { mapColors, defaultLayer } from "./appear.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const km = (m) => `${nf(m / 1000, 1)} km`;
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PREF = "ocn.tr.prefs";
const loadPref = (k, d) => { try { const v = JSON.parse(localStorage.getItem(PREF) || "{}")[k]; return v ?? d; } catch (e) { return d; } };
const savePref = (k, v) => { try { const o = JSON.parse(localStorage.getItem(PREF) || "{}"); o[k] = v; localStorage.setItem(PREF, JSON.stringify(o)); } catch (e) { /* this visit */ } };
const GUIDE = (ch) => `#/methodes?onglet=tracer${ch ? `&voir=${ch}` : ""}`;
// the commands that need a point on the map: the ribbon asks for the click
const PICK = {
  "gap-add-circle": "Cliquez sur le cercle, là où le couper", "bend-add": "Cliquez sur l'interposte, là où le plier",
  "gap-add-leg": "Cliquez sur l'interposte, là où le couper", "bend-remove": "Cliquez le coude à retirer",
  "gap-remove-leg": "Cliquez la coupure à refermer", "corner-add": "Cliquez sur la ligne ou le bord, là où ajouter un sommet",
  "corner-remove": "Cliquez le sommet à retirer",
};
const BLENDS = [["none", "Par-dessus", "Le violet couvre la carte."], ["blend", "Mélangé", "Le noir de la carte reste visible à travers le violet, comme à l'impression."],
  ["layer", "En couches", "Les cercles et les traits passent sous les couleurs de la carte au-dessus d'une couleur choisie ; les numéros restent dessus (carte OCAD ou Mapper)."]];
const FLAGS = [["none", "Aucun"], ["all", "Tout"], ["begin", "Le début"], ["end", "La fin"]];
const SCALES = [4000, 5000, 7500, 10000, 12500, 15000];

/** Mount the ribbon in the editor (its root has #tr-ribbon and the title bar's #tr-rsearch, #tr-rdisplay). */
export function mountRibbon(E) {
  const host = E.$("#tr-ribbon");
  const R = { tab: "home", prevTab: "home", ctx: null, ctxKey: null, display: loadPref("ribbon", "full"), floating: false, pulse: false,
    issues: null, issueRows: [], comments: null, items: [], keytips: 0, pops: [] };
  E.ribbon = R;

  // ---- what a command can do now -----------------------------------------------------------------------------------------
  const course = () => E.course();
  const ctl = () => (E.sel?.control ? E.ev.controls[E.sel.control] : null);
  const cc = () => (E.sel?.cc ? E.ev.courseControls[E.sel.cc] : null);
  const special = () => (E.sel?.kind === "special" ? E.ev.specials[E.sel.id] : null);
  const legRec = () => (E.sel?.kind === "leg" ? E.ev.legs[M.findLeg(E.ev, E.sel.c1, E.sel.c2)] : null);
  const raceLater = () => E.meta?.kind === "race" && E.meta.date && E.meta.date > today();
  /** null when the command can run, else why not (shown in its tooltip). */
  function why(it) {
    const act = it.act || it.tool;
    if (E.blank && !["view-course", "view-map", "save-to"].includes(act)) return "Ouvrez, créez ou importez d'abord un événement (« Événements », en haut à gauche).";
    const n = it.need;
    if ((n === "edit" || n === "course" || n === "vector" || (it.tool && it.tool !== "select")) && E.readOnly) return "Lecture seule.";
    if (n === "course" && !E.cd.course) return "Choisissez d'abord un circuit (les onglets au-dessus de la carte).";
    if (n === "vector" && E.map?.kind !== "vector") return "Avec une carte OCAD ou Mapper seulement.";
    if (n === "after" && raceLater()) return `Les circuits restent secrets jusqu'à la course : à partir du ${new Date(E.meta.date).toLocaleDateString("fr-FR")}.`;
    if ((act === "var-fork" || act === "var-loop" || act === "var-delete") && !E.sel?.cc && it.t !== "small") return E.cd.course ? "Choisissez d'abord le poste d'où partent les variantes." : "Choisissez d'abord un circuit, puis le poste d'où partent les variantes.";
    if (act === "pdf-course" && !E.cd.course) return "Choisissez d'abord un circuit.";
    return null;
  }
  /** Whether a contextual command applies to the selection at all (else it is left out). */
  function applies(it) {
    const act = it.act, c = ctl(), sp = special(), inCourse = !!(E.cd.course && E.sel?.cc);
    switch (act) {
      case "control-props": return c && (c.kind === "normal" || c.kind === "start");
      case "toggle-exchange": return inCourse && c?.kind === "normal";
      case "var-fork": case "var-loop": return R.ctx !== "control" || inCourse;
      case "var-delete": return R.ctx !== "control" || !!cc()?.split;
      case "points": return inCourse && c?.kind === "normal" && M.isScore(E.ev, E.cd.course);
      case "text-before": case "text-after": return inCourse;
      case "gap-add-circle": return c && (c.kind === "normal" || c.kind === "finish");
      case "number-auto": return E.sel?.kind === "number" || !!cc()?.number;
      case "rotate": return R.ctx === "control" ? c?.kind === "crossing" : sp?.kind === "optional-crossing-point";
      case "special-props": return sp && ["text", "line", "rectangle", "ellipse", "descriptions"].includes(sp.kind);
      case "corner-add": case "corner-remove": return sp && !M.POINT_SPECIALS.includes(sp.kind) && !["text", "image", "rectangle", "ellipse", "descriptions"].includes(sp.kind);
      case "bend-remove": return !!legRec()?.bends?.length;
      case "gap-remove-leg": return !!legRec()?.gaps?.length;
      default: return true;
    }
  }
  function labelOf(it) {
    const c = ctl(), sp = special();
    if (it.act === "delete" && R.ctx === "control") return E.cd.course && E.sel?.cc ? "Retirer du circuit" : "Supprimer le poste";
    if (it.act === "special-props" && sp) return sp.kind === "text" ? "Texte…" : sp.kind === "descriptions" ? "Colonnes…" : "Apparence…";
    if (it.act === "toggle-exchange" && cc()?.exchange) return "Retirer l'échange";
    if (it.count === "unused" && !E.blank) { const n = M.unusedControls(E.ev).length; return n ? `${it.label} (${n})` : it.label; }
    void c;
    return it.label;
  }
  function pressed(it) {
    if (it.tool) return E.tool === it.tool || (it.tool.startsWith("special:") && E.tool === it.tool);
    switch (it.toggle) {
      case "printArea": return !!E.opts.printArea;
      case "allControls": return !!E.opts.allControls;
      case "overprint": return !!E.ev.appearance?.ocadOverprint;
      case "exchange": return !!cc()?.exchange;
      default: return null;
    }
  }
  const badgeOf = (k) => (k === "issues" ? R.issues : k === "comments" ? R.comments : null);
  // red for problems, amber for reminders only (a climb not filled in) and for comments
  const softBadge = (k) => k === "comments" || (k === "issues" && R.issuesSoft);
  // on a phone the full ribbon becomes its single line
  const disp = () => (R.display === "full" && window.innerWidth <= 760 ? "line" : R.display);

  // ---- drawing -----------------------------------------------------------------------------------------------------------
  function curTab() { return R.tab.startsWith("ctx:") ? CONTEXT[R.tab.slice(4)] : TABS.find((t) => t.id === R.tab); }
  function curGroups() {
    const t = curTab();
    if (!t) return [];
    if (!R.tab.startsWith("ctx:")) return t.groups;
    // contextual: the items that apply to the selection only, and the groups left with something
    const keep = (items) => items.map((it) => (it.t === "stack" ? { ...it, items: keep(it.items) } : it))
      .filter((it) => (it.t === "stack" ? it.items.length : !it.act || applies(it)));
    return t.groups.map((g) => ({ ...g, items: keep(g.items) })).filter((g) => g.items.length);
  }
  const reg = (it, extra = {}) => { R.items.push({ ...it, ...extra }); return R.items.length - 1; };
  function button(it, size) {
    const w = why(it), p = pressed(it), label = labelOf(it), i = reg(it, { label, why: w });
    const b = it.badge ? badgeOf(it.badge) : null;
    const attrs = `type="button" data-ri="${i}" ${it.act ? `data-ract="${esc(it.act)}"` : `data-rtool="${esc(it.tool)}"`} ${w ? 'aria-disabled="true"' : ""} ${p != null ? `aria-pressed="${p}"` : ""}`;
    const badge = b ? `<span class="tr-rbadge${softBadge(it.badge) ? " soft" : ""}">${b}</span>` : "";
    if (size === "big") {
      const caret = it.split ? `<span class="tr-rsplit" data-rsplit="${i}" role="button" aria-label="Plus de choix" title="Plus de choix">▾</span>` : "";
      return `<button class="tr-rbig${it.split ? " has-split" : ""}" ${attrs}>${svg(it.icon, 26)}<span class="tr-rl">${esc(label)}</span>${caret}${badge}</button>`;
    }
    return `<button class="tr-rsmall" ${attrs}>${svg(it.icon, 16)}<span class="tr-rl">${esc(label)}</span>${it.key && it.key.length === 1 ? `<kbd class="tr-rkey">${esc(it.key)}</kbd>` : ""}${it.split ? '<span class="tr-rcaret">▾</span>' : ""}${badge}</button>`;
  }
  function itemHtml(it, mode) {
    if (it.t === "stack") return mode === "line" ? it.items.map((x) => itemHtml(x, mode)).join("") : `<div class="tr-rstack">${it.items.map((x) => itemHtml(x, mode)).join("")}</div>`;
    if (it.t === "big") return button(it, mode === "line" ? "small" : "big");
    if (it.t === "small") return button(it, "small");
    if (it.t === "gallery") return gallery(mode);
    if (it.t === "field") return fieldHtml(it.id, mode);
    if (it.t === "chip") return chipHtml(it.id, mode);
    if (it.t === "modes") return modesHtml(it.id, mode);
    return "";
  }
  function gallery(mode) {
    const list = mode === "line" ? GALLERY.slice(0, 4) : GALLERY;
    const cell = (k) => {
      const it = { t: "small", tool: `special:${k}`, label: A.SPECIAL_NAME[k], icon: ACT_OF[k] || k, need: "edit", tip: SPECIAL_TIP(k) };
      const w = why(it), i = reg(it, { why: w });
      return `<button type="button" class="tr-rcell" data-ri="${i}" data-rtool="special:${k}" ${w ? 'aria-disabled="true"' : ""} aria-pressed="${E.tool === `special:${k}`}" aria-label="${esc(it.label)}">${svg(it.icon, 18)}</button>`;
    };
    const more = { t: "small", act: "special-more", label: "Tous les objets spéciaux", icon: "special", tip: "Point d'eau, poste de secours, zones, lignes, cadres : la liste complète." };
    const mw = why({ ...more, need: "edit" }), mi = reg(more, { why: mw });
    return `<div class="tr-rgallery${mode === "line" ? " line" : ""}">${list.map(cell).join("")}<button type="button" class="tr-rmore" data-ri="${mi}" data-ract="special-more" ${mw ? 'aria-disabled="true"' : ""} aria-label="Tous les objets spéciaux">▾</button></div>`;
  }
  // ---- settings in the ribbon ----------------------------------------------------------------------------------------------
  const FIELDS = {
    descStandard: { label: "Norme", tip: "La norme des définitions : IOF 2018/2024, ou 2004.", opts: () => [["2018", "IOF 2018"], ["2004", "IOF 2004"]], get: () => E.ev.descStandard,
      set: (v) => D.applyStandards(E, v, E.ev.appearance.mapStandard) },
    lang: { label: "Langue", tip: "La langue des définitions en texte (23 langues).", opts: () => D.langChoices(E.ev.lang), get: () => E.ev.lang,
      set: async (v) => { if (!["fr", "en"].includes(v)) await (await import("./symbols.js")).loadAllTexts(); E.change((x) => { x.lang = v; }, "Langue des définitions"); } },
    mapStandard: { label: "Carte", tip: "La norme de la carte, qui fixe la taille des cercles et des numéros : ISOM 2017 (forêt), ISSprOM 2019 (sprint), ISOM 2000.",
      opts: () => [["2017", "ISOM 2017"], ["Spr2019", "ISSprOM 2019"], ["2000", "ISOM 2000"]], get: () => E.ev.appearance.mapStandard, set: (v) => D.applyStandards(E, E.ev.descStandard, v) },
    printScale: { label: "Échelle", tip: "L'échelle d'impression du circuit en cours (de « Tous les postes » quand aucun circuit n'est choisi).",
      opts: () => { const cur = course() ? course().printScale : E.ev.allControls.printScale; return [...new Set([...SCALES, E.ev.map.scale, cur])].filter((x) => x > 0).sort((a, b) => a - b).map((x) => [String(x), `1:${nf(x)}`]); },
      get: () => String(course() ? course().printScale : E.ev.allControls.printScale),
      set: (v) => { const id = E.cd.course, k = Number(v); E.change((x) => { if (id) x.courses[id].printScale = k; else x.allControls.printScale = k; }, "Échelle d'impression"); } },
    circle: { label: "Cercles", num: true, tip: "La taille des cercles, en proportion de la norme.", get: () => E.ev.appearance.controlCircleSize, set: (v) => E.change((x) => { x.appearance.controlCircleSize = v; }, "Taille des cercles") },
    line: { label: "Traits", num: true, tip: "L'épaisseur des traits, en proportion de la norme.", get: () => E.ev.appearance.lineWidth, set: (v) => E.change((x) => { x.appearance.lineWidth = v; }, "Épaisseur des traits") },
    number: { label: "Numéros", num: true, tip: "La hauteur des numéros, en proportion de la norme.", get: () => E.ev.appearance.numberHeight, set: (v) => E.change((x) => { x.appearance.numberHeight = v; }, "Hauteur des numéros") },
    intensity: { label: "Intensité", range: true, tip: "Pâlir la carte, pour mieux voir le circuit (aussi : le curseur sous les boutons de zoom).", get: () => E.opts.intensity,
      set: (v) => E.setIntensity(v) },
    code: { label: "Code", text: true, tip: "Le code du poste (1 à 3 caractères), tel que le porte le boîtier.", get: () => ctl()?.code || "", set: (v, el) => { if (!A.changeCode(E, E.sel.control, v) && el) el.value = ctl()?.code || ""; },
      show: () => ctl()?.kind === "normal" },
  };
  function fieldHtml(id, mode) {
    const f = FIELDS[id];
    if (!f || (f.show && !f.show())) return "";
    const dis = E.blank || (E.readOnly && id !== "intensity") ? "disabled" : "";
    f.label = INFO.field[id]?.[0] || f.label; f.tip = INFO.field[id]?.[1] || f.tip;
    const i = reg({ t: "field", label: f.label, tip: f.tip, id });
    let ctl0;
    if (f.range) ctl0 = `<input type="range" min="0.2" max="1" step="0.05" value="${f.get()}" data-rfield="${id}" aria-label="${esc(f.label)}">`;
    else if (f.num) ctl0 = `<input type="number" min="0.3" max="3" step="0.05" value="${f.get()}" data-rfield="${id}" aria-label="${esc(f.label)}" ${dis}>`;
    else if (f.text) ctl0 = `<input type="text" maxlength="3" size="4" value="${esc(f.get())}" data-rfield="${id}" aria-label="${esc(f.label)}" ${dis}>`;
    else ctl0 = `<select data-rfield="${id}" aria-label="${esc(f.label)}" ${dis}>${f.opts().map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.get()) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    return `<label class="tr-rfield${mode === "line" ? " line" : ""}" data-ri="${i}"><span>${esc(f.label)}</span>${ctl0}</label>`;
  }
  // ---- live figures --------------------------------------------------------------------------------------------------------
  function chipHtml(id, mode) {
    const lines = chipLines(id);
    if (!lines.length) return "";
    if (mode === "line") return `<span class="tr-rchip line">${esc(lines[0])}</span>`;
    if (id === "issues") {
      const rows = R.issueRows.slice(0, 3);
      return `<div class="tr-rchip issues">${R.issues == null ? '<span class="muted">Contrôle en cours…</span>' : rows.length ? rows.map((r) => `<button type="button" data-ract="rep-audit" class="tr-rissue"><i class="${r.warn ? "w" : ""}"></i>${esc(r.text)}</button>`).join("")
        + (R.issues > 3 ? `<span class="muted">et ${R.issues - 3} autre${R.issues - 3 > 1 ? "s" : ""}…</span>` : "") : '<span class="tr-rok">✓ Aucun problème trouvé</span>'}</div>`;
    }
    return `<div class="tr-rchip"><b>${esc(lines[0])}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
  }
  function chipLines(id) {
    if (E.blank) return id === "issues" ? [] : [];
    const ev = E.ev;
    switch (id) {
      case "issues": return ["Contrôle"];
      case "mapInfo": {
        const m = E.map, sc = `1:${nf(ev.map.scale)}`;
        if (!m) return [`Pas de carte · ${sc}`];
        return [m.kind === "vector" ? `${m.format === "oom" ? "Mapper" : `OCAD ${m.version || ""}`.trim()} · ${sc}` : m.kind === "pdf" ? `PDF · ${sc}` : `Image ${Math.round(ev.map.dpi || m.dpi || 0)} ppp · ${sc}`];
      }
      case "geoInfo": return [hasGeo(ev) ? "Géoréférencée ✓" : "Non géoréférencée"];
      case "course": {
        const c = course();
        if (!c) return ["Tous les postes", `${Object.values(ev.controls).filter((x) => x.kind === "normal").length} postes, ${M.unusedControls(ev).length} inutilisé(s)`];
        const v = E.layout?.view;
        if (!v) return [c.name];
        const len = v.totalMin === v.totalMax ? km(v.totalMin) : `${km(v.totalMin)} – ${km(v.totalMax)}`;
        return [`${c.name} · ${len}${c.climb >= 0 ? ` · ${Math.round(c.climb)} m` : ""}`, `${v.minNormal === v.maxNormal ? v.minNormal : `${v.minNormal} – ${v.maxNormal}`} postes · 1:${nf(c.printScale)}`,
          c.load >= 0 ? `${c.load} concurrents attendus` : "Concurrents : non renseignés"];
      }
      case "control": {
        const c = ctl(); if (!c) return [];
        const used = M.coursesUsing(ev, E.sel.control).map((x) => ev.courses[x].name), load = M.controlLoad(ev, E.sel.control);
        let next = "";
        if (E.cd.course && E.sel.cc) { const v = E.layout?.view, i = v ? v.controls.findIndex((x) => x.ccs.includes(E.sel.cc)) : -1; if (i >= 0 && v.controls[i].legLen?.length) next = `Vers le suivant : ${nf(v.controls[i].legLen[0])} m`; }
        return [used.length ? used.join(", ") : "Dans aucun circuit", load >= 0 ? `${load} concurrents` : `Position ${nf(c.x, 1)} ; ${nf(c.y, 1)} mm`, ...(next ? [next] : [])];
      }
      case "leg": {
        const s = E.sel; if (s?.kind !== "leg" || !ev.controls[s.c1] || !ev.controls[s.c2]) return [];
        const a = ev.controls[s.c1], b = ev.controls[s.c2], len = M.legLengthM(ev, s.c1, s.c2), straight = M.mmToM(ev, M.dist([a.x, a.y], [b.x, b.y]));
        const used = M.coursesUsingLeg(ev, s.c1, s.c2).map((x) => ev.courses[x].name), load = M.legLoad(ev, s.c1, s.c2);
        return [`${a.code || "Départ"} → ${b.code || "Arrivée"} · ${nf(len)} m${Math.abs(len - straight) > 1 ? ` (ligne droite ${nf(straight)} m)` : ""}`, used.join(", ") || "—", ...(load >= 0 ? [`${load} concurrents`] : [])];
      }
      case "special": {
        const sp = special(); if (!sp) return [];
        const shown = sp.all ? "Sur tous les circuits" : `Sur : ${sp.courses.map((x) => (x.course ? ev.courses[x.course]?.name : "Tous les postes")).join(", ") || "aucun circuit"}`;
        return [A.SPECIAL_NAME[sp.kind] || sp.kind, shown];
      }
      case "drawing": {
        const p = E.pending; if (!p) return [];
        const name = p.kind === "route" ? "Itinéraire" : A.SPECIAL_NAME[p.kind] || p.kind;
        return [`${name} · ${p.pts.length} point${p.pts.length > 1 ? "s" : ""}`, p.kind === "route" ? "Cliquez le long du chemin prévu" : "Cliquez les sommets suivants", "Entrée termine, Échap annule"];
      }
      default: return [];
    }
  }
  // ---- choices with a preview: the purple's blend, a leg's flagging ----------------------------------------------------------------------
  function modesHtml(id, mode) {
    const vector = mapColors(E.map).length > 0;
    const list = id === "blend" ? BLENDS.filter(([k]) => k !== "layer" || vector) : FLAGS;
    const cur = id === "blend" ? (E.ev.appearance.blend === "layer" && !vector ? "blend" : E.ev.appearance.blend || "none") : (E.sel?.kind === "leg" ? M.legFlagging(E.ev, E.sel.c1, E.sel.c2) : "none");
    const dis = E.blank || E.readOnly ? "disabled" : "";
    if (mode === "line") {
      const i = reg({ t: "field", label: id === "blend" ? "Violet" : "Balisage", tip: id === "blend" ? "La façon dont le violet se pose sur la carte." : "Le balisage de l'interposte." });
      return `<label class="tr-rfield line" data-ri="${i}"><span>${id === "blend" ? "Violet" : "Balisage"}</span><select data-rmode="${id}" ${dis}>${list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
    }
    return `<div class="tr-rmodes">${list.map(([k, l, t]) => {
      const i = reg({ t: "small", label: id === "blend" ? `Violet : ${l}` : `Balisage : ${l.toLowerCase()}`, tip: t || (k === "none" ? "Interposte non balisé." : k === "all" ? "Tout l'interposte balisé." : k === "begin" ? "Le début de l'interposte balisé." : "La fin de l'interposte balisée (vers l'arrivée).") });
      return `<button type="button" class="tr-rmode" data-ri="${i}" data-rmode="${id}" data-v="${k}" aria-pressed="${k === cur}" ${dis}>${preview(id, k)}<span>${esc(l)}</span></button>`;
    }).join("")}</div>`;
  }
  function preview(id, k) {
    const P = "#a7179b";
    if (id === "blend") return `<svg viewBox="0 0 48 30" aria-hidden="true"><rect width="48" height="30" rx="3" fill="#fbf8ef"/><path d="M0 21L48 9" stroke="#1d1d1b" stroke-width="3"/>
      ${k === "layer" ? `<circle cx="24" cy="15" r="9" fill="none" stroke="${P}" stroke-width="2.4"/><path d="M0 21L48 9" stroke="#1d1d1b" stroke-width="3"/>`
        : `<circle cx="24" cy="15" r="9" fill="none" stroke="${P}" stroke-width="2.4" ${k === "blend" ? 'style="mix-blend-mode:multiply" opacity=".8"' : ""}/>`}</svg>`;
    const leg = (d) => `<path d="${d}" stroke="${P}" stroke-width="2" fill="none"`;
    return `<svg viewBox="0 0 48 30" aria-hidden="true"><rect width="48" height="30" rx="3" fill="#fbf8ef"/><circle cx="8" cy="23" r="5" fill="none" stroke="${P}" stroke-width="2"/><circle cx="40" cy="7" r="5" fill="none" stroke="${P}" stroke-width="2"/>
      ${k === "none" ? `${leg("M12 21L36 9")}/>` : k === "all" ? `${leg("M12 21L36 9")} stroke-dasharray="3 2"/>` : k === "begin" ? `${leg("M12 21L24 15")} stroke-dasharray="3 2"/>${leg("M24 15L36 9")}/>` : `${leg("M12 21L24 15")}/>${leg("M24 15L36 9")} stroke-dasharray="3 2"/>`}</svg>`;
  }
  // ---- the groups and the tabs -------------------------------------------------------------------------------------------------
  function groupHtml(g, mode, folded) {
    if (folded) {
      const first = firstIcon(g.items) || "dots", i = reg({ t: "group", label: g.title || "Plus", tip: `Le groupe « ${g.title || "Plus"} », replié faute de place : un clic l'ouvre.` });
      if (mode === "line") return `<div class="tr-rgrp folded"><button type="button" class="tr-rsmall" data-ri="${i}" data-rfold="${esc(g.id)}" aria-haspopup="true">${svg(first, 16)}<span class="tr-rl">${esc(g.title || "Plus")}</span><span class="tr-rcaret">▾</span></button></div>`;
      return `<div class="tr-rgrp folded"><div class="tr-rgrp-body"><button type="button" class="tr-rbig" data-ri="${i}" data-rfold="${esc(g.id)}" aria-haspopup="true">${svg(first, 26)}<span class="tr-rl">${esc(g.title || "Plus")} ▾</span></button></div><div class="tr-rgrp-t">&nbsp;</div></div>`;
    }
    const li = g.launcher ? reg({ t: "small", act: g.launcher, label: launcherLabel(g.launcher), tip: "La fenêtre complète de ces réglages." }) : -1;
    return `<div class="tr-rgrp" data-g="${esc(g.id)}"><div class="tr-rgrp-body">${g.items.map((x) => itemHtml(x, mode)).join("")}</div>
      ${mode === "line" ? "" : `<div class="tr-rgrp-t">${esc(groupTitle(g))}</div>`}${li >= 0 && mode !== "line" ? `<button type="button" class="tr-rlaunch" data-ri="${li}" data-ract="${esc(g.launcher)}" aria-label="${esc(launcherLabel(g.launcher))}">${svg("launcher", 12)}</button>` : ""}</div>`;
  }
  const launcherLabel = (act) => ({ "special-more": "Tous les objets spéciaux", standards: "Normes IOF", "course-props": "Propriétés du circuit", "print-area": "Zone d'impression", appearance: "Apparence des circuits" })[act] || "Plus de réglages";
  function groupTitle(g) {
    if (R.tab === "ctx:control" && g.id === "ctl") { const c = ctl(); return c ? (c.kind === "normal" ? `Poste ${c.code}` : { start: "Départ", finish: "Arrivée", crossing: "Passage obligatoire", "map-issue": "Remise de carte", "map-exchange": "Échange de carte" }[c.kind] || "Poste") : g.title; }
    if (R.tab === "ctx:special" && g.id === "obj") return A.SPECIAL_NAME[special()?.kind] || g.title;
    if (R.tab === "ctx:leg" && g.id === "where") return "Interposte";
    if (R.tab === "check" && g.id === "figures") return course() ? "Circuit en cours" : "L'événement";
    return g.title;
  }
  const firstIcon = (items) => { for (const it of items) { if (it.icon) return it.icon; if (it.items) { const k = firstIcon(it.items); if (k) return k; } if (it.t === "gallery") return "special"; } return null; };
  function bodyHtml(folded = 0) {
    R.items = [];
    const groups = curGroups(), mode = disp() === "line" ? "line" : "full";
    return groups.map((g, i) => groupHtml(g, mode, i >= groups.length - folded)).join("");
  }
  function tabsHtml() {
    const tab = (t) => {
      const b = t.badge ? badgeOf(t.badge) : null;
      return `<button type="button" role="tab" class="tr-rtab${t.backstage ? " file" : ""}" data-rtab="${t.id}" aria-selected="${!t.backstage && R.tab === t.id}" ${E.blank && !t.backstage && t.id !== "home" ? 'data-blank="1"' : ""}>${esc(t.label)}${b ? ` <span class="tr-rbadge${softBadge(t.badge) ? " soft" : ""}" title="${t.badge === "issues" ? "Problèmes trouvés par le contrôle de l'événement" : "Commentaires de l'équipe encore ouverts"}">${b}</span>` : ""}</button>`;
    };
    const ctx = R.ctx ? CONTEXT[R.ctx] : null;
    return `${TABS.map(tab).join("")}${ctx ? `<span class="tr-rctx${R.pulse ? " new" : ""}"><span class="tr-rctx-h">${esc(ctx.head)}</span><button type="button" role="tab" class="tr-rtab" data-rtab="ctx:${R.ctx}" aria-selected="${R.tab === `ctx:${R.ctx}`}">${esc(ctx.label)}</button></span>` : ""}`;
  }
  function render() {
    if (E.ui !== "ocn") return;
    hideTip();                                                   // its button may be drawn again
    if (!host.firstChild) host.innerHTML = '<div class="tr-rtabs" role="tablist" aria-label="Onglets du ruban"></div><div class="tr-rbody" role="toolbar" aria-label="Commandes"></div>';
    host.dataset.display = disp();
    host.classList.toggle("floating", R.display === "folded" && R.floating);
    host.querySelector(".tr-rtabs").innerHTML = tabsHtml();
    const body = host.querySelector(".tr-rbody");
    // a field being typed in keeps its focus: the body is drawn again once it is left
    if (body.contains(document.activeElement) && document.activeElement.matches("input, select")) { R.stale = true; return; }
    R.stale = false;
    body.classList.remove("iconic");
    body.innerHTML = bodyHtml(0);
    fit(body);
  }
  /** Too wide: the single line drops its labels; then groups fold into one button each, from the right. */
  function fit(body) {
    if (R.display === "folded" && !R.floating) return;
    if (!body.clientWidth) return;
    if (disp() === "line" && body.scrollWidth > body.clientWidth + 1) body.classList.add("iconic");
    const n = curGroups().length;
    for (let f = 1; f < n && body.scrollWidth > body.clientWidth + 1; f++) body.innerHTML = bodyHtml(f);
  }
  R.render = render;

  // ---- the selection's tab, live figures -------------------------------------------------------------------------------------
  function ctxKind() {
    if (E.blank) return null;
    if (E.pending) return "drawing";
    const s = E.sel;
    if (!s) return null;
    if ((s.kind === "control" || s.kind === "number") && E.ev.controls[s.control]) return "control";
    if (s.kind === "leg") return "leg";
    if (s.kind === "special" && E.ev.specials[s.id]) return "special";
    return null;
  }
  const selKey = () => { const s = E.sel; return E.pending ? `drawing:${E.pending.kind}` : !s ? "" : `${s.kind}:${s.control ?? s.id ?? `${s.c1}-${s.c2}`}:${s.cc ?? ""}`; };
  /** Called by the editor after every refresh, tool change and drawing step. */
  R.update = () => {
    const ctx = ctxKind(), key = selKey();
    if (key !== R.ctxKey) {
      R.ctxKey = key; R.ctx = ctx; R.pulse = false;
      if (!ctx) { if (R.tab.startsWith("ctx:")) R.tab = R.prevTab || "home"; }
      else if (R.tab.startsWith("ctx:")) R.tab = `ctx:${ctx}`;
      // chosen with the Sélection tool from « Tracer » (not just placed with a tool), or a shape being drawn: its tab opens
      else if (R.tab === "home" && (E.tool === "select" || ctx === "drawing")) { R.prevTab = R.tab; R.tab = `ctx:${ctx}`; }
      else R.pulse = true;
    }
    if (E.commentsData) R.comments = E.commentsData.items.filter((c) => !c.done).length || null;
    render();
    scheduleIssues();
  };
  let issueTimer = null, issueSig = "";
  function scheduleIssues() {
    if (E.blank) { R.issues = null; R.issueRows = []; return; }
    const sig = `${E.rev}:${E.ev.title}`;
    if (sig === issueSig) return;
    clearTimeout(issueTimer);
    issueTimer = setTimeout(async () => {
      issueSig = sig;
      try {
        const { audit } = await import("./reports.js");
        R.issueRows = issueRows(audit(E.ev)); R.issues = R.issueRows.length || null;
        R.issuesSoft = R.issueRows.every((r) => r.warn);
        R.checked = true;
        render();
      } catch (err) { console.error(err); }
    }, 500);
  }
  // comments still open, from the server when the event opens (team.js keeps E.commentsData up to date afterwards)
  if (!E.blank && E.meta?.id && !E.offline) S.loadJson(E.meta.id, "comments", E.key).then((r) => {
    const items = r?.data?.items || [];
    if (!E.commentsData) R.comments = items.filter((c) => !c.done).length || null;
    render();
  }).catch(() => {});

  // ---- running a command -----------------------------------------------------------------------------------------------------
  async function run(act, btn) {
    closePops();
    if (R.display === "folded" && R.floating) { R.floating = false; render(); }
    switch (act) {
      case "pdf-course": if (!E.cd.course) { E.toast("Choisissez d'abord un circuit (les onglets au-dessus de la carte)."); return; } (await import("./pdf.js")).coursesDialog(E, { only: E.cd.course }); return;
      case "special-more": D.specialMenu(E, btn || host); return;
      case "finish-draw": A.finishPending(E); return;
      case "cancel-draw": E.cancelPending(); return;
      case "route-draw": routeDraw(); return;
      case "overprint": if (!E.readOnly) E.change((x) => { x.appearance.ocadOverprint = !x.appearance.ocadOverprint; }, "Effets de surimpression"); return;
      case "ribbon-full": case "ribbon-line": case "ribbon-folded": setDisplay(act.slice(7)); return;
      case "ui-classic": E.setUi("pp"); return;
      case "keytips": keytips(1); return;
      case "guide": window.open(GUIDE(curTab()?.guide || ""), "_blank"); return;
      case "backstage": openBackstage(); return;
      default:
    }
    if (PICK[act]) {
      if (E.readOnly) { E.toast("Lecture seule."); return; }
      E.pickOnce = (p) => { const [sx, sy] = E.toScreen(...p); D.action(E, act, null, { p, sx, sy }); };
      E.pickCancel = null;
      E.help(`${PICK[act]} (Échap pour annuler).`);
      E.canvas.focus({ preventScroll: true });
      return;
    }
    await D.action(E, act, btn);
    if (document.body.contains(E.root)) render();                // a toggle (« Montrer la zone ») shows its new state
  }
  /** The route of the chosen leg: the Itinéraire tool, already on that leg. */
  function routeDraw() {
    const s = E.sel;
    if (E.readOnly || s?.kind !== "leg") return;
    E.setTool("route");
    const a = E.ev.controls[s.c1];
    E.pending = { kind: "route", c1: s.c1, c2: s.c2, pts: [[a.x, a.y]] };
    E.ghost = { pts: E.pending.pts.slice() };
    E.help("Itinéraire : cliquer le long du chemin prévu, double-cliquer (ou Entrée) pour finir.");
    E.redraw(); R.update();
  }
  function setDisplay(d) {
    R.display = ["full", "line", "folded"].includes(d) ? d : "full";
    R.floating = false;
    savePref("ribbon", R.display);
    render();
    E.fitHeight?.();
  }
  R.setDisplay = setDisplay;

  // ---- clicks ----------------------------------------------------------------------------------------------------------------
  host.addEventListener("click", (e) => {
    const t = e.target.closest("[data-rtab]");
    if (t) {
      const id = t.dataset.rtab;
      if (id === "file") { openBackstage(); return; }
      if (R.display === "folded") R.floating = !(R.floating && R.tab === id);
      if (!id.startsWith("ctx:")) R.prevTab = id;
      R.tab = id; R.pulse = false; render();
      return;
    }
    const split = e.target.closest("[data-rsplit]");
    if (split) {
      e.stopPropagation();
      const it = R.items[Number(split.dataset.rsplit)], r = split.getBoundingClientRect();
      const big = split.closest(".tr-rbig")?.getBoundingClientRect() || r;
      D.popupMenu(E, Math.max(8, big.left), big.bottom + 4, it.split, (a) => run(a, split));
      return;
    }
    const fold = e.target.closest("[data-rfold]");
    if (fold) { openFolded(fold); return; }
    const mode = e.target.closest("button[data-rmode]");
    if (mode && !mode.disabled) { setMode(mode.dataset.rmode, mode.dataset.v); return; }
    const b = e.target.closest("button[data-ract], button[data-rtool]");
    if (!b) return;
    const it = R.items[Number(b.dataset.ri)];
    if (b.getAttribute("aria-disabled") === "true") { E.toast(it?.why || "Indisponible pour l'instant."); return; }
    if (b.dataset.rtool) { E.setTool(b.dataset.rtool); E.canvas.focus({ preventScroll: true }); if (R.display === "folded") { R.floating = false; render(); } return; }
    run(b.dataset.ract, b);
  });
  host.addEventListener("change", (e) => {
    const f = e.target.closest("[data-rfield]");
    if (f) { setField(f.dataset.rfield, f); return; }
    const m = e.target.closest("select[data-rmode]");
    if (m) setMode(m.dataset.rmode, m.value);
  });
  host.addEventListener("input", (e) => { const f = e.target.closest('input[type="range"][data-rfield]'); if (f) FIELDS[f.dataset.rfield].set(Number(f.value)); });
  host.addEventListener("focusout", () => setTimeout(() => { if (R.stale && !host.contains(document.activeElement)) render(); }, 0));
  host.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input[data-rfield]")) { e.preventDefault(); e.target.blur(); } });
  function setField(id, el) {
    const f = FIELDS[id];
    if (!f || f.range) return;
    if (f.num) { const v = Number(String(el.value).replace(",", ".")); if (!(v > 0.2 && v <= 5)) { el.value = f.get(); E.toast("Une proportion entre 0,3 et 3."); return; } f.set(Math.round(v * 100) / 100); return; }
    f.set(f.text ? el.value.trim() : el.value, el);
  }
  function setMode(id, v) {
    if (E.readOnly || E.blank) return;
    if (id === "blend") E.change((x) => { x.appearance.blend = v; if (v === "layer" && x.appearance.lowerPurpleLayer == null) x.appearance.lowerPurpleLayer = defaultLayer(E.map); }, "Mélange du violet");
    else if (id === "flag") D.action(E, `flag-${v}`, null);
  }

  // ---- popups: folded groups, the display menu ---------------------------------------------------------------------------------
  function closePops() { for (const p of R.pops.splice(0)) p.remove(); host.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false")); }
  R.closePops = closePops;
  function openFolded(btn) {
    const open = R.pops.find((p) => p.dataset.for === btn.dataset.rfold);
    closePops();
    if (open) return;
    const g = curGroups().find((x) => x.id === btn.dataset.rfold);
    if (!g) return;
    const pop = document.createElement("div");
    pop.className = "tr-pop tr-rpop"; pop.dataset.for = g.id;
    pop.innerHTML = groupHtml(g, "full", false);
    E.root.appendChild(pop); R.pops.push(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`; pop.style.top = `${r.bottom + 4}px`;
    btn.setAttribute("aria-expanded", "true");
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-ract], button[data-rtool]");
      const m = e.target.closest("button[data-rmode]");
      if (m) { setMode(m.dataset.rmode, m.dataset.v); closePops(); return; }
      if (!b) return;
      const it = R.items[Number(b.dataset.ri)];
      if (b.getAttribute("aria-disabled") === "true") { E.toast(it?.why || "Indisponible pour l'instant."); return; }
      closePops();
      if (b.dataset.rtool) E.setTool(b.dataset.rtool); else run(b.dataset.ract, b);
    });
    pop.addEventListener("change", (e) => { const f = e.target.closest("[data-rfield]"); if (f) setField(f.dataset.rfield, f); });
    bindTips(pop);
  }
  document.addEventListener("pointerdown", (e) => { if (R.pops.length && !R.pops.some((p) => p.contains(e.target)) && !e.target.closest("[data-rfold]")) closePops();
    if (R.floating && !host.contains(e.target) && !e.target.closest(".tr-pop, .tr-modal")) { R.floating = false; render(); } }, true);
  const dispBtn = E.$("#tr-rdisplay");
  dispBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = dispBtn.getBoundingClientRect(), on = (k) => (R.display === k ? " ✓" : "");
    D.popupMenu(E, r.right - 260, r.bottom + 4, [["ribbon-full", `Ruban complet${on("full")}`], ["ribbon-line", `Une seule ligne${on("line")}`], ["ribbon-folded", `Les onglets seuls (Ctrl+F1)${on("folded")}`], "-",
      ["ui-classic", "Mode Purple Pen : les menus"], "-", ["keytips", "Raccourcis du ruban (Alt)"], ["guide", "Le guide du tracé"]], (a) => run(a, dispBtn));
  });

  // ---- tooltips ----------------------------------------------------------------------------------------------------------------
  let tip = null, tipTimer = null, tipFor = null;
  function hideTip() { clearTimeout(tipTimer); tip?.remove(); tip = null; tipFor = null; }
  function showTip(el) {
    const it = R.items[Number(el.dataset.ri)];
    if (!it) return;
    hideTip(); tipFor = el;
    tipTimer = setTimeout(() => {
      if (!document.contains(el)) return;
      const old = it.act ? menuAt(it.act) : it.tool ? "la barre d'outils" : "";
      tip = document.createElement("div");
      tip.className = "tr-rtip"; tip.setAttribute("role", "tooltip");
      tip.innerHTML = `<b><span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ""}</b>${it.tip ? `<p>${esc(it.tip)}</p>` : ""}${it.why ? `<p class="tr-rtip-why">${esc(it.why)}</p>` : ""}
        ${old ? `<p class="tr-rtip-old">Mode Purple Pen : ${esc(old)}</p>` : ""}<p class="tr-rtip-more">F1 : le guide du tracé</p>`;
      document.body.appendChild(tip);
      const r = el.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - tip.offsetWidth - 8))}px`;
      tip.style.top = `${Math.min(r.bottom + 6, window.innerHeight - tip.offsetHeight - 8)}px`;
    }, 450);
  }
  function bindTips(root) {
    root.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-ri]"); if (el && el !== tipFor) showTip(el); });
    root.addEventListener("pointerout", (e) => { const el = e.target.closest("[data-ri]"); if (el && !el.contains(e.relatedTarget)) hideTip(); });
    root.addEventListener("focusin", (e) => { const el = e.target.closest("[data-ri]"); if (el) showTip(el); });
    root.addEventListener("focusout", hideTip);
    root.addEventListener("pointerdown", hideTip);
  }
  bindTips(host);

  // ---- the « Fichier » page ---------------------------------------------------------------------------------------------------
  function openBackstage(sec = "info") {
    closePops(); hideTip();
    E.$(".tr-bs")?.remove();
    const bs = document.createElement("div");
    bs.className = "tr-bs"; bs.setAttribute("role", "dialog"); bs.setAttribute("aria-label", "Fichier");
    bs.style.top = `${E.$(".tr-top").offsetHeight}px`;
    E.root.appendChild(bs);
    const draw = (s) => {
      bs.innerHTML = `<nav class="tr-bs-nav"><button type="button" class="tr-bs-back" data-bs-close>← Revenir au tracé</button>
        ${BACKSTAGE.map((x) => `<button type="button" data-bs="${x.id}" ${x.act ? `data-bs-act="${x.act}"` : ""} aria-current="${x.id === s}">${svg(x.icon, 18)}<span>${esc(x.label)}</span></button>`).join("")}</nav>
        <div class="tr-bs-main">${pageHtml(s)}</div>`;
    };
    const close = () => { bs.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".tr-modal")) { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    bs.addEventListener("click", (e) => {
      if (e.target.closest("[data-bs-close]")) { close(); return; }
      const nav = e.target.closest("[data-bs]");
      if (nav) { if (nav.dataset.bsAct) { close(); run(nav.dataset.bsAct, null); } else draw(nav.dataset.bs); return; }
      const a = e.target.closest("[data-bs-run]");
      if (a) { close(); run(a.dataset.bsRun, null); return; }
      const ui = e.target.closest("[data-bs-ui]");
      if (ui) { close(); E.setUi(ui.dataset.bsUi); return; }
      const d = e.target.closest("[data-bs-disp]");
      if (d) { setDisplay(d.dataset.bsDisp); draw("options"); }
    });
    R.closeBackstage = close;
    draw(sec);
    bs.querySelector("[aria-current='true']")?.focus({ preventScroll: true });
  }
  R.openBackstage = openBackstage;
  const card = ([act, t, d]) => `<button type="button" class="tr-bs-card" data-bs-run="${act}">${svg(ACT_ICON_OF(act), 22)}<b>${esc(t)}</b><span>${esc(d)}</span></button>`;
  function pageHtml(s) {
    const sec = BACKSTAGE.find((x) => x.id === s);
    if (s === "info") {
      if (E.blank) return `<h3>Aucun événement ouvert</h3><p class="tr-bs-sub">Créez un événement, ouvrez l'un des vôtres, ou importez un fichier O'CN (.ocnt) ou Purple Pen (.ppen).</p>
        <div class="tr-bs-cards">${card(["start-new", "Nouvel événement", "Une compétition de votre club ou un entraînement, sur sa carte."])}${card(["start-open", "Ouvrir un événement", "Un de ceux que vous avez créés ou dont l'équipe vous compte."])}${card(["start-import", "Importer un événement", "Un fichier O'CN (.ocnt) ou Purple Pen (.ppen) et sa carte."])}</div>`;
      const ev = E.ev, m = E.meta || {}, n = Object.values(ev.controls).filter((c) => c.kind === "normal").length;
      const map = E.map ? (E.map.kind === "vector" ? (E.map.format === "oom" ? "OpenOrienteering Mapper" : `OCAD ${E.map.version || ""}`) : E.map.kind === "pdf" ? "PDF" : "Image") : "aucune";
      const role = { owner: "créateur", setter: "traceur", controller: "contrôleur", viewer: "lecteur" }[E.role] || E.role || "";
      return `<h3>${esc(ev.title.replace(/\|/g, " ") || m.title || "Événement")}</h3><p class="tr-bs-sub">${m.kind === "race" ? "Compétition" : "Entraînement"}${m.date ? ` · ${new Date(m.date).toLocaleDateString("fr-FR", { dateStyle: "long" })}` : ""}</p>
        <dl class="tr-bs-info"><dt>Carte</dt><dd>${esc(ev.map.file || m.map?.name || "")} · ${esc(map)} · 1:${nf(ev.map.scale)}${hasGeo(ev) ? " · géoréférencée" : ""}</dd>
          <dt>Circuits</dt><dd>${M.courseIds(ev).map((id) => esc(ev.courses[id].name)).join(", ") || "aucun"} · ${n} postes</dd>
          <dt>Votre rôle</dt><dd>${esc(role)}${E.readOnly ? " · lecture seule" : ""}</dd><dt>Chiffrement</dt><dd>${E.key ? "oui, avec la phrase de passe de l'équipe" : "non"}</dd>
          <dt>Enregistré</dt><dd>${E.lastSaved ? `à ${E.lastSaved.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "tout seul, après chaque changement"}</dd></dl>
        <div class="tr-bs-cards">${card(["event-props", "Propriétés", "Le titre, l'échelle de la carte, la langue des définitions, des notes."])}${card(["team", "L'équipe", "Les membres de l'équipe et leur rôle."])}${card(["encryption", "Le chiffrement", "Une phrase de passe de l'équipe."])}</div>`;
    }
    if (s === "options") {
      const ui = (k, t, d) => `<button type="button" class="tr-bs-card${E.ui === k ? " on" : ""}" data-bs-ui="${k}">${svg(k === "ocn" ? "ribbon" : "menu", 22)}<b>${t}${E.ui === k ? " ✓" : ""}</b><span>${d}</span></button>`;
      const dp = (k, t, d) => `<button type="button" class="tr-bs-card${R.display === k ? " on" : ""}" data-bs-disp="${k}">${svg(k === "full" ? "ribbon" : k === "line" ? "minus" : "fit", 22)}<b>${t}${R.display === k ? " ✓" : ""}</b><span>${d}</span></button>`;
      return `<h3>Options</h3><p class="tr-bs-sub">Gardées sur ce navigateur.</p>
        <h4>L'interface</h4><div class="tr-bs-cards">${ui("ocn", "Mode O'CN : le ruban", "Les commandes par onglets, dans l'ordre du travail, et celles de l'objet choisi dans son propre onglet. Par défaut.")}
          ${ui("pp", "Mode Purple Pen : les menus", "Les menus Fichier, Événement, Circuit, Rapports, Affichage et la barre d'outils, comme dans Purple Pen.")}</div>
        <h4>Le ruban</h4><div class="tr-bs-cards">${dp("full", "Complet", "Les grands boutons et leurs noms.")}${dp("line", "Une seule ligne", "Une rangée de petits boutons : plus de place pour la carte.")}${dp("folded", "Les onglets seuls", "Le ruban s'ouvre sur la carte au clic d'un onglet (Ctrl+F1).")}</div>
        <h4>Les fichiers</h4><div class="tr-bs-cards">${card(["save-to", "Plusieurs fichiers", "Quand une commande crée plusieurs fichiers : un dossier choisi, ou un seul .zip."])}</div>`;
    }
    if (sec?.groups) return `<h3>${esc(sec.label)}</h3><p class="tr-bs-sub">Chaque fichier, et à qui il sert.</p>${sec.groups.map(([t, items]) => `<h4>${esc(t)}</h4><div class="tr-bs-cards">${items.map(card).join("")}</div>`).join("")}`;
    if (sec?.items) return `<h3>${esc(sec.label)}</h3><div class="tr-bs-cards">${sec.items.map(card).join("")}</div>`;
    return "";
  }

  // ---- finding a command ------------------------------------------------------------------------------------------------------
  const search = E.$("#tr-rsearch"), res = E.$("#tr-rsearch-res");
  let found = [];
  function index() {
    const out = commands().map((c) => ({ ...c, where: `${c.tab.label}${c.group.title ? ` › ${c.group.title}` : ""}`, old: c.act ? menuAt(c.act) : "" }));
    for (const k of Object.keys(A.SPECIAL_NAME)) out.push({ tool: `special:${k}`, label: A.SPECIAL_NAME[k], icon: ACT_OF[k] || k, tip: SPECIAL_TIP(k), tab: TABS[1], group: { title: "Objets spéciaux" }, where: "Tracer › Objets spéciaux", need: "edit", old: "" });
    for (const s of BACKSTAGE) for (const [act, l, d] of [...(s.items || []), ...(s.groups || []).flatMap((g) => g[1])]) if (!out.some((x) => x.act === act)) out.push({ act, label: l, tip: d, icon: ACT_ICON_OF(act), where: `Fichier › ${s.label}`, backstage: true, old: menuAt(act) });
    out.push({ act: "ui-classic", label: "Mode Purple Pen (les menus)", tip: "Revenir aux menus et à la barre d'outils de Purple Pen.", icon: "menu", where: "Fichier › Options", backstage: true, old: "" });
    out.push({ act: "ribbon-line", label: "Ruban sur une seule ligne", tip: "", icon: "minus", where: "Affichage du ruban", backstage: true, old: "" });
    out.push({ act: "ribbon-folded", label: "Replier le ruban", tip: "Ctrl+F1", icon: "fit", where: "Affichage du ruban", backstage: true, old: "" });
    return out;
  }
  function showResults() {
    const q = norm(search.value.trim());
    if (!q) { res.hidden = true; return; }
    const words = q.split(/\s+/);
    found = index().filter((c) => { const h = norm(`${c.label} ${c.tip || ""} ${c.old || ""} ${c.where}`); return words.every((w) => h.includes(w)); });
    // the names first, then the descriptions
    found.sort((a, b) => (norm(b.label).includes(words[0]) ? 1 : 0) - (norm(a.label).includes(words[0]) ? 1 : 0));
    found = found.filter((c, i) => found.findIndex((x) => (x.act || x.tool) === (c.act || c.tool) && x.ctx === c.ctx) === i).slice(0, 9);
    res.hidden = false;
    res.innerHTML = found.length ? found.map((c, i) => `<button type="button" data-fi="${i}" class="${i === 0 ? "on" : ""}">${svg(c.icon || "dots", 16)}<span>${esc(c.label)}</span><small>${esc(c.where)}</small></button>`).join("")
      : '<p class="tr-rsearch-none">Aucune commande. Essayez « fourche », « gpx », « caler », « échelle »…</p>';
  }
  async function choose(c) {
    res.hidden = true; search.value = ""; search.blur();
    if (c.ctx) {
      if (R.ctx !== c.ctx) { E.toast(`« ${c.label} » est dans l'onglet « ${CONTEXT[c.ctx].label} », qui vient quand ${({ control: "un poste", leg: "un interposte", special: "un objet", drawing: "un tracé" })[c.ctx]} est choisi.`, 6000); return; }
      R.tab = `ctx:${c.ctx}`;
    } else if (!c.backstage && c.tab?.id && c.tab.id !== "file") { if (!c.tab.id.startsWith("ctx:")) R.prevTab = c.tab.id; R.tab = c.tab.id; }
    render();
    const sel = c.tool ? `[data-rtool="${c.tool}"]` : `[data-ract="${c.act}"]`, b = host.querySelector(sel);
    if (b) { b.classList.add("tr-rflash"); setTimeout(() => b.classList.remove("tr-rflash"), 1600); }
    const w = why(c);
    if (w) { E.toast(w); return; }
    if (c.tool) E.setTool(c.tool); else run(c.act, b);
  }
  search?.addEventListener("input", showResults);
  search?.addEventListener("focus", showResults);
  search?.addEventListener("blur", () => setTimeout(() => { res.hidden = true; }, 160));
  search?.addEventListener("keydown", (e) => {
    const items = [...res.querySelectorAll("[data-fi]")], cur = items.findIndex((x) => x.classList.contains("on"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = (cur + (e.key === "ArrowDown" ? 1 : -1) + items.length) % (items.length || 1); items.forEach((x, i) => x.classList.toggle("on", i === n)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = found[Math.max(0, cur)]; if (c) choose(c); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); search.value = ""; res.hidden = true; search.blur(); }
  });
  res?.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-fi]"); if (b) { e.preventDefault(); choose(found[Number(b.dataset.fi)]); } });

  // ---- the keyboard: Alt for the key hints, Alt+Q the search, Ctrl+F1 to fold, F1 the guide ------------------------------------------------
  let altAlone = false;
  function keytips(level) {
    hideKeytips();
    R.keytips = level;
    if (!level) return;
    if (R.display === "folded" && level === 2) { R.floating = true; render(); }
    const put = (el, k) => { const r = el.getBoundingClientRect(), h = E.root.getBoundingClientRect(); if (!r.width) return; const s = document.createElement("span"); s.className = "tr-rkt"; s.textContent = k; s.style.left = `${r.left - h.left + r.width / 2}px`; s.style.top = `${r.bottom - h.top - 6}px`; E.root.appendChild(s); el.dataset.kt = k; };
    if (level === 1) {
      host.querySelectorAll(".tr-rtabs [data-rtab]").forEach((b) => { const id = b.dataset.rtab; put(b, id.startsWith("ctx:") ? "Z" : TABS.find((t) => t.id === id)?.key || "?"); });
      const s = E.$("#tr-rsearch"); if (s) put(s, "Q");
    } else {
      const used = new Set();
      host.querySelectorAll(".tr-rbody [data-ri]").forEach((b) => {
        if (b.matches("label")) return;
        const it = R.items[Number(b.dataset.ri)] || {};
        const cand = [it.key, ...norm(it.label).toUpperCase().replace(/[^A-Z]/g, "")].filter((c) => c && c.length === 1);
        let k = cand.find((c) => !used.has(c));
        for (let i = 0; !k && i < 26; i++) { const c = `Y${String.fromCharCode(65 + i)}`; if (!used.has(c)) k = c; }
        used.add(k); put(b, k);
      });
    }
  }
  function hideKeytips() { R.keytips = 0; R.ktBuf = ""; E.root.querySelectorAll(".tr-rkt").forEach((x) => x.remove()); host.querySelectorAll("[data-kt]").forEach((b) => delete b.dataset.kt); }
  R.keytips = 0;
  const onKey = (e) => {
    if (E.ui !== "ocn" || !document.body.contains(E.root)) return;
    if (document.querySelector(".tr-modal, .tr-start")) { if (R.keytips) hideKeytips(); return; }
    if (e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey) { altAlone = true; if (e.type === "keydown") e.preventDefault(); return; }
    if (e.type === "keyup") return;
    altAlone = false;
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === "q") { e.preventDefault(); search?.focus(); return; }
    if (e.ctrlKey && e.key === "F1") { e.preventDefault(); setDisplay(R.display === "folded" ? "full" : "folded"); return; }
    if (e.key === "F1" && !e.ctrlKey) { e.preventDefault(); const it = tipFor ? R.items[Number(tipFor.dataset.ri)] : null; window.open(GUIDE(guideOf(it) || curTab()?.guide || ""), "_blank"); return; }
    if (e.key === "Escape" && !R.keytips && (R.pops.length || R.floating)) { e.preventDefault(); e.stopPropagation(); closePops(); if (R.floating) { R.floating = false; render(); } return; }
    if (!R.keytips) return;
    if (e.target.closest?.("input, textarea, select")) { hideKeytips(); return; }
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { if (R.keytips === 2) keytips(1); else hideKeytips(); return; }
    const k = e.key.length === 1 ? e.key.toUpperCase() : "";
    if (!k) return;
    if (R.keytips === 1) {
      if (k === "Q") { hideKeytips(); search?.focus(); return; }
      if (k === "F") { hideKeytips(); openBackstage(); return; }
      const t = k === "Z" ? (R.ctx ? `ctx:${R.ctx}` : null) : TABS.find((x) => x.key === k && !x.backstage)?.id;
      if (!t) return;
      if (!t.startsWith("ctx:")) R.prevTab = t;
      R.tab = t; R.pulse = false; render(); keytips(2);
      return;
    }
    R.ktBuf = (R.ktBuf || "") + k;
    const b = [...host.querySelectorAll("[data-kt]")].find((x) => x.dataset.kt === R.ktBuf);
    if (b) { hideKeytips(); b.click(); return; }
    if (![...host.querySelectorAll("[data-kt]")].some((x) => x.dataset.kt.startsWith(R.ktBuf))) R.ktBuf = "";
  };
  const onKeyUp = (e) => {
    if (E.ui !== "ocn" || !document.body.contains(E.root)) return;
    if (e.key === "Alt" && altAlone) { altAlone = false; e.preventDefault(); if (document.querySelector(".tr-modal, .tr-start")) return; if (R.keytips) hideKeytips(); else keytips(1); }
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKeyUp, true);
  E.root.addEventListener("pointerdown", () => { if (R.keytips) hideKeytips(); });
  const guideOf = (it) => {
    if (!it) return "";
    const c = commands().find((x) => (it.act && x.act === it.act) || (it.tool && x.tool === it.tool));
    return c?.group?.guide || (c?.ctx ? CONTEXT[c.ctx].guide : c?.tab?.guide) || "";
  };
  // the ribbon is drawn again when its width changes (groups fold and unfold)
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = host.clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; render(); } });
  ro.observe(host);
  E.closeHooks.push(() => {
    ro.disconnect(); clearTimeout(issueTimer); hideTip(); closePops(); hideKeytips();
    document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKeyUp, true);
  });
  /** Owns Échap while something of its own is open. */
  R.ownsEscape = () => !!(R.keytips || R.pops.length || E.$(".tr-bs") || (R.display === "folded" && R.floating));
  render();
  return R;
}

/** The event audit's findings, one line each, the problems before the reminders (« Vérifier »: its count and its first lines). */
function issueRows(rep) {
  const out = [], plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
  for (const s of rep.sections) {
    const t = s.title || "";
    if (t === "Postes proches") { for (const r of s.rows) if (r[3]) out.push({ text: `Postes ${r[0]} à ${r[1]} : ${r[3].replace(/\s*\((IOF|sprint)[^)]*\)/g, "")}` }); }
    else if (t === "Interpostes courus dans les deux sens") { for (let i = 0; i < s.rows.length; i += 2) out.push({ text: `Interposte ${s.rows[i][0]} couru dans les deux sens`, warn: true }); }
    else if (t === "Postes inutilisés") out.push({ text: `${plural(s.rows.length, "poste")} inutilisé${s.rows.length > 1 ? "s" : ""}`, warn: true });
    else if (t === "Éléments manquants") { for (const r of s.rows) out.push({ text: `${r[0]} : ${r[2].replace(/\s*\(.*\)/, "")}`, warn: r[1] === "Dénivelée" || r[1] === "Charge" }); }
    else if (t === "Postes répétés") { for (const r of s.rows) out.push({ text: `${r[0]}, poste ${r[1]} : ${r[2]}` }); }
    else if (t === "Définitions incomplètes") { for (const r of s.rows) out.push({ text: `Poste ${r[0]} : ${r[2]}`, warn: true }); }
    else if (t.startsWith("Autres vérifications")) { for (const r of s.rows) out.push({ text: `${r[0] ? `${r[0]}, ` : ""}${r[1]} : ${r[2]}`, warn: /court|Aller-retour/.test(r[2]) }); }
    else for (const r of s.rows) out.push({ text: r.filter(Boolean).join(" · "), warn: true });
  }
  // « Circuit A : la dénivelée… »: the audit's sentences go on after a colon
  for (const o of out) o.text = o.text.replace(/ : ([A-ZÀ-Ý])(?=[a-zà-ÿ])/g, (m, c) => ` : ${c.toLowerCase()}`);
  return out.sort((a, b) => (a.warn ? 1 : 0) - (b.warn ? 1 : 0));
}

// the special objects' icons and a word on each (the gallery, the search)
const ACT_OF = { "first-aid": "firstaid", "optional-crossing-point": "crossing", "forbidden-route": "forbidden", "registration-mark": "regmark", "out-of-bounds": "oob",
  "dangerous-area": "danger", "temporary-construction": "construction", "white-out": "whiteout", rectangle: "rect" };
const SPECIAL_TIP = (k) => (["text", "image", "rectangle", "ellipse"].includes(k) ? "Glisser un cadre sur la carte."
  : ["boundary", "line"].includes(k) ? "Un clic par point, puis un double-clic (ou Entrée) pour finir."
    : ["out-of-bounds", "dangerous-area", "temporary-construction", "white-out"].includes(k) ? "Un clic par sommet, puis un double-clic (ou Entrée) : la zone se ferme toute seule." : "Un clic à l'endroit voulu.");
const ACT_ICON_OF = (act) => ACT_ICON[act] || "dots";

// What applies to the selection: the ribbon's contextual tab (ribbon.js) and the right-click menu (actions.js contextMenu) are
// both drawn from ribbon-data.js CONTEXT, so that they always offer the same commands (owner, 2026-10-17). The menu words them
// for the spot clicked (« Ajouter un coude ici »), and knows the handle under the mouse (« Retirer ce coude »).

import * as M from "./model.js";
import { CONTEXT } from "./ribbon-data.js";

/** The kind of the selection's tab: "drawing" (a line, an area or a route under way), "control", "leg", "special", or null. */
export function ctxKind(E) {
  if (E.blank) return null;
  if (E.pending) return "drawing";
  const s = E.sel;
  if (!s) return null;
  if ((s.kind === "control" || s.kind === "number") && E.ev.controls[s.control]) return "control";
  if (s.kind === "leg" && E.ev.controls[s.c1] && E.ev.controls[s.c2]) return "leg";
  if (s.kind === "special" && E.ev.specials[s.id]) return "special";
  return null;
}

const FRAMES = ["text", "image", "rectangle", "ellipse", "descriptions"];
/** Whether a contextual command applies to the selection. at.menu: for the right-click menu, at.handle the handle under the mouse. */
export function applies(E, act, kind, at = {}) {
  const s = E.sel, ev = E.ev;
  const c = s?.control ? ev.controls[s.control] : null, cc = s?.cc ? ev.courseControls[s.cc] : null;
  const sp = s?.kind === "special" ? ev.specials[s.id] : null;
  const leg = s?.kind === "leg" ? ev.legs[M.findLeg(ev, s.c1, s.c2)] : null;
  const inCourse = !!(E.cd.course && s?.cc);
  const corners = sp && !M.POINT_SPECIALS.includes(sp.kind) && !FRAMES.includes(sp.kind);
  switch (act) {
    case "control-props": return !!c && (c.kind === "normal" || c.kind === "start");
    case "toggle-exchange": return inCourse && c?.kind === "normal";
    case "var-fork": case "var-loop": return kind !== "control" || inCourse;
    case "var-delete": return kind !== "control" || !!cc?.split;
    case "points": return inCourse && c?.kind === "normal" && M.isScore(ev, E.cd.course);
    case "text-before": case "text-after": return inCourse;
    case "gap-add-circle": return !!c && (c.kind === "normal" || c.kind === "finish");
    case "number-auto": return s?.kind === "number" || !!cc?.number;
    case "rotate": case "stretch": return kind === "control" ? c?.kind === "crossing" : sp?.kind === "optional-crossing-point";
    case "special-props": return !!sp && ["text", "line", "rectangle", "ellipse", "descriptions"].includes(sp.kind);
    case "corner-add": return !!corners;
    case "corner-remove": return !!corners && (!at.menu || at.handle?.type === "corner");
    case "bend-remove": return !!leg?.bends?.length && (!at.menu || at.handle?.type === "bend");
    case "gap-remove-leg": return !!leg?.gaps?.length;
    case "route-clear": return !!leg?.route?.length;
    default: return true;
  }
}

const FLAG_MENU = [["flag-none", "Interposte non balisé"], ["flag-all", "Interposte entièrement balisé"], ["flag-begin", "Début balisé"], ["flag-end", "Fin balisée"]];
/** A command's words in the right-click menu (the ribbon's are shorter). */
function menuLabel(E, act, kind, label) {
  const cc = E.sel?.cc ? E.ev.courseControls[E.sel.cc] : null, sp = E.sel?.kind === "special" ? E.ev.specials[E.sel.id] : null;
  switch (act) {
    case "control-props": return "Définition et propriétés…";
    case "toggle-exchange": return cc?.exchange ? "Retirer l'échange de carte" : "Échange de carte à ce poste";
    case "var-fork": return "Fourche à partir d'ici…";
    case "var-loop": return "Boucles à partir d'ici…";
    case "text-before": return "Ligne de texte avant…";
    case "text-after": return "Ligne de texte après…";
    case "gap-add-circle": return "Couper le cercle ici";
    case "number-auto": return "Numéro placé automatiquement";
    case "bend-add": return "Ajouter un coude ici";
    case "bend-remove": return "Retirer ce coude";
    case "gap-add-leg": return "Couper l'interposte ici";
    case "gap-remove-leg": return "Refermer la coupure ici";
    case "route-draw": return "Tracer l'itinéraire prévu…";
    case "corner-add": return "Ajouter un sommet ici";
    case "corner-remove": return "Retirer ce sommet";
    case "displayed-courses": return "Circuits où il apparaît…";
    case "special-props": return sp?.kind === "text" ? "Texte…" : sp?.kind === "descriptions" ? "Colonnes…" : "Apparence…";
    case "delete": return kind === "control" ? (E.cd.course && E.sel?.cc ? "Retirer du circuit" : "Supprimer le poste") : "Supprimer";
    default: return label;
  }
}
/** The right-click menu for the selection: its tab's commands, group by group, then « Tout le circuit » when nothing is chosen. */
export function menuItems(E, at = {}) {
  const kind = ctxKind(E);
  if (!kind) return [["view-course", "Tout le circuit"], ["view-map", "Toute la carte"]];
  const out = [];
  for (const g of CONTEXT[kind].groups) {
    const here = [];
    const walk = (items) => items.forEach((it) => {
      if (it.t === "stack") walk(it.items);
      else if (it.t === "modes" && it.id === "flag") here.push("-", ...FLAG_MENU);
      else if (it.act && applies(E, it.act, kind, { ...at, menu: true })) here.push([it.act, menuLabel(E, it.act, kind, it.label)]);
    });
    walk(g.items);
    if (here.length) { if (out.length && here[0] !== "-") out.push("-"); out.push(...here); }
  }
  return out;
}

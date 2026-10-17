// The editor's actions (tracer/editor.js): what a click, a drag or a key does with each tool, as in Purple Pen —
// placing controls, the start, the finish, crossing points, map issue points and map exchanges; bends, gaps and flagging
// on legs; special objects; moving, deleting; handles; the right-click menu; the selected object's pane.

import * as M from "./model.js";
import { layoutCourse } from "./layout.js";
import { itemsFor } from "./draw.js";
import { widthInCells } from "./descr.js";
import * as D from "./dialogs.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const m0 = (v) => `${Math.round(v)} m`;
const km = (v) => `${(v / 1000).toFixed(2).replace(".", ",")} km`;
const KIND_NAME = { normal: "Poste", start: "Départ", finish: "Arrivée", crossing: "Point de passage obligatoire", "map-issue": "Point de remise de carte", "map-exchange": "Échange de carte" };
export const SPECIAL_NAME = { "first-aid": "Poste de secours", water: "Point d'eau", "optional-crossing-point": "Point de passage facultatif", "forbidden-route": "Itinéraire interdit",
  "registration-mark": "Repère de calage", boundary: "Limite infranchissable", line: "Ligne", "out-of-bounds": "Zone interdite", "dangerous-area": "Zone dangereuse",
  "temporary-construction": "Construction temporaire", "white-out": "Masque blanc", text: "Texte", image: "Image", rectangle: "Rectangle", ellipse: "Ellipse", descriptions: "Définitions sur la carte" };
const MOVE_WARN_M = 75;                                        // Purple Pen: moving a shared control further asks first

// ---- adding --------------------------------------------------------------------------------------------------------------
/** Where a new control goes in the current course: after the selected control, into the selected leg, or the closest leg. */
function insertionFor(E, p) {
  const ev = E.ev, cd = E.cdDraw || E.cd;
  if (E.sel?.kind === "control" && E.sel.cc && M.ccIds(ev, cd).includes(E.sel.cc)) return M.insertionPoint(ev, cd, E.sel.cc, 0);
  if (E.sel?.kind === "leg" && E.sel.cc1 && E.sel.cc2) return M.insertionPoint(ev, cd, E.sel.cc1, E.sel.cc2);
  // the closest leg (QueryEvent.FindClosestLeg)
  let best = null, bestD = Infinity;
  for (const l of M.enumLegs(ev, cd)) {
    const pts = M.legPoints(ev, ev.courseControls[l.cc1].control, ev.courseControls[l.cc2].control);
    const d = M.nearest(pts, p).d;
    if (d < bestD) { bestD = d; best = l; }
  }
  return M.insertionPoint(ev, cd, best?.cc1 || 0, best?.cc2 || 0);
}
const KIND_OF_TOOL = { control: "normal", start: "start", finish: "finish", crossing: "crossing", issue: "map-issue", exchange: "map-exchange" };
function placeControl(E, tool, p, sx, sy) {
  const kind = KIND_OF_TOOL[tool];
  const courseId = E.cd.course;
  const hit = E.hitAt(sx, sy, { includeOthers: true });
  const existing = hit && (hit.kind === "control") && E.ev.controls[hit.control]?.kind === kind ? hit.control : 0;
  // map exchange at a control of the course
  if (tool === "exchange" && hit?.kind === "control" && hit.cc && E.ev.controls[hit.control].kind === "normal") {
    return E.change((ev) => {
      const ids = M.ccIds(ev, M.cdCourse(courseId)).filter((id) => ev.courseControls[id].control === hit.control);
      for (const id of ids) ev.courseControls[id].exchange = !ev.courseControls[id].exchange;
    }, "Échange de carte au poste");
  }
  if (!courseId) {
    // « Tous les postes »: a new control in the collection only
    if (existing) { E.select({ kind: "control", control: existing, cc: 0 }); return true; }
    let id;
    E.change((ev) => { id = M.addControl(ev, kind, p); }, `Nouveau ${KIND_NAME[kind].toLowerCase()}`);
    E.select({ kind: "control", control: id, cc: 0 });
    return true;
  }
  if (kind === "map-issue" && !existing) {
    D.issueKind(E, (issueKind) => {
      let cc;
      E.change((ev) => { const id = M.addControl(ev, kind, p, { issueKind }); cc = M.addStartOrIssue(ev, id, courseId, false); }, "Point de remise de carte");
      E.select({ kind: "control", control: E.ev.courseControls[cc]?.control, cc });
    });
    return true;
  }
  let ccNew = 0;
  const ok = E.change((ev) => {
    if (M.isScore(ev, courseId) && kind === "normal" && existing && M.courseUses(ev, M.cdCourse(courseId), existing)) return false;
    if (kind === "start" || kind === "map-issue") {
      const id = existing || M.addControl(ev, kind, p);
      ccNew = M.addStartOrIssue(ev, id, courseId, !existing);
      return true;
    }
    if (kind === "finish") {
      const id = existing || M.addControl(ev, kind, p);
      ccNew = M.addFinish(ev, id, courseId, !existing);
      return true;
    }
    const ins = insertionFor(E, p);
    let id = existing;
    // clicking a neighbour of the insertion point makes a new control there (Purple Pen)
    if (id && [ins.cc1, ins.cc2].some((c) => c && ev.courseControls[c]?.control === id)) id = 0;
    if (!id) id = M.addControl(ev, kind, p);
    ccNew = M.addCourseControl(ev, id, courseId, ins.cc1, ins.cc2, ins.loc);
    if (kind === "map-exchange") { ev.courseControls[ccNew].exchange = true; }
    return true;
  }, existing ? `Ajout du poste ${E.ev.controls[existing]?.code || ""}` : `Nouveau ${KIND_NAME[kind].toLowerCase()}`);
  if (ok && ccNew) E.select({ kind: "control", control: E.ev.courseControls[ccNew]?.control, cc: ccNew });
  return ok;
}

// ---- the tools' clicks and drags --------------------------------------------------------------------------------------------
export function click(E, p, sx, sy, e) {
  const t = E.tool;
  if (t === "select") { const hit = E.hitAt(sx, sy); E.select(hit && !hit.other ? hit : null); return; }
  if (E.readOnly) return;
  if (KIND_OF_TOOL[t]) { placeControl(E, t, p, sx, sy); if (!e.shiftKey && t !== "control") E.setTool("select"); return; }
  if (t === "bend") {
    const hit = E.hitAt(sx, sy);
    const bend = handleAt(E, sx, sy);
    if (bend?.type === "bend") { E.change((ev) => M.removeBend(ev, bend.c1, bend.c2, bend.pt), "Coude retiré"); return; }
    if (hit?.kind === "leg") {
      E.change((ev) => M.addBend(ev, hit.c1, hit.c2, M.nearest(M.legPoints(ev, hit.c1, hit.c2), p).at), "Coude ajouté");
      E.select(hit);
    }
    return;
  }
  if (t === "route") {
    // the route expected on a leg (for the climb): the leg first, then its points, a double-click ends it
    if (!E.pending) {
      const hit = E.hitAt(sx, sy);
      if (hit?.kind !== "leg") { E.toast("Cliquez d'abord un interposte."); return; }
      const a = E.ev.controls[hit.c1];
      E.pending = { kind: "route", c1: hit.c1, c2: hit.c2, pts: [[a.x, a.y]] };
      E.select(hit);
    } else E.pending.pts.push(p);
    E.ghost = { pts: E.pending.pts.slice() };
    E.help(`Itinéraire : ${E.pending.pts.length - 1} point(s) — cliquer le long du chemin prévu, double-cliquer (ou Entrée) pour finir`);
    E.redraw();
    return;
  }
  if (t === "gap") {
    const hit = E.hitAt(sx, sy);
    if (hit?.kind === "leg") E.change((ev) => M.removeLegGap(ev, hit.c1, hit.c2, p), "Coupure refermée");
    else if (hit?.kind === "control") E.change((ev) => M.removeCircleGap(ev, hit.control, gapScale(E), p), "Coupure refermée");
    return;
  }
  if (t.startsWith("special:")) {
    const kind = t.slice(8);
    if (M.POINT_SPECIALS.includes(kind)) {
      let id;
      E.change((ev) => { id = M.addSpecial(ev, kind, [p], kind === "optional-crossing-point" ? { orientation: 0 } : {}); }, SPECIAL_NAME[kind]);
      E.select({ kind: "special", id });
      if (!e.shiftKey) E.setTool("select");
      return;
    }
    if (M.LINE_SPECIALS.includes(kind) || M.AREA_SPECIALS.includes(kind)) {
      E.pending = E.pending || { kind, pts: [] };
      E.pending.pts.push(p);
      E.ghost = { pts: E.pending.pts.slice(), closed: M.AREA_SPECIALS.includes(kind) };
      E.help(`${SPECIAL_NAME[kind]} : ${E.pending.pts.length} point(s) — double-cliquer (ou Entrée) pour finir`);
      E.redraw();
    }
  }
}
export function doubleClick(E, p) {
  if (E.pending && (E.tool.startsWith("special:") || E.pending.kind === "route")) { finishPending(E); return true; }
  if (E.tool === "select" && E.sel?.kind === "special") {
    const sp = E.ev.specials[E.sel.id];
    if (sp?.kind === "text" || sp?.kind === "descriptions") { D.specialProps(E, E.sel.id); return true; }
  }
  if (E.tool === "select" && E.sel?.kind === "control" && E.cd.course) { D.controlProps?.(E, E.sel.control); return !!D.controlProps; }
  void p;
  return false;
}
export function finishPending(E) {
  const pend = E.pending;
  if (!pend) return;
  // the double-click's second click added a point at the same place
  const pts = pend.pts.filter((q, i) => i === 0 || M.dist(q, pend.pts[i - 1]) > 0.05);
  if (pend.kind === "route") {
    E.pending = null; E.ghost = null;
    const inner = pts.slice(1);
    E.change((ev) => M.setLegRoute(ev, pend.c1, pend.c2, inner), inner.length ? "Itinéraire tracé" : "Itinéraire effacé");
    E.setTool("select");
    return;
  }
  const min = M.AREA_SPECIALS.includes(pend.kind) ? 3 : 2;
  E.pending = null; E.ghost = null;
  if (pts.length < min) { E.toast(`Il faut au moins ${min} points.`); E.redraw(); return; }
  if (pend.kind === "line") {
    D.lineAppearance(E, null, (look) => { let id; E.change((ev) => { id = M.addSpecial(ev, "line", pts, look); }, "Ligne"); E.select({ kind: "special", id }); E.setTool("select"); });
    return;
  }
  let id;
  E.change((ev) => { id = M.addSpecial(ev, pend.kind, pts); }, SPECIAL_NAME[pend.kind]);
  E.select({ kind: "special", id });
  E.setTool("select");
}
/** A tool that works by dragging: returns the drag's state, or null to let the click happen. */
export function toolDown(E, p, sx, sy) {
  const t = E.tool;
  if (t === "gap") {
    const hit = E.hitAt(sx, sy);
    if (hit?.kind === "leg" || hit?.kind === "control") return { kind: "gap", hit, start: p };
    return null;
  }
  if (t === "descr" || ["special:text", "special:image", "special:rectangle", "special:ellipse"].includes(t)) return { kind: "rect", tool: t, start: p };
  return null;
}
export function dragMove(E, d, p, sx, sy, e) {
  if (d.kind === "rect") { E.dragRect = [d.start, p]; E.redraw(); return; }
  if (d.kind === "gap") { E.ghost = { pts: [d.start, p] }; E.redraw(); return; }
  if (d.kind === "move" || d.kind === "handle") {
    d.last = p;
    E.ghost = moveGhost(E, d, p, e);
    E.redraw();
  }
}
export function dragEnd(E, d, p, sx, sy, e) {
  E.ghost = null; E.dragRect = null;
  if (d.kind === "rect") {
    if (!d.moved) { E.redraw(); return; }
    const [l, b, r, t] = [Math.min(d.start[0], p[0]), Math.min(d.start[1], p[1]), Math.max(d.start[0], p[0]), Math.max(d.start[1], p[1])];
    if (r - l < 1 || t - b < 1) { E.redraw(); return; }
    if (d.tool === "descr") { placeDescriptions(E, [l, t], r - l); return; }
    const kind = d.tool.slice(8);
    if (kind === "text") D.textProps(E, null, (look) => { let id; E.change((ev) => { id = M.addSpecial(ev, "text", [[l, t], [r, b]], look); }, "Texte"); E.select({ kind: "special", id }); E.setTool("select"); });
    else if (kind === "image") D.imageFile(E, (image) => { let id; E.change((ev) => { id = M.addSpecial(ev, "image", [[l, t], [r, b]], image); }, "Image"); E.select({ kind: "special", id }); E.setTool("select"); });
    else D.lineAppearance(E, kind, (look) => { let id; E.change((ev) => { id = M.addSpecial(ev, kind, [[l, t], [r, b]], look); }, SPECIAL_NAME[kind]); E.select({ kind: "special", id }); E.setTool("select"); });
    return;
  }
  if (d.kind === "gap") {
    if (!d.moved) { click(E, p, sx, sy, e); return; }
    const h = d.hit;
    if (h.kind === "leg") E.change((ev) => M.addLegGap(ev, h.c1, h.c2, d.start, p), "Coupure");
    else E.change((ev) => M.addCircleGap(ev, h.control, gapScale(E), d.start, p), "Coupure du cercle");
    return;
  }
  if (d.kind === "move") { if (d.moved) applyMove(E, d.hit, d.start, p, e); else E.redraw(); return; }
  if (d.kind === "handle") { if (d.moved) applyHandle(E, d.handle, p); else if (E.tool === "bend" || e.altKey) click(E, p, sx, sy, e); else E.redraw(); }
}
const gapScale = (E) => M.gapScale(E.ev, (E.cd.course ? E.ev.courses[E.cd.course].printScale : E.ev.allControls.printScale));

function placeDescriptions(E, topLeft, width) {
  const cd = E.cd;
  const descKind = cd.course ? E.ev.courses[cd.course].descKind : E.ev.allControls.descKind;
  const cell = width / widthInCells(descKind);
  let id;
  E.change((ev) => {
    // one description block per course: an existing one for this course moves
    const old = Object.entries(ev.specials).find(([, s]) => s.kind === "descriptions" && !s.all && s.courses.some((x) => x.course === cd.course && (x.part ?? -1) === cd.part));
    if (old) { ev.specials[old[0]].pts = [topLeft, [topLeft[0] + cell, topLeft[1]]]; id = Number(old[0]); return; }
    id = M.addSpecial(ev, "descriptions", [topLeft, [topLeft[0] + cell, topLeft[1]]], { all: false, courses: [{ course: cd.course, part: cd.part }], columns: 1 });
  }, "Définitions sur la carte");
  E.select({ kind: "special", id });
  E.setTool("select");
}

// ---- moving ----------------------------------------------------------------------------------------------------------------
export const movable = (E, hit) => ["control", "number", "special"].includes(hit.kind);
function moveGhost(E, d, p, e) {
  const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
  if (d.kind === "handle") {
    const h = d.handle;
    if (h.type === "descr") return { pts: [[h.topLeft[0], h.topLeft[1]], [p[0], h.topLeft[1]], [p[0], p[1]], [h.topLeft[0], p[1]]], closed: true };
    return { pts: [h.pt, p] };
  }
  const hit = d.hit;
  if (hit.kind === "control") {
    const c = E.ev.controls[hit.control];
    const ev2 = M.clone(E.ev);
    M.moveControl(ev2, hit.control, snap(E, [c.x + dx, c.y + dy], e));
    return { items: itemsFor(ev2, layoutCourse(ev2, E.cdDraw || E.cd, { numbers: false, specials: false, descriptions: false })) };
  }
  if (hit.kind === "number") return { pts: [d.start, p] };
  if (hit.kind === "special") {
    const sp = E.ev.specials[hit.id];
    const pts = sp.pts.map(([x, y]) => [x + dx, y + dy]);
    if (sp.kind === "descriptions") {
      const o = E.layout.objs.find((x) => x.special === hit.id);
      if (o?.size) { const [x0, y0] = pts[0]; return { pts: [[x0, y0], [x0 + o.size[0], y0], [x0 + o.size[0], y0 - o.size[1]], [x0, y0 - o.size[1]]], closed: true }; }
    }
    if (["text", "image", "rectangle", "ellipse"].includes(sp.kind)) {
      const [a, b] = pts; return { pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], closed: true };
    }
    return { pts, closed: M.AREA_SPECIALS.includes(sp.kind) };
  }
  return null;
}
/** Shift held: snap to the nearest other control (to merge positions exactly). */
function snap(E, p, e) {
  if (!e?.shiftKey) return p;
  let best = null, bd = 3;
  for (const c of Object.values(E.ev.controls)) { const d = M.dist([c.x, c.y], p); if (d < bd) { bd = d; best = [c.x, c.y]; } }
  return best || p;
}
function applyMove(E, hit, start, p, e) {
  const dx = p[0] - start[0], dy = p[1] - start[1];
  if (hit.kind === "control") {
    const c = E.ev.controls[hit.control], to = snap(E, [c.x + dx, c.y + dy], e);
    const others = E.cd.course ? M.coursesUsing(E.ev, hit.control).filter((x) => x !== E.cd.course) : [];
    const far = M.mmToM(E.ev, M.dist([c.x, c.y], to)) >= MOVE_WARN_M;
    if (c.kind === "normal" && others.length && far && hit.cc) {
      D.sharedMove(E, hit, others, to);
      return;
    }
    E.change((ev) => M.moveControl(ev, hit.control, to), `Poste ${c.code || KIND_NAME[c.kind]} déplacé`);
    return;
  }
  if (hit.kind === "number") {
    const c = E.ev.controls[hit.control];
    const o = E.layout.objs.find((x) => (x.t === "number" || x.t === "code") && x.control === hit.control);
    if (!o) return;
    const ctr = [o.ctr[0] + dx, o.ctr[1] + dy];
    // dropped on its circle: back to automatic
    const auto = M.dist(ctr, [c.x, c.y]) < M.controlRadius(E.ev) * E.layout.ratio;
    if (hit.cc) E.change((ev) => { const cc = ev.courseControls[hit.cc]; if (auto) delete cc.number; else cc.number = [ctr[0] - c.x, ctr[1] - c.y]; }, "Numéro déplacé");
    else E.change((ev) => { if (auto) delete ev.controls[hit.control].codeAngle; else ev.controls[hit.control].codeAngle = M.angleDeg([c.x, c.y], ctr); }, "Code déplacé");
    return;
  }
  if (hit.kind === "special") E.change((ev) => { const sp = ev.specials[hit.id]; sp.pts = sp.pts.map(([x, y]) => [x + dx, y + dy]); }, `${SPECIAL_NAME[E.ev.specials[hit.id].kind]} déplacé`);
}

// ---- handles ---------------------------------------------------------------------------------------------------------------
/** The selected object's handles: [{ type, pt, … }]. */
export function handles(E) {
  const s = E.sel, ev = E.ev, out = [];
  if (!s) return out;
  if (s.kind === "leg" && ev.controls[s.c1] && ev.controls[s.c2]) {
    const leg = ev.legs[M.findLeg(ev, s.c1, s.c2)];
    for (const b of leg?.bends || []) out.push({ type: "bend", pt: b, c1: s.c1, c2: s.c2 });
    const pts = M.legPoints(ev, s.c1, s.c2);
    for (const [st, len] of leg?.gaps || []) {
      out.push({ type: "legGap", pt: M.pointAt(pts, st), c1: s.c1, c2: s.c2, round: true });
      out.push({ type: "legGap", pt: M.pointAt(pts, st + len), c1: s.c1, c2: s.c2, round: true });
    }
  }
  if (s.kind === "control" && ev.controls[s.control]) {
    const c = ev.controls[s.control], r = M.controlRadius(ev) * (E.layout?.ratio || 1);
    for (const [a, b] of M.circleGaps(ev, s.control, gapScale(E)) || []) for (const ang of [a, b])
      out.push({ type: "circleGap", pt: [c.x + r * Math.cos(ang * Math.PI / 180), c.y + r * Math.sin(ang * Math.PI / 180)], control: s.control, round: true });
  }
  if (s.kind === "special" && ev.specials[s.id]) {
    const sp = ev.specials[s.id];
    if (sp.kind === "descriptions") {
      const o = E.layout?.objs.find((x) => x.special === s.id);
      if (o?.size) out.push({ type: "descr", pt: [sp.pts[0][0] + o.size[0], sp.pts[0][1] - o.size[1]], id: s.id, topLeft: sp.pts[0], cells: o.widthCells });
    } else if (["text", "image", "rectangle", "ellipse"].includes(sp.kind)) {
      sp.pts.forEach((pt, i) => out.push({ type: "corner", pt, id: s.id, i }));
    } else if (!M.POINT_SPECIALS.includes(sp.kind)) sp.pts.forEach((pt, i) => out.push({ type: "corner", pt, id: s.id, i }));
  }
  return out;
}
export function handleAt(E, sx, sy) {
  for (const h of handles(E)) { const [x, y] = E.toScreen(...h.pt); if (Math.hypot(x - sx, y - sy) <= 7) return h; }
  return null;
}
function applyHandle(E, h, p) {
  if (h.type === "bend") E.change((ev) => M.moveBend(ev, h.c1, h.c2, h.pt, p), "Coude déplacé");
  else if (h.type === "legGap") E.change((ev) => {
    const pts = M.legPoints(ev, h.c1, h.c2), leg = ev.legs[M.findLeg(ev, h.c1, h.c2)];
    const at = M.nearest(pts, h.pt).len, to = M.nearest(pts, p).len;
    const gaps = leg.gaps.map(([s, l]) => (Math.abs(s - at) < 0.01 ? [to, l - (to - s)] : Math.abs(s + l - at) < 0.01 ? [s, to - s] : [s, l]));
    M.setLegGaps(ev, h.c1, h.c2, M.simplifyGaps(gaps, M.pathLength(pts)));
  }, "Coupure modifiée");
  else if (h.type === "circleGap") E.change((ev) => {
    const c = ev.controls[h.control], ang0 = M.angleDeg([c.x, c.y], h.pt), ang1 = M.angleDeg([c.x, c.y], p);
    const near = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 0.5;
    const gaps = (M.circleGaps(ev, h.control, gapScale(E)) || []).map(([a, b]) => (near(a, ang0) ? M.orderGapAngles(ang1, b) : near(b, ang0) ? M.orderGapAngles(a, ang1) : [a, b]));
    M.setCircleGaps(ev, h.control, gapScale(E), M.simplifyCircleGaps(gaps));
  }, "Coupure du cercle modifiée");
  else if (h.type === "corner") E.change((ev) => { ev.specials[h.id].pts[h.i] = p.slice(); }, "Coin déplacé");
  else if (h.type === "descr") E.change((ev) => {
    const sp = ev.specials[h.id], w = Math.max(5, p[0] - h.topLeft[0]), cell = w / h.cells;
    sp.pts = [sp.pts[0], [sp.pts[0][0] + cell, sp.pts[0][1]]];
  }, "Taille des définitions");
}

// ---- hover: a preview of what a click would add ------------------------------------------------------------------------------
export function hover(E, p, sx, sy) {
  const t = E.tool;
  if (E.pending) { E.ghost = { pts: E.pending.pts.slice(), cursor: p, closed: M.AREA_SPECIALS.includes(E.pending.kind) }; E.redraw(); return; }
  if (KIND_OF_TOOL[t] || (t.startsWith("special:") && M.POINT_SPECIALS.includes(t.slice(8)))) {
    const hit = KIND_OF_TOOL[t] ? E.hitAt(sx, sy, { includeOthers: true }) : null;
    const kind = KIND_OF_TOOL[t];
    const at = hit?.kind === "control" && E.ev.controls[hit.control]?.kind === kind ? [E.ev.controls[hit.control].x, E.ev.controls[hit.control].y] : p;
    const ev2 = M.clone(E.ev);
    if (kind) M.addControl(ev2, kind === "map-exchange" ? "normal" : kind, at);
    else M.addSpecial(ev2, t.slice(8), [at]);
    const lay = layoutCourse(ev2, M.cdAll(), { numbers: false, descriptions: false, specials: !kind });
    const last = kind ? lay.objs.filter((o) => o.control === Math.max(...Object.keys(ev2.controls).map(Number))) : lay.objs.filter((o) => o.special === Math.max(...Object.keys(ev2.specials).map(Number)));
    E.ghost = { items: itemsFor(ev2, { objs: last }) };
    E.redraw();
    return;
  }
  if (E.ghost) { E.ghost = null; E.redraw(); }
}

// ---- deleting --------------------------------------------------------------------------------------------------------------
export function deleteSelection(E) {
  const s = E.sel;
  if (!s || E.readOnly) return;
  if (s.kind === "special") { E.change((ev) => { delete ev.specials[s.id]; }, "Objet supprimé"); E.select(null); return; }
  if (s.kind === "leg") { E.toast("Un interposte ne se supprime pas : supprimez l'un de ses postes, ou retirez ses coudes et coupures."); return; }
  if (s.kind === "control" || s.kind === "number") {
    const c = E.ev.controls[s.control];
    if (E.cd.course && s.cc) {
      // from this course only; the control stays in « Tous les postes »
      E.change((ev) => { M.removeCourseControl(ev, E.cd.course, s.cc); }, `${KIND_NAME[c.kind]} ${c.code || ""} retiré du circuit`);
    } else {
      const used = M.coursesUsing(E.ev, s.control);
      if (used.length) { D.confirm(E, `Ce poste sert dans ${used.length} circuit(s) (${used.map((x) => E.ev.courses[x].name).join(", ")}). Le supprimer partout ?`, "Supprimer", () => { E.change((ev) => M.removeControl(ev, s.control), "Poste supprimé"); E.select(null); }); return; }
      E.change((ev) => M.removeControl(ev, s.control), "Poste supprimé");
    }
    E.select(null);
  }
}

// ---- the right-click menu --------------------------------------------------------------------------------------------------
export function contextMenu(E, sx, sy, cx, cy) {
  const hit = E.hitAt(sx, sy) || (handleAt(E, sx, sy) ? E.sel : null);
  if (hit && !hit.other) E.select(hit);
  const s = E.sel, items = [];
  const p = E.toMap(sx, sy);
  if (s?.kind === "control" || s?.kind === "number") {
    const c = E.ev.controls[s.control];
    if (c.kind === "normal" || c.kind === "start") items.push(["control-props", "Définition et propriétés…"]);
    if (c.kind === "crossing") items.push(["rotate", "Faire pivoter…"], ["stretch", "Étirer…"]);
    if (E.cd.course && s.cc) {
      if (c.kind === "normal") items.push(["toggle-exchange", E.ev.courseControls[s.cc]?.exchange ? "Retirer l'échange de carte" : "Échange de carte à ce poste"]);
      items.push(["var-fork", "Fourche à partir d'ici…"], ["var-loop", "Boucles à partir d'ici…"]);
      if (E.ev.courseControls[s.cc]?.split) items.push(["var-delete", "Supprimer la variante"]);
      if (c.kind === "normal" && M.isScore(E.ev, E.cd.course)) items.push(["points", "Points…"]);
      items.push(["text-before", "Ligne de texte avant…"], ["text-after", "Ligne de texte après…"]);
    }
    if (c.kind === "normal" || c.kind === "finish") items.push(["gap-add-circle", "Couper le cercle ici"]);
    if (s.kind === "number" || (s.cc && E.ev.courseControls[s.cc]?.number)) items.push(["number-auto", "Numéro placé automatiquement"]);
    items.push(["delete", E.cd.course && s.cc ? "Retirer du circuit" : "Supprimer le poste"]);
  } else if (s?.kind === "leg") {
    items.push(["bend-add", "Ajouter un coude ici"]);
    const h = handleAt(E, sx, sy);
    if (h?.type === "bend") items.push(["bend-remove", "Retirer ce coude"]);
    items.push(["gap-add-leg", "Couper l'interposte ici"]);
    if (E.ev.legs[M.findLeg(E.ev, s.c1, s.c2)]?.gaps?.length) items.push(["gap-remove-leg", "Refermer la coupure ici"]);
    items.push("-", ["flag-none", "Interposte non balisé"], ["flag-all", "Interposte entièrement balisé"], ["flag-begin", "Début balisé"], ["flag-end", "Fin balisée"]);
  } else if (s?.kind === "special") {
    const sp = E.ev.specials[s.id];
    if (["text"].includes(sp.kind)) items.push(["special-props", "Texte…"]);
    if (["line", "rectangle", "ellipse"].includes(sp.kind)) items.push(["special-props", "Apparence…"]);
    if (sp.kind === "descriptions") items.push(["special-props", "Colonnes…"]);
    if (sp.kind === "optional-crossing-point") items.push(["rotate", "Faire pivoter…"], ["stretch", "Étirer…"]);
    if (!M.POINT_SPECIALS.includes(sp.kind) && !["text", "image", "rectangle", "ellipse", "descriptions"].includes(sp.kind)) {
      items.push(["corner-add", "Ajouter un sommet ici"]);
      if (handleAt(E, sx, sy)?.type === "corner") items.push(["corner-remove", "Retirer ce sommet"]);
    }
    items.push(["displayed-courses", "Circuits où il apparaît…"], ["delete", "Supprimer"]);
  } else {
    items.push(["view-course", "Tout le circuit"], ["view-map", "Toute la carte"]);
  }
  D.popupMenu(E, cx, cy, items, (act) => D.action(E, act, null, { p, sx, sy }));
}

// ---- the selected object's pane ---------------------------------------------------------------------------------------------
export function describeSelection(E) {
  const s = E.sel, ev = E.ev;
  if (!s) {
    if (!E.cd.course) return `<h3>Tous les postes</h3><p>${Object.values(ev.controls).filter((c) => c.kind === "normal").length} postes, ${M.unusedControls(ev).length} inutilisé(s).</p>`;
    const v = E.layout.view, c = E.course();
    return `<h3>${esc(c.name)}</h3><dl class="tr-dl"><dt>Longueur</dt><dd>${v.totalMin === v.totalMax ? km(v.totalMin) : `${km(v.totalMin)} – ${km(v.totalMax)}`}</dd>
      <dt>Dénivelée</dt><dd>${c.climb >= 0 ? m0(c.climb) : "—"}</dd><dt>Postes</dt><dd>${v.minNormal === v.maxNormal ? v.minNormal : `${v.minNormal} – ${v.maxNormal}`}</dd>
      <dt>Échelle</dt><dd>1:${new Intl.NumberFormat("fr-FR").format(c.printScale)}</dd>${c.load >= 0 ? `<dt>Concurrents</dt><dd>${c.load}</dd>` : ""}
      ${c.secondary ? `<dt>Catégories</dt><dd>${esc(c.secondary)}</dd>` : ""}</dl>
      <button type="button" class="btn btn-sm" data-act="course-props">Propriétés du circuit…</button>`;
  }
  if (s.kind === "control" || s.kind === "number") {
    const c = ev.controls[s.control];
    if (!c) return "";
    const used = M.coursesUsing(ev, s.control).map((x) => ev.courses[x].name);
    const load = M.controlLoad(ev, s.control);
    let legInfo = "";
    if (E.cd.course && s.cc) {
      const v = E.layout.view, i = v.controls.findIndex((x) => x.ccs.includes(s.cc));
      if (i >= 0 && v.controls[i].legLen?.length) legInfo = `<dt>Vers le suivant</dt><dd>${m0(v.controls[i].legLen[0])}</dd>`;
    }
    return `<h3>${KIND_NAME[c.kind]}${c.code ? ` ${esc(c.code)}` : ""}</h3>
      <dl class="tr-dl">${c.kind === "normal" ? `<dt>Code</dt><dd><input id="tr-code" value="${esc(c.code)}" size="4" maxlength="3" ${E.readOnly ? "disabled" : ""}></dd>` : ""}
      ${legInfo}<dt>Circuits</dt><dd>${used.length ? esc(used.join(", ")) : "aucun"}</dd>${load >= 0 ? `<dt>Charge</dt><dd>${load} concurrents</dd>` : ""}
      <dt>Position</dt><dd>${c.x.toFixed(1)} ; ${c.y.toFixed(1)} mm</dd></dl>
      ${c.notes ? `<p class="tr-note">${esc(c.notes)}</p>` : ""}
      <div class="tr-btns">${c.kind === "normal" || c.kind === "start" ? '<button type="button" class="btn btn-sm" data-act="control-props">Définition…</button>' : ""}
      <button type="button" class="btn btn-sm" data-act="delete">${E.cd.course && s.cc ? "Retirer du circuit" : "Supprimer"}</button></div>`;
  }
  if (s.kind === "leg") {
    const a = ev.controls[s.c1], b = ev.controls[s.c2];
    if (!a || !b) return "";
    const len = M.legLengthM(ev, s.c1, s.c2), straight = M.mmToM(ev, M.dist([a.x, a.y], [b.x, b.y]));
    const flag = M.legFlagging(ev, s.c1, s.c2), load = M.legLoad(ev, s.c1, s.c2);
    const used = M.coursesUsingLeg(ev, s.c1, s.c2).map((x) => ev.courses[x].name);
    return `<h3>Interposte ${esc(a.code || KIND_NAME[a.kind])} → ${esc(b.code || KIND_NAME[b.kind])}</h3>
      <dl class="tr-dl"><dt>Longueur</dt><dd>${m0(len)}${Math.abs(len - straight) > 1 ? ` (ligne droite ${m0(straight)})` : ""}</dd>
      <dt>Circuits</dt><dd>${esc(used.join(", ") || "—")}</dd>${load >= 0 ? `<dt>Charge</dt><dd>${load} concurrents</dd>` : ""}
      <dt>Balisage</dt><dd><select id="tr-flag" ${E.readOnly ? "disabled" : ""}>${[["none", "aucun"], ["all", "tout l'interposte"], ["begin", "le début"], ["end", "la fin"]].map(([k, l]) =>
        `<option value="${k}" ${flag === k ? "selected" : ""}>${l}</option>`).join("")}${flag === "issue-middle" ? '<option selected value="issue-middle">remise de carte</option>' : ""}</select></dd></dl>
      ${(() => { const r = ev.legs[M.findLeg(ev, s.c1, s.c2)]?.route; return r?.length ? `<p class="tr-hint">Itinéraire prévu : ${m0(M.mmToM(ev, M.pathLength(M.legRoutePoints(ev, s.c1, s.c2))))} (sert à la dénivelée).</p>
        <div class="tr-btns"><button type="button" class="btn btn-sm" data-act="route-clear">Effacer l'itinéraire</button></div>` : ""; })()}
      <p class="tr-hint">Outil Coude : cliquer l'interposte. Outil Coupure : glisser le long de l'interposte. Outil Itinéraire : le chemin prévu, pour la dénivelée.</p>`;
  }
  if (s.kind === "special") {
    const sp = ev.specials[s.id];
    if (!sp) return "";
    const shown = sp.all ? "tous les circuits" : sp.courses.map((x) => (x.course ? ev.courses[x.course]?.name : "Tous les postes") + (x.part >= 0 ? ` (partie ${x.part + 1})` : "")).join(", ");
    const len = M.LINE_SPECIALS.includes(sp.kind) ? `<dt>Longueur</dt><dd>${m0(M.mmToM(ev, M.pathLength(sp.pts)))}</dd>` : "";
    return `<h3>${SPECIAL_NAME[sp.kind] || sp.kind}</h3><dl class="tr-dl"><dt>Affiché sur</dt><dd>${esc(shown || "aucun circuit")}</dd>${len}</dl>
      <div class="tr-btns"><button type="button" class="btn btn-sm" data-act="displayed-courses">Circuits…</button>
      ${["text", "line", "rectangle", "ellipse", "descriptions"].includes(sp.kind) ? '<button type="button" class="btn btn-sm" data-act="special-props">Modifier…</button>' : ""}
      <button type="button" class="btn btn-sm" data-act="delete">Supprimer</button></div>`;
  }
  return "";
}
/** A control's new code, checked (the pane's field, the ribbon's): false when refused. */
export function changeCode(E, id, v) {
  const problem = M.codeProblem(E.ev, v), other = M.findCode(E.ev, v);
  if (problem === "length" || problem === "space") { E.toast("Un code a de 1 à 3 caractères, sans espace."); return false; }
  if (other && other !== id) { E.toast(`Le code ${v} est déjà pris.`); return false; }
  if (v === E.ev.controls[id].code) return true;
  if (problem === "upside") E.toast(`Le code ${v} se lit aussi à l'envers : à éviter.`);
  return E.change((ev) => { ev.controls[id].code = v; }, "Code changé");
}
export function bindInfo(E, el) {
  const code = el.querySelector("#tr-code");
  code?.addEventListener("change", () => { if (!changeCode(E, E.sel.control, code.value.trim())) code.value = E.ev.controls[E.sel.control].code; });
  const flag = el.querySelector("#tr-flag");
  flag?.addEventListener("change", () => { const s = E.sel; E.change((ev) => M.setFlagging(ev, s.c1, s.c2, flag.value), "Balisage"); });
}

/** A one-line summary of the event, for a version's card. */
export function summaryOf(ev) {
  const courses = M.courseIds(ev).map((id) => {
    const v = M.view(ev, M.cdCourse(id), { specials: false, descriptions: false });
    return `${ev.courses[id].name} ${(v.totalMin / 1000).toFixed(1).replace(".", ",")} km, ${v.minNormal} p.`;
  });
  return `${Object.values(ev.controls).filter((c) => c.kind === "normal").length} postes ; ${courses.join(", ")}`;
}

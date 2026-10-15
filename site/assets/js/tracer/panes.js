// The editor's description pane: the current course's sheet drawn on a canvas, clickable as Purple Pen's — a click on a
// line selects its control (and the map follows), a second click on a box opens that column's symbols (C to H; column F
// also takes the feature's size), the code, the title, the header (length, climb) and text lines are edited in place.

import * as M from "./model.js";
import { describe, sheetItems, sheetSize, hitTest, widthInCells } from "./descr.js";
import { drawItems } from "./draw.js";
import { symbolsFor, symbolName, symbolPaths, symbol } from "./symbols.js";
import * as D from "./dialogs.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const COLUMN = { 2: "C", 3: "D", 4: "E", 5: "F", 6: "G", 7: "H" };

export function descPane(E) {
  const box = E.$("#tr-desc");
  const cd = E.cdDraw || E.cd;
  const descKind = cd.course ? E.ev.courses[cd.course].descKind : E.ev.allControls.descKind;
  const lines = describe(E.ev, cd, { purpose: "ui", variationName: E.variation?.code || "" });
  const W = box.clientWidth || 300;
  const cells = widthInCells(descKind);
  const cell = Math.max(16, Math.min(34, Math.floor((W - 8) / cells)));       // px per cell
  const size = sheetSize(lines, descKind, cell);
  let canvas = box.querySelector("canvas");
  if (!canvas) {
    box.innerHTML = '<canvas aria-label="Définitions des postes"></canvas><p class="tr-desc-hint">Cliquer une ligne pour choisir le poste, puis une case pour la remplir.</p>';
    canvas = box.querySelector("canvas");
    canvas.addEventListener("click", (e) => onClick(E, e));
    canvas.addEventListener("dblclick", (e) => onClick(E, e, true));
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(size.w * dpr) + 2; canvas.height = Math.ceil(size.h * dpr) + 2;
  canvas.style.width = `${size.w + 2 / dpr}px`; canvas.style.height = `${size.h + 2 / dpr}px`;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size.w + 2, size.h + 2);
  // selection highlight (yellow, as in Purple Pen)
  const selCtl = E.sel?.kind === "control" || E.sel?.kind === "number" ? E.sel : null;
  lines.forEach((l, i) => {
    const hit = selCtl && l.control === selCtl.control && (!selCtl.cc || !l.cc || l.cc === selCtl.cc) && (l.kind === "normal" || l.kind === "directive" && !l.isLeg);
    const legHit = E.sel?.kind === "leg" && l.isLeg && l.cc === E.sel.cc1;
    if (hit || legHit) { g.fillStyle = "#fff59d"; g.fillRect(0.5, 0.5 + i * cell, size.w, cell); }
  });
  // the sheet, in pixels (y down): its own coordinates are already y down from the top-left corner
  const items = sheetItems(lines, descKind, cell, { white: false, x0: 0.5, y0: 0.5 });
  const T = (x, y) => [x, y];
  drawItems(g, items.map((it) => ({ ...it, color: "black" })), T, 1, { blend: "none" });
  E.descState = { lines, descKind, cell };
}

function onClick(E, e, dbl = false) {
  const st = E.descState;
  if (!st) return;
  const r = e.target.getBoundingClientRect();
  const hit = hitTest(st.lines, st.descKind, st.cell, e.clientX - r.left - 0.5, e.clientY - r.top - 0.5);
  if (!hit) return;
  const line = st.lines[hit.line];
  const wasSelected = (E.sel?.kind === "control" && line.control === E.sel.control && (!line.cc || line.cc === E.sel.cc)) || (E.sel?.kind === "leg" && line.isLeg && line.cc === E.sel.cc1);
  if (hit.kind === "title") { if (!E.readOnly) D.eventTitle(E); return; }
  if (hit.kind === "secondary" || hit.kind === "header") { if (!E.readOnly && E.cd.course) D.courseProps(E, E.cd.course, hit.box === 2 ? "climb" : null); return; }
  if (hit.kind === "text") { if (!E.readOnly && line.control) D.textLine(E, line); return; }
  if (line.isLeg) {
    const cc1 = line.cc, cc2 = line.cc2;
    E.select({ kind: "leg", c1: E.ev.courseControls[cc1]?.control, c2: E.ev.courseControls[cc2]?.control, cc1, cc2 });
    return;
  }
  if (!line.control) return;
  if (!wasSelected && !dbl) { E.select({ kind: "control", control: line.control, cc: line.cc || 0 }); centerOn(E, line.control); return; }
  if (E.readOnly) return;
  const c = E.ev.controls[line.control];
  if (hit.kind === "box" && hit.box === 1 && c.kind === "normal") { D.codeEdit(E, line.control); return; }
  if (hit.kind === "box" && COLUMN[hit.box] && (c.kind === "normal" || c.kind === "start" || c.kind === "map-exchange")) { symbolPicker(E, line.control, hit.box, e.clientX, e.clientY); return; }
  if (hit.kind === "directive" && (c.kind === "finish" || c.kind === "crossing" || c.kind === "map-issue")) { directivePicker(E, line.control, e.clientX, e.clientY); return; }
  if (hit.kind === "normalText") D.customText(E, line.control);
}
function centerOn(E, controlId) {
  const c = E.ev.controls[controlId];
  if (!c) return;
  const [sx, sy] = E.toScreen(c.x, c.y), W = E.canvas.clientWidth, H = E.canvas.clientHeight;
  if (sx < 40 || sy < 40 || sx > W - 40 || sy > H - 40) { E.view = { ...E.view, ox: E.view.ox + W / 2 - sx, oy: E.view.oy + H / 2 - sy }; E.redraw(); }
}

/** A grid of a column's symbols (Purple Pen's SymbolPopup), with names; column F adds the size field. */
function symbolPicker(E, controlId, box, cx, cy) {
  const std = E.ev.descStandard || "2018", col = COLUMN[box];
  let list = symbolsFor(col, std);
  if (col === "E") list = [...list, ...symbolsFor("D", std)];
  const c = E.ev.controls[controlId];
  const current = c.symbols[box - 2];
  const pop = document.createElement("div");
  pop.className = "tr-pop tr-sympop";
  pop.innerHTML = `<div class="tr-pop-head"><strong>Colonne ${col}</strong> <input type="search" placeholder="Chercher…" class="tr-symsearch"></div>
    ${col === "F" ? `<label class="tr-dim">Dimensions <input class="tr-dimin" value="${esc(c.colF || "")}" placeholder="2.5 ou 3x4 ou 2/1"></label>` : ""}
    <div class="tr-symgrid">${[null, ...list].map((s) => `<button type="button" class="tr-sym ${s?.id === current ? "on" : ""}" data-id="${s ? esc(s.id) : ""}" title="${esc(s ? symbolName(s, "fr") : "Vide")}">
      <canvas width="40" height="40"></canvas><span>${esc(s ? symbolName(s, "fr") : "(vide)")}</span></button>`).join("")}</div>`;
  E.root.appendChild(pop);
  place(pop, cx, cy);
  pop.querySelectorAll(".tr-sym").forEach((b, i) => {
    const s = i === 0 ? null : list[i - 1];
    const g = b.querySelector("canvas").getContext("2d");
    if (s) drawItems(g, symbolPaths(s, 2, 2, 36, 36).map((p) => ({ t: "path", ...p, color: "black" })), (x, y) => [x, y], 1, { blend: "none" });
    else { g.strokeStyle = "#999"; g.strokeRect(4, 4, 32, 32); }
    b.addEventListener("click", () => {
      E.change((ev) => {
        ev.controls[controlId].symbols[box - 2] = s ? s.id : null;
        if (col === "F" && s) ev.controls[controlId].colF = null;
      }, `Définition : colonne ${col}`);
      pop.remove();
    });
  });
  const search = pop.querySelector(".tr-symsearch");
  search.focus();
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    pop.querySelectorAll(".tr-sym").forEach((b) => { b.hidden = q && !b.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q); });
  });
  const dim = pop.querySelector(".tr-dimin");
  dim?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = dim.value.trim();
    E.change((ev) => { ev.controls[controlId].colF = v || null; if (v) ev.controls[controlId].symbols[3] = null; }, "Dimensions");
    pop.remove();
  });
  closeOnOutside(pop);
}
/** The finish's or crossing point's directive (14.1 / 14.2 / 14.3, 13.3 / 13.4…). */
function directivePicker(E, controlId, cx, cy) {
  const c = E.ev.controls[controlId], std = E.ev.descStandard || "2018";
  const ids = c.kind === "finish" ? ["14.1", "14.2", "14.3"] : c.kind === "crossing" ? ["13.3", "13.4"] : ["13.6"];
  const list = ids.map((id) => symbol(id, std)).filter(Boolean);
  const pop = document.createElement("div");
  pop.className = "tr-pop tr-sympop";
  pop.innerHTML = `<div class="tr-symgrid wide">${list.map((s) => `<button type="button" class="tr-sym wide ${c.symbols[0] === s.id ? "on" : ""}" title="${esc(symbolName(s, "fr"))}">
    <canvas width="240" height="30"></canvas><span>${esc(symbolName(s, "fr"))}</span></button>`).join("")}</div>`;
  E.root.appendChild(pop);
  place(pop, cx, cy);
  pop.querySelectorAll(".tr-sym").forEach((b, i) => {
    const s = list[i], g = b.querySelector("canvas").getContext("2d");
    drawItems(g, symbolPaths(s, 0, 0, 240, 30).map((p) => ({ t: "path", ...p, color: "black" })), (x, y) => [x, y], 1, { blend: "none" });
    b.addEventListener("click", () => { E.change((ev) => { ev.controls[controlId].symbols[0] = s.id; }, "Directive"); pop.remove(); });
  });
  closeOnOutside(pop);
}
export function place(pop, cx, cy) {
  const W = window.innerWidth, H = window.innerHeight;
  pop.style.left = `${Math.min(cx, W - pop.offsetWidth - 8)}px`;
  pop.style.top = `${Math.min(cy, H - pop.offsetHeight - 8)}px`;
}
export function closeOnOutside(pop) {
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", key, true); } };
    const key = (e) => { if (e.key === "Escape") { pop.remove(); document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", key, true); } };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key, true);
  }, 0);
}
void M;

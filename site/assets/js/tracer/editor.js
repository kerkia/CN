// The Tracer's editor (Organisation › Tracer): one window over the site — the course tabs and tools along the top, the
// description sheet and the selected object's details on the left, the map with the course in the middle, a help line
// at the bottom — that works as Purple Pen does (click to select, drag a selected object to move it, drag elsewhere to
// pan, the wheel to zoom; a new control goes after the selected control, into the selected leg, or into the closest leg).
// Every change goes through change(): a snapshot for undo (100 steps), a new layout, a redraw, and a save a moment later
// (the event's version guards against two people saving over each other; a lock tells the team who is editing).

import * as M from "./model.js";
import { layoutCourse, distFrom } from "./layout.js";
import { itemsFor, drawItems, tracePath, SCREEN, cmykToRgb } from "./draw.js";
import * as S from "./store.js";
import { loadSymbols } from "./symbols.js";
import { loadFonts } from "./fonts.js";
import * as OFF from "./offline.js";
import * as FW from "../fullwin.js";
import { descPane } from "./panes.js";
import * as A from "./actions.js";
import * as D from "./dialogs.js";

const ICON = {
  select: '<path d="M5 3l14 8-6 2-3 6z"/>',
  control: '<circle cx="12" cy="12" r="7"/>',
  start: '<path d="M12 4l8 14H4z"/>',
  finish: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/>',
  crossing: '<path d="M8 4c3 4 3 12 0 16M16 4c-3 4-3 12 0 16"/>',
  issue: '<path d="M7 12h10M12 12v6"/>',
  exchange: '<circle cx="12" cy="12" r="8"/><path d="M12 6l5 9H7z"/>',
  bend: '<path d="M4 18l8-12 8 12"/><circle cx="12" cy="6" r="2"/>',
  gap: '<path d="M3 12h6M15 12h6"/>',
  route: '<path d="M4 19c3-1 3-6 7-7s4-6 9-8" stroke-dasharray="3 2.5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="4" r="1.6"/>',
  descr: '<rect x="4" y="4" width="16" height="16"/><path d="M4 9h16M4 14h16M9 9v11"/>',
  special: '<path d="M4 20l8-16 8 16z"/><path d="M8 14h8"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  newtab: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
};
const svg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TOOLS = [["select", "Sélection", "Cliquer pour choisir un objet ; glisser un objet choisi pour le déplacer ; glisser ailleurs pour se déplacer"],
  ["start", "Départ", "Cliquer pour placer le départ (ou cliquer un départ existant)"],
  ["control", "Poste", "Cliquer pour placer un poste (ou cliquer un poste existant, en pâle) — il vient après le poste choisi, dans l'interposte choisi, ou dans l'interposte le plus proche"],
  ["finish", "Arrivée", "Cliquer pour placer l'arrivée"],
  ["crossing", "Passage obligatoire", "Cliquer pour placer un point de passage obligatoire"],
  ["issue", "Remise de carte", "Cliquer pour placer le point de remise de carte (début du balisage vers le départ)"],
  ["exchange", "Échange de carte", "Cliquer un poste du circuit pour y échanger la carte, ou ailleurs pour un échange au bout d'un trajet balisé"],
  ["bend", "Coude", "Cliquer un interposte pour y ajouter un coude ; cliquer un coude pour le retirer"],
  ["gap", "Coupure", "Glisser le long d'un interposte ou d'un cercle pour le couper ; cliquer une coupure pour la refermer"],
  ["route", "Itinéraire", "Cliquer un interposte, puis les points du chemin que prendront les coureurs (pour la dénivelée) ; double-cliquer pour finir"],
  ["descr", "Définitions sur la carte", "Glisser pour placer les définitions du circuit sur la carte (la largeur donne leur taille)"]];

/** Open the editor over the page. ctx: { meta, role, you, ev, version, mapSrc, key, readOnly, lockHolder, onClose, newTab }. */
export async function openEditor(ctx) {
  // the symbols, and the fonts the labels are measured with (Helvetica's widths stand in when they are slow to come)
  const fontsIn = await Promise.all([loadSymbols(), loadFonts(5000)]).then(([, ok]) => ok);
  const E = {
    meta: ctx.meta, role: ctx.role, you: ctx.you, ev: ctx.ev, version: ctx.version || 0, key: ctx.key || null, map: ctx.mapSrc,
    readOnly: !!ctx.readOnly, lockHolder: ctx.lockHolder || null, offline: !!ctx.offline,
    cd: M.cdAll(), variation: null, sel: null, tool: "select", undo: [], redo: [], dirty: false, saving: false, lastSaved: null,
    opts: { intensity: loadPref("intensity", 1), allControls: loadPref("allControls", false), others: [], printArea: false },
    layout: null, items: [], view: { k: 1, ox: 0, oy: 0 }, pending: null,
    overlays: [], closeHooks: [], pickOnce: null,
  };
  window.__tracer = E;                                   // for support and scripted checks
  const root = document.createElement("div");
  root.className = "tr-app";
  root.setAttribute("role", "application");
  root.innerHTML = shell(E);
  // in the page under the site's menus, as the analyses (owner, 2026-10-15): ⤢ fills the window, ↗ moves it to a tab
  (ctx.container || document.body).appendChild(root);
  document.body.classList.add("tr-open");
  FW.bindFull();
  if (FW.inOwnTab()) FW.setFull(true);
  E.root = root;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  E.$ = $; E.$$ = $$;
  const canvas = $("#tr-map"), g = canvas.getContext("2d");
  E.canvas = canvas;

  // ---- helpers exposed to the other modules -----------------------------------------------------------------------
  E.status = (msg, kind = "") => { const s = $("#tr-status"); s.textContent = msg; s.dataset.kind = kind; };
  E.help = (msg) => { $("#tr-help").textContent = msg || toolHelp(E.tool); };
  E.toast = (msg, ms = 3500) => {
    const t = document.createElement("div"); t.className = "tr-toast"; t.textContent = msg; root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };
  E.course = () => (E.cd.course ? E.ev.courses[E.cd.course] : null);
  /** Apply a change: snapshot for undo, then fn(ev); a refused change (fn returns false) is not kept. */
  E.change = (fn, label = "") => {
    if (E.readOnly) { E.toast("Lecture seule : un autre membre de l'équipe modifie l'événement."); return false; }
    const snap = JSON.stringify(E.ev);
    let ok;
    try { ok = fn(E.ev); } catch (err) { console.error(err); E.ev = JSON.parse(snap); E.toast(`Modification impossible : ${err.message}`); return false; }
    if (ok === false) { E.ev = JSON.parse(snap); return false; }
    E.undo.push({ snap, label }); if (E.undo.length > 100) E.undo.shift();
    E.redo = [];
    afterChange();
    return true;
  };
  E.undoStep = () => {
    const u = E.undo.pop(); if (!u) return;
    E.redo.push({ snap: JSON.stringify(E.ev), label: u.label });
    E.ev = JSON.parse(u.snap); fixSelection(); afterChange();
    E.help(`Annulé${u.label ? ` : ${u.label}` : ""}`);
  };
  E.redoStep = () => {
    const r = E.redo.pop(); if (!r) return;
    E.undo.push({ snap: JSON.stringify(E.ev), label: r.label });
    E.ev = JSON.parse(r.snap); fixSelection(); afterChange();
    E.help(`Rétabli${r.label ? ` : ${r.label}` : ""}`);
  };
  E.select = (sel) => { E.sel = sel; refresh(); };
  E.setTool = (t) => {
    E.tool = t; E.pending = null;
    $$("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t || (t.startsWith("special:") && b.dataset.tool === "special"))));
    canvas.dataset.tool = t.split(":")[0];
    E.help(); draw();
  };
  E.setCourse = (courseId, part = -1, path = null) => {
    E.cd = courseId ? M.cdCourse(courseId, part, path) : M.cdAll();
    E.variation = null;
    if (E.sel?.kind === "leg" || E.sel?.kind === "control" && E.sel.cc) E.sel = null;
    renderTabs(); refresh();
  };
  E.refresh = () => refresh();
  E.redraw = () => draw();
  E.fitCourse = () => fitCourse();
  E.save = () => save(true);
  E.close = () => close();
  E.toMap = (sx, sy) => [(sx - E.view.ox) / E.view.k, (E.view.oy - sy) / E.view.k];
  E.toScreen = (x, y) => [E.view.ox + x * E.view.k, E.view.oy - y * E.view.k];

  function afterChange() {
    E.dirty = true;
    renderTabs(); refresh();
    scheduleSave();
  }
  function fixSelection() {
    if (E.cd.course && !E.ev.courses[E.cd.course]) { E.cd = M.cdAll(); E.variation = null; }   // a course undone or deleted
    if (E.variation && !(E.cd.course && M.hasVariations(E.ev, E.cd.course))) E.variation = null;
    const s = E.sel; if (!s) return;
    if ((s.kind === "control" || s.kind === "number") && !E.ev.controls[s.control]) E.sel = null;
    if (s.kind === "special" && !E.ev.specials[s.id]) E.sel = null;
    if (s.kind === "leg" && (!E.ev.controls[s.c1] || !E.ev.controls[s.c2])) E.sel = null;
  }
  /** Layout, items, panes, then the drawing. */
  function refresh() {
    fixSelection();
    const cdDraw = E.cd.course && M.hasVariations(E.ev, E.cd.course) && E.variation ? { ...E.cd, path: E.variation.path } : E.cd;
    E.cdDraw = cdDraw;
    E.layout = layoutCourse(E.ev, cdDraw, { variationName: E.variation?.code || "" });
    E.items = itemsFor(E.ev, E.layout, { selected: selKey(E.sel) });
    E.others = othersLayer();
    descPane(E);
    infoPane();
    renderVariations();
    $("#tr-undo").disabled = !E.undo.length || E.readOnly;
    $("#tr-redo").disabled = !E.redo.length || E.readOnly;
    draw();
  }
  const selKey = (s) => !s ? null : s.kind === "leg" ? { leg: [s.c1, s.c2] } : s.kind === "special" ? { special: s.id } : s.kind === "control" ? { control: s.control } : null;
  /** The other controls (light purple) while adding, or when « tous les postes » is on; other courses' outlines. */
  function othersLayer() {
    const out = [];
    // other courses chosen under Affichage › Autres circuits, faint
    const oc = [];
    for (const id of E.opts.others || []) if (id !== E.cd.course && E.ev.courses[id]) oc.push(...layoutCourse(E.ev, M.cdCourse(id), { specials: false, descriptions: false }).objs.filter((o) => o.t !== "descriptions"));
    E.otherCourseItems = oc.length ? itemsFor(E.ev, { objs: oc }) : [];
    const show = E.opts.allControls || ["control", "start", "finish", "crossing", "issue"].includes(E.tool);
    if (show && E.cd.course) {
      const used = new Set(M.ccIds(E.ev, E.cd).map((id) => E.ev.courseControls[id].control));
      const all = layoutCourse(E.ev, M.cdAll(), { numbers: true, specials: false, descriptions: false });
      for (const o of all.objs) if ((o.control && !used.has(o.control)) || (o.t === "code" && !used.has(o.control))) out.push(o);
      E.othersObjs = out;
      return itemsFor(E.ev, { objs: out });
    }
    E.othersObjs = [];
    return [];
  }

  // ---- the map view ------------------------------------------------------------------------------------------------
  const dpr = () => window.devicePixelRatio || 1;
  let sharp = null, sharpTimer = null, sharpCtl = null;            // a PDF rendered sharp for the current view
  function fitHeight() {
    const top = root.getBoundingClientRect().top + window.scrollY;
    root.style.height = `${Math.max(420, Math.floor(window.innerHeight - top - 8))}px`;
  }
  E.fitHeight = fitHeight;
  function size() {
    fitHeight();
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr())); canvas.height = Math.max(1, Math.round(r.height * dpr()));
    if ((E.needFit || !(E.view.k > 0)) && r.width > 70 && r.height > 70) { fitCourse(); return; }
    draw();
  }
  const mapPxPerMm = () => (E.map ? E.map.pxW / E.ev.map.w : 1);
  function draw() {
    const W = canvas.width / dpr(), H = canvas.height / dpr();
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    g.fillStyle = "#f4f3ee"; g.fillRect(0, 0, W, H);
    const v = E.view;
    if (E.map) {
      g.save();
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      const s = v.k / mapPxPerMm();
      g.globalAlpha = 1;
      // zoomed out, a reduced copy of a large image (mapsrc.withLevels): the coarsest still as fine as the screen
      let img = E.map.image;
      for (const l of E.map.levels || []) if (l.k >= s * dpr()) img = l.image;
      g.drawImage(img, v.ox, v.oy - E.ev.map.h * v.k, E.map.pxW * s, E.map.pxH * s);
      if (sharp && sharp.k === v.k) {
        const [x, y] = E.toScreen(sharp.box[0], sharp.box[3]);
        g.drawImage(sharp.canvas, x, y, sharp.canvas.width / dpr(), sharp.canvas.height / dpr());
      }
      if (E.opts.intensity < 1) { g.fillStyle = `rgba(255,255,255,${1 - E.opts.intensity})`; g.fillRect(v.ox, v.oy - E.ev.map.h * v.k, E.ev.map.w * v.k, E.ev.map.h * v.k); }
      g.restore();
    } else {
      g.strokeStyle = "#c9c6bb"; g.strokeRect(v.ox, v.oy - (E.ev.map.h || 297) * v.k, (E.ev.map.w || 210) * v.k, (E.ev.map.h || 297) * v.k);
    }
    const T = (x, y) => [v.ox + x * v.k, v.oy - y * v.k];
    const purple = E.ev.appearance.purple ? cmykToRgb(E.ev.appearance.purple) : SCREEN.upper;
    if (E.otherCourseItems?.length) drawItems(g, E.otherCourseItems, T, v.k, { blend: E.ev.appearance.blend, purple: "#7b8fb3", alpha: 0.55 });
    if (E.others?.length) drawItems(g, E.others, T, v.k, { blend: E.ev.appearance.blend, purple: "#d9a6d4", alpha: 0.9 });
    drawItems(g, E.items, T, v.k, { blend: E.ev.appearance.blend, purple });
    if (E.opts.printArea) drawPrintArea(T);
    drawRoutes(T);
    for (const f of E.overlays) { try { f(g, T, v.k); } catch (err) { console.error(err); } }
    drawHandles(T);
    if (E.ghost) drawGhost(T);
    if (E.dragRect) { g.strokeStyle = "#0a84ff"; g.setLineDash([5, 4]); const [x1, y1] = T(...E.dragRect[0]), [x2, y2] = T(...E.dragRect[1]); g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); g.setLineDash([]); }
    scheduleSharp();
  }
  /** The routes drawn for the climb (Itinéraire), on the screen only: dashed, in the map's brown. */
  function drawRoutes(T) {
    const legs = (E.layout?.objs || []).filter((o) => o.t === "leg");
    g.save(); g.strokeStyle = "#8b5a2b"; g.lineWidth = 1.6; g.setLineDash([6, 4]);
    for (const o of legs) {
      const r = E.ev.legs[M.findLeg(E.ev, o.control, o.control2)]?.route;
      if (!r?.length) continue;
      g.beginPath();
      M.legRoutePoints(E.ev, o.control, o.control2).forEach((p, i) => { const [x, y] = T(...p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    g.restore();
  }
  function drawPrintArea(T) {
    const pa = M.printAreaOf(E.ev, E.cdDraw || E.cd);
    if (!pa?.rect) return;
    const [l, b, r, t] = pa.rect, [x1, y1] = T(l, t), [x2, y2] = T(r, b);
    g.save(); g.strokeStyle = "#555"; g.setLineDash([8, 5]); g.lineWidth = 1.5; g.strokeRect(x1, y1, x2 - x1, y2 - y1); g.restore();
  }
  /** Handles of the selected object: bends, gap ends, special corners, the description sheet's corner. */
  function drawHandles(T) {
    const hs = A.handles(E);
    g.save();
    for (const h of hs) {
      const [x, y] = T(...h.pt);
      g.fillStyle = "#fff"; g.strokeStyle = "#0a84ff"; g.lineWidth = 1.5;
      g.beginPath(); h.round ? g.arc(x, y, 4.5, 0, Math.PI * 2) : g.rect(x - 4, y - 4, 8, 8); g.fill(); g.stroke();
    }
    g.restore();
  }
  function drawGhost(T) {
    const gh = E.ghost;
    g.save(); g.globalAlpha = 0.65;
    if (gh.items) drawItems(g, gh.items, T, E.view.k, { blend: "none", purple: "#0a84ff" });
    if (gh.pts?.length) {
      g.strokeStyle = "#0a84ff"; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath();
      gh.pts.forEach((p, i) => { const [x, y] = T(...p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (gh.cursor) g.lineTo(...T(...gh.cursor));
      if (gh.closed) g.closePath();
      g.stroke();
    }
    g.restore();
  }
  // a PDF map drawn sharp at high zoom: the visible part rendered at the screen's resolution after the view settles
  function scheduleSharp() {
    if (E.map?.kind !== "pdf") return;
    clearTimeout(sharpTimer);
    const need = E.view.k * dpr() > mapPxPerMm() * 1.15;
    if (!need) { sharp = null; return; }
    if (sharp && sharp.k === E.view.k && sharp.ox === E.view.ox && sharp.oy === E.view.oy) return;
    sharpTimer = setTimeout(async () => {
      sharpCtl?.abort(); sharpCtl = new AbortController();
      const W = canvas.width / dpr(), H = canvas.height / dpr();
      const [l, t] = E.toMap(0, 0), [r, b] = E.toMap(W, H);
      const box = [Math.max(0, l), Math.max(0, b), Math.min(E.ev.map.w, r), Math.min(E.ev.map.h, t)];
      if (box[2] <= box[0] || box[3] <= box[1]) return;
      const k = E.view.k, v0 = { ...E.view };
      try {
        const c = await E.map.renderRegion(box, k * dpr(), sharpCtl.signal);
        if (E.view.k === v0.k && E.view.ox === v0.ox && E.view.oy === v0.oy) { sharp = { canvas: c, box, k, ox: v0.ox, oy: v0.oy }; draw(); }
      } catch (err) { /* cancelled */ }
    }, 260);
  }
  function fitBox([l, b, r, t], pad = 30) {
    const W = canvas.width / dpr(), H = canvas.height / dpr();
    if (W < 2 * pad + 10 || H < 2 * pad + 10) { E.needFit = true; return; }      // no room yet (a hidden tab): fitted on the next size()
    E.needFit = false;
    const k = Math.min((W - 2 * pad) / Math.max(5, r - l), (H - 2 * pad) / Math.max(5, t - b));
    E.view = { k, ox: W / 2 - ((l + r) / 2) * k, oy: H / 2 + ((b + t) / 2) * k };
  }
  function fitCourse() {
    const v = E.layout?.view;
    if (v && v.controls.length) fitBox(M.viewBounds(E.ev, v));
    else fitBox([0, 0, E.ev.map.w || 210, E.ev.map.h || 297], 10);
    draw();
  }
  E.fitMap = () => { fitBox([0, 0, E.ev.map.w || 210, E.ev.map.h || 297], 10); draw(); };
  function zoomAt(f, sx, sy) {
    const W = canvas.width / dpr(), H = canvas.height / dpr();
    if (sx == null) { sx = W / 2; sy = H / 2; }
    const [x, y] = E.toMap(sx, sy);
    const k = Math.max(0.05, Math.min(400, E.view.k * f));
    E.view = { k, ox: sx - x * k, oy: sy + y * k };
    $("#tr-zoom").textContent = `${Math.round((k / (96 / 25.4)) * 100)} %`;
    draw();
  }
  E.zoomAt = zoomAt;

  // ---- hit testing ---------------------------------------------------------------------------------------------------
  /** The object under a screen point: { kind, … } for selection; within 6 px. */
  function hitAt(sx, sy, { includeOthers = false } = {}) {
    const p = E.toMap(sx, sy), tol = 7 / E.view.k;
    let best = null, bestD = Infinity, bestPri = -1;
    const consider = (o, pri) => {
      let d;
      if (o.t === "control" || o.t === "finish") d = Math.max(0, M.dist(p, o.ctr) - (o.radius || 0));
      else d = distFrom(o, p);
      if (o.t === "descriptions") d = o.box && p[0] >= o.box[0] && p[0] <= o.box[2] && p[1] >= o.box[1] && p[1] <= o.box[3] ? 0 : Infinity;
      if (d <= tol && (pri > bestPri || (pri === bestPri && d < bestD))) { best = o; bestD = d; bestPri = pri; }
    };
    for (const o of E.layout.objs) {
      const pri = o.t === "number" || o.t === "code" ? 5 : ["control", "finish", "start", "crossing", "issue"].includes(o.t) && o.control ? 4
        : o.t === "leg" ? 3 : o.t === "descriptions" ? 1 : o.special ? 2 : 0;
      consider(o, pri);
    }
    if (includeOthers) for (const o of E.othersObjs || []) if (o.control) consider({ ...o, other: true }, o.t === "code" ? 0 : 6);
    if (!best) return null;
    if (best.other) return { kind: "control", control: best.control, cc: 0, other: true };
    if (best.t === "number" || best.t === "code") return { kind: "number", control: best.control, cc: best.cc };
    if (best.t === "leg") return { kind: "leg", c1: best.control, c2: best.control2, cc1: best.cc, cc2: best.cc2 };
    if (best.special) return { kind: "special", id: best.special };
    if (best.control) return { kind: "control", control: best.control, cc: best.cc };
    return null;
  }
  E.hitAt = hitAt;

  // ---- pointer -----------------------------------------------------------------------------------------------------
  let drag = null;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    const sx = e.offsetX, sy = e.offsetY, p = E.toMap(sx, sy);
    if (e.button === 2) { drag = { kind: "pan", sx, sy, ox: E.view.ox, oy: E.view.oy, moved: false, right: true }; return; }
    if (e.button === 1) { drag = { kind: "pan", sx, sy, ox: E.view.ox, oy: E.view.oy, moved: false }; return; }
    // a tool that draws by dragging
    if (!E.readOnly && E.tool !== "select") {
      const d = A.toolDown(E, p, sx, sy, e);
      if (d) { drag = { ...d, sx, sy, moved: false }; return; }
    }
    // a handle of the selected object, or the selected object itself, is dragged; elsewhere the map pans
    if (E.tool === "select" && !E.readOnly) {
      const h = A.handleAt(E, sx, sy);
      if (h) { drag = { kind: "handle", handle: h, sx, sy, moved: false, start: p }; return; }
      const hit = hitAt(sx, sy);
      if (hit && E.sel && sameSel(hit, E.sel) && A.movable(E, hit)) { drag = { kind: "move", hit, sx, sy, start: p, moved: false }; return; }
    }
    drag = { kind: "pan", sx, sy, ox: E.view.ox, oy: E.view.oy, moved: false, click: true };
  });
  canvas.addEventListener("pointermove", (e) => {
    const sx = e.offsetX, sy = e.offsetY, p = E.toMap(sx, sy);
    $("#tr-pos").textContent = `${p[0].toFixed(1)}, ${p[1].toFixed(1)} mm`;
    if (!drag) { A.hover(E, p, sx, sy); return; }
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === "pan") { E.view = { ...E.view, ox: drag.ox + sx - drag.sx, oy: drag.oy + sy - drag.sy }; draw(); }
    else A.dragMove(E, drag, p, sx, sy, e);
  });
  const up = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    const sx = e.offsetX, sy = e.offsetY, p = E.toMap(sx, sy);
    if (d.kind === "pan") {
      if (!d.moved && d.right) { A.contextMenu(E, sx, sy, e.clientX, e.clientY); return; }
      if (!d.moved && d.click && E.pickOnce) { const f = E.pickOnce; E.pickOnce = null; E.help(); f(p); return; }
      if (!d.moved && d.click) A.click(E, p, sx, sy, e);
      return;
    }
    A.dragEnd(E, d, p, sx, sy, e);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", () => { drag = null; E.ghost = null; draw(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { if (A.doubleClick(E, E.toMap(e.offsetX, e.offsetY), e.offsetX, e.offsetY)) return; zoomAt(1.6, e.offsetX, e.offsetY); });
  const sameSel = (a, b) => a.kind === b.kind && (a.kind === "special" ? a.id === b.id : a.kind === "leg" ? a.c1 === b.c1 && a.c2 === b.c2 : a.control === b.control);

  // ---- keyboard ----------------------------------------------------------------------------------------------------
  function onKey(e) {
    if (!document.body.contains(root)) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.target.closest?.("[data-own-keys]") && !e.ctrlKey && !e.metaKey) return;      // the description sheet's own keys (panes.js)
    if (root.querySelector(".tr-modal")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); E.undoStep(); }
    else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); E.redoStep(); }
    else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(true); }
    else if (e.key === "Enter" && E.pending) { e.preventDefault(); A.finishPending(E); }
    else if (e.key === "Delete" || e.key === "Backspace") { if (E.sel) { e.preventDefault(); A.deleteSelection(E); } }
    else if (e.key === "Escape") {
      if (E.pickOnce) { E.pickOnce = null; const c = E.pickCancel; E.pickCancel = null; c?.(); E.help(); }
      else if (E.pending) { E.pending = null; E.ghost = null; E.help(); draw(); }
      else if (E.tool !== "select") E.setTool("select");
      else if (E.sel) E.select(null);
      else if (FW.isFull() && !FW.inOwnTab()) FW.setFull(false);
    }
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = 60, dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0, dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      E.view = { ...E.view, ox: E.view.ox + dx, oy: E.view.oy + dy }; draw();
    } else if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-") zoomAt(0.8);
    else if (!mod && !e.altKey) {
      const k = { s: "select", p: "control", d: "start", a: "finish", o: "crossing", c: "bend", x: "gap" }[e.key.toLowerCase()];
      if (k && !E.readOnly) E.setTool(k);
    }
  }
  document.addEventListener("keydown", onKey);

  // ---- tabs, toolbar, menus ----------------------------------------------------------------------------------------
  function renderTabs() {
    const ids = M.courseIds(E.ev);
    $("#tr-tabs").innerHTML = [`<button type="button" role="tab" data-course="0" aria-selected="${!E.cd.course}">Tous les postes</button>`,
      ...ids.map((id) => `<button type="button" role="tab" data-course="${id}" aria-selected="${E.cd.course === id}" title="${esc(courseTip(id))}">${esc(E.ev.courses[id].name || "Circuit")}</button>`),
      E.readOnly ? "" : `<button type="button" class="tr-tab-add" data-act="course-new" title="Nouveau circuit">${svg("plus", 15)}</button>`].join("");
    $$("#tr-tabs [data-course]").forEach((b) => b.addEventListener("click", () => E.setCourse(Number(b.dataset.course))));
    const parts = E.cd.course ? M.countParts(E.ev, { ...E.cd, part: -1, path: E.variation?.path || null }) : 1;
    const pbox = $("#tr-parts");
    pbox.hidden = parts < 2;
    if (parts >= 2) pbox.innerHTML = [`<button type="button" data-part="-1" aria-pressed="${E.cd.part < 0}">Toutes les parties</button>`,
      ...Array.from({ length: parts }, (_, i) => `<button type="button" data-part="${i}" aria-pressed="${E.cd.part === i}">Partie ${i + 1}</button>`)].join("");
    $$("#tr-parts [data-part]").forEach((b) => b.addEventListener("click", () => { E.cd = { ...E.cd, part: Number(b.dataset.part) }; renderTabs(); refresh(); }));
    root.querySelector(".tr-title").textContent = E.ev.title || E.meta.title;
  }
  const courseTip = (id) => {
    const v = M.view(E.ev, M.cdCourse(id), { specials: false, descriptions: false });
    return `${(v.totalMin / 1000).toFixed(1).replace(".", ",")} km · ${v.minNormal} postes`;
  };
  function renderVariations() {
    const box = $("#tr-vars");
    const has = E.cd.course && M.hasVariations(E.ev, E.cd.course);
    box.hidden = !has;
    if (!has) return;
    const vars = M.allVariations(E.ev, E.cd.course);
    box.innerHTML = `<label>Variante <select id="tr-var"><option value="">Toutes</option>${vars.map((v) => `<option value="${esc(v.code)}" ${E.variation?.code === v.code ? "selected" : ""}>${esc(v.code)}</option>`).join("")}</select></label>`;
    box.querySelector("#tr-var").addEventListener("change", (ev) => {
      E.variation = vars.find((v) => v.code === ev.target.value) || null;
      E.sel = null; refresh();
    });
  }
  function infoPane() { $("#tr-info").innerHTML = A.describeSelection(E); A.bindInfo(E, $("#tr-info")); }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    e.preventDefault();
    closeMenus();
    D.action(E, b.dataset.act, b);
  });
  $$("[data-tool]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.tool === "special") { D.specialMenu(E, b); return; }
    E.setTool(b.dataset.tool);
  }));
  $$(".tr-menu > button").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = b.parentElement, open = !m.classList.contains("open");
    closeMenus(); m.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open));
  }));
  const closeMenus = () => $$(".tr-menu.open").forEach((m) => { m.classList.remove("open"); m.firstElementChild.setAttribute("aria-expanded", "false"); });
  root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".tr-menu")) closeMenus(); });
  $("#tr-undo").addEventListener("click", () => E.undoStep());
  $("#tr-redo").addEventListener("click", () => E.redoStep());
  $("#tr-close").addEventListener("click", () => close());
  // « ↗ »: the event moves to a tab of its own — the tab opened at once (a later open would be taken for a pop-up), the work
  // saved, the tab sent to the event, and the editor here closed: one event is not edited from two tabs
  FW.setTabHandler(async () => {
    const w = window.open("", "_blank");
    if (!w) { E.toast("Le navigateur a bloqué le nouvel onglet."); return; }
    await save(false);
    w.location.href = `${location.origin}${location.pathname}#/orga-tracer?id=${E.meta.id}&fen=1`;
    close();
  });
  // Échap: the editor's own uses first (a pick, a tool, a selection), then out of full window
  FW.setEscapeOwner(() => document.body.contains(root) && !!(E.pickOnce || E.pending || E.tool !== "select" || E.sel || root.querySelector(".tr-modal")));
  FW.setBeforeClose(() => save(false));                  // « ✕ » of a tab of its own: the work saved first
  $("#tr-fit").addEventListener("click", () => fitCourse());
  $("#tr-zin").addEventListener("click", () => zoomAt(1.4));
  $("#tr-zout").addEventListener("click", () => zoomAt(1 / 1.4));
  $("#tr-intensity").value = String(E.opts.intensity);
  $("#tr-intensity").addEventListener("input", (e) => { E.opts.intensity = Number(e.target.value); savePref("intensity", E.opts.intensity); draw(); });
  // the left pane's width
  const split = $("#tr-split");
  split.addEventListener("pointerdown", (e) => {
    split.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = $(".tr-left").offsetWidth;
    const mv = (ev2) => { const w = Math.max(220, Math.min(620, w0 + ev2.clientX - x0)); root.style.setProperty("--tr-left", `${w}px`); };
    const end = () => { split.removeEventListener("pointermove", mv); split.removeEventListener("pointerup", end); savePref("left", $(".tr-left").offsetWidth); refresh(); size(); };
    split.addEventListener("pointermove", mv); split.addEventListener("pointerup", end);
  });
  const lw = loadPref("left", 0); if (lw) root.style.setProperty("--tr-left", `${lw}px`);

  // ---- saving ------------------------------------------------------------------------------------------------------
  let saveTimer = null, lastVersionAt = Date.now();
  function scheduleSave() { clearTimeout(saveTimer); E.status("Modifié", "dirty"); saveTimer = setTimeout(() => save(false), 1800); }
  async function save(explicit) {
    clearTimeout(saveTimer);
    if (E.readOnly || !E.dirty) { if (explicit) E.status("Enregistré", "ok"); return true; }
    if (E.saving) { saveTimer = setTimeout(() => save(explicit), 600); return false; }
    E.saving = true; E.status("Enregistrement…", "busy");
    const snapshot = JSON.parse(JSON.stringify(E.ev));
    try {
      const r = await S.saveEvent(E.meta.id, snapshot, E.key, E.version);
      E.version = r.version; E.dirty = JSON.stringify(E.ev) !== JSON.stringify(snapshot);
      E.lastSaved = new Date(); E.status(`Enregistré à ${E.lastSaved.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, "ok");
      backup(null);
      if (E.offline) { E.offline = false; banner(); }
      OFF.clearPending(E.meta.id).catch(() => {});
      if (OFF.isKept(E.meta.id)) OFF.keepEvent(E).catch(() => {});       // the copy on this device follows
      if (Date.now() - lastVersionAt > 30 * 60e3) { lastVersionAt = Date.now(); S.saveVersion(E.meta.id, snapshot, E.key, "Version automatique", A.summaryOf(E.ev)).catch(() => {}); }
      return true;
    } catch (err) {
      if (err.status === 409) {
        E.status("Conflit", "bad");
        D.conflict(E, err.data);
      } else if (!err.status && OFF.isKept(E.meta.id)) {
        // no network: the change waits on this device and goes when the network returns
        await OFF.savePending(E, snapshot, E.version).catch(() => {});
        if (!E.offline) { E.offline = true; banner(); }
        E.status("Hors ligne — enregistré sur cet appareil", "dirty");
        saveTimer = setTimeout(() => save(false), 30000);
      } else {
        backup(snapshot);
        E.status("Non enregistré — gardé sur cet appareil, nouvel essai bientôt", "bad");
        saveTimer = setTimeout(() => save(false), 15000);
      }
      return false;
    } finally { E.saving = false; }
  }
  E.saveNow = save;
  function backup(ev) {
    try { if (ev) localStorage.setItem(`ocn.tr.backup.${E.meta.id}`, JSON.stringify({ at: Date.now(), version: E.version, ev: E.key ? null : ev })); else localStorage.removeItem(`ocn.tr.backup.${E.meta.id}`); } catch (e) { /* full */ }
  }
  // the editing lock: taken at opening, refreshed every minute, released at closing
  let lockTimer = null;
  async function takeLock(force = false) {
    if (ctx.role === "viewer") { E.readOnly = true; return; }
    try {
      const r = await S.api(`/${E.meta.id}/lock`, { method: "POST", body: { force } });
      if (!r.ok) { E.readOnly = true; E.lockHolder = r.holder; banner(); return; }
      E.readOnly = false; E.lockHolder = null; banner();
      clearInterval(lockTimer);
      lockTimer = setInterval(() => S.api(`/${E.meta.id}/lock`, { method: "POST", body: {} }).then((x) => {
        if (!x.ok) { E.readOnly = true; E.lockHolder = x.holder; banner(); refresh(); }
      }).catch(() => {}), 60e3);
    } catch (err) { /* offline: edit anyway, the version check guards the save */ }
  }
  E.takeLock = async () => { await takeLock(true); refresh(); };
  function banner() {
    const b = $("#tr-banner");
    if (E.offline) {
      b.hidden = false;
      b.innerHTML = "<span>Hors ligne : vos modifications sont gardées sur cet appareil et partiront au serveur dès que le réseau reviendra.</span>";
    } else if (E.readOnly && E.lockHolder) {
      b.hidden = false;
      b.innerHTML = `<span>${esc(E.lockHolder.name || "Un membre de l'équipe")} modifie l'événement en ce moment : lecture seule.</span> <button type="button" class="btn btn-sm" data-act="take-lock">Prendre la main</button>`;
    } else if (E.readOnly) { b.hidden = false; b.innerHTML = "<span>Lecture seule (rôle « lecteur »).</span>"; }
    else b.hidden = true;
    root.classList.toggle("tr-readonly", E.readOnly);
  }
  function close() {
    save(false).finally(() => {
      clearInterval(lockTimer);
      for (const f of E.closeHooks) { try { f(); } catch (err) { /* closing anyway */ } }
      if (!E.readOnly) S.api(`/${E.meta.id}/lock`, { method: "DELETE" }).catch(() => {});
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", size);
      window.removeEventListener("beforeunload", beforeUnload);
      ro.disconnect();
      root.remove(); document.body.classList.remove("tr-open");
      if (!FW.inOwnTab()) FW.leaveFull(); else { FW.setTabHandler(null); FW.setEscapeOwner(null); FW.setBeforeClose(null); }
      if (window.__tracer === E) delete window.__tracer;
      ctx.onClose?.();
    });
  }
  const beforeUnload = (e) => { if (E.dirty) { save(false); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("resize", size);
  const ro = new ResizeObserver(() => size());
  ro.observe(canvas);

  // ---- start -------------------------------------------------------------------------------------------------------
  renderTabs();
  size();
  refresh();
  const first = M.courseIds(E.ev)[0];
  if (first) E.setCourse(first);
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 120); });   // a hidden tab draws no frame
  size();
  fitCourse();
  E.setTool("select");
  banner();
  if (!E.readOnly) await takeLock(false);
  refresh();
  E.status(E.readOnly ? "Lecture seule" : "Prêt", "ok");
  if (!fontsIn) loadFonts(60000).then((ok) => { if (ok && document.body.contains(root)) refresh(); });
  // files dropped on the editor: a .ppen is imported, a map replaces the event's
  root.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files") && !root.querySelector(".tr-modal")) e.preventDefault(); });
  root.addEventListener("drop", async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || root.querySelector(".tr-modal")) return;
    e.preventDefault();
    if (E.readOnly) { E.toast("Lecture seule."); return; }
    const ppen = files.find((f) => /\.(ppen|xml)$/i.test(f.name)), map = files.find((f) => /\.(pdf|png|jpe?g|gif|bmp|webp|tiff?)$/i.test(f.name) || /^image\//.test(f.type));
    if (ppen) D.importPpen(E, ppen);
    else if (map) (await import("./extras.js")).changeMap(E, map);
    else E.toast("Déposez un fichier .ppen ou une carte (PDF ou image).");
  });
  // back online: what waited on this device is sent
  const onOnline = () => { if (E.dirty || E.offline) { E.dirty = true; save(true); } };
  window.addEventListener("online", onOnline);
  E.closeHooks.push(() => window.removeEventListener("online", onOnline));
  if (ctx.dirty && !E.readOnly) { E.dirty = true; scheduleSave(); }              // changes made offline, to send now
  // a .ppen opened on another map than its own: the controls are aligned on this one first (calage.js)
  if (ctx.align && !E.readOnly) (await import("./calage.js")).calage(E, { fromPpen: true });
  return E;
}
const toolHelp = (t) => (TOOLS.find(([k]) => k === t.split(":")[0])?.[2]) || (t.startsWith("special:") ? "Cliquer (ou glisser) sur la carte pour placer l'objet ; double-cliquer pour finir une ligne ou une zone" : "");
const loadPref = (k, d) => { try { const v = JSON.parse(localStorage.getItem("ocn.tr.prefs") || "{}")[k]; return v ?? d; } catch (e) { return d; } };
const savePref = (k, v) => { try { const o = JSON.parse(localStorage.getItem("ocn.tr.prefs") || "{}"); o[k] = v; localStorage.setItem("ocn.tr.prefs", JSON.stringify(o)); } catch (e) { /* this visit */ } };

function shell(E) {
  const tool = ([k, label]) => `<button type="button" class="tr-tool" data-tool="${k}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="false">${svg(k)}</button>`;
  const menu = (label, items) => `<div class="tr-menu"><button type="button" aria-haspopup="menu" aria-expanded="false">${label}</button><div class="tr-menu-list" role="menu">${items.map((it) =>
    it === "-" ? '<hr>' : `<button type="button" role="menuitem" data-act="${it[0]}">${esc(it[1])}</button>`).join("")}</div></div>`;
  return `
  <header class="tr-top">
    <button type="button" class="btn btn-sm tr-back" id="tr-close" title="Enregistrer et revenir à la liste des événements">← Événements</button>
    <span class="tr-title"></span>
    <nav class="tr-menus">
      ${menu("Fichier", [["save", "Enregistrer maintenant"], ["version-save", "Enregistrer une version…"], ["versions", "Versions…"], "-",
        ["import-ppen", "Importer un fichier Purple Pen (.ppen)…"], ["export-ppen", "Exporter en .ppen"], "-",
        ["pdf-courses", "PDF des circuits…"], ["pdf-descriptions", "PDF des définitions…"], ["pdf-punch", "Cartons de contrôle (PDF)…"], "-",
        ["export-iof3", "IOF XML 3.0 (logiciels de chronométrage)"], ["export-iof2", "IOF XML 2.0.3"], ["export-gpx", "GPX des postes"], ["export-kml", "KML des circuits"],
        ["export-images", "Images des circuits (PNG, JPEG)…"], ["export-routegadget", "Fichiers RouteGadget"], ["export-csv", "Tableaux (CSV)"], "-",
        ["publish", "Publier vers l'analyse multi…"], ["send-results", "Envoyer les circuits à « Résultats »…"], ["map-change", "Changer de carte…"], "-", ["offline", "Travailler hors ligne…"]])}
      ${menu("Événement", [["event-props", "Propriétés…"], ["appearance", "Apparence des circuits…"], ["standards", "Normes IOF…"], ["numbering", "Numérotation automatique…"],
        ["codes", "Changer les codes…"], ["renumber", "Renuméroter tous les postes"], ["remove-unused", "Supprimer les postes inutilisés"], ["calage", "Caler les postes sur la carte…"], ["move-all", "Déplacer tous les postes…"],
        ["custom-text", "Textes des définitions…"], ["punch", "Poinçons…"], ["load", "Charge des concurrents…"], ["georef", "Géoréférencer la carte…"], "-", ["team", "Équipe et partage…"], ["encryption", "Chiffrement…"]])}
      ${menu("Circuit", [["course-new", "Nouveau circuit…"], ["course-props", "Propriétés du circuit…"], ["course-dup", "Dupliquer le circuit…"], ["course-delete", "Supprimer le circuit"],
        ["course-order", "Ordre des circuits…"], "-", ["var-fork", "Ajouter une fourche…"], ["var-loop", "Ajouter des boucles…"], ["var-delete", "Supprimer la variante"], ["relay", "Variantes de relais…"], "-",
        ["print-area", "Zone d'impression…"], ["part-options", "Options de la partie…"]])}
      ${menu("Rapports", [["rep-summary", "Résumé des circuits"], ["rep-legs", "Longueurs des interpostes"], ["rep-cross", "Références croisées"], ["rep-load", "Charge des postes et interpostes"],
        ["rep-audit", "Contrôle de l'événement"], "-", ["rep-climb", "Dénivelée (IGN)…"], ["rep-times", "Temps estimés du vainqueur…"], ["rep-pickup", "Plan de ramassage…"], ["rep-after", "Bilan après la course…"], "-", ["comments", "Commentaires de l'équipe…"], ["field", "Mode terrain…"]])}
      ${menu("Affichage", [["view-course", "Tout le circuit"], ["view-map", "Toute la carte"], ["view-all", "Afficher tous les postes"], ["view-printarea", "Afficher la zone d'impression"],
        ["view-others", "Autres circuits…"], "-", ["import-course", "Lire un circuit sur la carte (PDF, photo)…"], ["save-to", "Plusieurs fichiers : dossier ou .zip…"]])}
    </nav>
    <div class="tr-tools" role="toolbar" aria-label="Outils">
      <button type="button" class="tr-icon" id="tr-undo" title="Annuler (Ctrl+Z)" aria-label="Annuler">${svg("undo")}</button>
      <button type="button" class="tr-icon" id="tr-redo" title="Rétablir (Ctrl+Y)" aria-label="Rétablir">${svg("redo")}</button>
      <span class="tr-sep"></span>
      ${TOOLS.map(tool).join("")}
      <button type="button" class="tr-tool" data-tool="special" title="Objets spéciaux" aria-label="Objets spéciaux">${svg("special")}</button>
    </div>
    <span class="tr-status" id="tr-status"></span>
    <span class="fw-btns">${FW.buttons()}</span>
  </header>
  <div class="tr-banner" id="tr-banner" hidden></div>
  <div class="tr-tabbar"><div class="tr-tabs" id="tr-tabs" role="tablist"></div><div class="tr-parts" id="tr-parts" hidden></div><div class="tr-vars" id="tr-vars" hidden></div></div>
  <div class="tr-body">
    <aside class="tr-left">
      <div class="tr-desc" id="tr-desc"></div>
      <div class="tr-info" id="tr-info"></div>
    </aside>
    <div class="tr-split" id="tr-split" role="separator" aria-orientation="vertical" title="Glisser pour élargir"></div>
    <main class="tr-mapwrap">
      <canvas id="tr-map" tabindex="0" aria-label="Carte et circuit"></canvas>
      <div class="tr-zoombox">
        <button type="button" class="tr-icon" id="tr-zin" title="Zoom avant">${svg("plus", 16)}</button>
        <button type="button" class="tr-icon" id="tr-zout" title="Zoom arrière">${svg("minus", 16)}</button>
        <button type="button" class="tr-icon" id="tr-fit" title="Tout le circuit">${svg("fit", 16)}</button>
        <label class="tr-intensity" title="Intensité de la carte"><input type="range" id="tr-intensity" min="0.2" max="1" step="0.05"></label>
      </div>
    </main>
  </div>
  <footer class="tr-foot"><span id="tr-help"></span><span class="tr-foot-r"><span id="tr-pos"></span> · <span id="tr-zoom"></span></span></footer>`;
}

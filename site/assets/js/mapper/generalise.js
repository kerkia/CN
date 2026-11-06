// Cartographier's generalisation, a guided tool (owner, 2026-11-06): what a map needs to stay legible at its scale — after a change
// of scale (a 1:10 000 forest map made the 1:15 000 the IOF asks for long distances), or over raw data (LiDAR, OpenStreetMap,
// BD TOPO: far more detail than ISOM allows). Step by step, in the right pane: each step finds its cases, « Montrer » selects and
// frames them, « Appliquer » does what it says in one undoable step; nothing is changed without the mapper asking. The steps:
// 1. the scale (the geometry scaled about the map's origin, the real-world georeference kept; the symbols scaled with it, or not);
// 2. areas under their symbol's minimum (deleted, or enlarged to the minimum about their centre) and lines under their minimum
//    length (deleted);
// 3. too many points (lines and areas simplified to a tolerance on the map, in mm);
// 4. areas of one symbol overlapping (united);
// 5. point features crowding each other (of one symbol, closer than a distance: the first kept);
// 6. contours closer than legible (listed only: moving a contour is the mapper's call).

import * as G from "./geom.js";
import { minimumOf, numLabel, symName } from "./panels.js";
import { scaleSymbol } from "./layout.js";
import { t, tn, locale } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const CONTOURS = new Set([101000, 102000, 103000]);

/** A symbol's minimum at the map's scale (the set's own `min` scaled as the checks do, else the specifications' table). */
function minOf(E, sym) {
  const s = E.live.symbol(sym);
  if (s?.min) { const f = s.set === "isom2017-2" && E.doc.scale <= 10000 ? 1.5 : 1; return { area: (s.min.area || 0) * f * f, length: (s.min.length || 0) * f, gap: (s.min.gap || 0) * f }; }
  return minimumOf(E, sym);
}
const areaOf = (o) => { const p = G.partsOf(o.coords); if (!p.length) return 0; let a = Math.abs(G.ringArea(G.flatten(p[0].pts, 0.05))); for (const h of p.slice(1)) a -= Math.abs(G.ringArea(G.flatten(h.pts, 0.05))); return a; };
const lengthOf = (o) => { const p = G.partsOf(o.coords); return p.length ? G.polyLength(G.flatten(p[0].pts, 0.05)) : 0; };
const plainPoints = (o) => o.coords.filter((c) => !G.isCtrl(c)).length;

// ---- the steps' findings --------------------------------------------------------------------------------------------------------
export function findSmall(E) {
  const out = [];
  for (const o of E.doc.objects) {
    if (o.sym <= 0 || (o.otp !== 2 && o.otp !== 3) || o.src === "layout") continue;
    const m = minOf(E, o.sym); if (!m) continue;
    if (o.otp === 3 && m.area) { const a = areaOf(o); if (a < m.area) out.push({ o, kind: "area", v: a, min: m.area }); }
    if (o.otp === 2 && m.length && !CONTOURS.has(o.sym)) { const l = lengthOf(o); if (l < m.length) out.push({ o, kind: "line", v: l, min: m.length }); }
  }
  return out;
}
export function findDense(E, tol) {
  const out = [];
  for (const o of E.doc.objects) {
    if (o.sym <= 0 || (o.otp !== 2 && o.otp !== 3)) continue;
    const before = plainPoints(o);
    if (before < 6) continue;
    const after = G.partsOf(o.coords).reduce((s, p) => s + G.simplify(G.flatten(p.pts, tol / 2), tol).length, 0);
    if (after < before * 0.8) out.push({ o, before, after });
  }
  return out;
}
export function findOverlaps(E) {
  const out = [], seen = new Set();
  for (const o of E.doc.objects) {
    if (o.otp !== 3 || o.sym <= 0 || seen.has(o.id)) continue;
    const group = [o];
    for (const n of E.live.near(o.bb || [0, 0, 0, 0])) {
      if (n === o || n.otp !== 3 || n.sym !== o.sym || seen.has(n.id)) continue;
      const a = G.flatten(G.partsOf(o.coords)[0]?.pts || [], 0.1), b = G.flatten(G.partsOf(n.coords)[0]?.pts || [], 0.1);
      if (b.some((p) => G.inRing(a, p[0], p[1])) || a.some((p) => G.inRing(b, p[0], p[1]))) group.push(n);
    }
    if (group.length > 1) { for (const g of group) seen.add(g.id); out.push({ o, group }); }
  }
  return out;
}
export function findCrowded(E, dist) {
  const out = [], gone = new Set();
  for (const o of E.doc.objects) {
    if (o.otp !== 1 || o.sym <= 0 || gone.has(o.id)) continue;
    const x = G.mmX(o.coords[0]), y = G.mmY(o.coords[0]);
    for (const n of E.live.near([x - dist, y - dist, x + dist, y + dist])) {
      if (n === o || n.otp !== 1 || n.sym !== o.sym || gone.has(n.id)) continue;
      if (Math.hypot(G.mmX(n.coords[0]) - x, G.mmY(n.coords[0]) - y) < dist) { gone.add(n.id); out.push({ o: n, keep: o }); }
    }
  }
  return out;
}
export function findContours(E) {
  const gap = minimumOf(E, 101000)?.gap || 0.15, out = [];
  const lines = E.doc.objects.filter((o) => CONTOURS.has(o.sym) && o.otp === 2);
  const flat = new Map(lines.map((o) => [o.id, G.flatten(G.partsOf(o.coords)[0]?.pts || [], 0.1)]));
  for (const o of lines) {
    const poly = flat.get(o.id);
    for (let i = 0; i < poly.length; i += 10) {
      const [x, y] = poly[i];
      const hit = E.live.near([x - gap, y - gap, x + gap, y + gap]).find((n) => n.id !== o.id && CONTOURS.has(n.sym) && G.nearestOn(flat.get(n.id) || [], x, y).d < gap);
      if (hit) { out.push({ o, at: [x, y] }); break; }
    }
  }
  return out;
}

// ---- the actions ---------------------------------------------------------------------------------------------------------------
/** A new scale: every object scaled by old ÷ new about the map's origin (its real-world place unchanged), the print area too;
 *  the symbols scaled with the map (`symbols` true: 1:10 000 → 1:15 000 is the IOF's own enlargement undone) or kept. */
export function changeScale(E, scale, symbols) {
  const f = E.doc.scale / scale;
  if (!(f > 0) || f === 1) return;
  const sc = (c) => ({ x: (Math.round((c.x >> 8) * f) << 8) | (c.x & 0xff), y: (Math.round((c.y >> 8) * f) << 8) | (c.y & 0xff) });
  E.live.transact(t("map.undo.scale"), () => {
    for (const o of E.doc.objects) {
      const coords = o.otp === 1 ? [sc(o.coords[0]), ...o.coords.slice(1)] : o.coords.map(sc);
      E.live.update(o.id, { coords });
    }
    if (symbols) for (const s of E.doc.symbols.slice()) E.live.updateSymbol(s.sym, scaleSymbol(s, f));
    if (E.doc.printArea) E.live.setDocField("printArea", E.doc.printArea.map((v) => v * f));
    E.live.setDocField("scale", scale);
    E.live.setDocField("printScale", scale);
  });
  E.live.compile(); E.view.setLive(E.live); E.view.fit(E.live.bounds());
}
export function applySmall(E, list, how) {
  E.live.transact(t("map.undo.generalise"), () => {
    for (const x of list) {
      const o = E.live.object(x.o.id); if (!o) continue;
      if (how === "delete" || x.kind === "line") { E.live.remove(o.id); continue; }
      // enlarged about its centre to the minimum area
      const k = Math.sqrt(x.min / Math.max(1e-6, x.v)) * 1.02, b = o.bb, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      E.live.update(o.id, { coords: o.coords.map((c) => G.pt(cx + (G.mmX(c) - cx) * k, cy + (G.mmY(c) - cy) * k, G.flags(c))) });
    }
  });
}
export function applyDense(E, list, tol) {
  E.live.transact(t("map.undo.simplify"), () => {
    for (const x of list) {
      const o = E.live.object(x.o.id); if (!o) continue;
      const parts = G.partsOf(o.coords).map((p) => ({ ...p, pts: G.simplify(G.flatten(p.pts, tol / 2), tol) }));
      E.live.update(o.id, { coords: G.coordsOf(parts) });
    }
  });
}
export async function applyOverlaps(E, list) {
  const B = await import("./boolean.js");
  const results = [];
  for (const x of list) results.push([x, await B.union(x.group.map((o) => o.coords))]);
  E.live.transact(t("map.undo.union"), () => {
    for (const [x, res] of results) {
      if (!res.length) continue;
      const keep = x.group[0], rec = E.strip(keep);
      for (const o of x.group) E.live.remove(o.id);
      for (const c of res) E.live.add({ ...rec, coords: c });
    }
  });
}
export function applyCrowded(E, list) { E.live.transact(t("map.undo.generalise"), () => { for (const x of list) E.live.remove(x.o.id); }); }

// ---- the pane --------------------------------------------------------------------------------------------------------------------
export function paneHtml(E) {
  const G0 = E.gen || (E.gen = { tol: 0.1, dist: 0.6, symbols: true });
  const step = (n, key, body) => `<section class="mp-gen"><h4>${n}. ${esc(t(`map.gen.${key}`))}</h4>${body}</section>`;
  const res = (k) => (G0[k] ? `<p class="mp-gen-r">${esc(tn(`map.gen.found`, G0[k].length))}</p><div class="mp-btns"><button type="button" class="btn btn-sm" data-gshow="${k}" ${G0[k].length ? "" : "disabled"}>${esc(t("map.gen.show"))}</button>` : "");
  const scales = [4000, 5000, 7500, 10000, 15000].filter((v) => v !== E.doc.scale);
  return `<p class="mp-hint">${esc(t("map.gen.lede"))}</p>
    ${step(1, "scale", `<p class="mp-hint">${esc(t("map.gen.scaleHint", { s: nf(E.doc.scale) }))}</p><div class="mp-row"><select id="mp-gen-scale">${scales.map((v) => `<option value="${v}" ${v === 15000 && E.doc.scale === 10000 ? "selected" : ""}>1:${nf(v)}</option>`).join("")}</select>
      <label><input type="checkbox" id="mp-gen-syms" ${G0.symbols ? "checked" : ""}> ${esc(t("map.gen.scaleSyms"))}</label></div><div class="mp-btns"><button type="button" class="btn btn-sm" data-gact="scale">${esc(t("map.gen.apply"))}</button></div>`)}
    ${step(2, "small", `<p class="mp-hint">${esc(t("map.gen.smallHint"))}</p><div class="mp-btns"><button type="button" class="btn btn-sm" data-gfind="small">${esc(t("map.gen.find"))}</button></div>${res("small")}${G0.small?.length ? `<button type="button" class="btn btn-sm" data-gact="enlarge">${esc(t("map.gen.enlarge"))}</button><button type="button" class="btn btn-sm" data-gact="delsmall">${esc(t("map.gen.delete"))}</button></div>` : G0.small ? "</div>" : ""}`)}
    ${step(3, "dense", `<div class="mp-row"><label>${esc(t("map.gen.tol"))} <input type="number" id="mp-gen-tol" step="0.05" min="0.02" value="${G0.tol}" class="mp-num"> mm</label></div><div class="mp-btns"><button type="button" class="btn btn-sm" data-gfind="dense">${esc(t("map.gen.find"))}</button></div>${res("dense")}${G0.dense?.length ? `<button type="button" class="btn btn-sm" data-gact="simplify">${esc(t("map.gen.simplify", { n: nf(G0.dense.reduce((s, x) => s + x.before - x.after, 0)) }))}</button></div>` : G0.dense ? "</div>" : ""}`)}
    ${step(4, "overlaps", `<div class="mp-btns"><button type="button" class="btn btn-sm" data-gfind="overlaps">${esc(t("map.gen.find"))}</button></div>${res("overlaps")}${G0.overlaps?.length ? `<button type="button" class="btn btn-sm" data-gact="unite">${esc(t("map.gen.unite"))}</button></div>` : G0.overlaps ? "</div>" : ""}`)}
    ${step(5, "crowded", `<div class="mp-row"><label>${esc(t("map.gen.dist"))} <input type="number" id="mp-gen-dist" step="0.1" min="0.1" value="${G0.dist}" class="mp-num"> mm</label></div><div class="mp-btns"><button type="button" class="btn btn-sm" data-gfind="crowded">${esc(t("map.gen.find"))}</button></div>${res("crowded")}${G0.crowded?.length ? `<button type="button" class="btn btn-sm" data-gact="thin">${esc(t("map.gen.thin"))}</button></div>` : G0.crowded ? "</div>" : ""}`)}
    ${step(6, "contours", `<p class="mp-hint">${esc(t("map.gen.contoursHint"))}</p><div class="mp-btns"><button type="button" class="btn btn-sm" data-gfind="contours">${esc(t("map.gen.find"))}</button></div>${res("contours")}${G0.contours?.length ? `<button type="button" class="btn btn-sm" data-gnext="contours">${esc(t("map.gen.next"))}</button></div>` : G0.contours ? "</div>" : ""}`)}`;
}
export async function paneClick(E, ev) {
  const G0 = E.gen;
  const b = ev.target.closest("[data-gfind],[data-gact],[data-gshow],[data-gnext]");
  if (!b) return false;
  const root = E.$("#mp-right");
  G0.tol = Number(root.querySelector("#mp-gen-tol")?.value) || G0.tol;
  G0.dist = Number(root.querySelector("#mp-gen-dist")?.value) || G0.dist;
  G0.symbols = root.querySelector("#mp-gen-syms")?.checked ?? G0.symbols;
  const f = b.dataset.gfind, a = b.dataset.gact, s = b.dataset.gshow, n = b.dataset.gnext;
  if (f) G0[f] = f === "small" ? findSmall(E) : f === "dense" ? findDense(E, G0.tol) : f === "overlaps" ? findOverlaps(E) : f === "crowded" ? findCrowded(E, G0.dist) : findContours(E);
  if (s || n) {
    const list = G0[s || n] || [];
    if (s) { E.sel = new Set(list.flatMap((x) => (x.group || [x.o]).map((o) => o.id)).filter((id) => E.live.object(id))); E.selChanged(); E.act("zoom-fit"); }
    else { G0.at = ((G0.at ?? -1) + 1) % list.length; const x = list[G0.at]; if (x) { E.sel = new Set([x.o.id]); E.selChanged(); E.view.fit([x.at[0] - 15, x.at[1] - 15, x.at[0] + 15, x.at[1] + 15], 0); } }
    return true;
  }
  if (a === "scale") {
    const v = Number(root.querySelector("#mp-gen-scale").value);
    changeScale(E, v, G0.symbols);
    E.say(t("map.gen.scaled", { s: nf(v) }));
    for (const k of ["small", "dense", "overlaps", "crowded", "contours"]) G0[k] = null;
  }
  if (a === "enlarge" || a === "delsmall") { applySmall(E, G0.small, a === "enlarge" ? "enlarge" : "delete"); G0.small = findSmall(E); }
  if (a === "simplify") { applyDense(E, G0.dense, G0.tol); G0.dense = findDense(E, G0.tol); }
  if (a === "unite") { for (let k = 0; k < 4 && G0.overlaps.length; k++) { await applyOverlaps(E, G0.overlaps); G0.overlaps = findOverlaps(E); } }
  if (a === "thin") { applyCrowded(E, G0.crowded); G0.crowded = findCrowded(E, G0.dist); }
  return true;
}
export async function act(E) {
  const P = await import("./panels.js");
  E.genPane = { html: paneHtml, click: paneClick };
  E._rtab = "gen"; P.drawRight(E);
}
void numLabel; void symName;

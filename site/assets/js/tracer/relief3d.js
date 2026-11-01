// The Tracer's 3D view (2026-11-01, owner: « bring it to the tracer »): the course in hand — the map with its overprint, as
// its print area shows it — draped over the ground's heights, to see the legs' climbs and the controls' features in relief.
// The same view as the analyses' (trace/view3d.js), without any trace. The map must be georeferenced: the heights are read
// at the ground's coordinates of a grid laid on the image (trace/terrain.js: IGN's RGE ALTI in France, else the open terrain
// tiles; only the grid's coordinates leave the browser, never the course). Over the map pane, Échap or ✕ closes it.

import * as M from "./model.js";
import { hasGeo, toLatLon } from "./geo.js";
import { courseImage } from "./exports.js";
import { layoutCourse } from "./layout.js";
import { printBox } from "./pdf.js";
import { where } from "./ribbon-data.js";
import { svg } from "./icons.js";
import { t, locale } from "./lang.js";
import { bar } from "../waitbar.js";
import { gridPlan, loadGrid, CREDIT } from "../trace/terrain.js";

const EX_KEY = "ocn.tr.ex3d";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (v, d) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(v);
let open = null;

/** The 3D view of the course shown (or of all the controls), over the editor's map pane. */
export async function view3d(E) {
  if (open) { open.close(); return; }
  const ev = E.ev;
  if (!hasGeo(ev)) { E.toast(t("trc.v3.needGeo", { where: where("georef") }), 6000); return; }
  const wrap = E.root.querySelector(".tr-mapwrap");
  const cd = E.cdDraw || E.cd;
  const name = cd.course ? ev.courses[cd.course]?.name || "" : t("trc.exp.allControls");
  let ex = 1.5;
  try { const v = Number(localStorage.getItem(EX_KEY)); if (v >= 1 && v <= 3) ex = v; } catch (e) { /* the default */ }
  const box = document.createElement("div");
  box.className = "tr-3d";
  box.innerHTML = `<div class="tr-3d-bar"><b>${esc(t("trc.v3.title", { name }))}</b>
      <label class="tr-3d-ex"><span>${esc(t("trc.v3.ex"))}</span><input type="range" min="1" max="3" step="0.25" value="${ex}"><b>× ${fmt(ex, 2)}</b></label>
      <button type="button" class="tr-icon" data-v3="fit" title="${esc(t("trc.v3.fit"))}">${svg("fit", 16)}</button>
      <button type="button" class="tr-icon" data-v3="close" title="${esc(t("trc.v3.close"))}">${svg("close", 16)}</button></div>
    <div class="tr-3d-host"></div><div class="tr-3d-note" role="status"></div>`;
  wrap.appendChild(box);
  const note = (html) => { box.querySelector(".tr-3d-note").innerHTML = html || ""; };
  let v = null, live = true;
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
  function close() {
    live = false; open = null;
    v?.dispose(); box.remove();
    document.removeEventListener("keydown", onKey, true);
  }
  open = { close };
  document.addEventListener("keydown", onKey, true);
  box.querySelector('[data-v3="close"]').addEventListener("click", close);
  box.querySelector('[data-v3="fit"]').addEventListener("click", () => v?.fitMap());
  box.querySelector(".tr-3d-ex input").addEventListener("input", (e) => {
    ex = Number(e.target.value); box.querySelector(".tr-3d-ex b").textContent = `× ${fmt(ex, 2)}`;
    v?.setExaggeration(ex);
    try { localStorage.setItem(EX_KEY, String(ex)); } catch (err) { /* this visit only */ }
  });
  try {
    // the course over the map at a resolution the view takes (its texture at most 4096 px on a phone, 6144 elsewhere)
    note(`${bar()} ${esc(t("trc.v3.drawing"))}`);
    // the course's print area, kept to the map (a small map on a large page: no blank paper around it)
    const clip = [0, 0, ev.map.w || 210, ev.map.h || 297], pb = printBox(E, cd, layoutCourse(ev, cd));
    const side = Math.max(Math.min(pb.box[2], clip[2]) - Math.max(pb.box[0], clip[0]), Math.min(pb.box[3], clip[3]) - Math.max(pb.box[1], clip[1]), 1);
    const maxPx = matchMedia("(pointer: coarse)").matches ? 4096 : 6144;
    const dpi = Math.max(30, Math.min(300, (25.4 * maxPx) / (side * pb.k)));
    const { canvas, box: mm, pxPerMm } = await courseImage(E, cd, dpi, { withMap: true, clip });
    if (!live) return;
    const W = canvas.width, H = canvas.height;
    // the image's pixels → the ground's degrees (through the map's mm) → local metres, x east, y south: an affine
    const ll = (px, py) => toLatLon(ev, mm[0] + px / pxPerMm, mm[3] - py / pxPerMm);
    const [lat0, lon0] = ll(W / 2, H / 2), kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const m = (px, py) => { const [la, lo] = ll(px, py); return [(lo - lon0) * kx, (lat0 - la) * ky]; };
    const o = m(0, 0), ax = m(1, 0).map((v2, i) => v2 - o[i]), ay = m(0, 1).map((v2, i) => v2 - o[i]), det = ax[0] * ay[1] - ax[1] * ay[0];
    const toM = (px, py) => [o[0] + px * ax[0] + py * ay[0], o[1] + px * ax[1] + py * ay[1]];
    const toPx = (mx, my) => { const u = mx - o[0], w = my - o[1]; return [(u * ay[1] - w * ay[0]) / det, (ax[0] * w - ax[1] * u) / det]; };
    // the heights
    const plan = gridPlan(W, H, toM);
    const key = `tr:${W}x${H}:${[[0, 0], [W, 0], [W, H], [0, H]].map(([a, b]) => ll(a, b).map((x) => x.toFixed(5)).join(",")).join(";")}`;
    note(`${bar(0)} ${esc(t("trc.v3.loading", { p: 0 }))}`);
    const grid = await loadGrid({ key, ...plan, node: (i, j) => ll((i / (plan.nx - 1)) * W, (j / (plan.ny - 1)) * H),
      onProgress: (f) => { if (live) note(`${bar(f)} ${esc(t("trc.v3.loading", { p: Math.round(100 * f) }))}`); } });
    if (!live) return;
    const { open3d } = await import("../trace/view3d.js");
    if (!live) return;
    v = await open3d(box.querySelector(".tr-3d-host"), { image: canvas, W, H, grid, toM, toPx });
    if (!live) { v.dispose(); return; }
    v.setExaggeration(ex);
    // the course's controls framed, else the whole print area
    const pts = M.ccIds(ev, cd).map((cc) => ev.controls[ev.courseControls[cc]?.control]).filter(Boolean)
      .map((c) => [(c.x - mm[0]) * pxPerMm, (mm[3] - c.y) * pxPerMm]);
    if (cd.course && pts.length > 1) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), pad = 25 * pxPerMm;
      v.fitTrace([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
    } else v.fitMap();
    const c = CREDIT[grid.source];
    note(`${esc(t("trc.v3.relief"))} <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a> · ${esc(t("trc.v3.how"))}`);
  } catch (err) {
    console.error(err);
    if (!live) return;
    note(esc(t(err.message === "webgl" ? "trc.v3.noWebgl" : "trc.v3.failed")));
  }
}

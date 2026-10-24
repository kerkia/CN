// Route choices on the analyses' maps (a prototype, administrators only; 2026-10-24): the page's side of trace/routechoice.js
// — the worker that reads the map and searches the legs, the settings panel shared by « Analyse solo » and « Analyse
// multi », the routes drawn over the map, the reference pace from a runner's own legs.

import { html, raw, $, fmt } from "../util.js";
import { t } from "../i18n.js";
import { DEFAULTS } from "./routechoice.js";

const PREFS = "ocn.rc.prefs";                        // the settings, kept on the device (the map's kind apart: the race's)
const MAX_PX = 9e6;                                  // a larger map is read at a reduced size (memory, time)
export const ROUTE_COLOURS = ["#00a651", "#f7941d", "#0072bc", "#e0218a"];
export const LETTERS = ["A", "B", "C", "D"];
const SPEED_KEYS = ["path", "open", "rough", "g1", "g2", "g3", "marsh", "paved", "grey", "shallow"];

/** The settings: the saved ones over the defaults; the map's kind from the race (`map`), unless changed this visit. */
export function loadSettings(map = "forest") {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS) || "{}") || {}; } catch (e) { /* defaults */ }
  return { ...DEFAULTS, ...saved, map, speeds: { ...DEFAULTS.speeds, ...(saved.speeds || {}) } };
}
function saveSettings(s) {
  const { map, ...rest } = s;
  try { localStorage.setItem(PREFS, JSON.stringify(rest)); } catch (e) { /* this visit only */ }
}
/** Whether a race reads as a sprint (its discipline, else its name). */
export const isSprint = (race) => /sprint/i.test(`${race?.terrain || ""} ${race?.format || ""} ${race?.name || ""}`);

/**
 * The planner of one map: image (an ImageBitmap or canvas), toM(px, py) the metres of a map pixel (any affine frame).
 * Returns { ready (Promise of the reading's facts), dem(grid), settings(s), leg(a, b), line(pts), picture(), destroy() };
 * points in the map's own pixels.
 */
export function planner(image, toM) {
  const W0 = image.width, H0 = image.height, sc = W0 * H0 > MAX_PX ? Math.sqrt(MAX_PX / (W0 * H0)) : 1;
  const W = Math.round(W0 * sc), H = Math.round(H0 * sc);
  const o = toM(0, 0), ex = toM(1, 0), ey = toM(0, 1);
  // metres of one pixel of the image read, in x and y: columns of J
  const J = [[(ex[0] - o[0]) / sc, (ey[0] - o[0]) / sc], [(ex[1] - o[1]) / sc, (ey[1] - o[1]) / sc]];
  const worker = new Worker(new URL("./routeworker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = (e) => { const p = waiting.get(e.data.id); if (!p) return; waiting.delete(e.data.id); if (e.data.ok) p.ok(e.data); else p.ko(new Error(e.data.error)); };
  worker.onerror = (e) => { for (const p of waiting.values()) p.ko(new Error(e.message || "worker")); waiting.clear(); };
  const ask = (op, body = {}, transfer = []) => new Promise((ok, ko) => { const id = ++seq; waiting.set(id, { ok, ko }); worker.postMessage({ id, op, ...body }, transfer); });
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(image, 0, 0, W, H);
  const rgba = g.getImageData(0, 0, W, H).data.buffer;
  const ready = ask("init", { rgba, w: W, h: H, J }, [rgba]);
  const cache = new Map();
  let skey = "";
  const S = (p) => [p[0] * sc, p[1] * sc], U = (p) => [p[0] / sc, p[1] / sc];
  return {
    ready,
    scale: sc,
    /** The ground's heights (trace/terrain.js's grid over the whole map). */
    async dem(grid) { await ready; await ask("dem", { grid: { z: grid.z, nx: grid.nx, ny: grid.ny } }); cache.clear(); },
    async settings(s) { await ready; skey = JSON.stringify(s); await ask("settings", { s }); },
    /** The routes of a leg, the best first (null: none found). */
    async leg(a, b) {
      const k = `${skey}|${a.map((v) => v.toFixed(1))}|${b.map((v) => v.toFixed(1))}`;
      if (!cache.has(k)) cache.set(k, ready.then(() => ask("leg", { a: S(a), b: S(b) })).then((r) => (r.routes ? r.routes.map((x) => ({ ...x, pts: x.pts.map(U) })) : null)));
      return cache.get(k);
    },
    /** A route drawn by a runner measured on the same model. */
    async line(pts) { await ready; return (await ask("line", { pts: pts.map(S) })).route; },
    /** The terrain as read, a canvas of one pixel a cell, and the cell's size in map pixels. */
    async picture() {
      await ready;
      const r = await ask("picture");
      const pc = document.createElement("canvas"); pc.width = r.nx; pc.height = r.ny;
      pc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.nx, r.ny), 0, 0);
      return { canvas: pc, cell: r.cs / sc };
    },
    destroy() { worker.terminate(); for (const p of waiting.values()) p.ko(new Error("closed")); waiting.clear(); },
  };
}

/** A runner's reference pace (seconds per metre of white forest on the flat): the median of their legs' actual time over
 *  the model's time of the route they ran, kept between 3 and 20 min/km. */
export function autoPace(pairs) {
  const r = pairs.filter((p) => p.actual > 0 && p.model > 0).map((p) => p.actual / p.model).sort((a, b) => a - b);
  if (!r.length) return null;
  const m = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
  return Math.max(0.18, Math.min(1.2, m));
}
/** The pace in use, seconds per metre: the one typed, else the automatic one, else 6:00 min/km. */
export const paceOf = (s, auto) => (s.pace > 0 ? s.pace / 1000 : auto || 0.36);
export const minKm = (sPerM) => { const v = Math.round(sPerM * 1000); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };

/**
 * The settings panel (a <details> for the side panels). s: the settings; info: { status, pace (auto, s/m), picture }.
 * The panel's controls call onChange(s, what) after each change ("on", "picture", "pace" redraw only; others search again).
 */
export function panelHtml(s, { on, picture, status = "", auto = null } = {}) {
  const range = (id, v, lo, hi, step, label, unit = "") => html`<label><span>${label}</span><span class="rc-range"><input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}"><b id="${id}-v">${v}${unit}</b></span></label>`;
  return html`<details class="an-settings rc-box" id="rc-box" open><summary>${t("rc.title")} <span class="pill rc-pill">${t("rc.admin")}</span></summary>
    <label class="rc-on"><input type="checkbox" id="rc-on" ${raw(on ? "checked" : "")}> ${t("rc.on")}</label>
    <div class="muted rc-status" id="rc-status">${status}</div>
    <div ${raw(on ? "" : "hidden")} id="rc-opts">
      <div class="an-opts">
        <label><span>${t("rc.map")}</span><select id="rc-map"><option value="forest" ${raw(s.map === "forest" ? "selected" : "")}>${t("rc.map.forest")}</option><option value="sprint" ${raw(s.map === "sprint" ? "selected" : "")}>${t("rc.map.sprint")}</option></select></label>
        <label><span>${t("rc.black")}</span><select id="rc-black">${["auto", "paths", "neutral", "obstacles"].map((v) => html`<option value="${v}" ${raw(s.black === v ? "selected" : "")}>${t(`rc.black.${v}`)}</option>`)}</select></label>
        ${range("rc-risk", s.risk, 0, 100, 5, t("rc.risk"), " %")}
        ${range("rc-climb", s.climb, 0, 20, 1, t("rc.climb"), " m")}
        <label><span>${t("rc.pace")}</span><span class="rc-range"><input id="rc-pace" inputmode="numeric" placeholder="${auto ? minKm(auto) : "6:00"}" value="${s.pace > 0 ? minKm(s.pace / 1000) : ""}" style="width:70px"> <span class="muted">${t("rc.pace.unit")}</span></span></label>
        <label><span>${t("rc.variants")}</span><select id="rc-variants">${[1, 2, 3, 4].map((n) => html`<option value="${n}" ${raw(n === s.variants ? "selected" : "")}>${n}</option>`)}</select></label>
        ${range("rc-extra", s.extra, 5, 60, 5, t("rc.extra"), " %")}
      </div>
      <details class="rc-speeds"><summary>${t("rc.speeds")}</summary><div class="an-opts">
        ${SPEED_KEYS.map((k) => range(`rc-sp-${k}`, s.speeds[k], 5, 200, 5, t(`rc.sp.${k}`), " %"))}</div></details>
      <label class="rc-on"><input type="checkbox" id="rc-pic" ${raw(picture ? "checked" : "")}> ${t("rc.picture")}</label>
      <p class="hint rc-hint">${t("rc.hint", { d: 50 })} <button type="button" class="btn btn-sm" id="rc-reset">${t("rc.reset")}</button></p>
    </div></details>`;
}
export function bindPanel(root, s, onChange) {
  const box = $("#rc-box", root);
  if (!box) return;
  const set = (what) => { saveSettings(s); onChange(s, what); };
  $("#rc-on", box).addEventListener("change", (e) => { $("#rc-opts", box).hidden = !e.target.checked; onChange(s, e.target.checked ? "on" : "off"); });
  $("#rc-pic", box).addEventListener("change", (e) => onChange(s, e.target.checked ? "picture-on" : "picture-off"));
  $("#rc-map", box).addEventListener("change", (e) => { s.map = e.target.value; set("map"); });
  $("#rc-black", box).addEventListener("change", (e) => { s.black = e.target.value; set("search"); });
  $("#rc-variants", box).addEventListener("change", (e) => { s.variants = Number(e.target.value); set("search"); });
  const slide = (id, apply) => {
    const el = $(`#${id}`, box);
    el.addEventListener("input", () => { const v = $(`#${id}-v`, box); if (v) v.textContent = v.textContent.replace(/^[\d.]+/, el.value); });
    el.addEventListener("change", () => { apply(Number(el.value)); set("search"); });
  };
  slide("rc-risk", (v) => { s.risk = v; });
  slide("rc-climb", (v) => { s.climb = v; });
  slide("rc-extra", (v) => { s.extra = v; });
  for (const k of SPEED_KEYS) slide(`rc-sp-${k}`, (v) => { s.speeds = { ...s.speeds, [k]: v }; });
  $("#rc-pace", box).addEventListener("change", (e) => {
    const m = /^\s*(\d{1,2})(?:[:.,h'](\d{1,2}))?\s*$/.exec(e.target.value);
    s.pace = m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0;
    if (s.pace && (s.pace < 150 || s.pace > 1500)) s.pace = 0;
    e.target.value = s.pace ? minKm(s.pace / 1000) : "";
    set("pace");
  });
  $("#rc-reset", box).addEventListener("click", () => { Object.assign(s, { ...DEFAULTS, map: s.map, speeds: { ...DEFAULTS.speeds } }); set("reset"); });
}
export const setStatus = (text) => { const el = $("#rc-status"); if (el) el.textContent = text; };

/** The routes of a leg over the map: each in its colour over a white casing, dashed, its letter and time at its middle. */
export function drawRoutes(g, routes, lw, pace, clock) {
  if (!routes?.length) return;
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  for (let n = routes.length - 1; n >= 0; n--) {
    const r = routes[n], col = ROUTE_COLOURS[n % ROUTE_COLOURS.length];
    const path = new Path2D();
    r.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    g.globalAlpha = 0.9; g.setLineDash([]); g.strokeStyle = "#ffffff"; g.lineWidth = lw(7); g.stroke(path);
    g.setLineDash([lw(10), lw(6)]); g.strokeStyle = col; g.lineWidth = lw(4); g.stroke(path);
  }
  g.setLineDash([]); g.globalAlpha = 1;
  g.font = `700 ${lw(12)}px system-ui, sans-serif`; g.textBaseline = "middle"; g.textAlign = "center";
  routes.forEach((r, n) => {
    const p = midpoint(r.pts), text = `${LETTERS[n]} ${clock(r.time * pace)}`, w = g.measureText(text).width + lw(10);
    g.fillStyle = ROUTE_COLOURS[n % ROUTE_COLOURS.length];
    g.beginPath(); g.roundRect ? g.roundRect(p[0] - w / 2, p[1] - lw(9), w, lw(18), lw(9)) : g.rect(p[0] - w / 2, p[1] - lw(9), w, lw(18)); g.fill();
    g.fillStyle = "#ffffff"; g.fillText(text, p[0], p[1]);
  });
  g.restore();
}
/** The point halfway along a polyline. */
function midpoint(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let d = L / 2;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= s) { const f = s ? d / s : 0; return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])]; }
    d -= s;
  }
  return pts[0];
}

/** Which of the routes a runner's route follows: the nearest by mean distance (map px) under `tol`, else -1. */
export function nearestRoute(routes, pts, tol) {
  const sample = (p, n) => {
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const L = cum[cum.length - 1] || 1, out = [];
    for (let k = 0, i = 1; k < n; k++) {
      const d = (k / (n - 1)) * L;
      while (i < p.length - 1 && cum[i] < d) i++;
      const s = cum[i] - cum[i - 1] || 1, f = Math.max(0, Math.min(1, (d - cum[i - 1]) / s));
      out.push([p[i - 1][0] + f * (p[i][0] - p[i - 1][0]), p[i - 1][1] + f * (p[i][1] - p[i - 1][1])]);
    }
    return out;
  };
  const a = sample(pts, 24);
  let best = -1, bd = tol;
  routes.forEach((r, n) => {
    const b = sample(r.pts, 24);
    const d = a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / a.length;
    if (d < bd) { bd = d; best = n; }
  });
  return best;
}

/** A route's facts for a table cell: time at the pace, length, climb. */
export function routeFacts(r, pace, clock) {
  return `${clock(r.time * pace)} · ${fmt(Math.round(r.len / 10) * 10)} m${r.up >= 1 ? ` · +${fmt(Math.round(r.up))} m` : ""}`;
}
export const sideLabel = (r) => t(r.side < 0 ? "rc.side.left" : r.side > 0 ? "rc.side.right" : "rc.side.straight");

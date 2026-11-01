// Route choices on the analyses' maps (a prototype, administrators only; 2026-10-24): the page's side of trace/routechoice.js
// — the worker that reads the map and searches the legs, the settings panel shared by « Analyse solo » and « Analyse
// multi » (with the reading's progress, a warning when the reading looks wrong, the terrain's legend), the routes and the
// decision map drawn over the map, the reference pace from a runner's own legs.

import { html, raw, $, fmt } from "../util.js";
import { t } from "../i18n.js";
import { DEFAULTS, LEGEND, A } from "./routechoice.js";
import { layers, VECTOR_ACCEPT } from "./vectorroutes.js";

const PREFS = "ocn.rc.prefs";                        // the settings, kept on the device (the map's kind apart: the race's)
const MAX_PX = 9e6;                                  // a larger map is read at a reduced size (memory, time)
export const ROUTE_COLOURS = ["#00a651", "#f7941d", "#0072bc", "#e0218a"];
export const LETTERS = ["A", "B", "C", "D"];
const SPEED_KEYS = ["track", "path", "small", "open", "rough", "g1", "g2", "g3", "marsh", "paved", "grey", "shallow"];

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
 * The planner of one map: image (an ImageBitmap or canvas), toM(px, py) the metres of a map pixel (any affine frame); vector:
 * an OCAD or Mapper map of it ({ v: trace/vectorroutes.js readVector's, T: the affine from its mm to the image's pixels }),
 * whose symbols are read instead of the image's colours; opts: { map (the map's kind), onProgress(f) (the reading's) }.
 * Returns { ready (Promise of the reading's facts), dem(grid), settings(s, onProgress) (the new facts when the map was read
 * again, else null), controls(pts) (the course's controls), leg(a, b), decision(a, b), line(pts), picture(), destroy() }; points in
 * the map's own pixels.
 */
export function planner(image, toM, vector = null, opts = {}) {
  const W0 = image.width, H0 = image.height, sc = W0 * H0 > MAX_PX ? Math.sqrt(MAX_PX / (W0 * H0)) : 1;
  const W = Math.round(W0 * sc), H = Math.round(H0 * sc);
  const o = toM(0, 0), ex = toM(1, 0), ey = toM(0, 1);
  // metres of one pixel of the image read, in x and y: columns of J
  const J = [[(ex[0] - o[0]) / sc, (ey[0] - o[0]) / sc], [(ex[1] - o[1]) / sc, (ey[1] - o[1]) / sc]];
  const worker = new Worker(new URL("./routeworker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    if (e.data.progress != null) { p.progress?.(e.data.progress); return; }
    waiting.delete(e.data.id);
    if (e.data.ok) p.ok(e.data); else p.ko(new Error(e.data.error));
  };
  worker.onerror = (e) => { for (const p of waiting.values()) p.ko(new Error(e.message || "worker")); waiting.clear(); };
  const ask = (op, body = {}, transfer = [], progress = null) => new Promise((ok, ko) => { const id = ++seq; waiting.set(id, { ok, ko, progress }); worker.postMessage({ id, op, ...body }, transfer); });
  let ready;
  if (vector) {
    const T = vector.T, L = layers(vector.v, { a: T.a * sc, b: T.b * sc, c: T.c * sc, d: T.d * sc, e: T.e * sc, f: T.f * sc }, W, H);
    const bufs = ["area", "path", "blue", "block", "hand"].map((k) => L[k].buffer);
    ready = ask("layers", { area: bufs[0], path: bufs[1], blue: bufs[2], block: bufs[3], hand: bufs[4], w: W, h: H, J }, bufs)
      .then((r) => ({ ...r, vector: { counts: L.counts, ms: L.ms, name: vector.v.name } }));
  } else {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0, W, H);
    const rgba = g.getImageData(0, 0, W, H).data.buffer;
    ready = ask("init", { rgba, w: W, h: H, J, map: opts.map }, [rgba], opts.onProgress);
  }
  const cache = new Map(), decs = new Map();
  let skey = "", ckey = "";
  const S = (p) => [p[0] * sc, p[1] * sc], U = (p) => [p[0] / sc, p[1] / sc];
  return {
    ready,
    scale: sc,
    /** The ground's heights (trace/terrain.js's grid over the whole map). */
    async dem(grid) { await ready; await ask("dem", { grid: { z: grid.z, nx: grid.nx, ny: grid.ny } }); cache.clear(); decs.clear(); },
    async settings(s, onProgress) {
      await ready;
      skey = JSON.stringify(s);
      const r = await ask("settings", { s }, [], onProgress);
      if (r.reread) { cache.clear(); decs.clear(); return r.facts; }
      return null;
    },
    /** The routes of a leg, the best first (null: none found). */
    async leg(a, b) {
      const k = `${skey}|${a.map((v) => v.toFixed(1))}|${b.map((v) => v.toFixed(1))}`;
      if (!cache.has(k)) cache.set(k, ready.then(() => ask("leg", { a: S(a), b: S(b) })).then((r) => (r.routes ? r.routes.map((x) => ({ ...x, pts: x.pts.map(U) })) : null)));
      return cache.get(k);
    },
    /** The course's controls (map px): the overprint around them is the course's own (circles, numbers), not out of bounds. */
    async controls(pts) {
      const k = JSON.stringify(pts.map((p) => p.map((v) => Math.round(v))));
      if (k === ckey) return;
      await ready; ckey = k;
      await ask("controls", { pts: pts.map(S) });
      cache.clear(); decs.clear();
    },
    /** The decision map of a leg: { canvas (one pixel a cell), x, y (its corner, map px), cell (map px a cell) }, or null. */
    decision(a, b) {
      const k = `${skey}|${a.map((v) => v.toFixed(1))}|${b.map((v) => v.toFixed(1))}`;
      if (!decs.has(k)) {
        decs.set(k, this.leg(a, b).then(() => ask("decision", { a: S(a), b: S(b) })).then((r) => {
          if (!r.rgba) return null;
          const c = document.createElement("canvas"); c.width = r.rw; c.height = r.rh;
          c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.rw, r.rh), 0, 0);
          return { canvas: c, x: (r.i0 * r.cs) / sc, y: (r.j0 * r.cs) / sc, cell: r.cs / sc };
        }));
        while (decs.size > 12) decs.delete(decs.keys().next().value);
      }
      return decs.get(k);
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
export function panelHtml(s, { on, picture, decision = false, status = "", progress = null, warn = "", auto = null, vector = null } = {}) {
  const range = (id, v, lo, hi, step, label, unit = "") => html`<label><span>${label}</span><span class="rc-range"><input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}"><b id="${id}-v">${v}${unit}</b></span></label>`;
  return html`<details class="an-settings rc-box" id="rc-box" open><summary>${t("rc.title")} <span class="pill rc-pill">${t("rc.admin")}</span></summary>
    <label class="rc-on"><input type="checkbox" id="rc-on" ${raw(on ? "checked" : "")}> ${t("rc.on")}</label>
    <div class="muted rc-status" id="rc-status">${status}</div>
    <progress class="rc-prog" id="rc-prog" max="1" value="${progress ?? 0}" ${raw(progress == null ? "hidden" : "")}></progress>
    <div class="notice rc-warn" id="rc-warn" ${raw(warn ? "" : "hidden")}>${warn}</div>
    <div ${raw(on ? "" : "hidden")} id="rc-opts">
      <div class="rc-vec"><label class="btn btn-sm" title="${t("rc.vec.hint")}">${t("rc.vec.pick")}<input type="file" id="rc-vec" accept="${VECTOR_ACCEPT}" hidden></label>
        <span class="muted">${vector?.name ? html`<b>${vector.name}</b>${vector.detail ? ` · ${vector.detail}` : ""}` : t("rc.vec.none")}</span>
        ${vector?.name && !vector.fixed ? html`<button type="button" class="btn btn-sm" id="rc-vec-clear" title="${t("rc.vec.clear")}">✕</button>` : ""}
        ${vector?.note ? html`<div class="notice rc-vec-note">${vector.note}</div>` : ""}</div>
      <div class="an-opts">
        <label><span>${t("rc.map")}</span><select id="rc-map"><option value="forest" ${raw(s.map === "forest" ? "selected" : "")}>${t("rc.map.forest")}</option><option value="sprint" ${raw(s.map === "sprint" ? "selected" : "")}>${t("rc.map.sprint")}</option></select></label>
        <label ${raw(vector?.used ? "hidden" : "")}><span>${t("rc.black")}</span><select id="rc-black">${["auto", "paths", "neutral", "obstacles"].map((v) => html`<option value="${v}" ${raw(s.black === v ? "selected" : "")}>${t(`rc.black.${v}`)}</option>`)}</select></label>
        ${range("rc-risk", s.risk, 0, 100, 5, t("rc.risk"), " %")}
        ${range("rc-climb", s.climb, 0, 20, 1, t("rc.climb"), " m")}
        <label><span>${t("rc.relief")}</span><select id="rc-relief">${["contours", "dem"].map((v) => html`<option value="${v}" ${raw(s.relief === v ? "selected" : "")}>${t(`rc.relief.${v}`)}</option>`)}</select></label>
        <label ${raw(s.relief === "dem" ? "hidden" : "")} id="rc-interval-row"><span>${t("rc.interval")}</span><select id="rc-interval">${[2.5, 5, 10].map((v) => html`<option value="${v}" ${raw(Number(s.interval) === v ? "selected" : "")}>${fmt(v, v % 1 ? 1 : 0)} m</option>`)}</select></label>
        <label><span>${t("rc.pace")}</span><span class="rc-range"><input id="rc-pace" inputmode="numeric" placeholder="${auto ? minKm(auto) : "6:00"}" value="${s.pace > 0 ? minKm(s.pace / 1000) : ""}" style="width:70px"> <span class="muted">${t("rc.pace.unit")}</span></span></label>
        <label><span>${t("rc.variants")}</span><select id="rc-variants">${[1, 2, 3, 4].map((n) => html`<option value="${n}" ${raw(n === s.variants ? "selected" : "")}>${n}</option>`)}</select></label>
        ${range("rc-extra", s.extra, 5, 60, 5, t("rc.extra"), " %")}
      </div>
      <details class="rc-speeds"><summary>${t("rc.speeds")}</summary><div class="an-opts">
        ${SPEED_KEYS.map((k) => range(`rc-sp-${k}`, s.speeds[k], 5, 200, 5, t(`rc.sp.${k}`), " %"))}</div></details>
      <label class="rc-on" title="${t("rc.decision.hint")}"><input type="checkbox" id="rc-dec" ${raw(decision ? "checked" : "")}> ${t("rc.decision")}</label>
      <div class="rc-dec-key" id="rc-dec-key" ${raw(decision ? "" : "hidden")}><span class="rc-dec-ramp"></span><span class="muted">${t("rc.decision.key", { p: s.extra })}</span></div>
      <label class="rc-on"><input type="checkbox" id="rc-pic" ${raw(picture ? "checked" : "")}> ${t("rc.picture")}</label>
      <div class="rc-legend" id="rc-legend" ${raw(picture ? "" : "hidden")}>${LEGEND.map(([k, c]) => html`<span><i style="background:rgb(${c.join(",")})"></i>${t(`rc.cls.${k}`)}</span>`)}</div>
      <p class="hint rc-hint">${t("rc.hint", { d: 50 })} <button type="button" class="btn btn-sm" id="rc-reset">${t("rc.reset")}</button></p>
    </div></details>`;
}
export function bindPanel(root, s, onChange) {
  const box = $("#rc-box", root);
  if (!box) return;
  const set = (what) => { saveSettings(s); onChange(s, what); };
  $("#rc-on", box).addEventListener("change", (e) => { $("#rc-opts", box).hidden = !e.target.checked; onChange(s, e.target.checked ? "on" : "off"); });
  $("#rc-pic", box).addEventListener("change", (e) => { $("#rc-legend", box).hidden = !e.target.checked; onChange(s, e.target.checked ? "picture-on" : "picture-off"); });
  $("#rc-dec", box).addEventListener("change", (e) => {
    $("#rc-dec-key", box).hidden = !e.target.checked;
    try { localStorage.setItem("ocn.rc.dec", e.target.checked ? "1" : "0"); } catch (err) { /* this visit */ }
    onChange(s, e.target.checked ? "decision-on" : "decision-off");
  });
  $("#rc-vec", box).addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onChange(s, "vector", f); });
  $("#rc-vec-clear", box)?.addEventListener("click", () => onChange(s, "vector-clear"));
  $("#rc-map", box).addEventListener("change", (e) => { s.map = e.target.value; set("map"); });
  $("#rc-black", box).addEventListener("change", (e) => { s.black = e.target.value; set("search"); });
  $("#rc-variants", box).addEventListener("change", (e) => { s.variants = Number(e.target.value); set("search"); });
  $("#rc-relief", box).addEventListener("change", (e) => { s.relief = e.target.value; $("#rc-interval-row", box).hidden = s.relief === "dem"; set("relief"); });
  $("#rc-interval", box).addEventListener("change", (e) => { s.interval = Number(e.target.value); set("relief"); });
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
/** The status line, and the progress bar under it (frac 0-1; null hides it). */
export const setStatus = (text, frac = null) => {
  const el = $("#rc-status"); if (el) el.textContent = text;
  const bar = $("#rc-prog"); if (bar) { bar.hidden = frac == null; if (frac != null) bar.value = Math.max(0, Math.min(1, frac)); }
};
/**
 * The heights the routes climb: the model's grid (trace/terrain.js) refined by the map's own contour lines (trace/contours.js:
 * each line set at its level from the model, the model filling between them), on nodes ~2 m apart — or the model alone
 * (s.relief "dem"). toM(px, py): a map pixel's metres. Returns { grid, pieces } (pieces: the contour pieces read; 0 too few,
 * the model kept; null not asked).
 */
export async function reliefGrid(image, grid, toM, s) {
  if (s.relief === "dem") return { grid, pieces: null };
  await new Promise((r) => setTimeout(r, 30));          // the status drawn before the page's thread is busy
  const { refineGrid } = await import("./contours.js");
  const W = image.width, H = image.height, o = toM(0, 0), e = toM(W, 0), mPerPx = Math.hypot(e[0] - o[0], e[1] - o[1]) / W;
  let step = 2, nx, ny;
  do { nx = Math.ceil((W * mPerPx) / step) + 1; ny = Math.ceil((H * mPerPx) / step) + 1; step *= 1.2; } while (nx * ny > 4e6);
  let r = null;
  try { r = refineGrid(image, grid, W, H, mPerPx, { interval: Number(s.interval) || 5, size: { nx, ny } }); } catch (err) { console.error(err); }
  return r ? { grid: r, pieces: r.contours.pieces } : { grid, pieces: 0 };
}
/** The relief's words for the status: the model's credit, and what the map's contours added. */
export const reliefNote = (credit, pieces) => (pieces > 0 ? t("rc.st.contours", { r: credit, n: pieces }) : pieces === 0 ? `${credit} · ${t("rc.st.contours.none")}` : credit);
/** Whether the decision map was last asked for (kept on the device). */
export const decisionOn = () => { try { return localStorage.getItem("ocn.rc.dec") === "1"; } catch (e) { return false; } };
const CLS_KEYS = ["white", "open", "rough", "g1", "g2", "g3", "water", "shallow", "paved", "oob", "building", "grey", "marsh"];
/** A warning when the map as read looks wrong: much of it bare rock or buildings on a forest map (a photo's grey paper, a
 *  scan's shade), one terrain other than white forest over two thirds of it, no path at all on a forest map of some size. */
export function readingWarning(info, s) {
  if (!info?.counts || info.vector) return "";
  const n = info.counts.reduce((a, b) => a + b, 0) || 1, pct = (v) => Math.round((100 * v) / n);
  if (s.map !== "sprint" && (info.counts[A.GREY] + info.counts[A.BUILDING]) / n > 0.2) return t("rc.warn.grey", { p: pct(info.counts[A.GREY] + info.counts[A.BUILDING]) });
  for (let c = 1; c < info.counts.length; c++) if (info.counts[c] / n > 0.66) return t("rc.warn.one", { p: pct(info.counts[c]), c: t(`rc.cls.${CLS_KEYS[c]}`) });
  if (s.map !== "sprint" && info.paths && !(info.paths[1] + info.paths[2] + info.paths[3]) && n * info.mpc * info.mpc > 2e5) return t("rc.warn.nopath");
  return "";
}
export const setWarning = (text) => { const el = $("#rc-warn"); if (el) { el.textContent = text; el.hidden = !text; } };
/** The decision map over the map, under the routes. */
export function drawDecision(g, d) {
  if (!d?.canvas) return;
  g.save(); g.globalAlpha = 0.55; g.imageSmoothingEnabled = true;
  g.drawImage(d.canvas, d.x, d.y, d.canvas.width * d.cell, d.canvas.height * d.cell);
  g.restore();
}

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

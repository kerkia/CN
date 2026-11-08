// The runners' paces under a replay's map (« Analyse multi »): one line per runner shown, in their colour, over the
// replay's own time axis (the clock, a mass start, a leg…), the pace scale in round min/km on the left, the replay's
// cursor; a click or a drag on it seeks. As « Analyse solo »'s curves (trace/curves.js), the scale is made of the moments
// in motion only (above 40 % of the median speed) and its slow end stops at 20 min/km: a stop at a control would
// otherwise flatten everything else.

import { t } from "../i18n.js";
import { fmt } from "../util.js";
import { pace, CHANNEL_LABEL } from "./curves.js";

const M = { top: 16, left: 40, right: 8, bottom: 16 };
const PACES = [150, 180, 210, 240, 270, 300, 330, 360, 420, 480, 540, 600, 720, 900, 1200];     // s/km: the ticks

/** What the strip can draw (owner, 2026-11-08: « Graphique » in « Affichage », the Trace menu's measures): the pace by default. */
export const isPaceGraph = (by) => by === "speed" || by === "gap";
/** A measure's name, the strip's bar and title saying what is drawn. */
export const graphName = (by) => t(by === "speed" ? "an.ch.pace" : by === "gap" ? "an.ch.gap" : by === "slope" ? "an.ch.slope" : CHANNEL_LABEL[by] || "an.ch.pace");

/** The number of samples a strip of this canvas holds (one per pixel of its plot). */
export const stripSamples = (canvas) => Math.max(20, Math.round(canvas.clientWidth - M.left - M.right));
/** The fraction (0-1) of the time axis under a pointer. */
export const stripFraction = (canvas, offsetX) => Math.max(0, Math.min(1, (offsetX - M.left) / Math.max(1, canvas.clientWidth - M.left - M.right)));

/**
 * series: [{ colour, vals (one per sample, null where none: speeds in m/s for the pace), bold }]; cursor: 0-1 or null;
 * ticks: [{ f (0-1), label }] the time axis' labels; marks: [{ f, label }] lines (the controls of a leg view);
 * by: the measure drawn (« speed », the default, and « gap » on the pace's scale; any other on its own, high up), unit its unit.
 */
export function drawPaceStrip(canvas, { series, cursor = null, ticks = [], marks = [], by = "speed", unit = "" }) {
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!w || !h) return;
  const css = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  const ink = css("--ink-3", "#888"), grid = css("--border", "#ddd");
  const plotW = Math.max(10, w - M.left - M.right), top = M.top, bottom = h - M.bottom, X = (f) => M.left + f * plotW;
  const label = (txt, x, y, align, colr, bold = false) => { g.font = `${bold ? "600 " : ""}10px system-ui, sans-serif`; g.textAlign = align; g.fillStyle = colr; g.fillText(txt, x, y); };
  const u = isPaceGraph(by) ? t("an.unit.pace") : by === "slope" ? "%" : unit;
  label(`${graphName(by)}${u ? ` (${u})` : ""}`, M.left, 11, "left", ink, true);
  let Y;
  if (isPaceGraph(by)) Y = paceScale();
  else Y = valueScale();
  // the pace's scale: the moments in motion of every line, 2nd to 98th percentile, widened to round paces
  function paceScale() {
    const all = [];
    for (const s of series) for (const v of s.vals) if (v != null && v > 0) all.push(v);
    all.sort((a, b) => a - b);
    const med = all[Math.floor(all.length / 2)] || 0, moving = all.filter((v) => v >= 0.4 * med);
    let lo = Math.max(1000 / 1200, moving[Math.floor(moving.length * 0.02)] || 1), hi = Math.max(lo + 0.1, moving[Math.floor(moving.length * 0.98)] || 4);
    const pFast = [...PACES].reverse().find((p) => p <= 1000 / hi) ?? PACES[0], pSlow = PACES.find((p) => p >= 1000 / lo) ?? 1200;
    hi = 1000 / pFast; lo = 1000 / pSlow;
    const Y = (v) => bottom - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * (bottom - top);
    g.lineWidth = 1;
    let lastY = -Infinity;
    for (const p of PACES.filter((q) => q >= pFast && q <= pSlow).sort((a, b) => a - b).reverse()) {   // from the bottom (slow) up
      const y = Y(1000 / p);
      if (Math.abs(y - lastY) < 12) continue;
      lastY = y;
      g.strokeStyle = grid; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(M.left, y); g.lineTo(M.left + plotW, y); g.stroke(); g.globalAlpha = 1;
      label(pace(1000 / p), M.left - 4, y + 3, "right", ink);
    }
    return Y;
  }
  // any other measure: its 2nd to 98th percentile widened to round steps (the slope even about 0), a line every ~16 px
  function valueScale() {
    const all = [];
    for (const s of series) for (const v of s.vals) if (v != null && Number.isFinite(v)) all.push(v);
    all.sort((a, b) => a - b);
    let lo = all[Math.floor(all.length * 0.02)] ?? 0, hi = all[Math.floor(all.length * 0.98)] ?? 1;
    if (by === "slope") { const m = Math.max(Math.abs(lo), Math.abs(hi), 2); lo = -m; hi = m; }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const rows = Math.max(1, Math.floor((bottom - top) / 16)), raw = (hi - lo) / rows, p10 = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= raw) || 10 * p10;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const Yv = (v) => bottom - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * (bottom - top);
    const digits = step < 1 ? 1 : 0;
    g.lineWidth = 1;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Yv(v);
      g.strokeStyle = grid; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(M.left, y); g.lineTo(M.left + plotW, y); g.stroke(); g.globalAlpha = 1;
      const r = Math.round(v / step) * step;
      label(`${by === "slope" && r > 0 ? "+" : r < 0 ? "−" : ""}${fmt(Math.abs(r), digits)}`, M.left - 4, y + 3, "right", ink);
    }
    return Yv;
  }
  // the controls of the view, then the lines (the bold one last), the time axis, the cursor
  g.strokeStyle = ink; g.globalAlpha = 0.45;
  for (const m of marks) { const x = X(m.f); g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); }
  g.globalAlpha = 1;
  for (const m of marks) if (m.label) label(m.label, X(m.f), top - 3, "center", ink);
  for (const s of [...series].sort((a, b) => (a.bold ? 1 : 0) - (b.bold ? 1 : 0))) {
    const n = s.vals.length;
    g.strokeStyle = s.colour; g.lineWidth = s.bold ? 2.6 : 1.5; g.globalAlpha = s.bold || !series.some((q) => q.bold) ? 1 : 0.7;
    g.beginPath();
    let pen = false;
    for (let k = 0; k < n; k++) {
      const v = s.vals[k];
      if (v == null) { pen = false; continue; }
      const x = X(n > 1 ? k / (n - 1) : 0), y = Y(v);
      if (pen) g.lineTo(x, y); else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(M.left, bottom); g.lineTo(M.left + plotW, bottom); g.stroke();
  for (const tk of ticks) label(tk.label, X(tk.f), h - 4, tk.f < 0.02 ? "left" : tk.f > 0.98 ? "right" : "center", ink);
  if (cursor != null) { const x = X(Math.max(0, Math.min(1, cursor))); g.strokeStyle = "#e8641c"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, bottom); g.stroke(); }
}

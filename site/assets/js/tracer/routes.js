// The routes runners took, for the setter's review after the race: the GPS traces shared on the event's « Analyse multi »
// (published from the Tracer, its circuits named as the courses), cut at each control's pass (trace/share.coursePasses),
// then, leg by leg, the routes grouped by shape — two routes are one when they keep within a few tens of metres of each
// other all along (each resampled to 16 points) — with each group's runners and median leg time, and its side of the
// straight line. Shown in « Bilan après la course », and drawn on the map leg by leg.

import * as M from "./model.js";
import * as G from "./geo.js";
import { t } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f"];
const mmss = (s) => { if (!Number.isFinite(s)) return ""; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

async function api(path) {
  const r = await fetch(`api/analyses${path}`, { credentials: "same-origin" });
  if (!r.ok) throw Object.assign(new Error(`http ${r.status}`), { status: r.status });
  return r.json();
}
/** Resample a polyline to n points by arc length. */
function resample(pts, n = 16) {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + M.dist(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1] || 1, out = [];
  for (let k = 0; k < n; k++) {
    const d = (L * k) / (n - 1);
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
  }
  return out;
}

/**
 * Per course of the event: { course, legs: [{ from, to, groups: [{ n, median, side, color, paths }], runners }] }, from the
 * traces of the published analysis. null when the event has no published analysis.
 */
export async function routesByLeg(E) {
  const aid = E.meta?.published?.analysis;
  if (!aid || !G.hasGeo(E.ev)) return null;
  const { decodeTrace, coursePasses, fitFromGeo } = await import("../trace/share.js");
  const data = await api(`/${aid}`);
  const ev = E.ev, out = [];
  for (const c of data.analysis?.courses || []) {
    const courseId = M.courseIds(ev).find((id) => ev.courses[id].name === c.name || c.name.startsWith(`${ev.courses[id].name} `));
    if (!courseId) continue;
    const recs = await api(`/${aid}/traces/${c.n}`).catch(() => []);
    if (!recs.length) continue;
    // the course's controls on the map (mm), in the analysis's order
    const ctrl = (c.controls || []).map((p) => ({ ...p }));
    const legs = ctrl.slice(1).map((p, j) => ({ from: ctrl[j], to: p, runs: [] }));
    for (const rec of recs) {
      const track = decodeTrace(rec);
      if (!track) continue;
      const fit = fitFromGeo(c.geo, track);
      const passes = coursePasses(track, fit, ctrl);
      for (let j = 1; j < ctrl.length; j++) {
        const t0 = passes[j - 1], t1 = passes[j];
        if (t0 == null || t1 == null || t1 <= t0) continue;
        const pts = [];
        for (let k = 0; k < track.n; k++) if (track.t[k] >= t0 && track.t[k] <= t1) pts.push(G.toMm(ev, track.lat0 - track.y[k] / track.ky, track.lon0 + track.x[k] / track.kx));
        if (pts.length >= 2) legs[j - 1].runs.push({ name: rec.name || "", time: t1 - t0, pts });
      }
    }
    // the map mm of each control (for labels and the straight line): from the analysis image back through its georeference
    for (const leg of legs) {
      const a = leg.runs[0]?.pts[0], b = leg.runs[0]?.pts[leg.runs[0].pts.length - 1];
      leg.a = a; leg.b = b;
      const straight = a && b ? M.dist(a, b) : 0;
      const lim = Math.max(25, 0.15 * M.mmToM(ev, straight)) / (ev.map.scale / 1000);      // mm
      const groups = [];
      for (const run of leg.runs) {
        const r = resample(run.pts);
        let g = groups.find((x) => x.ref.every((p, i) => M.dist(p, r[i]) < lim * 1.6) && x.ref.reduce((s, p, i) => s + M.dist(p, r[i]), 0) / r.length < lim);
        if (!g) { g = { ref: r, runs: [] }; groups.push(g); }
        g.runs.push(run);
      }
      groups.sort((x, y) => y.runs.length - x.runs.length);
      leg.groups = groups.map((g, i) => {
        const times = g.runs.map((r) => r.time).sort((x, y) => x - y);
        // side: the mean signed distance of the route from the straight line (positive: on the left going forward)
        let side = "";
        if (a && b && straight > 0) {
          const ux = (b[0] - a[0]) / straight, uy = (b[1] - a[1]) / straight;
          const off = g.ref.reduce((s, p) => s + ((p[0] - a[0]) * -uy + (p[1] - a[1]) * ux), 0) / g.ref.length;
          side = Math.abs(off) < lim * 0.6 ? t("trc.route.straight") : off > 0 ? t("trc.route.left") : t("trc.route.right");
        }
        return { n: g.runs.length, median: times[Math.floor(times.length / 2)], best: times[0], side, color: COLORS[i % COLORS.length], paths: g.runs.map((r) => r.pts), names: g.runs.map((r) => r.name) };
      });
    }
    out.push({ courseId, name: c.name, legs: legs.map((l, j) => ({ j, from: l.from, to: l.to, runners: l.runs.length, groups: l.groups || [], a: l.a, b: l.b })) });
  }
  return out;
}

/** The report's section (rows), and an overlay of one leg's routes on the map. */
export function routeRows(data) {
  const rows = [], meta = [];
  for (const c of data) for (const leg of c.legs) {
    if (leg.runners < 2) continue;
    const label = (p) => (p.kind === "start" ? t("trc.route.start") : p.kind === "finish" ? t("trc.route.finish") : p.code || "?");
    const best = leg.groups.length > 1 ? leg.groups.reduce((x, y) => (y.median < x.median ? y : x)) : null;
    rows.push([c.name, `${label(leg.from)}–${label(leg.to)}`, String(leg.runners), String(leg.groups.length),
      leg.groups.map((g) => `${g.n} ${g.side || ""} (${mmss(g.median)})${best && g === best ? " ★" : ""}`.replace(/\s+/g, " ")).join(" ; ")]);
    meta.push({ course: c.name, leg: leg.j });
  }
  return { rows, meta };
}
export function showLeg(E, data, courseName, legIndex) {
  const c = data.find((x) => x.name === courseName), leg = c?.legs[legIndex];
  if (!leg) return;
  const draw = (g, T, k) => {
    g.save(); g.lineWidth = 2.2; g.globalAlpha = 0.8;
    for (const grp of leg.groups) {
      g.strokeStyle = grp.color;
      for (const p of grp.paths) { g.beginPath(); p.forEach((q, i) => { const [x, y] = T(...q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    }
    g.restore();
    void k;
  };
  if (E.routesOverlay) E.overlays.splice(E.overlays.indexOf(E.routesOverlay), 1);
  E.routesOverlay = draw;
  E.overlays.push(draw);
  if (leg.a && leg.b) {
    const W = E.canvas.clientWidth, H = E.canvas.clientHeight, cx = (leg.a[0] + leg.b[0]) / 2, cy = (leg.a[1] + leg.b[1]) / 2;
    const span = Math.max(20, M.dist(leg.a, leg.b) * 1.6), k = Math.max(0.5, Math.min(W, H) / span);
    if (W > 50 && H > 50) E.view = { k, ox: W / 2 - cx * k, oy: H / 2 + cy * k };
  }
  E.redraw();
  E.toast(t("trc.route.legToast", { groups: leg.groups.map((g) => `${g.n} ${g.side}`).join(" · ") }), 6000);
  const off = (e) => { if (e.key === "Escape") { E.overlays.splice(E.overlays.indexOf(draw), 1); E.routesOverlay = null; E.redraw(); document.removeEventListener("keydown", off); } };
  document.addEventListener("keydown", off);
}
export { esc };

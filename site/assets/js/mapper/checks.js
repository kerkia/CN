// Cartographier's checks (« Vérifier »): what the IOF's specifications ask of a map that the eye misses — areas and lines under
// their symbol's minimum size (the symbol's `min`, else the specifications' table sets/minimums.json), contours drawn closer than
// can be read, objects whose symbol the map no longer has, the same object twice, objects with too few points, drafts not yet
// accepted; on a sprint map the legibility rules of sets/legibility.json, which the town map generator checks too
// (tools/virtually/legibility.py): impassable features closer than 0.4 mm, a path drawn on paving, a stairway off it. Each finding leads to its place (« Suivant » goes through them); the counts by symbol, part and source (« Statistiques »).

import * as G from "./geom.js";
import { minimumOf, numLabel, symName } from "./panels.js";
import { modal } from "../tracer/dialogs.js";
import { t, tn, locale } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const CONTOURS = new Set([101000, 102000, 103000]);
let LEG = null;
if (typeof window !== "undefined") fetch(new URL("./sets/legibility.json", import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((j) => { LEG = j; }).catch(() => {});
const codeOf = (sym) => `${Math.floor(sym / 1000)}${sym % 1000 ? "." + (sym % 1000) : ""}`;
const sprintMap = (E) => /sprint|ISSprOM/i.test(E.doc.standard || "") || E.doc.scale <= 5000;

export function run(E) {
  const out = [], seen = new Map(), have = new Set(E.doc.symbols.map((s) => s.sym));
  const minOf = (sym) => {
    const s = E.live.symbol(sym);
    if (s?.min) { const f = s.set === "isom2017-2" && E.doc.scale <= 10000 ? 1.5 : 1; return { area: (s.min.area || 0) * f * f, length: (s.min.length || 0) * f, gap: (s.min.gap || 0) * f }; }
    return minimumOf(E, sym);
  };
  for (const o of E.doc.objects) {
    if (o.sym > 0 && !have.has(o.sym)) { out.push({ kind: "unknown", o, msg: t("map.chk.unknown", { n: numLabel(o.sym) }) }); continue; }
    if (o.sym <= 0) continue;
    const parts = G.partsOf(o.coords);
    const plain = o.coords.filter((c) => !G.isCtrl(c)).length;
    if ((o.otp === 2 && plain < 2) || (o.otp === 3 && plain < 3)) { out.push({ kind: "points", o, msg: t("map.chk.points") }); continue; }
    const key = `${o.sym}|${o.otp}|${o.coords.map((c) => `${c.x},${c.y}`).join(";")}`;
    if (seen.has(key)) out.push({ kind: "dup", o, msg: t("map.chk.dup") }); else seen.set(key, o);
    if (o.draft) out.push({ kind: "draft", o, msg: t("map.chk.draft"), soft: true });
    const m = minOf(o.sym);
    if (!m || !parts.length) continue;
    if (o.otp === 3 && m.area) {
      const a = Math.abs(G.ringArea(G.flatten(parts[0].pts, 0.05)));
      if (a < m.area) out.push({ kind: "area", o, msg: t("map.chk.area", { s: numLabel(o.sym), a: nf(a, 2), min: nf(m.area, 2) }) });
    }
    if (o.otp === 2 && m.length) {
      const l = G.polyLength(G.flatten(parts[0].pts, 0.05));
      if (l < m.length) out.push({ kind: "length", o, msg: t("map.chk.length", { s: numLabel(o.sym), l: nf(l, 2), min: nf(m.length, 2) }) });
    }
  }
  // contours closer than the gap the specification asks (sampled every mm against the other contours near)
  const gap = (minimumOf(E, 101000)?.gap) || 0.15;
  const contours = E.doc.objects.filter((o) => CONTOURS.has(o.sym) && o.otp === 2);
  const flat = new Map(contours.map((o) => [o.id, G.flatten(G.partsOf(o.coords)[0]?.pts || [], 0.1)]));
  for (const o of contours) {
    const poly = flat.get(o.id);
    let found = null;
    for (let i = 0; i < poly.length && !found; i += 10) {
      const [x, y] = poly[i];
      for (const n of E.live.near([x - gap, y - gap, x + gap, y + gap])) {
        if (n.id === o.id || !CONTOURS.has(n.sym)) continue;
        const d = G.nearestOn(flat.get(n.id) || [], x, y).d;
        if (d < gap) { found = [x, y]; break; }
      }
    }
    if (found) out.push({ kind: "contour", o, at: found, msg: t("map.chk.contour", { min: nf(gap, 2) }), soft: true });
  }
  if (LEG && sprintMap(E)) sprintRules(E, out);
  return out;
}

/** A polyline's points every `step` mm (closed: back to its start). */
function walk(pts, closed, step, fn) {
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(l / step));
    for (let j = 0; j < k; j++) if (fn(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, l / k) === false) return;
  }
  if (!closed && n) fn(pts[n - 1][0], pts[n - 1][1], 0);
}
// an object's edges bucketed by 1 mm cells: a town's paving is one polygon of thousands of points, asked about at every sample
const CELL = 1;
function edgesOf(parts, closed) {
  const grid = new Map();
  parts.forEach((p, pi) => {
    const pts = p.pts, n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx * 65536 + gy; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push([a, b, pi]);
      }
    }
  });
  // rows: the edges crossing each horizontal band, for the point-in-polygon ray
  const rows = new Map();
  if (closed) parts.forEach((p, pi) => {
    const pts = p.pts, n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
        let l = rows.get(gy); if (!l) rows.set(gy, (l = [])); l.push([a, b, pi]);
      }
    }
  });
  return { grid, rows, nParts: parts.length };
}
/** Inside the area (its main ring, out of its holes). */
function inIdx(ix, x, y) {
  const odd = new Uint8Array(ix.nParts);
  for (const [a, b, pi] of ix.rows.get(Math.floor(y / CELL)) || []) {
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) odd[pi] ^= 1;
  }
  return odd[0] === 1 && !odd.slice(1).some((v) => v);
}
/** The nearest point of the edges, when under rmax: { d, x, y } (else d Infinity). */
function nearIdx(ix, x, y, rmax) {
  let best = { d: Infinity, x, y };
  const r = Math.ceil(rmax / CELL), gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++) {
    for (const [a, b] of ix.grid.get(i * 65536 + j) || []) { const q = G.segDist(x, y, a[0], a[1], b[0], b[1]); if (q.d < best.d) best = q; }
  }
  return best.d <= rmax ? best : { d: Infinity, x, y };
}

/** The sprint map's legibility rules (sets/legibility.json, shared with the town map generator's check). */
function sprintRules(E, out) {
  const geo = new Map();
  const parts = (o) => { let v = geo.get(o.id); if (!v) { v = G.partsOf(o.coords).map((p) => ({ pts: G.flatten(p.pts, 0.05), hole: p.hole })); geo.set(o.id, v); } return v; };
  const idxs = new Map();
  const idx = (o) => { let v = idxs.get(o.id); if (!v) { v = edgesOf(parts(o), o.otp === 3); idxs.set(o.id, v); } return v; };
  const gapA = new Set(LEG.gap.areas), gapL = new Set(LEG.gap.lines), gap = LEG.gap.mm;
  const imp = (o) => o.sym > 0 && ((o.otp === 3 && gapA.has(codeOf(o.sym))) || (o.otp === 2 && gapL.has(codeOf(o.sym))));
  const half = (o) => (o.otp === 2 ? (LEG.gap.lineWidthMm[codeOf(o.sym)] || 0.4) / 2 : 0);
  // impassable features less than 0.4 mm apart: a passage nobody can read (ISSprOM: closed, or widened)
  const pairs = new Set();
  const boxOf = (ps) => ps.reduce((b, p) => G.bboxOf(p.pts, b), [Infinity, Infinity, -Infinity, -Infinity]);
  for (const o of E.doc.objects) {
    if (!imp(o)) continue;
    const hw = half(o), closed = o.otp === 3, ps = parts(o), ob = boxOf(ps), r = gap + 0.5;
    // the impassable objects near this one, once; then each sample point against those whose box it is near
    const cand = E.live.near([ob[0] - r, ob[1] - r, ob[2] + r, ob[3] + r]).filter((n) => n.id !== o.id && imp(n))
      .map((n) => ({ n, ix: idx(n), b: boxOf(parts(n)), hw: half(n) }));
    if (!cand.length) continue;
    const own = closed ? idx(o) : null, touchMm = LEG.gap.touchMm || 0.02;
    // along the outline: where it touches each neighbour and where it passes too close; a narrow place within 3 gaps of a contact
    // is the wedge where the two meet at an angle — a dead end, not a passage
    const seen = cand.map(() => ({ touch: [], near: [] })), ringLen = [];
    let s = 0;
    ps.forEach((p, ri) => {
      s = 0;
      walk(p.pts, closed, 0.25, (x, y, l) => {
        cand.forEach((c, ci) => {
          const m = gap + c.hw + hw;
          if (x < c.b[0] - m || x > c.b[2] + m || y < c.b[1] - m || y > c.b[3] + m) return;
          if (c.n.otp === 3 && inIdx(c.ix, x, y)) { seen[ci].touch.push([ri, s]); return; }
          const q = nearIdx(c.ix, x, y, m), d = q.d - c.hw - hw;
          if (d <= touchMm) { seen[ci].touch.push([ri, s]); return; }
          if (d >= gap - 0.005) return;
          // the space between must be open ground: not across one of them, nor inside another impassable area
          const mx = (x + q.x) / 2, my = (y + q.y) / 2;
          if ((closed && inIdx(own, mx, my)) || cand.some((k) => k.n.otp === 3 && inIdx(k.ix, mx, my))) return;
          seen[ci].near.push([ri, s, x, y, d]);
        });
        s += l;
      });
      ringLen[ri] = s;
    });
    const along = (ri, a, rj, b) => (ri !== rj ? Infinity : closed ? Math.min(Math.abs(a - b), ringLen[ri] - Math.abs(a - b)) : Math.abs(a - b));
    cand.forEach((c, ci) => {
      const key = o.id < c.n.id ? `${o.id}|${c.n.id}` : `${c.n.id}|${o.id}`;
      if (pairs.has(key)) return;
      const hit = seen[ci].near.find(([ri, at]) => !seen[ci].touch.some(([rj, t0]) => along(ri, at, rj, t0) < 3 * gap));
      if (!hit) return;
      pairs.add(key);
      out.push({ kind: "gap", o, at: [hit[2], hit[3]], msg: t("map.chk.gap", { d: nf(hit[4], 2), min: nf(gap, 2) }) });
    });
  }
  // a path on paving, a stairway off it
  const paving = new Set(LEG.paving), paths = new Set([...LEG.unpavedPaths, ...LEG.pavedWays]);
  // inside the paving and not along its edge (a path joins it there): 0.3 m in, as the generator's check
  const inset = 0.3 / (E.doc.scale / 1000);
  const onPaving = (x, y) => E.live.near([x, y, x, y]).some((n) => n.otp === 3 && paving.has(codeOf(n.sym)) && inIdx(idx(n), x, y)
    && nearIdx(idx(n), x, y, inset).d === Infinity);
  // a stairway stands on paving: a paved area, a passage, or a paved footway's strip (501.6-501.9 at their width on the ground)
  const WAY_M = { "501.6": 1.4, "501.7": 2, "501.8": 3, "501.9": 4 }, k = E.doc.scale / 1000;
  const underStairs = (x, y) => E.live.near([x - 0.6, y - 0.6, x + 0.6, y + 0.6]).some((n) => {
    const c = codeOf(n.sym);
    if (n.otp === 3 && (paving.has(c) || c === LEG.passage)) return inIdx(idx(n), x, y) || nearIdx(idx(n), x, y, 0.05).d < Infinity;
    if (n.otp === 2 && WAY_M[c]) return nearIdx(idx(n), x, y, Math.max(0.7, WAY_M[c] / 2) / k + 0.05).d < Infinity;
    return false;
  });
  for (const o of E.doc.objects) {
    if (o.otp !== 2 || o.sym <= 0) continue;
    const c = codeOf(o.sym), stairs = c.split(".")[0] === LEG.stairs;
    if (!stairs && !paths.has(c)) continue;
    let on = 0, all = 0, at = null;
    const test = stairs ? underStairs : onPaving;
    for (const p of parts(o)) walk(p.pts, false, 0.25, (x, y, l) => { all += l; if (test(x, y)) { on += l; at = at || [x, y]; } });
    if (!all) continue;
    if (!stairs && on >= 0.5) out.push({ kind: "paved", o, at, msg: t("map.chk.pathPaved", { s: numLabel(o.sym), l: nf(on, 1) }) });
    if (stairs && on / all < LEG.stairsOnPavingShare) out.push({ kind: "stairs", o, msg: t("map.chk.stairs", { p: nf((100 * on) / all) }) });
  }
}

export async function act(E, act) {
  if (act === "check-run" || act === "check-legibility") {
    E.issues = run(E).filter((x) => act !== "check-legibility" || ["area", "length", "contour", "gap", "paved", "stairs"].includes(x.kind));
    E.issueAt = -1;
    E.issuesHtml = issuesHtml;
    const P = await import("./panels.js"); E._rtab = "issues"; P.drawRight(E);
    E.say(E.issues.length ? tn("map.chk.found", E.issues.length) : t("map.chk.none"));
    return;
  }
  if (act === "check-next") {
    if (!E.issues) E.issues = run(E);
    if (!E.issues.length) { E.say(t("map.chk.none")); return; }
    E.issueAt = (E.issueAt + 1) % E.issues.length;
    go(E, E.issues[E.issueAt]);
    return;
  }
  if (act === "stats") return stats(E);
}
export function go(E, x) {
  const o = E.live.object(x.o.id);
  if (!o) return;
  E.sel.clear(); E.sel.add(o.id); E.selChanged();
  const b = o.bb || [x.at[0] - 5, x.at[1] - 5, x.at[0] + 5, x.at[1] + 5], w = Math.max(20, b[2] - b[0]) * 2, h = Math.max(20, b[3] - b[1]) * 2;
  const cx = x.at ? x.at[0] : (b[0] + b[2]) / 2, cy = x.at ? x.at[1] : (b[1] + b[3]) / 2;
  E.view.fit([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 0);
  E.say(x.msg);
}
export function issuesHtml(E) {
  const list = E.issues || [];
  if (!list.length) return `<p class="mp-empty">${esc(t("map.chk.none"))}</p><button type="button" class="btn btn-sm" data-sact="check-run">${esc(t("map.rib.check-run"))}</button>`;
  return `<p class="mp-hint">${esc(tn("map.chk.found", list.length))}</p><ol class="mp-issues">${list.map((x, i) => `<li class="${x.soft ? "soft" : ""}"><button type="button" data-issue="${i}">${esc(x.msg)}</button></li>`).join("")}</ol>
    <button type="button" class="btn btn-sm" data-sact="check-run">${esc(t("map.chk.again"))}</button>`;
}
async function stats(E) {
  const k = E.doc.scale / 1000;
  const by = new Map();
  for (const o of E.doc.objects) {
    if (o.sym <= 0) continue;
    const r = by.get(o.sym) || { n: 0, len: 0, area: 0 };
    r.n++;
    const parts = G.partsOf(o.coords);
    if (o.otp === 2 && parts.length) r.len += G.polyLength(G.flatten(parts[0].pts, 0.1)) * k;
    if (o.otp === 3 && parts.length) r.area += Math.abs(G.ringArea(G.flatten(parts[0].pts, 0.1))) * k * k;
    by.set(o.sym, r);
  }
  const rows = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([sym, r]) => `<tr><td>${esc(numLabel(sym))}</td><td>${esc(symName(E.live.symbol(sym)))}</td><td>${nf(r.n)}</td><td>${r.len ? nf(r.len) + " m" : ""}</td><td>${r.area ? nf(r.area / 1e4, 2) + " ha" : ""}</td></tr>`).join("");
  const srcs = new Map(); for (const o of E.doc.objects) if (o.src) srcs.set(o.src, (srcs.get(o.src) || 0) + 1);
  await modal(E, { title: t("map.rib.stats"), wide: true, cancel: "", ok: t("map.dlg.close"), body: `<p>${esc(tn("map.stats.objects", E.doc.objects.length))}${srcs.size ? " · " + [...srcs].map(([s, n]) => `${t(`map.src.${s}`)} ${nf(n)}`).join(", ") : ""}</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>${esc(t("map.stats.n"))}</th><th>${esc(t("map.stats.symbol"))}</th><th>${esc(t("map.stats.count"))}</th><th>${esc(t("map.stats.length"))}</th><th>${esc(t("map.stats.area"))}</th></tr></thead><tbody>${rows}</tbody></table></div>` });
}

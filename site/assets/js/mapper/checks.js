// Cartographier's checks (« Vérifier »): what the IOF's specifications ask of a map that the eye misses — areas and lines under
// their symbol's minimum size (the symbol's `min`, else the specifications' table sets/minimums.json), contours drawn closer than
// can be read, objects whose symbol the map no longer has, the same object twice, objects with too few points, drafts not yet
// accepted. Each finding leads to its place (« Suivant » goes through them); the counts by symbol, part and source (« Statistiques »).

import * as G from "./geom.js";
import { minimumOf, numLabel, symName } from "./panels.js";
import { modal } from "../tracer/dialogs.js";
import { t, tn, locale } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const CONTOURS = new Set([101000, 102000, 103000]);

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
  return out;
}

export async function act(E, act) {
  if (act === "check-run" || act === "check-legibility") {
    E.issues = run(E).filter((x) => act !== "check-legibility" || ["area", "length", "contour"].includes(x.kind));
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

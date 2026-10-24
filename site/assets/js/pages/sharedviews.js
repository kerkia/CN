// « Analyse multi »'s views under the replay (pages/shared.js), as tabs: the splits table against a chosen runner (the
// duel), and one runner's legs as « Analyse solo » shows them — time, rank, the time lost by the split-times page's rule
// (trace/legs.js), the route's length against the straight line, the pace. Only positions and times are shared: no heart
// rate or cadence here for anyone (one's own stay in « Mes courbes », on one's device).
//
// X, the replay's context: runners (all, each { uid, name, colour, visible, passes, start, finish, tr, fit, mine }),
// ctrls, legsN, ctrlLabel(i), legName(j), legTime(r, j), total(r), fieldLegs() (the field's leg times and their source),
// state (tab, ref, legsOf: the replay's choices), setLeg(j), changed() (the address and the map follow).

import { html, raw, $, $$, fmt, pctN } from "../util.js";
import { t } from "../i18n.js";
import { clock } from "./provisional.js";
import { cumAt } from "../trace/track.js";
import { toM } from "../trace/geom.js";
import { bestLegs, legLoss } from "../trace/legs.js";
import { pace } from "../trace/curves.js";

export const signed = (s) => (s == null ? "—" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const detour = (dist, straight) => { const p = (100 * dist) / straight - 100; return `${p >= 0 ? "+" : "−"}${pctN(Math.abs(p))}`; };

export const TABS = ["splits", "legs"];

/** The tabs and their panel in `el`; returns { draw() } — a full redraw (the runners shown, the leg, the reference changed). */
export function views(el, X) {
  const tabs = () => TABS.filter((k) => !X.tabOk || X.tabOk(k));
  function draw() {
    const list = tabs();
    if (!list.includes(X.state.tab)) X.state.tab = list[0];
    el.innerHTML = html`<nav class="page-tabs sh-vtabs" role="tablist">${list.map((k) => html`<button type="button" role="tab" data-vtab="${k}" aria-selected="${k === X.state.tab}">${t(`sh.v.${k}`)}</button>`)}</nav>
      <div id="sh-vbody"></div>`;
    $$("[data-vtab]", el).forEach((b) => b.addEventListener("click", () => { X.state.tab = b.dataset.vtab; draw(); X.changed(); }));
    const body = $("#sh-vbody", el);
    if (X.state.tab === "legs") legsView(body, X);
    else splitsView(body, X);
  }
  return { draw };
}

// ---- the splits table, against a reference (the duel)
function splitsView(el, X) {
  const { legsN, ctrlLabel, legTime, total } = X;
  const R = X.runners.filter((r) => r.visible), ref = X.state.ref;
  if (!R.length || legsN < 1) { el.innerHTML = html`<div class="empty">${t("sh.noTraces")}</div>`; return; }
  const best = Array.from({ length: legsN }, (_, j) => Math.min(...R.map((r) => legTime(r, j + 1) ?? 1e9)));
  const rankOf = (r, j) => { const v = legTime(r, j); return v == null ? null : 1 + R.filter((x) => (legTime(x, j) ?? 1e9) < v).length; };
  el.innerHTML = html`<div class="card-head"><div class="hint">${t("sh.splits.hint")}</div>
      <label class="field" style="margin-left:auto"><span>${t("sh.ref")}</span><select id="sh-ref"><option value="">—</option>${R.map((r) => html`<option value="${r.uid}" ${raw(r === ref ? "selected" : "")}>${r.name}</option>`)}</select></label></div>
    <div class="table-wrap"><table class="data compact sh-splits"><thead><tr><th>${t("prov.name")}</th>${Array.from({ length: legsN }, (_, j) => html`<th class="r" data-legh="${j + 1}" style="cursor:pointer">${ctrlLabel(j + 1)}</th>`)}<th class="r">${t("an.total")}</th></tr></thead>
    <tbody>${R.map((r) => html`<tr><td><span class="sh-swatch" style="background:${r.colour}"></span> ${r.name}${r.published ? html` <span class="tag" title="${t("sh.pub.tip")}">${t("sh.pub")}</span>` : ""}</td>
      ${Array.from({ length: legsN }, (_, j) => { const v = legTime(r, j + 1), c = r.passes[j + 1] != null ? r.passes[j + 1] - r.start : null, rv = ref && ref !== r ? legTime(ref, j + 1) : null;
        return html`<td class="r num${v != null && v === best[j] ? " sh-best" : ""}">${v != null ? html`${clock(v)} <span class="muted">(${rankOf(r, j + 1)})</span>` : "—"}
          <div class="sh-sub muted">${c != null ? clock(c) : ""}${v != null && rv != null ? html` <span class="${v > rv ? "delta-down" : "delta-up"}">${signed(v - rv)}</span>` : ""}</div></td>`; })}
      <td class="r num"><b>${total(r) != null ? clock(total(r)) : "—"}</b>${ref && ref !== r && total(r) != null && total(ref) != null ? html`<div class="sh-sub ${total(r) > total(ref) ? "delta-down" : "delta-up"}">${signed(total(r) - total(ref))}</div>` : ""}</td></tr>`)}</tbody></table></div>`;
  $("#sh-ref", el).addEventListener("change", (e) => { X.state.ref = X.runners.find((r) => r.uid === Number(e.target.value)) || null; X.refChanged(); });
  $$("[data-legh]", el).forEach((th) => th.addEventListener("click", () => X.setLeg(Number(th.dataset.legh))));
}

// ---- one runner's legs, as « Analyse solo » (time lost, detour, pace)
function legsView(el, X) {
  const { legsN, ctrls, ctrlLabel, legTime } = X;
  const R = X.runners.filter((r) => r.passes.some((p) => p != null));
  if (!R.length || legsN < 1) { el.innerHTML = html`<div class="empty">${t("sh.noTraces")}</div>`; return; }
  const who = R.find((r) => r.uid === X.state.legsOf) || X.state.sel || R.find((r) => r.mine) || R[0];
  const field = X.fieldLegs(), best = bestLegs(field.all, legsN);
  const mine = Array.from({ length: legsN }, (_, i) => legTime(who, i + 1));
  const loss = legLoss(mine, best);
  const rows = mine.map((v, i) => {
    const j = i + 1, a = who.passes[j - 1], b = who.passes[j];
    const dist = v != null ? cumAt(who.tr, b) - cumAt(who.tr, a) : null;
    const p = toM(who.fit, ctrls[j - 1].x, ctrls[j - 1].y), q = toM(who.fit, ctrls[j].x, ctrls[j].y), straight = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const rank = v != null ? 1 + field.all.filter((l) => l[i] != null && l[i] < v).length : null;
    return { j, time: v, best: best[i], rank, n: field.all.filter((l) => l[i] != null).length, ...loss[i], dist, straight, v: v > 0 && dist != null ? dist / v : null };
  });
  const sum = rows.reduce((s, l) => ({ time: s.time + (l.time || 0), dist: s.dist + (l.dist || 0), straight: s.straight + (l.time != null ? l.straight : 0), lost: s.lost + (l.mistake ? l.lost : 0), n: s.n + (l.mistake ? 1 : 0) }), { time: 0, dist: 0, straight: 0, lost: 0, n: 0 });
  el.innerHTML = html`<div class="card-head"><div class="hint">${t("sh.legs.hint", { src: t(`sh.legs.src.${field.source}`) })}</div>
      <label class="field" style="margin-left:auto"><span>${t("prov.runner")}</span><select id="sh-legs-of">${R.map((r) => html`<option value="${r.uid}" ${raw(r === who ? "selected" : "")}>${r.name}</option>`)}</select></label></div>
    <div class="table-wrap"><table class="data compact sh-legs"><thead><tr><th>${t("an.col.leg")}</th><th class="r">${t("an.col.time")}</th><th class="r">${t("an.col.best")}</th>
      <th class="r">${t("an.col.rank")}</th><th class="r">${t("an.col.lost")}</th><th class="r">${t("an.col.trace")}</th><th class="r">${t("an.col.straight")}</th><th class="r">${t("an.col.detour")}</th><th class="r">${t("an.col.pace")}</th></tr></thead>
    <tbody>${rows.map((l) => html`<tr data-leg="${l.j}" class="${l.mistake ? "an-mistake" : ""}" style="cursor:pointer">
      <td>${ctrlLabel(l.j)}${ctrls[l.j].code ? html` <span class="muted">${ctrls[l.j].code}</span>` : ""}</td>
      <td class="r num">${l.time != null ? clock(l.time) : "—"}</td><td class="r num">${l.best != null ? clock(l.best) : "—"}</td>
      <td class="r num">${l.rank != null ? html`${l.rank}<span class="muted">/${l.n}</span>` : "—"}</td>
      <td class="r num${l.mistake ? " an-lost" : ""}">${l.lost != null ? signed(Math.round(l.lost)) : "—"}</td>
      <td class="r num">${l.dist != null ? html`${fmt(l.dist)} m` : "—"}</td><td class="r num">${fmt(l.straight)} m</td>
      <td class="r num">${l.dist != null && l.straight > 0 ? detour(l.dist, l.straight) : "—"}</td><td class="r num">${l.v != null ? pace(l.v) : "—"}</td></tr>`)}</tbody>
    <tfoot><tr><td>${t("an.total")}</td><td class="r num">${clock(sum.time)}</td><td></td><td></td>
      <td class="r num">${sum.n ? `${signed(Math.round(sum.lost))} (${sum.n})` : "—"}</td><td class="r num">${fmt(sum.dist)} m</td><td class="r num">${fmt(sum.straight)} m</td>
      <td class="r num">${sum.dist && sum.straight ? detour(sum.dist, sum.straight) : "—"}</td><td class="r num">${sum.time && sum.dist ? pace(sum.dist / sum.time) : "—"}</td></tr></tfoot></table></div>
    <p class="hint" style="margin:6px 2px 0">${t("sh.legs.rule")}</p>`;
  $("#sh-legs-of", el).addEventListener("change", (e) => { X.state.legsOf = Number(e.target.value); legsView(el, X); X.changed(); });
  $$("tr[data-leg]", el).forEach((tr) => tr.addEventListener("click", () => X.setLeg(Number(tr.dataset.leg))));
}

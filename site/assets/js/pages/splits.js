// Temps intermédiaires (administrators only, a pilot): the split times organisers publish (WinSplits, their own split
// files), circuit by circuit — each leg's time and rank, the cumulative time and rank, the time lost on each leg against
// the best, and the gap to the leader along the course for the runners picked.
//
// Time lost on a leg: the runner's leg time less what it would have been at their own pace on their good legs — their
// "ideal" is the best leg time × the median of their leg-time / best-leg-time ratios. A leg run 20 % slower than that is
// flagged. This is the classic split analysis (WinSplits' "time loss"), not a judgement on route choice.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { lineChart, slotColor } from "../charts.js";
import { chartCard, bindChartCard, legend } from "../ui.js";
import { link, replaceQuery } from "../app.js";
import { getProv, clock } from "./provisional.js";

const signed = (s) => (s == null ? "" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

export async function render(main, { query = {} } = {}) {
  if (!auth.session()?.admin) {
    main.innerHTML = html`<div class="notice">${t("ad.forbidden")}</div>`;
    return { title: t("spl.title") };
  }
  const idx = await getProv("index.json");
  const withSplits = (idx?.races || []).filter((r) => r.splits);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("spl.title")}</h1><p class="lede">${t("spl.lede")}</p></div>
      <a class="btn btn-sm" href="#/provisoires">← ${t("prov.title")}</a></div>
    <div class="filters" id="sp-pick"></div>
    <div id="sp-body"></div>`;
  if (!withSplits.length) {
    $("#sp-body").innerHTML = html`<div class="card"><div class="empty">${t("spl.none")}</div></div>`;
    return { title: t("spl.title") };
  }
  let key = withSplits.some((r) => r.key === query.course) ? query.course : withSplits[0].key;
  let race = null, docs = [], di = Number(query.doc) || 0, ci = Number(query.c) || 0, picked = null;

  async function loadRace() {
    race = await getProv(`${encodeURIComponent(key)}.json`);
    docs = (race?.docs || []).filter((d) => d.classes?.some((k) => k.runners.some((r) => r.splits)));
  }
  function pickers() {
    $("#sp-pick").innerHTML = html`
      <label class="field"><span>${t("prov.race")}</span><select id="sp-race" style="max-width:420px">${withSplits.map((r) => html`<option value="${r.key}" ${raw(r.key === key ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}</option>`)}</select></label>
      ${docs.length > 1 ? html`<label class="field"><span>${t("prov.doc")}</span><select id="sp-doc" style="max-width:320px">${docs.map((d, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${d.source} · ${d.title || decodeURIComponent(d.url.split("/").pop())}</option>`)}</select></label>` : ""}
      <label class="field"><span>${t("prov.circuit")}</span><select id="sp-c">${docs[di].classes.map((k, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")} ${raw(k.runners.some((r) => r.splits) ? "" : "disabled")}>${k.name} (${k.runners.length})</option>`)}</select></label>`;
    $("#sp-race").addEventListener("change", async (e) => { key = e.target.value; di = 0; ci = 0; picked = null; await loadRace(); fixIndexes(); pickers(); draw(); });
    $("#sp-doc")?.addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; picked = null; fixIndexes(); pickers(); draw(); });
    $("#sp-c").addEventListener("change", (e) => { ci = Number(e.target.value); picked = null; draw(); });
  }
  function fixIndexes() {
    di = docs[di] ? di : 0;
    const ks = docs[di].classes;
    if (!ks[ci]?.runners.some((r) => r.splits)) ci = Math.max(0, ks.findIndex((k) => k.runners.some((r) => r.splits)));
  }

  function draw() {
    const k = docs[di].classes[ci];
    replaceQuery({ course: key, doc: di || null, c: ci || null });
    const n = k.controls?.length || Math.max(...k.runners.map((r) => r.splits?.length || 0));
    const codes = k.controls || Array.from({ length: n }, (_, i) => String(i + 1));
    // cumulative times with the finish as the last "control"; legs between them
    const R = k.runners.filter((r) => r.splits).map((r) => {
      const cum = [...r.splits.slice(0, n), r.status === "ok" ? r.time_s : null];
      const legs = cum.map((c, i) => (c != null && (i === 0 || cum[i - 1] != null) ? c - (i ? cum[i - 1] : 0) : null));
      return { r, cum, legs };
    });
    const L = n + 1;
    const best = Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x.legs[i]).filter((v) => v != null && v > 0)));
    const bestCum = Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x.cum[i]).filter((v) => v != null)));
    const rankOf = (vals, v) => (v == null ? null : 1 + vals.filter((x) => x != null && x < v).length);
    for (const x of R) {
      x.legRank = x.legs.map((v, i) => rankOf(R.map((y) => y.legs[i]), v));
      x.cumRank = x.cum.map((v, i) => rankOf(R.map((y) => y.cum[i]), v));
      const ratio = median(x.legs.map((v, i) => (v != null && isFinite(best[i]) ? v / best[i] : null)));
      x.lost = x.legs.map((v, i) => (v != null && ratio && isFinite(best[i]) ? Math.max(0, v - best[i] * ratio) : null));
      x.lostTotal = x.lost.reduce((s, v) => s + (v || 0), 0);
    }
    const ok = R.filter((x) => x.r.status === "ok").sort((a, b) => a.r.time_s - b.r.time_s);
    if (!picked) picked = new Set(ok.slice(0, 5).map((x) => x.r.name));
    const label = (i) => (i === n ? t("spl.finish") : `${i + 1} (${codes[i]})`);

    $("#sp-body").innerHTML = html`
      ${chartCard({ id: "sp-gap", title: t("spl.gap"), hint: t("spl.gap.hint") })}
      <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>${k.name} · ${fmt(R.length)} ${t("prov.runners").toLowerCase()}</h2>
        <div class="hint">${t("spl.table.hint")}</div></div></div>
        <div class="table-wrap"><table class="data compact splits"><thead><tr><th></th><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
          <th class="r">${t("prov.time")}</th><th class="r" title="${t("spl.lost.hint")}">${t("spl.lost")}</th>
          ${Array.from({ length: L }, (_, i) => html`<th class="r">${label(i)}</th>`)}</tr></thead>
        <tbody>${R.sort((a, b) => (a.r.place ?? 999) - (b.r.place ?? 999)).map((x) => html`<tr>
          <td><input type="checkbox" data-pick="${x.r.name}" ${raw(picked.has(x.r.name) ? "checked" : "")} aria-label="${t("spl.pick")}"></td>
          <td class="r num">${x.r.place ?? ""}</td>
          <td style="white-space:nowrap">${x.r.lic ? html`<a href="${link.runner(x.r.lic)}">${x.r.name}</a>` : x.r.name}<div class="muted" style="font-size:11.5px">${x.r.club || ""}</div></td>
          <td class="r num">${x.r.status === "ok" ? clock(x.r.time_s) : x.r.status.toUpperCase()}</td>
          <td class="r num">${x.lostTotal ? clock(x.lostTotal) : "—"}</td>
          ${x.legs.map((v, i) => {
            const isBest = v != null && v === best[i];
            const slow = x.lost[i] != null && x.legs[i] && x.lost[i] > 0.2 * x.legs[i] && x.lost[i] >= 10;
            return html`<td class="r num" style="${raw(isBest ? "background:color-mix(in srgb, var(--good) 16%, transparent)" : slow ? "background:color-mix(in srgb, var(--bad) 12%, transparent)" : "")}">
              ${v == null ? "—" : html`${clock(v)} <span class="muted" style="font-size:11px">${x.legRank[i]}</span>`}
              <div class="muted" style="font-size:11px">${x.cum[i] == null ? "" : html`${clock(x.cum[i])} (${x.cumRank[i]})`}</div></td>`;
          })}</tr>`)}</tbody></table></div></section>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("spl.def")}</p>`;
    bindChartCard(main, "sp-gap");
    $$("[data-pick]").forEach((b) => b.addEventListener("change", () => {
      b.checked ? picked.add(b.dataset.pick) : picked.delete(b.dataset.pick);
      drawChart();
    }));
    function drawChart() {
      const sel = R.filter((x) => picked.has(x.r.name));
      const series = sel.map((x, i) => ({ name: x.r.name, color: slotColor(i), data: x.cum.map((c, j) => (c == null ? null : c - bestCum[j])) }));
      $("#sp-gap-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
      lineChart($("#sp-gap"), { categories: ["D", ...Array.from({ length: L }, (_, i) => label(i))],
        series: series.map((s) => ({ ...s, data: [0, ...s.data] })), yName: t("spl.behind"), fmtY: (v) => clock(v), inverse: true });
      $("#sp-gap-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("prov.name")}</th>${Array.from({ length: L }, (_, i) => html`<th class="r">${label(i)}</th>`)}</tr></thead>
        <tbody>${series.map((s) => html`<tr><td>${s.name}</td>${s.data.map((v) => html`<td class="r num">${v == null ? "—" : signed(v)}</td>`)}</tr>`)}</tbody></table>`;
    }
    drawChart();
  }

  await loadRace();
  if (!docs.length) { $("#sp-body").innerHTML = html`<div class="card"><div class="empty">${t("spl.none")}</div></div>`; return { title: t("spl.title") }; }
  fixIndexes();
  pickers();
  draw();
  return { title: t("spl.title") };
}

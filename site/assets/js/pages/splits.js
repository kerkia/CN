// Temps intermédiaires (from « Récemment »): the split times organisers publish (WinSplits, their own split
// files), circuit by circuit, in six views (most after WinSplits Pro's analyses):
// - Tableau: each leg's time and rank, the cumulative time and rank, the time lost on each leg;
// - Écarts: for the runners picked, the gap to a reference along the course — the best cumulative time at each control,
//   the sum of the best leg times (+ 0 to 100 %, as SplitsBrowser's "fastest time"), the winner or any runner — or
//   their place after each control, or their rank on each leg;
// - Inter-postes: leg by leg, the best and median times, how many runners made a mistake and the time lost there, the
//   leader after it — the tricky legs stand out;
// - Profil: for the runners picked, each leg as a percentage behind the best — where each one ran well or badly;
// - Face-à-face: for the runners picked, the legs each one won against each other one;
// - Groupes: who ran with whom. From the 1st control to the last one (the starts are apart by design, and the run-in to
//   the finish is everyone's), two runners — of any circuit
//   of the document, on the same leg (same pair of control codes) — who left a control and reached the next one within
//   a few seconds of each other ran that leg together; the one who punched first was in front. Needs the start times
//   (WinSplits' .spl files, liveresultat, IOF XML);
// - Bilan: one row per runner (legs won, mean leg rank, mistakes, time lost, usual pace, regularity, duels won).
//
// Time lost on a leg: the runner's leg time less what it would have been at their own pace on their good legs — their
// "ideal" is the best leg time × the median of their leg-time / best-leg-time ratios. A leg run 20 % slower than that,
// with 10 s lost at least, is a mistake. This is the classic split analysis (WinSplits' "time loss"), not a judgement
// on route choice. « Sans temps perdu » takes each leg's lost time off: the table, the ranks and the gaps then show the
// race as if every runner had run each leg at their own pace.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import { lineChart, columnChart, slotColor, css } from "../charts.js";
import { seg, chartCard, bindChartCard, legend, dataTable } from "../ui.js";
import { link, replaceQuery } from "../app.js";
import { getProv, clock } from "./provisional.js";
import * as local from "../local.js";

const VIEWS = ["table", "gaps", "legs", "profile", "h2h", "groups", "summary"];
const TOLS = [5, 10, 15, 20];               // seconds apart at both controls: "together"
const TIMED = ["table", "gaps"];          // the views « Sans temps perdu » applies to
const GRAPHS = ["gap", "pos", "legpos"];
const REFS = ["cum", "legs", "legs5", "legs25", "legs50", "legs100", "winner", "runner"];
const signed = (s) => (s == null ? "" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const behind = (ratio) => (ratio == null ? null : (ratio - 1) * 100);           // % behind the best
const pct = (v, d = 0) => (v == null ? "—" : `${v > 0 && d >= 0 ? "+" : ""}${fmt(v, d)} %`);
const GOOD = "background:color-mix(in srgb, var(--good) 16%, transparent)";
const BAD = "background:color-mix(in srgb, var(--bad) 12%, transparent)";

export async function render(main, { query = {} } = {}) {
  // the results file read on « Déposer », not published: it alone (local.js)
  const mine = query.course === local.LOCAL ? local.race() : null;
  const idx = mine || query.course === local.LOCAL ? null : await getProv("index.json");
  const withSplits = mine ? (mine.splits ? [mine] : []) : (idx?.races || []).filter((r) => r.splits);
  main.innerHTML = html`
    <div class="crumbs" id="sp-crumbs"></div>
    <div class="page-head"><div><h1>${t("spl.title")}</h1><p class="lede">${t("spl.lede")}</p></div></div>
    <div class="filters" id="sp-pick"></div>
    <div class="filters" id="sp-views"></div>
    <div id="sp-body"></div>`;
  if (!withSplits.length) {
    $("#sp-body").innerHTML = html`<div class="card"><div class="empty">${query.course === local.LOCAL
      ? html`${t("dep.gone")} <a href="#/deposer">${t("dep.title")}</a>` : t("spl.none")}</div></div>`;
    return { title: t("spl.title") };
  }
  let key = withSplits.some((r) => r.key === query.course) ? query.course : withSplits[0].key;
  let race = null, docs = [], di = Number(query.doc) || 0, ci = Number(query.c) || 0, picked = null, ideal = query.v === "ideal";
  let view = VIEWS.includes(query.vw) ? query.vw : "table", club = query.cl || "";
  let graph = GRAPHS.includes(query.g) ? query.g : "gap", ref = REFS.includes(query.ref) ? query.ref : "cum", refName = query.rr || "";
  let tol = TOLS.includes(Number(query.tol)) ? Number(query.tol) : 10;

  async function loadRace() {
    race = key === local.LOCAL ? local.race() : await getProv(`${encodeURIComponent(key)}.json`);
    docs = (race?.docs || []).filter((d) => d.classes?.some((k) => k.runners.some((r) => r.splits)));
  }
  function pickers() {
    const r = withSplits.find((x) => x.key === key);
    const k = docs[di].classes[ci];
    const clubs = [...new Set(k.runners.filter((x) => x.splits).map((x) => x.club).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    if (club && !clubs.includes(club)) club = "";
    $("#sp-crumbs").innerHTML = key === local.LOCAL
      ? html`<a href="#/recemment">${t("prov.title")}</a><span>›</span><a href="#/deposer">${t("dep.title")}</a><span>›</span>
        <span>${r?.name || ""}</span><span>›</span><span>${t("spl.title")}</span>`
      : html`<a href="#/recemment">${t("prov.title")}</a><span>›</span>
      <a href="#/recemment?course=${encodeURIComponent(key)}">${r?.name || key}</a><span>›</span><span>${t("spl.title")}</span>`;
    $("#sp-pick").innerHTML = html`
      ${key === local.LOCAL ? html`<div class="field"><span>${t("dep.file")}</span><span class="pill">${r?.name || ""}</span></div>`
        : html`<label class="field"><span>${t("prov.race")}</span><select id="sp-race" style="max-width:420px">${withSplits.map((r) => html`<option value="${r.key}" ${raw(r.key === key ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}</option>`)}</select></label>`}
      ${docs.length > 1 ? html`<label class="field"><span>${t("prov.doc")}</span><select id="sp-doc" style="max-width:320px">${docs.map((d, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${d.source} · ${d.title || decodeURIComponent(d.url.split("/").pop())}</option>`)}</select></label>` : ""}
      <label class="field"><span>${t("prov.circuit")}</span><select id="sp-c">${docs[di].classes.map((k, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")} ${raw(k.runners.some((r) => r.splits) ? "" : "disabled")}>${k.name} (${k.runners.length})</option>`)}</select></label>
      <label class="field"><span>${t("spl.club")}</span><select id="sp-club" style="max-width:260px"><option value="">${t("f.allm")}</option>
        ${clubs.map((c) => html`<option value="${c}" ${raw(c === club ? "selected" : "")}>${c}</option>`)}</select></label>`;
    $("#sp-views").innerHTML = html`<div class="field"><span>${t("spl.tab")}</span>${seg("spw", VIEWS.map((v) => [v, t(`spl.tab.${v}`)]), view)}</div>
      ${TIMED.includes(view) ? html`<div class="field"><span>${t("spl.view")}</span>${seg("spv", [["real", t("spl.view.real")], ["ideal", t("spl.view.ideal")]], ideal ? "ideal" : "real")}</div>` : ""}
      ${view === "gaps" ? html`<label class="field"><span>${t("spl.graph")}</span><select id="sp-graph">${GRAPHS.map((g) => html`<option value="${g}" ${raw(g === graph ? "selected" : "")}>${t(`spl.graph.${g}`)}</option>`)}</select></label>
        ${graph === "gap" ? html`<label class="field"><span>${t("spl.ref")}</span><select id="sp-ref">${REFS.map((x) => html`<option value="${x}" ${raw(x === ref ? "selected" : "")}>${t(`spl.ref.${x}`)}</option>`)}</select></label>` : ""}
        ${graph === "gap" && ref === "runner" ? html`<label class="field"><span>${t("prov.runner")}</span><select id="sp-rr" style="max-width:240px">${k.runners.filter((x) => x.splits)
          .sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999)).map((x) => html`<option value="${x.name}" ${raw(x.name === refName ? "selected" : "")}>${x.place ? `${x.place}. ` : ""}${x.name}</option>`)}</select></label>` : ""}` : ""}
      ${view === "groups" ? html`<label class="field"><span>${t("spl.grp.tol")}</span><select id="sp-tol">${TOLS.map((s) => html`<option value="${s}" ${raw(s === tol ? "selected" : "")}>${s} s</option>`)}</select></label>` : ""}`;
    $("#sp-race")?.addEventListener("change", async (e) => { key = e.target.value; di = 0; ci = 0; picked = null; await loadRace(); fixIndexes(); pickers(); draw(); });
    $("#sp-doc")?.addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; picked = null; fixIndexes(); pickers(); draw(); });
    $("#sp-c").addEventListener("change", (e) => { ci = Number(e.target.value); picked = null; pickers(); draw(); });
    $("#sp-club").addEventListener("change", (e) => { club = e.target.value; picked = null; draw(); });
    $$('[data-seg="spw"]').forEach((b) => b.addEventListener("click", () => { view = b.dataset.value; pickers(); draw(); }));
    $$('[data-seg="spv"]').forEach((b) => b.addEventListener("click", () => { ideal = b.dataset.value === "ideal"; pickers(); draw(); }));
    $("#sp-graph")?.addEventListener("change", (e) => { graph = e.target.value; pickers(); draw(); });
    $("#sp-ref")?.addEventListener("change", (e) => { ref = e.target.value; pickers(); draw(); });
    $("#sp-rr")?.addEventListener("change", (e) => { refName = e.target.value; draw(); });
    $("#sp-tol")?.addEventListener("change", (e) => { tol = Number(e.target.value); draw(); });
  }
  function fixIndexes() {
    di = docs[di] ? di : 0;
    const ks = docs[di].classes;
    if (!ks[ci]?.runners.some((r) => r.splits)) ci = Math.max(0, ks.findIndex((k) => k.runners.some((r) => r.splits)));
  }

  function draw() {
    const k = docs[di].classes[ci];
    const asIdeal = ideal && TIMED.includes(view);
    const gapView = view === "gaps";
    replaceQuery({ course: key, doc: di || null, c: ci || null, vw: view === "table" ? null : view,
      v: asIdeal ? "ideal" : null, cl: club || null, g: gapView && graph !== "gap" ? graph : null,
      ref: gapView && graph === "gap" && ref !== "cum" ? ref : null, rr: gapView && graph === "gap" && ref === "runner" ? refName : null,
      tol: view === "groups" && tol !== 10 ? tol : null });
    const n = k.controls?.length || Math.max(...k.runners.map((r) => r.splits?.length || 0));
    const codes = k.controls || Array.from({ length: n }, (_, i) => String(i + 1));
    // cumulative times with the finish as the last "control"; legs between them
    const R = k.runners.filter((r) => r.splits).map((r) => {
      const cum = [...r.splits.slice(0, n), r.status === "ok" ? r.time_s : null];
      const legs = cum.map((c, i) => (c != null && (i === 0 || cum[i - 1] != null) ? c - (i ? cum[i - 1] : 0) : null));
      return { r, cum, legs };
    });
    const L = n + 1;
    const bestLeg = (key) => Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x[key][i]).filter((v) => v != null && v > 0)));
    const rankOf = (vals, v) => (v == null ? null : 1 + vals.filter((x) => x != null && x < v).length);
    const realBest = bestLeg("legs");
    for (const x of R) {
      x.ratios = x.legs.map((v, i) => (v != null && isFinite(realBest[i]) ? v / realBest[i] : null));
      x.ratio = median(x.ratios);
      x.lost = x.legs.map((v, i) => (v != null && x.ratio && isFinite(realBest[i]) ? Math.max(0, v - realBest[i] * x.ratio) : null));
      x.lostTotal = x.lost.reduce((s, v) => s + (v || 0), 0);
      x.mistake = x.legs.map((v, i) => x.lost[i] != null && v > 0 && x.lost[i] > 0.2 * v && x.lost[i] >= 10);
      x.realLegRank = x.legs.map((v, i) => rankOf(R.map((y) => y.legs[i]), v));
      // without the lost time: each leg less its loss, the cumulative times less the losses so far
      let gone = 0;
      x.idealLegs = x.legs.map((v, i) => (v == null ? null : v - (x.lost[i] || 0)));
      x.idealCum = x.cum.map((c, i) => { gone += x.lost[i] || 0; return c == null ? null : c - gone; });
      x.vLegs = asIdeal ? x.idealLegs : x.legs;
      x.vCum = asIdeal ? x.idealCum : x.cum;
    }
    const best = bestLeg("vLegs");
    const bestCum = Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x.vCum[i]).filter((v) => v != null)));
    for (const x of R) {
      x.legRank = x.vLegs.map((v, i) => rankOf(R.map((y) => y.vLegs[i]), v));
      x.cumRank = x.vCum.map((v, i) => rankOf(R.map((y) => y.vCum[i]), v));
      x.place = asIdeal ? (x.r.status === "ok" ? x.cumRank[n] : null) : x.r.place;
    }
    const byPlace = (xs) => [...xs].sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || (a.r.place ?? 9999) - (b.r.place ?? 9999));
    const shown = club ? R.filter((x) => x.r.club === club) : R;
    if (!picked) picked = new Set(shown.filter((x) => x.r.status === "ok").sort((a, b) => a.r.time_s - b.r.time_s).slice(0, 5).map((x) => x.r.name));
    const sel = () => byPlace(shown.filter((x) => picked.has(x.r.name)));
    const label = (i) => (i === n ? t("spl.finish") : `${i + 1} (${codes[i]})`);
    const legLabels = Array.from({ length: L }, (_, i) => label(i));
    const name = (x) => (x.r.lic ? html`<a href="${link.runner(x.r.lic)}">${x.r.name}</a>` : x.r.name);
    // legs won and lost by a against b, on the legs both ran
    const duel = (a, b) => {
      let w = 0, l = 0;
      for (let i = 0; i < L; i++) {
        if (a.legs[i] == null || b.legs[i] == null) continue;
        if (a.legs[i] < b.legs[i]) w++; else if (a.legs[i] > b.legs[i]) l++;
      }
      return [w, l];
    };
    // the runners the charts and the face-à-face compare: ticked here or in the table
    const chooser = () => html`<section class="card" style="margin-top:16px"><div class="card-head"><div><h2>${t("spl.choose")}</h2>
        <div class="hint">${t("spl.choose.hint")}</div></div></div>
      <div class="card-body" style="max-height:200px;overflow:auto;display:flex;flex-wrap:wrap;gap:4px 16px">${byPlace(shown).map((x) => html`<label style="white-space:nowrap;font-size:13px">
        <input type="checkbox" data-pick="${x.r.name}" ${raw(picked.has(x.r.name) ? "checked" : "")}> ${x.r.place ? `${x.r.place}. ` : ""}${x.r.name}</label>`)}</div></section>`;
    const body = $("#sp-body");
    let redraw = () => {};

    if (view === "table") {
      body.innerHTML = html`
        <section class="card"><div class="card-head"><div><h2>${k.name} · ${fmt(shown.length)} ${t("prov.runners").toLowerCase()}</h2>
          <div class="hint">${t(asIdeal ? "spl.table.hint.ideal" : "spl.table.hint")}</div></div></div>
          <div class="table-wrap"><table class="data compact splits"><thead><tr><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
            <th class="r">${t("prov.time")}</th><th class="r" title="${t("spl.lost.hint")}">${t("spl.lost")}</th>
            ${legLabels.map((l) => html`<th class="r">${l}</th>`)}</tr></thead>
          <tbody>${byPlace(shown).map((x) => html`<tr>
            <td class="r num">${x.place ?? ""}${asIdeal && x.r.place ? html`<div class="muted" style="font-size:11px" title="${t("spl.real")}">${x.r.place}</div>` : ""}</td>
            <td style="white-space:nowrap">${name(x)}<div class="muted" style="font-size:11.5px">${x.r.club || ""}</div></td>
            <td class="r num">${x.r.status !== "ok" ? x.r.status.toUpperCase() : asIdeal
              ? html`${clock(x.vCum[n])}<div class="muted" style="font-size:11px" title="${t("spl.real")}">${clock(x.r.time_s)}</div>` : clock(x.r.time_s)}</td>
            <td class="r num">${x.lostTotal ? clock(x.lostTotal) : "—"}</td>
            ${x.vLegs.map((v, i) => {
              const isBest = v != null && v === best[i];
              const slow = !asIdeal && x.mistake[i];
              const lost = x.lost[i] != null && x.lost[i] >= 0.5 ? x.lost[i] : null;
              return html`<td class="r num" style="${raw(isBest ? GOOD : slow ? BAD : "")}">
                ${v == null ? "—" : html`${clock(v)} <span class="muted" style="font-size:11px">${x.legRank[i]}</span>`}
                <div class="muted" style="font-size:11px">${x.vCum[i] == null ? "" : html`${clock(x.vCum[i])} (${x.cumRank[i]})`}</div>
                ${lost == null ? "" : html`<div class="${lost >= 5 ? "" : "muted"}" style="font-size:11px${raw(lost >= 5 ? ";color:var(--bad)" : "")}" title="${t("spl.lost.leg")}">${asIdeal ? "−" : "+"}${clock(lost)}</div>`}</td>`;
            })}</tr>`)}</tbody></table></div></section>
        <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("spl.def")}</p>`;
    }

    if (view === "gaps") {
      // the reference's cumulative time at each control (the finish last)
      let refCum, refTitle;
      if (ref === "cum") {
        refCum = bestCum.map((v) => (isFinite(v) ? v : null));
        refTitle = t("spl.ref.t.cum");
      } else if (ref.startsWith("legs")) {
        const plus = Number(ref.slice(4)) || 0;
        let acc = 0;
        refCum = best.map((v) => (acc == null || !isFinite(v) ? (acc = null) : (acc += v * (1 + plus / 100))));
        refTitle = plus ? `${t("spl.ref.t.legs")} + ${plus} %` : t("spl.ref.t.legs");
      } else {
        const who = ref === "winner" ? R.find((x) => x.place === 1)
          : R.find((x) => x.r.name === refName) || byPlace(R)[0];
        refCum = who ? who.vCum : Array(L).fill(null);
        refTitle = who ? (ref === "winner" ? `${t("spl.ref.t.winner")} (${who.r.name})` : `${t("spl.ref.t.runner")} ${who.r.name}`) : "—";
      }
      const title = graph === "gap" ? `${t("spl.gapTo")} ${refTitle}` : t(`spl.graph.t.${graph}`);
      body.innerHTML = html`${chartCard({ id: "sp-gap", title: asIdeal ? `${title}, ${t("spl.noLoss")}` : title, hint: t(`spl.graph.hint.${graph}`) })}${chooser()}`;
      bindChartCard(main, "sp-gap");
      redraw = () => {
        const value = graph === "gap" ? (x, j) => (x.vCum[j] == null || refCum[j] == null ? null : x.vCum[j] - refCum[j])
          : graph === "pos" ? (x, j) => x.cumRank[j] : (x, j) => x.legRank[j];
        const series = sel().map((x, i) => ({ name: x.r.name, color: slotColor(i), data: legLabels.map((_, j) => value(x, j)) }));
        const fmtY = graph === "gap" ? (v) => signed(v) : (v) => fmt(v);
        $("#sp-gap-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
        // the gap starts at 0 at the start; the places only exist from the first control
        lineChart($("#sp-gap"), { categories: graph === "gap" ? ["D", ...legLabels] : legLabels,
          series: graph === "gap" ? series.map((s) => ({ ...s, data: [0, ...s.data] })) : series,
          yName: t(`spl.graph.y.${graph}`), fmtY, inverse: true });
        $("#sp-gap-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("prov.name")}</th>${legLabels.map((l) => html`<th class="r">${l}</th>`)}</tr></thead>
          <tbody>${series.map((s) => html`<tr><td>${s.name}</td>${s.data.map((v) => html`<td class="r num">${v == null ? "—" : fmtY(v)}</td>`)}</tr>`)}</tbody></table>`;
      };
    }

    if (view === "legs") {
      // leg by leg, over the whole circuit (the club filter does not apply: a leg's difficulty is everyone's)
      let leader = null;
      const rows = Array.from({ length: L }, (_, i) => {
        const xs = R.filter((x) => x.legs[i] != null);
        const errs = xs.filter((x) => x.mistake[i]);
        const first = R.filter((x) => x.cum[i] != null).sort((a, b) => a.cum[i] - b.cum[i])[0];
        const row = { i, label: label(i), n: xs.length, best: isFinite(realBest[i]) ? realBest[i] : null,
          winners: xs.filter((x) => x.legs[i] === realBest[i]), med: median(xs.map((x) => x.legs[i])),
          errs: errs.length, lostAll: xs.reduce((s, x) => s + (x.lost[i] || 0), 0), errMed: median(errs.map((x) => x.lost[i])),
          leader: first, newLeader: !!first && leader !== first && i > 0 };
        leader = first;
        return row;
      });
      body.innerHTML = html`
        ${chartCard({ id: "sp-legs", title: t("spl.legs.chart"), hint: t("spl.legs.hint") })}
        <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>${t("spl.legs.title")} · ${k.name}</h2>
          <div class="hint">${t("spl.legs.tableHint")}</div></div></div><div id="sp-legs-list"></div></section>
        <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("spl.legs.def")} ${t("spl.def")}</p>`;
      bindChartCard(main, "sp-legs");
      columnChart($("#sp-legs"), { categories: rows.map((r) => r.label),
        series: [{ name: t("spl.lostAll"), color: css("--bad"), data: rows.map((r) => Math.round(r.lostAll / 6) / 10) }], yName: t("spl.min"), digits: 1 });
      $("#sp-legs-legend").innerHTML = "";
      $("#sp-legs-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("spl.leg")}</th><th class="r">${t("spl.lostAll")}</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr><td>${r.label}</td><td class="r num">${clock(r.lostAll)}</td></tr>`)}</tbody></table>`;
      dataTable($("#sp-legs-list"), {
        compact: true, sortKey: "i", sortDir: 1, rows,
        columns: [
          { key: "i", label: t("spl.leg"), sort: (r) => r.i, defaultDir: 1, render: (r) => r.label },
          { key: "best", label: t("spl.best"), align: "r", sort: (r) => r.best, defaultDir: 1,
            render: (r) => html`${clock(r.best)}<div class="muted" style="font-size:11.5px">${r.winners.map((x) => x.r.name).join(", ")}</div>` },
          { key: "med", label: t("spl.median"), align: "r num", sort: (r) => r.med, render: (r) => clock(r.med) },
          { key: "gap", label: t("spl.medianGap"), align: "r num", sort: (r) => (r.best && r.med ? r.med / r.best : null),
            render: (r) => (r.best && r.med ? pct(behind(r.med / r.best)) : "—") },
          { key: "errs", label: t("spl.errors"), align: "r num", sort: (r) => r.errs,
            render: (r) => html`${fmt(r.errs)} <span class="muted" style="font-size:11.5px">/ ${fmt(r.n)}</span>` },
          { key: "lostAll", label: t("spl.lostAll"), align: "r num", sort: (r) => r.lostAll, render: (r) => clock(r.lostAll) },
          { key: "errMed", label: t("spl.errMed"), align: "r num", sort: (r) => r.errMed, render: (r) => (r.errMed == null ? "—" : clock(r.errMed)) },
          { key: "leader", label: t("spl.leader"), render: (r) => (r.leader ? html`${r.leader.r.name}${r.newLeader ? html` <span class="tag">${t("spl.newLeader")}</span>` : ""}` : "—") },
        ],
      });
    }

    if (view === "profile") {
      body.innerHTML = html`${chartCard({ id: "sp-prof", title: t("spl.prof"), hint: t("spl.prof.hint") })}${chooser()}`;
      bindChartCard(main, "sp-prof");
      redraw = () => {
        const xs = sel();
        const series = xs.map((x, i) => ({ name: x.r.name, color: slotColor(i), data: x.ratios.map(behind) }));
        $("#sp-prof-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
        lineChart($("#sp-prof"), { categories: legLabels, series, yName: t("spl.prof.y"), fmtY: (v) => pct(v), inverse: true });
        // each runner's legs from the best to the worst
        $("#sp-prof-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("prov.name")}</th><th class="r">${t("spl.pace")}</th><th>${t("spl.prof.order")}</th></tr></thead>
          <tbody>${xs.map((x) => html`<tr><td style="white-space:nowrap">${x.r.name}</td><td class="r num">${pct(behind(x.ratio))}</td>
            <td style="font-size:12px">${x.ratios.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => a[0] - b[0])
              .map(([v, i]) => html`<span class="tag" style="${raw(x.mistake[i] ? BAD : v === 1 ? GOOD : "")}" title="${label(i)} : ${pct(behind(v))}">${i === n ? t("spl.finish") : i + 1}</span> `)}</td></tr>`)}</tbody></table>`;
      };
    }

    if (view === "h2h") {
      body.innerHTML = html`<section class="card"><div class="card-head"><div><h2>${t("spl.h2h")} · ${k.name}</h2>
        <div class="hint">${t("spl.h2h.hint")}</div></div></div><div class="table-wrap" id="sp-h2h"></div></section>${chooser()}`;
      redraw = () => {
        const xs = sel();
        $("#sp-h2h").innerHTML = xs.length < 2 ? html`<div class="empty">${t("spl.h2h.few")}</div>` : html`<table class="data compact">
          <thead><tr><th></th>${xs.map((_, j) => html`<th class="c">${j + 1}</th>`)}<th class="r" title="${t("spl.duels.hint")}">${t("spl.duels")}</th></tr></thead>
          <tbody>${xs.map((a, i) => {
            const all = R.filter((b) => b !== a).map((b) => duel(a, b));
            return html`<tr><td style="white-space:nowrap"><b>${i + 1}</b> ${name(a)}</td>${xs.map((b) => {
              if (a === b) return html`<td class="c muted">—</td>`;
              const [w, l] = duel(a, b);
              return html`<td class="c num" style="${raw(w > l ? GOOD : w < l ? BAD : "")}" title="${a.r.name} – ${b.r.name}">${w} – ${l}</td>`;
            })}<td class="r num">${fmt(all.filter(([w, l]) => w > l).length)} / ${fmt(all.length)}</td></tr>`;
          })}</tbody></table>`;
      };
    }

    if (view === "groups") {
      // every leg run by anyone of the document from the 2nd control on, by its pair of control codes (a circuit
      // without codes is only compared with itself): [{who, dep, arr}] in clock seconds
      const legKey = (kc, j) => (kc.controls ? `${kc.controls[j - 1]}>${kc.controls[j]}` : `${kc.name}:${j}`);
      const board = new Map();
      for (const kc of docs[di].classes) {
        const m = kc.controls?.length || Math.max(0, ...kc.runners.map((r) => r.splits?.length || 0));
        for (const r of kc.runners) {
          if (r.start_s == null || !r.splits) continue;
          const cum = [...r.splits.slice(0, m), r.status === "ok" ? r.time_s : null];
          for (let j = 1; j < m; j++) {                  // control to control: neither the start nor the finish
            if (cum[j - 1] == null || cum[j] == null) continue;
            const key = legKey(kc, j);
            if (!board.has(key)) board.set(key, []);
            board.get(key).push({ r, cls: kc.name, dep: r.start_s + cum[j - 1], arr: r.start_s + cum[j] });
          }
        }
      }
      const timed = shown.filter((x) => x.r.start_s != null);
      const rows = timed.map((x) => {
        const legs = [];
        let all = 0, inGroup = 0, behindT = 0, gain = 0;
        for (let j = 1; j < n; j++) {
          if (x.cum[j - 1] == null || x.cum[j] == null) { legs.push(null); continue; }
          const dep = x.r.start_s + x.cum[j - 1], arr = x.r.start_s + x.cum[j];
          const mates = (board.get(legKey(k, j)) || []).filter((o) => o.r !== x.r && Math.abs(o.dep - dep) <= tol && Math.abs(o.arr - arr) <= tol);
          const front = mates.every((o) => o.arr >= arr);
          all += x.legs[j];
          if (mates.length) {
            inGroup += x.legs[j];
            if (!front) {
              behindT += x.legs[j];
              if (x.ratio && isFinite(realBest[j])) gain += realBest[j] * x.ratio - x.legs[j];
            }
          }
          legs.push(mates.length ? { mates, front } : { mates });
        }
        // the companions, with the controls between which they were together
        const withs = new Map();
        legs.forEach((g, j) => g?.mates.forEach((o) => {
          const id = `${o.r.name}|${o.cls}`;
          if (!withs.has(id)) withs.set(id, { o, legs: [] });
          withs.get(id).legs.push(j + 1);
        }));
        const spans = (js) => {
          const out = [];
          for (const j of js) {
            const last = out[out.length - 1];
            if (last && last[1] === j - 1) last[1] = j; else out.push([j, j]);
          }
          return out.map(([a, b]) => `${a} → ${b + 1}`).join(", ");
        };
        const mates = [...withs.values()].sort((a, b) => b.legs.length - a.legs.length);
        return { x, legs, place: x.r.place, n: legs.filter((g) => g?.mates.length).length, of: legs.filter(Boolean).length,
          front: legs.filter((g) => g?.mates.length && g.front).length, behind: legs.filter((g) => g?.mates.length && !g.front).length,
          pack: all ? (100 * inGroup) / all : null, follow: all ? (100 * behindT) / all : null, gain: behindT ? gain : null,
          mates: mates.map((m) => ({ name: m.o.r.name, cls: m.o.cls === k.name ? "" : m.o.cls, legs: m.legs.length, span: spans(m.legs) })) };
      });
      const legHead = Array.from({ length: n - 1 }, (_, j) => `${j + 1}–${j + 2}`);
      body.innerHTML = !timed.length ? html`<div class="card"><div class="empty">${t("spl.grp.none")}</div></div>` : html`
        <section class="card"><div class="card-head"><div><h2>${t("spl.grp.title")} · ${k.name}</h2>
          <div class="hint">${t("spl.grp.hint1")} ${tol} ${t("spl.grp.hint2")}</div></div></div><div id="sp-grp"></div></section>
        <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>${t("spl.grp.map")}</h2>
          <div class="hint">${t("spl.grp.map.hint")}</div></div></div>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("prov.name")}</th>${legHead.map((h) => html`<th class="c" style="font-size:11px">${h}</th>`)}</tr></thead>
          <tbody>${[...rows].sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999)).map((g) => html`<tr><td style="white-space:nowrap">${g.place ? `${g.place}. ` : ""}${g.x.r.name}</td>
            ${g.legs.map((c) => (!c ? html`<td class="c muted">·</td>` : !c.mates.length ? html`<td></td>`
              : html`<td class="c num" style="${raw(c.front ? GOOD : BAD)}" title="${c.mates.map((o) => o.r.name + (o.cls === k.name ? "" : ` (${o.cls})`)).join(", ")}">${c.mates.length}</td>`))}</tr>`)}</tbody></table></div></section>
        <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("spl.grp.def")}</p>`;
      if (timed.length) {
        dataTable($("#sp-grp"), {
          compact: true, sortKey: "place", sortDir: 1, rows,
          columns: [
            { key: "place", label: t("prov.place"), align: "r num", sort: (r) => r.place, defaultDir: 1, render: (r) => r.place ?? "" },
            { key: "name", label: t("prov.name"), sort: (r) => r.x.r.name, defaultDir: 1,
              render: (r) => html`<span style="white-space:nowrap">${name(r.x)}</span><div class="muted" style="font-size:11.5px">${r.x.r.club || ""}</div>` },
            { key: "n", label: t("spl.grp.legs"), align: "r num", sort: (r) => r.n, render: (r) => html`${fmt(r.n)} <span class="muted" style="font-size:11.5px">/ ${fmt(r.of)}</span>` },
            { key: "pack", label: t("spl.grp.pack"), align: "r num", sort: (r) => r.pack, render: (r) => (r.pack == null ? "—" : `${fmt(r.pack, 0)} %`) },
            { key: "front", label: t("spl.grp.front"), align: "r num", sort: (r) => r.front, render: (r) => fmt(r.front) },
            { key: "behind", label: t("spl.grp.behind"), align: "r num", sort: (r) => r.behind, render: (r) => fmt(r.behind) },
            { key: "follow", label: t("spl.grp.follow"), align: "r num", sort: (r) => r.follow, render: (r) => (r.follow == null ? "—" : `${fmt(r.follow, 0)} %`) },
            { key: "gain", label: t("spl.grp.gain"), align: "r num", sort: (r) => r.gain, render: (r) => (r.gain == null ? "—" : signed(r.gain)) },
            { key: "mates", label: t("spl.grp.with"), sort: (r) => r.mates.length,
              render: (r) => (r.mates.length ? html`<div style="font-size:12px;min-width:220px">${r.mates.slice(0, 4).map((m) => html`<div>${m.name}${m.cls ? html` <span class="muted">(${m.cls})</span>` : ""} <span class="muted">· ${t("spl.grp.ctl")} ${m.span}</span></div>`)}
                ${r.mates.length > 4 ? html`<div class="muted">+ ${r.mates.length - 4}</div>` : ""}</div>` : html`<span class="muted">—</span>`) },
          ],
        });
      }
    }

    if (view === "summary") {
      const km = k.length_m ? k.length_m / 1000 : null;
      const rows = shown.map((x) => {
        const rs = x.ratios.filter((v) => v != null);
        const mean = rs.length ? rs.reduce((s, v) => s + v, 0) / rs.length : null;
        const sd = rs.length > 1 ? Math.sqrt(rs.reduce((s, v) => s + (v - mean) ** 2, 0) / (rs.length - 1)) : null;
        const ranks = x.realLegRank.filter((v) => v != null);
        const duels = R.filter((b) => b !== x).map((b) => duel(x, b));
        return { x, place: x.r.place, time: x.r.status === "ok" ? x.r.time_s : null,
          won: x.legs.filter((v, i) => v != null && v === realBest[i]).length,
          avgRank: ranks.length ? ranks.reduce((s, v) => s + v, 0) / ranks.length : null,
          errs: x.mistake.filter(Boolean).length, lost: x.lostTotal,
          lostPct: x.r.status === "ok" && x.r.time_s ? (100 * x.lostTotal) / x.r.time_s : null,
          pace: behind(x.ratio), reg: mean && sd != null ? (100 * sd) / mean : null,
          duels: duels.filter(([w, l]) => w > l).length, of: duels.length,
          perKm: km && x.r.status === "ok" ? x.r.time_s / km : null };
      });
      body.innerHTML = html`<section class="card"><div class="card-head"><div><h2>${t("spl.sum")} · ${k.name}</h2>
        <div class="hint">${t("spl.sum.hint")}</div></div></div><div id="sp-sum"></div></section>
        <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("spl.sum.def")} ${t("spl.def")}</p>`;
      dataTable($("#sp-sum"), {
        compact: true, sortKey: "place", sortDir: 1, rows,
        columns: [
          { key: "place", label: t("prov.place"), align: "r num", sort: (r) => r.place, defaultDir: 1, render: (r) => r.place ?? "" },
          { key: "name", label: t("prov.name"), sort: (r) => r.x.r.name, defaultDir: 1,
            render: (r) => html`<span style="white-space:nowrap">${name(r.x)}</span><div class="muted" style="font-size:11.5px">${r.x.r.club || ""}</div>` },
          { key: "time", label: t("prov.time"), align: "r num", sort: (r) => r.time, defaultDir: 1,
            render: (r) => (r.time == null ? r.x.r.status.toUpperCase() : clock(r.time)) },
          ...(km ? [{ key: "perKm", label: t("spl.kmPace"), align: "r num", sort: (r) => r.perKm, defaultDir: 1, render: (r) => (r.perKm == null ? "—" : clock(r.perKm)) }] : []),
          { key: "won", label: t("spl.won"), align: "r num", sort: (r) => r.won, render: (r) => fmt(r.won) },
          { key: "avgRank", label: t("spl.avgRank"), align: "r num", sort: (r) => r.avgRank, defaultDir: 1, render: (r) => fmt(r.avgRank, 1) },
          { key: "errs", label: t("spl.errors"), align: "r num", sort: (r) => r.errs, defaultDir: 1, render: (r) => fmt(r.errs) },
          { key: "lost", label: t("spl.lost"), align: "r num", sort: (r) => r.lost, defaultDir: 1, render: (r) => (r.lost ? clock(r.lost) : "—") },
          { key: "lostPct", label: t("spl.lostPct"), align: "r num", sort: (r) => r.lostPct, defaultDir: 1, render: (r) => (r.lostPct == null ? "—" : `${fmt(r.lostPct, 1)} %`) },
          { key: "pace", label: t("spl.pace"), align: "r num", sort: (r) => r.pace, defaultDir: 1, render: (r) => pct(r.pace) },
          { key: "reg", label: t("spl.reg"), align: "r num", sort: (r) => r.reg, defaultDir: 1, render: (r) => (r.reg == null ? "—" : `${fmt(r.reg, 0)} %`) },
          { key: "duels", label: t("spl.duels"), align: "r num", sort: (r) => r.duels, render: (r) => `${fmt(r.duels)} / ${fmt(r.of)}` },
        ],
      });
    }

    $$("[data-pick]", body).forEach((b) => b.addEventListener("change", () => {
      b.checked ? picked.add(b.dataset.pick) : picked.delete(b.dataset.pick);
      redraw();
    }));
    redraw();
  }

  await loadRace();
  if (!docs.length) { $("#sp-body").innerHTML = html`<div class="card"><div class="empty">${t("spl.none")}</div></div>`; return { title: t("spl.title") }; }
  fixIndexes();
  pickers();
  draw();
  return { title: t("spl.title") };
}

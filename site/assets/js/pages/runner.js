// Runner: identity, headline figures, CN over time, the CN history event by
// event, the race-by-race breakdown at any date, progression against the age
// category, full race history and per-season summary.

import { html, raw, esc, $, $$, fmt, fmtSigned, fmtDate, fmtTime, displayName, initials, addDays, ord, plural } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { R, SCORE_COL, CNAFTER_COL } from "../data.js";
import { explain, cnHistory } from "../cn.js";
import { timeChart, bandChart, methodColor, css } from "../charts.js";
import {
  methodChips, bindMethodChips, chartCard, bindChartCard, legend, dataTable, tile,
  methodLabel, methodShort, statusLabel, seg, errorBox, runnerSearch, bindRunnerSearch, terrainTag,
} from "../ui.js";
import { loadRanking, AGES } from "./ranking.js";
import { monthlyProgress, seasonEnds, curveKey } from "../progress.js";
import { link, replaceQuery } from "../app.js";
import * as auth from "../auth.js";

export async function render(main, { arg, query }) {
  // #/coureur alone opens the runner last looked at, else the logged-in runner
  const lic = arg || store.get().lastRunner || auth.session()?.lic;
  if (!lic) return pickRunner(main);
  const person = data.runner(lic);
  if (!person) { main.innerHTML = errorBox(t("err.notfound")); return; }
  if (!arg) replaceQuery({});
  store.set({ lastRunner: lic });
  const [races, ac] = await Promise.all([data.runnerRaces(lic), data.ageCurves()]);
  const meta = data.meta();
  const terrain = store.get().terrain;
  const mineT = races.filter((r) => r[R.terrain] === terrain);
  let showScores = query.scores !== "0";
  let range = query.range || "all";
  let calcDate = query.d || null;
  let histMethod = null, ref = "all";

  const name = displayName(person.nom);
  // a race opens in the Courses tab, in Coureur mode, on this runner's circuit
  const raceLink = (r) => link.course(r[R.course], { circ: r[R.cid], mode: "runner", r: lic });
  const last = races[races.length - 1];
  const club = last?.[R.club] || person.club;
  const cp = data.clubParts(club);
  const other = terrain === "For" ? "Spr" : "For";

  main.innerHTML = html`
    <section class="card hero" style="margin-bottom:16px">
      <div class="avatar" aria-hidden="true">${initials(person.nom)}</div>
      <div>
        <h1>${name} <span class="tag licence-tag num">${t("rn.licenceNo")} ${lic}</span></h1>
        <div class="hero-meta">
          <span>${last?.[R.cat] || person.cat || ""}</span>
          ${cp.code ? html`<span><a href="${link.club(cp.code)}">${data.clubName(club)}</a></span>` : ""}
          ${cp.ligue ? html`<span>${data.ligueName(cp.ligue)}</span>` : ""}
          <span>${t("rn.since")} ${fmtDate(person.first)}</span>
          <span class="num">${fmt(person.n)} ${t("rn.races")} (${t("terrain.For")} ${fmt(person.nFor)} · ${t("terrain.Spr")} ${fmt(person.nSpr)})</span>
        </div>
      </div>
      <div class="stack" style="gap:8px"><button class="btn" type="button" id="cmp-btn"></button>
        <a class="btn btn-sm" href="${link.network(lic)}">${t("nav.network")}</a></div>
    </section>
    ${mineT.length ? "" : html`<div class="notice info">${t("rn.noRacesIn")} ${t(`terrain.${terrain}`).toLowerCase()} —
      ${t("rn.switchTo")} ${t(`terrain.${other}`)} ${t("rn.inHeader")}.</div>`}
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("rn.history")}</h2>
      <div class="row"><span id="hist-terrain"></span>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("f.season")}</span>
        <select id="season"></select></label></div></div>
      <div id="history" class="scroll-box"></div></section>
    <div style="margin-bottom:16px">${chartCard({
      id: "evo", title: t("rn.evolution"), hint: t("rn.evolution.hint"), tall: true,
      tools: html`<label class="checkline"><input type="checkbox" id="show-scores" ${raw(showScores ? "checked" : "")}>${t("rn.showScores")}</label>`,
    })}</div>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${t("rn.cnHistory")}</h2><div class="hint">${t("rn.cnHistory.hint")}</div></div>
        <span id="hist-seg"></span></div>
      <div id="cnhist"></div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head">
        <h2>${t("rn.calc")}</h2>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("f.date")}</span>
          <input type="date" id="calc-date"></label>
      </div>
      <div class="card-body"><div class="calc" id="calc"></div></div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${t("rn.ffHistory")}</h2><div class="hint">${t("rn.ffHistory.hint")}</div></div>
        </div>
      <div id="ffhist"></div>
    </section>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${t("pg.title")}</h2><div class="hint" id="pg-hint"></div></div>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("pg.ref")}</span><select id="ref"></select></label></div>
      <div class="card-body">
        <div class="tiles" id="pg-tiles" style="margin-bottom:14px"></div>
        <div class="grid grid-2">
          <div>${chartCard({ id: "path", title: t("pg.path"), hint: t("pg.path.hint") })}</div>
          <div>${chartCard({ id: "pct", title: t("pg.pct"), hint: t("pg.pct.hint") })}</div>
        </div>
        <div style="margin-top:16px">${chartCard({ id: "curve", title: t("pg.curve"), hint: t("pg.curve.hint") })}</div>
      </div>
    </section>
    <section class="card"><div class="card-head"><h2>${t("rn.seasons")}</h2></div><div id="seasons"></div></section>`;
  ["evo", "path", "pct", "curve"].forEach((id) => bindChartCard(main, id));

  const cmpBtn = $("#cmp-btn");
  const drawCmp = () => {
    const inC = store.inCompare(lic);
    cmpBtn.textContent = inC ? `✓ ${t("rn.inCompare")}` : `+ ${t("rn.addCompare")}`;
    cmpBtn.classList.toggle("btn-primary", !inC);
  };
  cmpBtn.addEventListener("click", () => {
    if (!store.toggleCompare(lic)) alert(t("cp.max"));
    drawCmp();
  });
  drawCmp();

  function drawFilters() {
    $("#filters").innerHTML = html`
      <div class="field"><span>${t("f.methods")}</span>${methodChips()}</div>
      <div class="field"><span>${t("f.range")}</span>${seg("range",
        [["1", t("chart.12m")], ["3", t("chart.3y")], ["5", t("chart.5y")], ["all", t("chart.all")]], range)}</div>
      <label class="field"><span>${t("f.from")}</span><input type="date" id="from"></label>
      <label class="field"><span>${t("f.to")}</span><input type="date" id="to"></label>`;
    bindMethodChips(main, () => { drawFilters(); drawAll(); });
    $$('[data-seg="range"]').forEach((b) => b.addEventListener("click", () => {
      range = b.dataset.value; drawFilters(); drawChart(); drawProgress();
    }));
    $("#from").addEventListener("change", drawChart);
    $("#to").addEventListener("change", drawChart);
  }

  /** Races that feed the chosen discipline's series (official is pooled before 2026). */
  const inSeries = (r, m) => r[R.terrain] === terrain ||
    (m === "official" && Number(r[R.date].slice(0, 4)) < meta.split_year);

  async function drawTiles() {
    const methods = store.get().methods;
    const month = data.latestMonth();
    const { rows } = await loadRanking(methods, terrain, month);
    const me = rows.find((r) => r.lic === lic);
    const cat = me?.cat;
    // for each method: the current CN, and the runner's place in the ranking (overall and in the category)
    const tiles = methods.map((m) => tile(`${t("rn.current")} · ${methodShort(m)}`,
      me?.cn[m] == null ? "—" : fmt(me.cn[m]), fmtDate(month), methodColor(m)));
    const rankTiles = methods.map((m) => {
      const cn = me?.cn[m];
      if (cn == null) return tile(`${t("rn.rank")} · ${methodShort(m)}`, "—", t("rn.unranked"), methodColor(m));
      const n = rows.filter((r) => r.cn[m] != null).length;
      const catRank = cat ? 1 + rows.filter((r) => r.cat === cat && r.cn[m] != null && r.cn[m] > cn).length : null;
      return tile(`${t("rn.rank")} · ${methodShort(m)}`, ord(me.rank[m]),
        `${t("rn.rankOf")} ${fmt(n)}${catRank ? ` · ${ord(catRank)} ${t("rn.rankCat")} ${cat}` : ""}`, methodColor(m));
    });
    const col = CNAFTER_COL[methods[0]];
    let best = null;
    for (const r of races) if (inSeries(r, methods[0]) && r[col] && (!best || r[col] > best[col])) best = r;
    const recent = mineT.filter((r) => r[R.date] > addDays(month, -365));
    const podiums = mineT.filter((r) => r[R.place] && r[R.place] <= 3).length;
    const wins = mineT.filter((r) => r[R.place] === 1).length;
    $("#tiles").innerHTML = html`${tiles}${rankTiles}
      ${tile(`${t("rn.best")} · ${methodShort(methods[0])}`, best ? fmt(best[col]) : "—", best ? fmtDate(best[R.date]) : "")}
      ${tile(t("rn.last12"), fmt(recent.length), `${t(`terrain.${terrain}`)}`)}
      ${tile(t("rn.podiums"), fmt(podiums), plural(wins, t("rn.win"), t("rn.wins")))}`;
  }

  function seriesFor(m) {
    const col = CNAFTER_COL[m];
    const pts = [];
    let prev = null;
    for (const r of races) {
      if (!inSeries(r, m)) continue;
      const v = r[col];
      if (!v) continue;                     // a 0 CN (all-zero window) is not a ranking
      if (prev && prev[0] === r[R.date]) { prev[1] = v; continue; }
      prev = [r[R.date], v];
      pts.push(prev);
    }
    return pts;
  }

  function zoomWindow(dates) {
    const first = dates[0], lastD = dates[dates.length - 1];
    let from = $("#from")?.value || null, to = $("#to")?.value || null;
    if (!from && range !== "all" && lastD) from = addDays(lastD, -365 * Number(range));
    const span = (d) => (first && lastD ? 100 * (new Date(d) - new Date(first)) / Math.max(1, new Date(lastD) - new Date(first)) : 0);
    return { start: from ? Math.max(0, span(from)) : 0, end: to ? Math.min(100, span(to)) : 100 };
  }

  function drawChart() {
    const methods = store.get().methods;
    const series = [];
    for (const m of methods) {
      series.push({ name: `CN · ${methodLabel(m)}`, color: methodColor(m), step: true, data: seriesFor(m),
        endLabel: methods.length <= 4 ? methodShort(m) : null });
    }
    if (showScores) {
      for (const m of methods) {
        const col = SCORE_COL[m];
        series.push({
          name: `${t("rn.score")} · ${methodLabel(m)}`, color: methodColor(m), kind: "dots",
          data: mineT.filter((r) => r[col] != null && r[col] > 0).map((r) => [r[R.date], r[col], r]),
        });
      }
    }
    const all = series.flatMap((s) => s.data.map((p) => p[0])).sort();
    $("#evo-legend").innerHTML = legend([
      ...methods.map((m) => ({ color: methodColor(m), label: `CN · ${methodLabel(m)}` })),
      ...(showScores ? [{ color: "var(--ink-3)", label: t("rn.score"), dot: true }] : []),
    ]);
    if (!all.length) { $("#evo").innerHTML = html`<div class="empty">${t("rn.noRaces")}</div>`; return; }
    timeChart($("#evo"), {
      series, zoom: zoomWindow(all),
      tooltipExtra: (s, v) => (v[2] ? `<span style="color:var(--ink-3);margin-left:6px">${esc(data.comp(v[2][R.course])?.title || "")}</span>` : ""),
      onClick: (d) => { calcDate = d; drawCalc(); $("#calc").scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    });
    const dates = [...new Set(methods.flatMap((m) => seriesFor(m).map((p) => p[0])))].sort().reverse();
    const lookup = Object.fromEntries(methods.map((m) => [m, new Map(seriesFor(m))]));
    $("#evo-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("col.date")}</th>
      ${methods.map((m) => html`<th class="r">CN · ${methodShort(m)}</th>`)}</tr></thead><tbody>
      ${dates.map((d) => html`<tr><td>${fmtDate(d)}</td>${methods.map((m) => html`<td class="r num">${fmt(lookup[m].get(d))}</td>`)}</tr>`)}
      </tbody></table>`;
  }

  // ---- CN history, event by event -----------------------------------------------
  function drawCnHistory() {
    const methods = store.get().methods;
    if (!methods.includes(histMethod)) histMethod = methods[0];
    $("#hist-seg").innerHTML = methods.length > 1 ? seg("hm", methods.map((m) => [m, methodShort(m)]), histMethod) : "";
    $$('[data-seg="hm"]').forEach((b) => b.addEventListener("click", () => { histMethod = b.dataset.value; drawCnHistory(); }));
    const ev = cnHistory(histMethod, races, terrain, meta, data.latestMonth());
    const raceLabel = (r) => {
      const c = data.comp(r[R.course]);
      return html`<a href="${raceLink(r)}" title="${c?.location || ""}">${c?.title || ""}</a> <span class="dim">${r[R.circuit] || ""}</span>`;
    };
    const what = (e) => {
      if (e.kind === "in") return html`${e.races.map((r) => html`<div><span class="tag tag-in">${t("rn.ev.in")}</span> ${raceLabel(r)}
          <span class="dim num">· ${t("rn.score")} ${fmt(r[SCORE_COL[histMethod]])}</span></div>`)}
        ${e.also.map((r) => html`<div><span class="tag">${t("rn.ev.out")}</span> ${raceLabel(r)} <span class="dim">(${fmtDate(r[R.date], "short")})</span></div>`)}`;
      if (e.kind === "out") return html`${e.races.map((r) => html`<div><span class="tag">${t("rn.ev.out")}</span> ${raceLabel(r)} <span class="dim">(${fmtDate(r[R.date], "short")})</span></div>`)}`;
      return html`<span class="tag">${t(histMethod === "v2026" ? "rn.ev.recalYear" : "rn.ev.recalMonth")}</span>`;
    };
    dataTable($("#cnhist"), {
      rows: ev, sortKey: "date", sortDir: -1,
      emptyText: t("rn.noRaces"),
      columns: [
        { key: "date", label: t("col.date"), cls: "num", sort: (e) => e.date, render: (e) => fmtDate(e.date) },
        { key: "what", label: t("rn.ev.what"), render: what },
        { key: "cn", label: "CN", align: "r", cls: "num", sort: (e) => e.cn, render: (e) => (e.cn == null ? html`<span class="dim">—</span>` : html`<b>${fmt(e.cn)}</b>`) },
        { key: "delta", label: t("rn.ev.delta"), align: "r", cls: "num", sort: (e) => e.delta,
          render: (e) => (e.delta == null ? "" : html`<span class="${e.delta > 0 ? "delta-up" : e.delta < 0 ? "delta-down" : "dim"}">${fmtSigned(e.delta)}</span>`) },
      ],
    });
  }

  // ---- the calculation at one date ------------------------------------------------
  function roleLabel(role) {
    // green: kept; yellow: the "best" scores that are not kept (10 % best, or the 60 % best beyond the 6); grey: the rest
    const cls = role === "kept" ? "role-kept" : role === "notTop6" || role === "best10" ? "role-mid" : "role-out";
    return html`<span class="role ${cls}" title="${t(`calc.${role}`)}">${t(`calc.s.${role}`)}</span>`;
  }
  function drawCalc() {
    const methods = store.get().methods;
    const lastRace = mineT[mineT.length - 1]?.[R.date];
    const month = data.latestMonth();
    const iso = calcDate || (lastRace && lastRace < addDays(month, -300) ? lastRace : month);
    $("#calc-date").value = iso;
    replaceQuery({ d: calcDate || null, range: range === "all" ? null : range });
    $("#calc").innerHTML = html`${methods.map((m) => {
      const x = explain(m, races, iso, terrain, meta);
      const head = html`<div class="calc-head">
        <div class="row"><span class="key" style="background:${raw(methodColor(m))}"></span><h3>${methodLabel(m)}</h3></div>
        <div class="big num">${x.cn == null ? "—" : fmt(x.cn)}</div></div>`;
      let formula;
      if (m === "v2026") formula = html`${t("calc.v2026.formula")} ${x.nKept ? html` — <code>${fmt(x.nKept)} / ${fmt(x.rows.length)}</code>` : ""}`;
      else if (m === "top6w") formula = html`${t("calc.top6w.formula")} ${t("calc.weights")}.`;
      else formula = html`${t("calc.official.note")} <code>${x.reconstructed == null ? "—" : fmt(x.reconstructed)}</code>${
        x.pooled ? html`<br>${t("rk.noted2026")}` : ""}`;
      const body = x.rows.length ? html`<div class="calc-table" id="calc-t-${m}"></div>` : html`<div class="empty">${t("rn.calc.none")}</div>`;
      return html`<div class="calc-card ${m === "top6w" ? "wide" : ""}" id="calc-card-${m}">${head}<div class="calc-formula">${formula}</div><div class="calc-body">${body}</div></div>`;
    })}`;
    // each method's table: click a column header to sort by it (date by default, newest first)
    const ROLE = (role) => ({ kept: 0, notTop6: 1, best10: 2, worst40: 3, notTop60: 4 }[role] ?? 5);
    if (methods.includes("official")) drawOfficialCalc(iso);
    for (const m of methods) {
      const el = $(`#calc-t-${m}`);
      if (!el) continue;
      const x = explain(m, races, iso, terrain, meta);
      const name = (row) => data.comp(row.race[R.course])?.title || "";
      const place = (row) => data.comp(row.race[R.course])?.location || "";
      dataTable(el, {
        rows: x.rows, sortKey: "date", sortDir: -1, compact: true, maxHeight: "480px",
        columns: [
          { key: "date", label: t("col.date"), cls: "num cell-date", sort: (row) => row.race[R.date], render: (row) => fmtDate(row.race[R.date], "short") },
          { key: "type", label: t("col.type"), cls: "cell-type", sort: (row) => row.race[R.epreuve] || "", defaultDir: 1,
            render: (row) => row.race[R.epreuve] || "" },
          { key: "comp", label: t("col.comp"), cls: "cell-comp", sort: (row) => name(row), defaultDir: 1,
            render: (row) => html`<a href="${raceLink(row.race)}" title="${place(row)}">${name(row)}</a>` },
          { key: "score", label: t("rn.score"), align: "r", cls: "num cell-score", sort: (row) => row.value,
            render: (row) => html`<span class="${row.role === "kept" ? "cn" : "dim"}">${fmt(row.value)}${row.rescaled && Math.abs(row.rescaled - 1) > 1e-6
              ? html`<span title="${t("calc.rescaled")} ×${fmt(row.rescaled, 4)}"> *</span>` : ""}</span>` },
          ...(m === "top6w" ? [{ key: "w", label: t("col.weight"), align: "r", cls: "num cell-w", sort: (row) => row.weight,
            render: (row) => html`×${fmt(row.weight, Number.isInteger(row.weight) ? 0 : 1)}` }] : []),
          { key: "use", label: t("col.use"), cls: "cell-use", sort: (row) => ROLE(row.role), defaultDir: 1, render: (row) => roleLabel(row.role) },
        ],
      });
    }
  }

  // ---- the official calculation, exactly as FFCO publishes it on the runner's CN page at that date: its races,
  // the points it counts for each (a race of a past season is re-evaluated for the new season, so these can
  // differ from the race's results page), the ones it keeps, and its CN. Before the forest/sprint split the
  // CN was one, published under "Ped".
  const ffCn = new Map();
  function ffCnAt(iso) {
    const spe = Number(iso.slice(0, 4)) < meta.split_year ? "Ped" : terrain;
    const key = `${lic}|${spe}|${iso}`;
    if (!ffCn.has(key)) {
      ffCn.set(key, fetch(`api/ffco-cn?lic=${encodeURIComponent(lic)}&spe=${spe}&d=${iso}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((res) => { if (!res) ffCn.delete(key); return res && { ...res, spe }; }));
    }
    return ffCn.get(key);
  }
  /** Our row for a race of an FFCO page: same circuit, else same day and competition (re-evaluated circuits get new ids). */
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "");
  function ourRace(id, iso, title) {
    const byId = races.find((r) => String(r[R.cid]) === String(id));
    if (byId) return byId;
    const same = races.filter((r) => r[R.date] === iso);
    return same.find((r) => norm(data.comp(r[R.course])?.title) === norm(title)) || (same.length === 1 ? same[0] : null);
  }
  async function drawOfficialCalc(iso) {
    // while FFCO answers, the card waits; without an answer (offline, not signed in) our copy of the published values stays
    let card = $("#calc-card-official");
    const saved = card && [card.querySelector(".big").innerHTML, card.querySelector(".calc-formula").innerHTML];
    if (card) {
      card.classList.add("pending");
      card.querySelector(".big").textContent = "…";
      card.querySelector(".calc-formula").innerHTML = html`<span class="muted">${t("calc.official.loading")}</span>`;
    }
    const res = await ffCnAt(iso);
    card = $("#calc-card-official");
    if (!card || $("#calc-date").value !== iso) return;                  // redrawn meanwhile: that draw handles it
    card.classList.remove("pending");
    if (!res) {
      if (saved) [card.querySelector(".big").innerHTML, card.querySelector(".calc-formula").innerHTML] = saved;
      return;
    }
    const keptMin = Math.min(...res.rows.filter((x) => x.kept).map((x) => x.points));
    const rows = res.rows.map((x) => ({
      ...x, race: ourRace(x.id, x.date, x.title),
      role: x.kept ? "kept" : res.cn == null ? "noCn" : x.points > keptMin ? "best10" : "worst40",
    }));
    const url = `https://cn.ffcorientation.fr/cn/${lic}/?specialite=${res.spe}&jour=${Number(iso.slice(8))}&mois=${Number(iso.slice(5, 7))}&annee=${iso.slice(0, 4)}`;
    card.querySelector(".big").textContent = res.cn == null ? "—" : fmt(res.cn);
    card.querySelector(".calc-formula").innerHTML = html`${t("calc.official.ffco")}
      <a href="${url}" target="_blank" rel="noopener">${t("calc.official.page")} ↗</a>${res.cn == null && res.note ? html`<br>${res.note}` : ""}`;
    card.querySelector(".calc-body").innerHTML = rows.length ? html`<div class="calc-table" id="calc-t-official"></div>` : html`<div class="empty">${t("rn.calc.none")}</div>`;
    if (!rows.length) return;
    const ROLE = (role) => ({ kept: 0, best10: 1, worst40: 2 }[role] ?? 3);
    const name = (x) => (x.race && data.comp(x.race[R.course])?.title) || x.title;
    dataTable($("#calc-t-official"), {
      rows, sortKey: "date", sortDir: -1, compact: true, maxHeight: "480px",
      columns: [
        { key: "date", label: t("col.date"), cls: "num cell-date", sort: (x) => x.date, render: (x) => fmtDate(x.date, "short") },
        { key: "type", label: t("col.type"), cls: "cell-type", sort: (x) => x.race?.[R.epreuve] || "", defaultDir: 1,
          render: (x) => x.race?.[R.epreuve] || "" },
        { key: "comp", label: t("col.comp"), cls: "cell-comp", sort: (x) => name(x), defaultDir: 1,
          render: (x) => (x.race ? html`<a href="${raceLink(x.race)}" title="${x.place}">${name(x)}</a>`
            : html`<a href="https://cn.ffcorientation.fr/circuit/${x.id}/" target="_blank" rel="noopener" title="${x.place}">${name(x)}</a>`) },
        { key: "score", label: t("rn.score"), align: "r", cls: "num cell-score", sort: (x) => x.points,
          render: (x) => html`<span class="${x.kept ? "cn" : "dim"}">${fmt(x.points)}</span>` },
        { key: "use", label: t("col.use"), cls: "cell-use", sort: (x) => ROLE(x.role), defaultDir: 1, render: (x) => roleLabel(x.role) },
      ],
    });
  }

  // ---- the CN history as the FFCO site publishes it: entries and exits of races in the calculation base,
  // with the CN and its variation after each — for every selected method (the official ones are FFCO's own
  // figures; the others are computed at the same dates)
  let ffPromise = null, ffKey = "";
  function ffRows() {                                                    // fetched once per runner and discipline
    const key = `${lic}|${terrain}`;
    if (ffKey !== key) {
      ffKey = key;
      ffPromise = fetch(`api/ffco-history?lic=${encodeURIComponent(lic)}&spe=${terrain}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);      // offline, or no server (local file server)
    }
    return ffPromise;
  }
  async function drawFfHistory() {
    const box = $("#ffhist");
    const methods = store.get().methods;
    box.innerHTML = html`<div class="muted" style="padding:14px 18px">${t("misc.loading")}</div>`;
    const res = await ffRows();
    if (!$("#ffhist")) return;                                            // the page changed meanwhile
    if (!res) {
      box.innerHTML = html`<div class="empty">${t("rn.ffHistory.err")}
        <a href="https://cn.ffcorientation.fr/historique/${lic}/?specialite=${terrain}" target="_blank" rel="noopener">${t("rn.ffHistory.open")} ↗</a></div>`;
      return;
    }
    // one row per FFCO entry/exit; each method's CN at that date, and its change since the previous row
    const prev = {};
    const rows = [...res.rows].sort((x, y) => (x.date < y.date ? -1 : 1)).map((e) => {
      const row = { ...e, cn: {}, delta: {} };
      for (const m of methods) {
        const official = m === "official";
        const cn = official ? e.cn : explain(m, races, e.date, terrain, meta).cn;
        row.cn[m] = cn;
        row.delta[m] = official ? e.delta : (cn != null && prev[m] != null ? cn - prev[m] : null);
        if (cn != null) prev[m] = cn;
      }
      return row;
    });
    const label = (x, e) => {
      const mine = ourRace(x.id, x.struck ? null : e.date, x.text);      // our page for it (an exit row is dated by the exit)
      return mine ? html`<a href="${raceLink(mine)}" title="${data.comp(mine[R.course])?.location || ""}">${x.text}</a>`
        : html`<a href="https://cn.ffcorientation.fr/circuit/${x.id}/" target="_blank" rel="noopener">${x.text}</a>`;
    };
    const several = methods.length > 1;
    const key = (m) => html`<span class="key" style="background:${raw(methodColor(m))};margin-right:6px"></span>`;
    dataTable(box, {
      rows, sortKey: "date", sortDir: -1, compact: true, emptyText: t("rn.noRaces"),
      columns: [
        { key: "date", label: t("col.date"), cls: "num", sort: (e) => e.date, render: (e) => fmtDate(e.date, "short") },
        { key: "what", label: html`Entrées et <s>sorties</s> des courses dans la base de calcul`, defaultDir: 1,
          sort: (e) => e.races[0]?.text || "",
          render: (e) => html`${e.races.map((x) => html`<div class="${x.struck ? "struck" : ""}">${label(x, e)}</div>`)}` },
        ...methods.flatMap((m) => [
          { key: `cn_${m}`, label: several ? html`${key(m)}CN ${methodShort(m)}` : "CN", align: "r", cls: "num", sort: (e) => e.cn[m],
            render: (e) => (e.cn[m] == null ? html`<span class="dim">—</span>` : html`<b>${fmt(e.cn[m])}</b>`) },
          { key: `d_${m}`, label: several ? html`Var. ${methodShort(m)}` : t("rn.ev.delta"), align: "r", cls: "num", sort: (e) => e.delta[m],
            render: (e) => (e.delta[m] == null ? "" : html`<span class="${e.delta[m] > 0 ? "delta-up" : e.delta[m] < 0 ? "delta-down" : "dim"}">${fmtSigned(e.delta[m])}</span>`) },
        ]),
      ],
    });
  }
  $("#calc-date").addEventListener("change", (e) => { calcDate = e.target.value || null; drawCalc(); });
  $("#show-scores").addEventListener("change", (e) => { showScores = e.target.checked; drawChart(); });

  // ---- progression against the age category ----------------------------------------
  const seasons = Object.keys(ac?.months || {}).sort().reverse();
  $("#ref").innerHTML = html`<option value="all">${t("pg.refAll")} (${ac?.pool_from}–${seasons[0]})</option>
    ${seasons.map((y) => html`<option value="${y}">${t("f.season")} ${y}</option>`)}`;
  $("#ref").addEventListener("change", (e) => { ref = e.target.value; drawProgress(); });

  function drawProgress() {
    if (!ac) return;
    const methods = store.get().methods, m0 = methods[0];
    const blue = css("--s1"), ink = css("--ink");
    const wash = (pct) => `color-mix(in srgb, ${blue} ${pct}%, transparent)`;
    const Q = ac.q, qi = (p) => 1 + Q.indexOf(p);
    const per = Object.fromEntries(methods.map((m) => [m, monthlyProgress(m, races, terrain, meta, ac)]));
    const mine = per[m0];
    $("#pg-hint").textContent = `${t("pg.hint")} · ${methodLabel(m0)}`;
    const lastS = mine[mine.length - 1];
    const bestPct = mine.reduce((b, s) => (s.pct != null && (!b || s.pct > b.pct) ? s : b), null);
    const cats = [...new Set(mine.map((s) => s.cat))];
    $("#pg-tiles").innerHTML = html`
      ${tile(t("pg.nowPct"), lastS?.pct != null ? `${fmt(lastS.pct)} %` : "—", lastS ? `${lastS.cat} · ${fmtDate(lastS.iso, "month")}` : "")}
      ${tile(t("pg.bestPct"), bestPct ? `${fmt(bestPct.pct)} %` : "—", bestPct ? `${bestPct.cat} · ${fmtDate(bestPct.iso, "month")}` : "")}
      ${tile(t("pg.cats"), fmt(cats.length), cats.join(" → "))}`;
    if (!mine.length) {
      for (const id of ["path", "pct", "curve"]) $(`#${id}`).innerHTML = html`<div class="empty">${t("rn.noRaces")}</div>`;
      return;
    }
    const iso = mine.map((s) => s.iso);
    const at = (p) => mine.map((s) => s.curve?.[qi(p)] ?? null);
    const zoom = zoomWindow(iso);
    // path: monthly CN against the band of that season's category
    $("#path-legend").innerHTML = legend([
      { color: ink, label: name, dot: true }, { color: blue, label: t("pg.median") },
      { color: wash(40), label: t("pg.band50") }, { color: wash(20), label: t("pg.band90") },
    ]);
    const c1 = bandChart($("#path"), {
      categories: iso, time: true,
      bands: [{ name: "p10–p90", color: blue, opacity: 0.12, lo: at(10), hi: at(90), step: "end" },
        { name: "p25–p75", color: blue, opacity: 0.22, lo: at(25), hi: at(75), step: "end" }],
      lines: [{ name: t("pg.median"), color: blue, data: at(50), markers: false, step: "end" },
        { name, color: ink, data: mine.map((s) => s.cn), markers: false }],
      tip: (axisValue) => {
        const d = typeof axisValue === "number" ? new Date(axisValue).toISOString().slice(0, 10) : axisValue;
        const s = mine.find((x) => x.iso === d) || mine.reduce((b, x) => (x.iso <= d ? x : b), mine[0]);
        return `<div style="color:var(--ink-3);font-size:12px">${fmtDate(s.iso, "month")} · ${esc(s.cat || "")}</div><div><b>${fmt(s.cn)}</b> ${esc(name)}</div>
          ${s.curve ? `<div style="color:var(--ink-2)">${t("pg.median")} ${esc(s.cat)} : ${fmt(s.curve[qi(50)])} · ${fmt(s.pct)} %</div>` : ""}`;
      },
    });
    c1.dispatchAction({ type: "dataZoom", start: zoom.start, end: zoom.end });
    // percentile, one line per selected method
    $("#pct-legend").innerHTML = legend(methods.map((m) => ({ color: methodColor(m), label: methodLabel(m) })));
    const allIso = [...new Set(methods.flatMap((m) => per[m].map((s) => s.iso)))].sort();
    const c2 = bandChart($("#pct"), {
      categories: allIso, time: true, yName: "%", yMin: 0, yMax: 100, yFormat: (v) => `${fmt(v)} %`,
      bands: [{ name: "p25–p75", color: blue, opacity: 0.10, lo: allIso.map(() => 25), hi: allIso.map(() => 75) }],
      lines: methods.map((m) => {
        const byIso = new Map(per[m].map((s) => [s.iso, s.pct == null ? null : Math.round(s.pct)]));
        return { name: methodLabel(m), color: methodColor(m), data: allIso.map((d) => byIso.get(d) ?? null), markers: false };
      }),
      tip: (axisValue, params) => {
        const d = typeof axisValue === "number" ? new Date(axisValue).toISOString().slice(0, 10) : axisValue;
        const rows = methods.map((m) => { const s = per[m].find((x) => x.iso === d); return s?.pct != null ? `<div>${esc(methodShort(m))} : <b>${fmt(s.pct)} %</b> <span style="color:var(--ink-3)">${esc(s.cat)}</span></div>` : ""; });
        return `<div style="color:var(--ink-3);font-size:12px">${fmtDate(d, "month")}</div>${rows.join("")}`;
      },
    });
    c2.dispatchAction({ type: "dataZoom", start: zoom.start, end: zoom.end });
    // the typical curve by category, the runner's season ends over it
    const refKey = curveKey(m0, terrain, ref, meta.split_year);
    const curves = ac.data[refKey]?.[ref] || {};
    const sexe = (lastS?.cat || person.cat || "H")[0];
    const catsX = AGES.map((a) => sexe + a).filter((c) => curves[c]);
    const col = (p) => catsX.map((c) => curves[c][qi(p)]);
    const ends = seasonEnds(mine, ac).filter((s) => catsX.includes(s.cat));
    $("#curve-legend").innerHTML = legend([
      { color: wash(20), label: t("pg.band90") }, { color: wash(40), label: t("pg.band50") }, { color: blue, label: t("pg.median") },
      ...(ends.length ? [{ color: ink, label: `${name} (${t("pg.seasonEnds")})`, dot: true }] : []),
    ]);
    bandChart($("#curve"), {
      categories: catsX,
      bands: [{ name: "p10–p90", color: blue, opacity: 0.12, lo: col(10), hi: col(90) },
        { name: "p25–p75", color: blue, opacity: 0.22, lo: col(25), hi: col(75) }],
      lines: [{ name: t("pg.median"), color: blue, data: col(50), markers: false },
        ...(ends.length ? [{ name, color: ink, data: ends.map((s) => [s.cat, s.cn]) }] : [])],
      tip: (cat) => {
        const r = curves[cat]; if (!r) return "";
        const me = ends.filter((s) => s.cat === cat);
        return `<div style="color:var(--ink-3);font-size:12px">${esc(cat)} · ${fmt(r[0])} ${t("pg.ranked")}</div>
          <div><b>${fmt(r[qi(50)])}</b> ${t("pg.median").toLowerCase()}</div>
          <div style="color:var(--ink-2)">p25–p75 : ${fmt(r[qi(25)])} – ${fmt(r[qi(75)])}<br>p10–p90 : ${fmt(r[qi(10)])} – ${fmt(r[qi(90)])}</div>
          ${me.map((s) => `<div style="margin-top:4px"><b>${fmt(s.cn)}</b> ${s.iso.slice(0, 4)} · ${fmt(s.pct)} %</div>`).join("")}`;
      },
    });
    const table = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("rk.col.cat")}</th><th class="r">CN</th>
      <th class="r">${t("pg.median")}</th><th class="r">${t("pg.pctShort")}</th></tr></thead>
      <tbody>${[...mine].reverse().map((s) => html`<tr><td>${fmtDate(s.iso, "month")}</td><td>${s.cat}</td><td class="r num">${fmt(s.cn)}</td>
        <td class="r num">${fmt(s.curve?.[qi(50)])}</td><td class="r num">${s.pct == null ? "—" : `${fmt(s.pct)} %`}</td></tr>`)}</tbody></table>`;
    $("#path-table").innerHTML = table;
    $("#pct-table").innerHTML = table;
    $("#curve-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("rk.col.cat")}</th><th class="r">${t("pg.ranked")}</th>
      ${[10, 25, 50, 75, 90].map((p) => html`<th class="r">p${p}</th>`)}</tr></thead>
      <tbody>${catsX.map((c) => html`<tr><td>${c}</td><td class="r num">${fmt(curves[c][0])}</td>
        ${[10, 25, 50, 75, 90].map((p) => html`<td class="r num">${fmt(curves[c][qi(p)])}</td>`)}</tr>`)}</tbody></table>`;
  }

  // ---- race history and seasons ------------------------------------------------------
  // every race, whatever the discipline — a race is a race, even a PM; the
  // CN-related sections above stay per discipline
  let histTerrain = "";
  function drawHistory() {
    const methods = store.get().methods;
    $("#hist-terrain").innerHTML = seg("ht", [["", t("f.all")], ...store.TERRAINS.map((x) => [x, t(`terrain.${x}`)])], histTerrain);
    $$('[data-seg="ht"]').forEach((b) => b.addEventListener("click", () => { histTerrain = b.dataset.value; drawHistory(); }));
    const pool = races.filter((r) => !histTerrain || r[R.terrain] === histTerrain);
    const seasonsR = [...new Set(pool.map((r) => r[R.date].slice(0, 4)))].sort().reverse();
    const sel = $("#season");
    const prevSel = sel.value;
    sel.innerHTML = html`<option value="">${t("f.all")}</option>${seasonsR.map((s) => html`<option value="${s}" ${raw(s === prevSel ? "selected" : "")}>${s}</option>`)}`;
    const rows = pool.filter((r) => !sel.value || r[R.date].startsWith(sel.value)).map((r) => ({ r }));
    const cols = [
      { key: "date", label: t("col.date"), cls: "num", sort: (x) => x.r[R.date], render: (x) => fmtDate(x.r[R.date], "short") },
      { key: "comp", label: t("col.comp"), sort: (x) => data.comp(x.r[R.course])?.title,
        render: (x) => { const c = data.comp(x.r[R.course]); return html`<a href="${raceLink(x.r)}" title="${c?.location || ""}">${c?.title || ""}</a>
          <div class="dim" style="font-size:12px">${terrainTag(x.r[R.terrain])} ${x.r[R.circuit] || ""} · ${x.r[R.epreuve] || ""} ${x.r[R.groupe] ? html`<span class="tag">${x.r[R.groupe]}</span>` : ""}</div>`; } },
      { key: "cat", label: t("rk.col.cat"), render: (x) => x.r[R.cat] || "" },
      { key: "place", label: t("col.place"), align: "r", cls: "num", sort: (x) => x.r[R.place], defaultDir: 1,
        render: (x) => x.r[R.place] ? html`${fmt(x.r[R.place])}<span class="dim"> / ${fmt(x.r[R.nOnCircuit])}</span>` : statusLabel(x.r[R.status]) },
      { key: "time", label: t("col.time"), align: "r", cls: "num", sort: (x) => x.r[R.time], defaultDir: 1, render: (x) => x.r[R.time] ? fmtTime(x.r[R.time]) : "" },
      // score and CN after, one column per method
      ...methods.map((m) => ({
        key: `s_${m}`, align: "r", cls: "num", sort: (x) => x.r[SCORE_COL[m]],
        label: html`<span class="key" style="background:${raw(methodColor(m))};margin-right:5px"></span>${methodShort(m)}<div class="dim" style="font-weight:400">${t("rn.scoreCn")}</div>`,
        render: (x) => html`${x.r[SCORE_COL[m]] == null ? html`<span class="dim">—</span>` : fmt(x.r[SCORE_COL[m]])}<div class="dim">${x.r[CNAFTER_COL[m]] ? fmt(x.r[CNAFTER_COL[m]]) : ""}</div>`,
      })),
      { key: "ext", label: "", render: (x) => html`<a class="dim" href="${data.officialCircuitUrl(x.r[R.cid])}" target="_blank" rel="noopener" title="${t("rn.officialFfco")}">↗</a>` },
    ];
    dataTable($("#history"), { columns: cols, rows, sortKey: "date", sortDir: -1 });
  }
  $("#season").addEventListener("change", drawHistory);

  function drawSeasons() {
    const methods = store.get().methods;
    const by = new Map();
    for (const r of mineT) {
      const y = r[R.date].slice(0, 4);
      if (!by.has(y)) by.set(y, []);
      by.get(y).push(r);
    }
    const rows = [...by.entries()].map(([y, rs]) => ({ y, rs }));
    dataTable($("#seasons"), {
      rows, sortKey: "y", sortDir: -1,
      columns: [
        { key: "y", label: t("f.season"), sort: (x) => x.y },
        { key: "n", label: t("col.races"), align: "r", cls: "num", sort: (x) => x.rs.length, render: (x) => fmt(x.rs.length) },
        { key: "pod", label: t("rn.podiums"), align: "r", cls: "num", render: (x) => fmt(x.rs.filter((r) => r[R.place] && r[R.place] <= 3).length) },
        ...methods.flatMap((m) => [
          { key: `b_${m}`, align: "r", cls: "num", label: html`<span class="key" style="background:${raw(methodColor(m))};margin-right:5px"></span>${t("col.best")}`,
            render: (x) => { const v = x.rs.map((r) => r[SCORE_COL[m]]).filter((s) => s > 0); return v.length ? fmt(Math.max(...v)) : "—"; } },
          { key: `a_${m}`, align: "r", cls: "num", label: t("col.avg"),
            render: (x) => { const v = x.rs.map((r) => r[SCORE_COL[m]]).filter((s) => s > 0); return v.length ? fmt(v.reduce((a, b) => a + b, 0) / v.length) : "—"; } },
          { key: `e_${m}`, align: "r", cls: "num", label: t("col.cnEnd"),
            render: (x) => { const v = x.rs.map((r) => r[CNAFTER_COL[m]]).filter(Boolean); return v.length ? html`<b>${fmt(v[v.length - 1])}</b>` : "—"; } },
        ]),
      ],
    });
  }

  function drawAll() {
    drawTiles();
    drawChart();
    drawCnHistory();
    drawFfHistory();
    drawCalc();
    drawProgress();
    drawHistory();
    drawSeasons();
  }
  drawFilters();
  drawAll();
  return { title: name };
}

/** #/coureur with nobody chosen yet: a search. */
function pickRunner(main) {
  main.innerHTML = html`<div class="page-head"><h1>${t("nav.runner")}</h1></div>
    <section class="card"><div class="card-body stack" style="gap:12px">
      <p class="soft">${t("rn.pickLede")}</p>
      ${runnerSearch("rn-search", t("search.placeholder"))}
    </div></section>`;
  bindRunnerSearch($("#rn-search"), { onPick: (l) => { location.hash = link.runner(l); } });
  $("#rn-search input").focus();
  return { title: t("nav.runner") };
}

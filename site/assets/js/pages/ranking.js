// Ranking: the national ranking at a date, with FFCO-style filters, a row of
// figures per method, the list with the distributions beside it, and
// multi-select into the comparison.

import { html, raw, $, $$, fmt, fmtSigned, fmtDate, ord, displayName, normalise, summary, quantile, downloadCsv, debounce } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { distributionChart, cdfChart, methodColor, css } from "../charts.js";
import {
  methodChips, bindMethodChips, chartCard, bindChartCard, legend, dataTable, tile, methodLabel, methodShort,
} from "../ui.js";
import { link, replaceQuery, terrainField } from "../app.js";
import * as auth from "../auth.js";

export const AGES = ["10", "12", "14", "16", "18", "20", "21", "35", "40", "45", "50", "55", "60", "65", "70", "75", "80", "85", "90"];
const BIN = 250;

/** Everything the ranking needs at one date, shared with the compare and club pages. */
export async function loadRanking(methods, terrain, month) {
  const year = Number(month.slice(0, 4));
  const prevMonth = data.monthYearBefore(month);
  const [attrs, ...maps] = await Promise.all([
    data.attrsAt(year),
    ...methods.map((m) => data.cnAt(m, terrain, month)),
  ]);
  const prev = prevMonth
    ? await Promise.all(methods.map((m) => data.cnAt(m, terrain, prevMonth)))
    : methods.map(() => new Map());
  const byMethod = Object.fromEntries(methods.map((m, i) => [m, maps[i]]));
  const prevBy = Object.fromEntries(methods.map((m, i) => [m, prev[i]]));
  // overall rank per method, before any filter
  const overall = {};
  for (const m of methods) {
    const sorted = [...byMethod[m].entries()].sort((a, b) => b[1] - a[1]);
    const rk = new Map();
    let last = null, pos = 0;
    sorted.forEach(([lic, cn], i) => { if (cn !== last) { pos = i + 1; last = cn; } rk.set(lic, pos); });
    overall[m] = rk;
  }
  const lics = new Set();
  methods.forEach((m) => byMethod[m].forEach((_, lic) => lics.add(lic)));
  const rows = [];
  for (const lic of lics) {
    const r = data.runner(lic);
    const a = attrs.get(lic) || [r?.cat, r?.club];
    const club = a[1] || "";
    const parts = data.clubParts(club);
    const cn = {}, delta = {}, rank = {};
    for (const m of methods) {
      cn[m] = byMethod[m].get(lic) ?? null;
      const p = prevBy[m].get(lic);
      delta[m] = cn[m] != null && p != null ? cn[m] - p : null;
      rank[m] = overall[m].get(lic) ?? null;
    }
    rows.push({
      lic, nom: r?.nom || lic, name: displayName(r?.nom || lic), key: normalise(r?.nom),
      cat: a[0] || "", sexe: (a[0] || "")[0] || r?.sexe || "", age: (a[0] || "").slice(1),
      club, clubCode: parts.code, dept: parts.dept, ligue: parts.ligue,
      nRaces: r?.nBy[terrain], cn, delta, rank,
    });
  }
  return { rows, attrs, prevMonth };
}

export function applyFilters(rows, f, sortMethod) {
  let out = rows.filter((r) =>
    (!f.sexe || r.sexe === f.sexe) &&
    (!f.cat || r.age === f.cat) &&
    (!f.club || r.clubCode === f.club) &&
    (!f.dept || r.dept === f.dept) &&
    (!f.ligue || r.ligue === f.ligue) &&
    (!f.q || normalise(f.q).split(/\s+/).every((w) => r.key.includes(w))));
  if (f.podium) {
    const byCat = new Map();
    for (const r of out) {
      if (r.cn[sortMethod] == null) continue;
      if (!byCat.has(r.cat)) byCat.set(r.cat, []);
      byCat.get(r.cat).push(r);
    }
    out = [];
    for (const list of byCat.values()) {
      list.sort((a, b) => b.cn[sortMethod] - a.cn[sortMethod]);
      out.push(...list.slice(0, 3));
    }
  }
  return out;
}

export function bins(values) {
  const counts = new Map();
  for (const v of values) {
    const b = Math.floor(v / BIN) * BIN + BIN / 2;
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  if (!counts.size) return [];
  const keys = [...counts.keys()];
  const lo = Math.min(...keys), hi = Math.max(...keys);
  const out = [];
  for (let b = lo; b <= hi; b += BIN) out.push([b, counts.get(b) || 0]);
  return out;
}

export function dateControls(month) {
  const months = data.months();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].reverse();
  const y = month.slice(0, 4);
  const ms = months.filter((m) => m.startsWith(y));
  return html`<label class="field"><span>${t("f.date")}</span>
    <div class="row" style="gap:6px">
      <select id="f-year" aria-label="Année">${years.map((yy) => html`<option value="${yy}" ${raw(yy === y ? "selected" : "")}>${yy}</option>`)}</select>
      <select id="f-month" aria-label="Mois">${ms.map((m) => html`<option value="${m}" ${raw(m === month ? "selected" : "")}>${fmtDate(m, "month").replace(/\s\d{4}$/, "")}</option>`)}</select>
    </div></label>`;
}
export function bindDateControls(root, onChange) {
  $("#f-year", root).addEventListener("change", (e) => {
    const y = e.target.value;
    const ms = data.months().filter((m) => m.startsWith(y));
    const cur = $("#f-month", root).value.slice(5, 7);
    onChange(ms.find((m) => m.slice(5, 7) === cur) || ms[ms.length - 1]);
  });
  $("#f-month", root).addEventListener("change", (e) => onChange(e.target.value));
}

/** One row of headline figures per selected method. */
export function statRows(methods, rowsFor) {
  return html`<div class="statrows">${methods.map((m) => {
    const s = summary(rowsFor(m));
    return html`<div class="statrow">
      <div class="statrow-label"><span class="key" style="background:${raw(methodColor(m))}"></span>${methodLabel(m)}</div>
      ${tile(t("st.ranked"), s ? fmt(s.n) : "—")}
      ${tile(t("st.mean"), s ? fmt(s.mean) : "—")}
      ${tile(t("st.p90"), s ? fmt(s.p90) : "—")}
      ${tile(t("st.max"), s ? fmt(s.max) : "—")}
    </div>`;
  })}</div>`;
}

/** Histogram (frequency polygons) of CN values, with its table twin. */
export function drawDistribution(id, series) {
  $(`#${id}-legend`).innerHTML = series.length > 1 ? legend(series.map((x) => ({ color: x.color, label: x.name }))) : "";
  distributionChart($(`#${id}`), { series, binSize: BIN });
  const allBins = [...new Set(series.flatMap((x) => x.bins.map((b) => b[0])))].sort((a, b) => a - b);
  $(`#${id}-table`).innerHTML = html`<table class="data compact"><thead><tr><th>CN</th>${series.map((x) => html`<th class="r">${x.name}</th>`)}</tr></thead>
    <tbody>${allBins.map((b) => html`<tr><td class="num">${fmt(b - BIN / 2)} – ${fmt(b + BIN / 2)}</td>${series.map((x) => html`<td class="r num">${fmt(x.bins.find((y) => y[0] === b)?.[1] || 0)}</td>`)}</tr>`)}</tbody></table>`;
}

/**
 * One-point-per-runner CDF. groups: [{ name, color, rows: [{lic, name, value}] }];
 * highlight (optional): { name, lics:Set, of: index of the group it sits on }.
 */
export function drawCdf(id, groups, { highlight, onClick } = {}) {
  const pos = [];
  const cdf = groups.map((g, gi) => {
    const sorted = g.rows.filter((r) => r.value != null).sort((a, b) => a.value - b.value);
    const n = sorted.length;
    pos[gi] = new Map();
    const pts = sorted.map((r, i) => { const p = [r.value, (100 * (i + 1)) / n, r.lic, r.name]; pos[gi].set(r.lic, p); return p; });
    return { name: g.name, color: g.color, data: pts, values: sorted.map((r) => r.value) };
  });
  const hl = highlight && highlight.lics.size
    ? [{ name: highlight.name, color: css("--ink"), highlight: true,
        data: [...highlight.lics].map((l) => pos[highlight.of]?.get(l)).filter(Boolean) }]
    : [];
  $(`#${id}-legend`).innerHTML = legend([
    ...cdf.map((x) => ({ color: x.color, label: x.name, dot: true })),
    ...hl.map((x) => ({ color: x.color, label: `${x.name} (${fmt(x.data.length)})`, dot: true })),
  ]);
  cdfChart($(`#${id}`), { series: [...cdf, ...hl], onClick });
  const qs = [10, 25, 50, 75, 90, 95, 99];
  $(`#${id}-table`).innerHTML = html`<table class="data compact"><thead><tr><th>${t("rk.cdf.pct")}</th>${cdf.map((x) => html`<th class="r">${x.name}</th>`)}</tr></thead>
    <tbody>${qs.map((q) => html`<tr><td>${q} %</td>${cdf.map((x) => html`<td class="r num">${fmt(quantile(x.values, q / 100))}</td>`)}</tr>`)}
    <tr><td>${t("st.ranked")}</td>${cdf.map((x) => html`<td class="r num">${fmt(x.values.length)}</td>`)}</tr></tbody></table>`;
}

export async function render(main, { query }) {
  const st = store.get();
  const f = {
    month: query.date ? data.monthFor(query.date) : data.latestMonth(),
    sexe: query.sexe || "", cat: query.cat || "", club: query.club || "", dept: query.dept || "",
    ligue: query.ligue || "", q: query.q || "", podium: query.podium === "1",
  };
  const terrain = st.terrain;
  const me = auth.session();
  // the list is ranked by one method: the first selected, or the one whose column was clicked
  let sortMethod = query.sort && st.methods.includes(query.sort) ? query.sort : st.methods[0];
  let loaded = null, table = null, foundLic = null;       // foundLic: the runner picked in the search box

  function syncUrl() {
    replaceQuery({
      date: f.month.slice(0, 7) === data.latestMonth().slice(0, 7) ? null : f.month.slice(0, 7),
      sort: sortMethod === store.get().methods[0] ? null : sortMethod, sexe: f.sexe, cat: f.cat, club: f.club, dept: f.dept,
      ligue: f.ligue, q: f.q, podium: f.podium ? "1" : null,
    });
  }

  main.innerHTML = html`
    <div class="page-head">
      <h1>${t("rk.title")}</h1>
      <div class="row">
        <button class="btn" type="button" id="export">${t("rk.export")}</button>
        <button class="btn" type="button" id="find-me" hidden></button>
        <a class="btn btn-primary" href="#/comparer" id="go-compare">${t("rk.compare")}</a>
      </div>
    </div>
    <div class="filters" id="filters"></div>
    <div id="notice"></div>
    <div id="stats"></div>
    <div class="list-charts">
      <section class="card" id="list-card">
        <div class="card-head">
          <div><h2 id="list-title"></h2><div class="hint">${t("rk.sortHint")}</div></div>
        </div>
        <div id="list"></div>
      </section>
      <div class="side">
        ${chartCard({ id: "dist", title: t("rk.dist"), hint: t("rk.dist.hint"), short: true })}
        ${chartCard({ id: "gdist", title: t("rk.gdist"), hint: t("rk.gdist.hint"), short: true })}
        ${chartCard({ id: "cdf", title: t("rk.cdf"), hint: t("rk.cdf.hint") })}
        <section class="card"><div class="card-head"><div><h2>${t("ov.progress")}</h2><div class="hint" id="prog-hint"></div></div></div>
          <div id="prog"></div></section>
      </div>
    </div>`;
  ["dist", "gdist", "cdf"].forEach((id) => bindChartCard(main, id));

  function drawFilters(rows) {
    const clubs = new Map();
    rows.forEach((r) => { if (r.clubCode) clubs.set(r.clubCode, data.clubName(r.club)); });
    const clubOpts = [...clubs.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const ligues = [...new Set(rows.map((r) => r.ligue).filter(Boolean))].sort();
    const depts = [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort();
    $("#filters").innerHTML = html`${terrainField()}
      ${dateControls(f.month)}
      <div class="field"><span>${t("f.methods")}</span>${methodChips()}</div>
      <label class="field"><span>${t("f.sexe")}</span>
        <select id="f-sexe"><option value="">${t("sexe.all")}</option>
          <option value="H" ${raw(f.sexe === "H" ? "selected" : "")}>${t("sexe.H")}</option>
          <option value="D" ${raw(f.sexe === "D" ? "selected" : "")}>${t("sexe.D")}</option></select></label>
      <label class="field"><span>${t("f.cat")}</span>
        <select id="f-cat"><option value="">${t("f.all")}</option>${AGES.map((a) => html`<option value="${a}" ${raw(a === f.cat ? "selected" : "")}>${a}</option>`)}</select></label>
      <label class="field"><span>${t("f.club")}</span>
        <select id="f-club" style="max-width:230px"><option value="">${t("f.allm")}</option>${clubOpts.map(([c, n]) => html`<option value="${c}" ${raw(c === f.club ? "selected" : "")}>${c} - ${n}</option>`)}</select></label>
      <label class="field"><span>${t("f.dept")}</span>
        <select id="f-dept" style="max-width:170px"><option value="">${t("f.allm")}</option>${depts.map((d) => html`<option value="${d}" ${raw(d === f.dept ? "selected" : "")}>${d} - ${data.deptName(d)}</option>`)}</select></label>
      <label class="field"><span>${t("f.ligue")}</span>
        <select id="f-ligue" style="max-width:170px"><option value="">${t("f.all")}</option>${ligues.map((l) => html`<option value="${l}" ${raw(l === f.ligue ? "selected" : "")}>${l} - ${data.ligueName(l)}</option>`)}</select></label>
      <label class="field"><span>${t("f.name")}</span><input type="search" id="f-q" value="${f.q}" style="width:150px"></label>
      <label class="checkline"><input type="checkbox" id="f-podium" ${raw(f.podium ? "checked" : "")}>${t("f.podiums")}</label>
      <button class="btn btn-ghost" type="button" id="f-reset">${t("f.reset")}</button>`;
    bindDateControls(main, (m) => { f.month = m; reload(); });
    bindMethodChips(main, () => {
      const ms = store.get().methods;
      if (!ms.includes(sortMethod)) sortMethod = ms[0];
      reload();
    });
    for (const k of ["sexe", "cat", "club", "dept", "ligue"]) {
      $(`#f-${k}`).addEventListener("change", (e) => { f[k] = e.target.value; refresh(); });
    }
    $("#f-q").addEventListener("input", debounce((e) => { f.q = e.target.value; refresh(); }, 180));
    $("#f-podium").addEventListener("change", (e) => { f.podium = e.target.checked; refresh(); });
    $("#f-reset").addEventListener("click", () => {
      Object.assign(f, { sexe: "", cat: "", club: "", dept: "", ligue: "", q: "", podium: false });
      drawFilters(loaded.rows);
      refresh();
    });
  }

  async function reload() {
    foundLic = null;
    $("#list-card").classList.add("loading-veil");
    loaded = await loadRanking(store.get().methods, terrain, f.month);
    $("#list-card").classList.remove("loading-veil");
    drawFilters(loaded.rows);
    refresh();
  }

  function refresh() {
    const methods = store.get().methods;
    const rows = applyFilters(loaded.rows, f, sortMethod)
      .filter((r) => methods.some((m) => r.cn[m] != null));
    syncUrl();
    const year = Number(f.month.slice(0, 4));
    const notes = [];
    const foot = data.FOOT.includes(terrain);           // VTT and ski: one official ranking all along
    if (foot && methods.includes("official") && year < data.meta().split_year) notes.push(t("rk.noted2026"));
    if (foot && methods.includes("official") && year >= data.meta().split_year) notes.push(t("rk.official2026"));
    $("#notice").innerHTML = notes.map((n) => html`<div class="notice info">${n}</div>`).join("");

    $("#stats").innerHTML = statRows(methods, (m) => rows.map((r) => r.cn[m]));

    // charts beside the list: the filtered set, the whole field, and the CDF
    drawDistribution("dist", methods.map((m) => ({
      name: methodLabel(m), color: methodColor(m), bins: bins(rows.map((r) => r.cn[m]).filter((v) => v != null)),
    })));
    drawDistribution("gdist", methods.map((m) => ({
      name: methodLabel(m), color: methodColor(m), bins: bins(loaded.rows.map((r) => r.cn[m]).filter((v) => v != null)),
    })));
    const filteredSet = new Set(rows.filter((r) => r.cn[sortMethod] != null).map((r) => r.lic));
    const nAll = loaded.rows.filter((r) => r.cn[sortMethod] != null).length;
    drawCdf("cdf", methods.map((m) => ({
      name: methodLabel(m), color: methodColor(m), rows: loaded.rows.map((r) => ({ lic: r.lic, name: r.name, value: r.cn[m] })),
    })), {
      highlight: filteredSet.size < nAll ? { name: `${t("rk.cdf.filtered")} · ${methodShort(sortMethod)}`, lics: filteredSet, of: methods.indexOf(sortMethod) } : null,
      onClick: (lic) => { location.hash = link.runner(lic); },
    });

    // the list, ranked by sortMethod
    const ranked = [...rows].sort((a, b) => (b.cn[sortMethod] ?? -1) - (a.cn[sortMethod] ?? -1));
    ranked.forEach((r, i) => { r.pos = r.cn[sortMethod] != null ? i + 1 : null; });
    $("#list-title").textContent = `${fmt(ranked.filter((r) => r.pos).length)} ${t("rk.count")} — ${fmtDate(f.month)}`;
    const cols = [
      { key: "sel", label: raw('<span class="sr-only">✓</span>'), cls: "c", render: (r) => html`<input type="checkbox" data-sel="${r.lic}" ${raw(store.inCompare(r.lic) ? "checked" : "")} aria-label="${t("rn.addCompare")} ${r.name}">` },
      { key: "pos", label: t("rk.col.rank"), cls: "rank num", sort: (r) => r.pos, defaultDir: 1, render: (r) => r.pos ?? "" },
      { key: "name", label: t("rk.col.name"), sort: (r) => r.key, defaultDir: 1, render: (r) => html`<a class="name" href="${link.runner(r.lic)}">${r.name}</a>` },
      ...methods.map((m) => ({
        key: `cn_${m}`, align: "r", cls: "num",
        label: html`<span class="key" style="background:${raw(methodColor(m))};margin-right:6px"></span>${methodShort(m)}${m === sortMethod ? html`<span class="arrow">▼</span>` : ""}`,
        sort: (r) => r.cn[m],
        render: (r) => r.cn[m] == null ? html`<span class="dim">—</span>`
          : html`<span class="${m === sortMethod ? "cn" : ""}">${fmt(r.cn[m])}</span>`,
      })),
      { key: "delta", label: t("rk.col.delta"), align: "r", cls: "num", sort: (r) => r.delta[sortMethod],
        render: (r) => { const d = r.delta[sortMethod]; return d == null ? html`<span class="dim">—</span>` : html`<span class="${d > 0 ? "delta-up" : d < 0 ? "delta-down" : ""}">${fmtSigned(d)}</span>`; } },
      { key: "lic", label: t("rk.col.licence"), cls: "num dim", sort: (r) => Number(r.lic) || 0, defaultDir: 1, render: (r) => r.lic },
      { key: "cat", label: t("rk.col.cat"), sort: (r) => r.cat, defaultDir: 1 },
      { key: "club", label: t("rk.col.club"), cls: "num", sort: (r) => r.clubCode, defaultDir: 1,
        render: (r) => r.clubCode ? html`<a href="${link.club(r.clubCode)}" title="${data.clubName(r.club)}">${r.clubCode}</a>` : "" },
    ];
    const opts = {
      columns: cols, rows: ranked, sortKey: "pos", sortDir: 1,
      // clicking a method's column ranks the list by that method
      onSort: (key) => {
        if (!key.startsWith("cn_")) return true;
        sortMethod = key.slice(3);
        refresh();
        return false;
      },
      rowClass: (r) => [store.inCompare(r.lic) ? "selected" : "", r.lic === me?.lic ? "me" : "", r.lic === foundLic ? "found" : ""].join(" "),
      emptyText: "—",
      onRender(container) {
        $$("[data-sel]", container).forEach((cb) => cb.addEventListener("change", () => {
          const ok = store.toggleCompare(cb.dataset.sel);
          if (!ok) { cb.checked = false; alert(t("cp.max")); }
          cb.closest("tr").classList.toggle("selected", store.inCompare(cb.dataset.sel));
          updateCompareBtn();
        }));
      },
    };
    table = dataTable($("#list"), opts);
    const mine = ranked.find((r) => r.lic === me?.lic);
    $("#find-me").hidden = !mine?.pos;
    if (mine?.pos) $("#find-me").textContent = `${t("rk.findMe")} · ${ord(mine.pos)}`;

    // the biggest progressions over a year, within the current filters
    const prevMonth = loaded.prevMonth;
    $("#prog-hint").textContent = prevMonth
      ? `${methodShort(sortMethod)} · ${fmtDate(prevMonth, "month")} → ${fmtDate(f.month, "month")}` : "";
    const prog = rows.filter((r) => r.delta[sortMethod] != null).sort((a, b) => b.delta[sortMethod] - a.delta[sortMethod]).slice(0, 10);
    dataTable($("#prog"), {
      rows: prog, sortKey: "d", sortDir: -1, emptyText: t("rk.noProgress"),
      rowClass: (r) => (r.lic === me?.lic ? "me" : ""),
      columns: [
        { key: "name", label: t("rk.col.name"), render: (r) => html`<a class="name" href="${link.runner(r.lic)}">${r.name}</a>` },
        { key: "cat", label: t("rk.col.cat") },
        { key: "cn", label: "CN", align: "r", cls: "num", render: (r) => fmt(r.cn[sortMethod]) },
        { key: "d", label: t("rk.col.delta"), align: "r", cls: "num", sort: (r) => r.delta[sortMethod],
          render: (r) => html`<b class="delta-up">${fmtSigned(r.delta[sortMethod])}</b>` },
      ],
    });
    updateCompareBtn();

    $("#export").onclick = () => downloadCsv(`cn_${terrain}_${f.month}.csv`,
      ["place", "nom", "licence", "categorie", "club", ...methods.map((m) => `cn_${m}`)],
      table.rows().map((r) => [r.pos ?? "", r.nom, r.lic, r.cat, r.club, ...methods.map((m) => r.cn[m] ?? "")]));
  }
  function updateCompareBtn() {
    const n = store.get().compare.length;
    $("#go-compare").textContent = n ? `${t("rk.compare")} (${n})` : t("rk.compare");
  }
  $("#find-me").addEventListener("click", () => {
    if (table?.goTo((r) => r.lic === me?.lic)) $("#list tr.me")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  /** The search box chose a runner: bring them into view and highlight them (the page opens on a click on the name). */
  function pick(lic) {
    if (!table) return false;
    const r = loaded?.rows.find((x) => x.lic === lic) || data.runner(lic);
    const inList = table.goTo((x) => x.lic === lic);
    if (!inList) {
      const name = displayName(r?.nom || lic);
      $("#notice").innerHTML = html`<div class="notice">${name} ${t("rk.pick.absent")}
        <a href="${link.runner(lic)}">${t("rk.pick.open")}</a></div>`;
      return true;
    }
    foundLic = lic;
    $("#notice").innerHTML = "";
    $$("#list tr.found").forEach((tr) => tr.classList.remove("found"));
    const row = $(`#list [data-sel="${lic}"]`)?.closest("tr");
    row?.classList.add("found");
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  await reload();
  return { title: t("rk.title"), onRunnerPick: pick };
}

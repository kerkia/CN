// Clubs: every club at the chosen date, ranked by what is counted (CN or
// national-race points) and how (total, mean, top 5, headcount), over the
// runners of a sex and age group — plus the same by ligue.

import { html, raw, $, $$, fmt, normalise, debounce, downloadCsv } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { methodColor } from "../charts.js";
import { dataTable, tile, methodLabel, methodShort, methodSeg, bindMethodSeg, seg, filterFold } from "../ui.js";
import { dateControls, bindDateControls } from "./ranking.js";
import {
  BASES, SEXES, AGE_GROUPS, baseLabel, measureLabel, sexLabel, ageLabel, clubTable, rankOn, clubName,
  measuresOf, defaultMeasure,
} from "../clubstats.js";
import { link, replaceQuery, terrainField } from "../app.js";
import { myClub } from "../auth.js";

/** The four selectors shared by the club pages; withOrg adds the organised-competitions base. */
export function clubSelectors(sel, { withOrg = false } = {}) {
  const bases = withOrg ? [...BASES, "org"] : BASES;
  return html`
    <div class="field"><span>${t("cb.base")}</span>${seg("base", bases.map((b) => [b, baseLabel(b)]), sel.base)}</div>
    <div class="field"><span>${t("cb.measure")}</span>${seg("measure", measuresOf(sel.base).map((m) => [m, measureLabel(m, sel.base)]), sel.measure)}</div>
    ${sel.base === "org" ? "" : html`
    <div class="field"><span>${t("f.sexe")}</span>${seg("sexe", SEXES.map((s) => [s, sexLabel(s)]), sel.sexe)}</div>
    <div class="field"><span>${t("cb.ageGroup")}</span>${seg("age", AGE_GROUPS.map((a) => [a, ageLabel(a)]), sel.age)}</div>`}`;
}
export function bindClubSelectors(root, sel, onChange) {
  for (const k of ["base", "measure", "sexe", "age"]) {
    $$(`[data-seg="${k}"]`, root).forEach((b) => b.addEventListener("click", () => {
      sel[k] = b.dataset.value;
      if (!measuresOf(sel.base).includes(sel.measure)) sel.measure = defaultMeasure(sel.base);
      onChange(k);
    }));
  }
}
export const selFromQuery = (q, { withOrg = false } = {}) => {
  const base = BASES.includes(q.base) || (withOrg && q.base === "org") ? q.base : "cn";
  return {
    base,
    measure: measuresOf(base).includes(q.by) ? q.by : defaultMeasure(base),
    sexe: SEXES.includes(q.sexe) ? q.sexe : "*",
    age: AGE_GROUPS.includes(q.age) ? q.age : "*",
  };
};
export const selToQuery = (s) => ({ base: s.base === "cn" ? null : s.base, by: s.measure === defaultMeasure(s.base) ? null : s.measure,
  sexe: s.sexe === "*" ? null : s.sexe, age: s.age === "*" ? null : s.age });
/** One line saying what is being ranked. */
export const selDescription = (s) => (s.base === "org" ? `${t(`cb.desc.org.${s.measure}`)}.`
  : `${t(`cb.desc.${s.base}.${s.measure}`)} ${t("cb.desc.over")} ${
    s.sexe === "*" && s.age === "*" ? t("cb.desc.all") : `${sexLabel(s.sexe).toLowerCase()} · ${ageLabel(s.age).toLowerCase()}`}.`);

export async function render(main, { query }) {
  let month = query.date ? data.monthFor(query.date) : data.latestMonth();
  let ligue = query.ligue || "", q = query.q || "";
  let method = store.available().includes(query.m) ? query.m : store.get().methods[0];
  const sel = selFromQuery(query, { withOrg: true });
  const terrain = store.get().terrain;
  const mine = myClub();
  let table = null;

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cl.title")}</h1><p class="lede">${t("cl.lede")}</p></div>
      <div class="row">${mine ? html`<a class="btn" href="${link.club(mine)}">${t("cl.myClub")}</a>` : ""}
        <a class="btn btn-primary" href="#/comparer-clubs" id="go-cmp"></a></div></div>
    ${filterFold(html`<div class="filters" id="filters"></div>`)}
    <div class="notice info" id="by-desc" style="margin-bottom:16px"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><h2 id="clubs-title">${t("nav.clubs")}</h2>
        <div class="row">
          <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("f.name")}</span>
            <input type="search" id="cq" value="${q}" style="width:180px"></label>
          <button class="btn btn-sm" type="button" id="csv">${t("rk.export")}</button>
        </div></div>
      <div id="clubs"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>${t("cl.ligues")}</h2></div>
      <div id="ligues"></div>
    </section>`;

  let res = null;

  function drawFilters() {
    const ls = Object.entries(data.meta().names.ligues).sort((a, b) => a[1].localeCompare(b[1]));
    $("#filters").innerHTML = html`${terrainField()}
      ${dateControls(month)}
      ${clubSelectors(sel, { withOrg: true })}
      ${sel.base !== "pts" ? html`<div class="field"><span>${t("cm.method")}</span>${methodSeg(method)}</div>` : ""}
      <label class="field"><span>${t("f.ligue")}</span><select id="lg"><option value="">${t("f.all")}</option>
        ${ls.map(([c, n]) => html`<option value="${c}" ${raw(c === ligue ? "selected" : "")}>${n}</option>`)}</select></label>`;
    bindDateControls(main, (m) => { month = m; drawFilters(); load(); });
    bindMethodSeg(main, (m) => { method = m; drawFilters(); load(); });
    bindClubSelectors(main, sel, (k) => { drawFilters(); if (k === "sexe" || k === "age") load(); else drawTables(); });
    $("#lg").addEventListener("change", (e) => { ligue = e.target.value; drawTables(); });
  }

  async function load() {
    main.classList.add("loading-veil");
    res = await clubTable(method, terrain, month, sel);
    main.classList.remove("loading-veil");
    drawTables();
  }

  function updateCmp() {
    const n = store.get().clubs.length;
    $("#go-cmp").textContent = n ? `${t("cm.compare")} (${n})` : t("cm.compare");
  }

  const digits = (m) => (sel.base === "org" && m === "per100" ? 1 : 0);
  const valCols = () => [
    ...measuresOf(sel.base).map((m) => ({
      key: m, label: measureLabel(m, sel.base), align: "r", cls: "num", sort: (g) => g[sel.base][m] || null,
      render: (g) => (g[sel.base][m] ? (m === sel.measure ? html`<b>${fmt(g[sel.base][m], digits(m))}</b>` : fmt(g[sel.base][m], digits(m))) : html`<span class="dim">—</span>`),
    })),
    // the denominator of the per-100 figure
    ...(sel.base === "org" ? [{ key: "members", label: t("cb.m.org.members"), align: "r", cls: "num dim",
      sort: (g) => g.org.members, render: (g) => fmt(g.org.members) }] : []),
  ];
  const bestCol = {
    key: "best", label: sel.base === "cn" ? t("col.top") : t("cb.bestPts"), align: "r", cls: "num",
    render: (g) => {
      const b = g[sel.base].best;
      if (!b) return "—";
      const lic = b.lic, v = sel.base === "cn" ? b.cn[method] : b.value;
      return html`<a href="${link.runner(lic)}" title="${data.runner(lic) ? data.runner(lic).nom : lic}">${fmt(v)}</a>`;
    },
  };

  function drawTables() {
    replaceQuery({ date: month === data.latestMonth() ? null : month.slice(0, 7), ligue: ligue || null,
      q: q || null, m: method, ...selToQuery(sel) });
    $("#by-desc").innerHTML = html`${selDescription(sel)}${sel.base === "pts" ? html` <a href="#/methodes?onglet=autres&voir=elite">${t("cm.howElite")}</a>` : html` <span class="dim">(${methodLabel(method)})</span>`}`;
    rankOn(res.clubs, sel.base, sel.measure);
    rankOn(res.ligues, sel.base, sel.measure);
    const ms = measuresOf(sel.base);
    const qn = normalise(q);
    const shown = res.clubs.filter((g) => g.rank && (!ligue || g.ligue === ligue) &&
      (!qn || normalise(`${g.code} ${clubName(g.code)}`).includes(qn)));
    const lead = (m) => [...res.clubs].filter((g) => g[sel.base][m]).sort((a, b) => b[sel.base][m] - a[sel.base][m])[0];
    const tl = (m) => { const g = lead(m); return tile(`1er · ${measureLabel(m, sel.base)}`, g ? fmt(g[sel.base][m], digits(m)) : "—", g ? clubName(g.code) : ""); };
    $("#tiles").innerHTML = html`${ms.map(tl)}`;
    $("#clubs-title").textContent = `${fmt(shown.length)} ${t("cm.clubsRanked")} — ${measureLabel(sel.measure, sel.base)} · ${baseLabel(sel.base)}`;
    table = dataTable($("#clubs"), {
      rows: shown, sortKey: "rank", sortDir: 1,
      rowClass: (g) => [store.inClubs(g.code) ? "selected" : "", g.code === mine ? "me" : ""].join(" "),
      columns: [
        { key: "sel", label: "", cls: "c", render: (g) => html`<input type="checkbox" data-club="${g.code}" ${raw(store.inClubs(g.code) ? "checked" : "")} aria-label="${clubName(g.code)}">` },
        { key: "rank", label: t("rk.col.rank"), cls: "rank num", sort: (g) => g.rank, defaultDir: 1, render: (g) => g.rank ?? "" },
        { key: "code", label: t("col.code"), cls: "num dim", sort: (g) => g.code, defaultDir: 1, render: (g) => g.code },
        { key: "name", label: t("col.name"), sort: (g) => clubName(g.code), defaultDir: 1,
          render: (g) => html`<a class="name" href="${link.club(g.code)}">${clubName(g.code)}</a>` },
        { key: "lg", label: t("f.ligue"), render: (g) => data.ligueName(g.ligue) },
        ...valCols(), ...(sel.base === "org" ? [] : [bestCol]),
      ],
      onRender(el) {
        $$("[data-club]", el).forEach((cb) => cb.addEventListener("change", () => {
          if (!store.toggleClub(cb.dataset.club)) { cb.checked = false; alert(t("cm.max")); }
          cb.closest("tr").classList.toggle("selected", store.inClubs(cb.dataset.club));
          updateCmp();
        }));
      },
    });
    dataTable($("#ligues"), {
      rows: res.ligues.filter((g) => g.rank), sortKey: "rank", sortDir: 1,
      columns: [
        { key: "rank", label: t("rk.col.rank"), cls: "rank num", sort: (g) => g.rank, defaultDir: 1, render: (g) => g.rank ?? "" },
        { key: "name", label: t("f.ligue"), sort: (g) => data.ligueName(g.code), defaultDir: 1,
          render: (g) => html`<span class="name">${data.ligueName(g.code)}</span> <span class="dim">${g.code}</span>` },
        { key: "clubs", label: t("nav.clubs"), align: "r", cls: "num", sort: (g) => g.clubs, render: (g) => fmt(g.clubs) },
        ...valCols(),
      ],
    });
    $("#csv").onclick = () => downloadCsv(`clubs_${terrain}_${sel.base}_${month}.csv`,
      ["rang", "code", "club", "ligue", ...ms],
      table.rows().map((g) => [g.rank ?? "", g.code, clubName(g.code), g.ligue || "", ...ms.map((m) => g[sel.base][m] ?? "")]));
    updateCmp();
  }
  $("#cq").addEventListener("input", debounce((e) => { q = e.target.value; drawTables(); }, 180));

  drawFilters();
  await load();
  return { title: t("cl.title") };
}

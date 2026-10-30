// Clubs: every club at the chosen date, ranked by what is counted (CN or
// national-race points) and how (total, mean, top 5, headcount), over the
// runners of a sex and age group — plus the same by ligue.

import { html, raw, $, $$, fmt, normalise, debounce, downloadCsv, ord } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { methodColor } from "../charts.js";
import { dataTable, tile, methodLabel, methodShort, methodSeg, bindMethodSeg, seg, filterFold, setLede } from "../ui.js";
import { dateControls, bindDateControls } from "./ranking.js";
import {
  BASES, SEXES, AGE_GROUPS, baseLabel, measureLabel, sexLabel, ageLabel, clubTable, rankOn, clubName,
  measuresOf, defaultMeasure,
} from "../clubstats.js";
import { link, replaceQuery, terrainField } from "../app.js";
import { myClub } from "../auth.js";

/** The four selectors shared by the club pages; withOrg adds the organised-competitions base; without withMeasure,
 *  the measure is chosen by sorting the table on its column. */
export function clubSelectors(sel, { withOrg = false, withMeasure = true } = {}) {
  const bases = (withOrg ? [...BASES, "org"] : BASES).filter((b) => b !== "pts" || isFr());
  return html`
    <div class="field"><span>${t("cb.base")}</span>${seg("base", bases.map((b) => [b, baseLabel(b)]), sel.base)}</div>
    ${withMeasure ? html`<div class="field"><span>${t("cb.measure")}</span>${seg("measure", measuresOf(sel.base).map((m) => [m, measureLabel(m, sel.base)]), sel.measure)}</div>` : ""}
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
  const base = (BASES.includes(q.base) && (q.base !== "pts" || isFr())) || (withOrg && q.base === "org") ? q.base : "cn";
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

// The Clubs page: one head and its tab bar — the clubs, the ligues, the comparison of clubs, the relay simulator, one's
// own club (« Mon club », owner 2026-10-14) and, when another club's page is open, that club —, the view under them
// switched in place (the address follows), as on Statistiques: #/clubs, #/clubs?onglet=ligues, #/comparer-clubs,
// #/relais and #/club/<code> all open it.
const VIEWS = [["clubs", "#/clubs"], ["ligues", "#/clubs?onglet=ligues"], ["compare", "#/comparer-clubs"], ["relays", "#/relais"]];
// France's: FFCO's club numbers, its ligues, its national races' points and its relay formats; another country's clubs are
// keyed by Ozimut (countries/<cc>/clubs.py) and its regions are its regional federations
const isFr = () => data.loadedCountry() === "FR";
const ligueWord = () => (isFr() ? t("f.ligue") : t("f.region"));
async function view(el, v, query) {
  setLede(t("cl.lede"));
  if (v === "compare") return (await import("./clubcompare.js")).render(el, { query });
  if (v === "relays") return (await import("./relays.js")).render(el, { query });
  if (v.startsWith("club:")) return (await import("./club.js")).render(el, { arg: v.slice(5), query });
  return listView(el, query, v);
}
export async function render(main, { route, arg, query }) {
  const mine = myClub();
  const v = route === "clubcompare" ? "compare" : route === "relays" ? "relays" : route === "club" ? `club:${arg}`
    : query.onglet === "ligues" ? "ligues" : "clubs";
  // the views: the four, one's own club, and the club whose page is open when it is another one
  const views = VIEWS.filter(([k]) => isFr() || k !== "relays")
    .map(([k, href]) => [k, href, k === "ligues" && !isFr() ? t("cl.view.regions") : t(`cl.view.${k}`)]);
  if (mine) views.push([`club:${mine}`, link.club(mine), t("cl.myClub")]);
  if (route === "club" && arg && arg !== mine) views.push([v, link.club(arg), clubName(arg)]);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cl.title")}</h1><p class="lede" id="page-lede">${t("cl.lede")}</p></div></div>
    <nav class="page-tabs" role="tablist">${views.map(([k, , label]) => html`<button type="button" role="tab" data-cview="${k}" aria-selected="${k === v}">${label}</button>`)}</nav>
    <div id="club-view"></div>`;
  const el = $("#club-view", main);
  let shown = await view(el, v, query);
  $$("[data-cview]", main).forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.cview, href = views.find(([x]) => x === k)[1];
    $$("[data-cview]", main).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    shown?.cleanup?.();
    history.pushState(null, "", href);
    shown = await view(el, k, Object.fromEntries(new URLSearchParams(href.split("?")[1] || "")));
    if (shown?.title) document.title = `${shown.title} — ${document.title.split(" — ").pop()}`;
  }));
  return { title: shown?.title || t("cl.title"), cleanup: () => shown?.cleanup?.() };
}

/** The clubs' or the ligues' table, with the filters and the tiles they share. */
async function listView(main, query, mode) {
  let month = query.date ? data.monthFor(query.date) : data.latestMonth();
  let ligue = query.ligue || "", q = query.q || "";
  const method = store.get().method;
  const sel = selFromQuery(query, { withOrg: true });
  const terrain = store.get().terrain;
  const mine = myClub();
  let table = null, sortKey = sel.measure, sortDir = -1;

  main.innerHTML = html`
    ${filterFold(html`<div class="filters" id="filters"></div>`)}
    <div class="notice info" id="by-desc" style="margin-bottom:16px"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <div ${raw(mode === "ligues" ? "hidden" : "")}>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><h2 id="clubs-title">${t("nav.clubs")}</h2>
        <div class="row">
          <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("f.name")}</span>
            <input type="search" id="cq" value="${q}" style="width:180px"></label>
          <button class="btn btn-sm csv-btn" type="button" id="csv">${t("rk.export")}</button>
        </div></div>
      <div id="clubs"></div>
    </section>
    </div>
    <div ${raw(mode === "ligues" ? "" : "hidden")}>
    <section class="card">
      <div class="card-head"><h2>${isFr() ? t("cl.ligues") : t("cl.view.regions")}</h2></div>
      <div id="ligues"></div>
    </section>
    </div>`;

  let res = null;

  function drawFilters() {
    const ls = Object.entries(data.meta().names.ligues).sort((a, b) => a[1].localeCompare(b[1]));
    $("#filters").innerHTML = html`${terrainField()}
      ${dateControls(month)}
      ${clubSelectors(sel, { withOrg: true, withMeasure: false })}
      <label class="field"><span>${ligueWord()}</span><select id="lg"><option value="">${t("f.all")}</option>
        ${ls.map(([c, n]) => html`<option value="${c}" ${raw(c === ligue ? "selected" : "")}>${n}</option>`)}</select></label>`;
    bindDateControls(main, (m) => { month = m; drawFilters(); load(); });
    bindClubSelectors(main, sel, (k) => {
      if (k === "base") { sortKey = sel.measure; sortDir = -1; }
      drawFilters(); if (k === "sexe" || k === "age") load(); else drawTables();
    });
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
    const go = $("#go-cmp");
    if (go) go.textContent = n ? `${t("cm.compare")} (${n})` : t("cm.compare");
  }

  const digits = (m) => (sel.base === "org" && m === "per100" ? 1 : 0);
  // national points and organised competitions: a club with none counts 0 (it is listed); a CN measure without
  // runners in the group is no value
  const zeroOk = () => sel.base !== "cn";
  const valOf = (g, m) => g[sel.base][m] || (zeroOk() && g.org?.members ? 0 : null);
  const valCols = () => [
    ...measuresOf(sel.base).map((m) => ({
      key: m, label: measureLabel(m, sel.base), align: "r", cls: "num", sort: (g) => valOf(g, m),
      render: (g) => { const v = valOf(g, m); return v == null ? html`<span class="dim">—</span>` : m === sel.measure ? html`<b>${fmt(v, digits(m))}</b>` : fmt(v, digits(m)); },
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
    $("#by-desc").innerHTML = html`${selDescription(sel)}${sel.base === "pts" ? html` <a href="#/documentation?onglet=autres&voir=elite">${t("cm.howElite")}</a>` : ""}`;
    rankOn(res.clubs, sel.base, sel.measure);
    rankOn(res.ligues, sel.base, sel.measure);
    const ms = measuresOf(sel.base);
    const qn = normalise(q);
    // every club with ranked runners (in the group, for a CN measure): those with no national points or no
    // organised competition are listed with 0
    const listed = (g) => (sel.base === "cn" ? g.members.length > 0 : g.org.members > 0 || g.org.n > 0 || g.pts.n > 0);
    const shown = res.clubs.filter((g) => listed(g) && (!ligue || g.ligue === ligue) &&
      (!qn || normalise(`${g.code} ${clubName(g.code)}`).includes(qn)));
    const lead = (m) => [...res.clubs].filter((g) => g[sel.base][m]).sort((a, b) => b[sel.base][m] - a[sel.base][m])[0];
    const tl = (m) => { const g = lead(m); return tile(`${ord(1)} · ${measureLabel(m, sel.base)}`, g ? fmt(g[sel.base][m], digits(m)) : "—", g ? clubName(g.code) : ""); };
    $("#tiles").innerHTML = html`${ms.map(tl)}`;
    $("#clubs-title").textContent = `${fmt(shown.length)} ${t("cm.clubsRanked")} — ${measureLabel(sel.measure, sel.base)} · ${baseLabel(sel.base)}`;
    if (![...measuresOf(sel.base), "code", "name", "lg", "best", "members"].includes(sortKey)) { sortKey = sel.measure; sortDir = -1; }
    table = dataTable($("#clubs"), {
      rows: shown, sortKey, sortDir,
      rowClass: (g) => [store.inClubs(g.code) ? "selected" : "", g.code === mine ? "me" : ""].join(" "),
      // sorting on a measure's column makes it the measure ranked (the description, the title, the bold column)
      onSort(key, dir) {
        sortKey = key; sortDir = dir;
        if (measuresOf(sel.base).includes(key) && key !== sel.measure) { sel.measure = key; drawTables(); return false; }
        return true;
      },
      columns: [
        { key: "rownum", label: t("col.n"), cls: "rank num", render: (g, i) => i + 1 },
        { key: "sel", label: "", cls: "c", render: (g) => html`<input type="checkbox" data-club="${g.code}" ${raw(store.inClubs(g.code) ? "checked" : "")} aria-label="${clubName(g.code)}">` },
        isFr() && { key: "code", label: t("col.code"), cls: "num dim", sort: (g) => g.code, defaultDir: 1, render: (g) => g.code },
        { key: "name", label: t("col.name"), sort: (g) => clubName(g.code), defaultDir: 1,
          render: (g) => html`<a class="name" href="${link.club(g.code)}">${clubName(g.code)}</a>` },
        { key: "lg", label: ligueWord(), sort: (g) => data.ligueName(g.ligue) || null, defaultDir: 1, render: (g) => data.ligueName(g.ligue) },
        ...valCols(), ...(sel.base === "org" ? [] : [bestCol]),
      ].filter(Boolean),
      onRender(el) {
        $$("[data-club]", el).forEach((cb) => cb.addEventListener("change", () => {
          if (!store.toggleClub(cb.dataset.club)) { cb.checked = false; alert(t("cm.max")); }
          cb.closest("tr").classList.toggle("selected", store.inClubs(cb.dataset.club));
          updateCmp();
        }));
      },
    });
    dataTable($("#ligues"), {
      rows: res.ligues.filter((g) => g.rank || g.org.members), sortKey: sel.measure, sortDir: -1,
      columns: [
        { key: "rownum", label: t("col.n"), cls: "rank num", render: (g, i) => i + 1 },
        { key: "name", label: ligueWord(), sort: (g) => data.ligueName(g.code), defaultDir: 1,
          render: (g) => html`<span class="name">${data.ligueName(g.code)}</span>${isFr() ? html` <span class="dim">${g.code}</span>` : ""}` },
        { key: "clubs", label: t("nav.clubs"), align: "r", cls: "num", sort: (g) => g.clubs, render: (g) => fmt(g.clubs) },
        ...valCols(),
      ],
    });
    $("#csv").onclick = () => downloadCsv(`clubs_${terrain}_${sel.base}_${month}.csv`,
      ["n", "code", "club", "ligue", ...ms],
      table.rows().map((g, i) => [i + 1, g.code, clubName(g.code), g.ligue || "", ...ms.map((m) => valOf(g, m) ?? "")]));
    updateCmp();
  }
  $("#cq").addEventListener("input", debounce((e) => { q = e.target.value; drawTables(); }, 180));

  drawFilters();
  await load();
  return { title: mode === "ligues" ? `${t("cl.title")} · ${t("cl.view.ligues")}` : t("cl.title") };
}

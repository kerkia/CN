// A country's federation ranking as the federation publishes it (Spain: FEDO's Liga Española — owner, 2026-10-22: the two
// rankings of a country side by side, as France's official CN beside the Ozimut index): one season, one discipline, one
// category at a time, FEDO's columns in its order, each runner linked to their Ozimut page when Ozimut knows their licence.
// Nothing is computed here: the file is FEDO's table (countries/es/official.py site_table).

import { html, raw, $, fmt, fmtDate, displayName, normalise, debounce } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import * as country from "../country.js";
import { dataTable } from "../ui.js";
import { link, replaceQuery } from "../app.js";

/** Draw the federation's ranking into `el`. `query`: the page's address (fsaison, fcat). */
export async function drawFederation(el, query) {
  const cc = data.loadedCountry();
  const fed = country.info(cc)?.federation || "";
  el.innerHTML = html`<div class="loading">${t("misc.loading")}</div>`;
  const file = await data.officialTable().catch(() => null);
  const seasons = Object.keys(file?.seasons || {}).sort().reverse();
  if (!seasons.length) {
    el.innerHTML = html`<div class="notice">${t("fed.none", { f: fed })}</div>`;
    return;
  }
  const terrain = store.get().terrain;
  const url = /^https:/.test(t(`fed.${cc}.url`)) ? t(`fed.${cc}.url`) : "";     // the federation's own page (i18n-ignore)
  const f = { season: seasons.includes(query.fsaison) ? query.fsaison : seasons[0], cat: query.fcat || "", q: "" };

  function draw() {
    const tab = file.seasons[f.season]?.[terrain];
    const cats = tab ? [...new Set(tab.rows.map((r) => r[3]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
    if (!cats.includes(f.cat)) f.cat = cats.find((c) => /^M-E$|^H-E$|^M-21E/.test(c)) || cats[0] || "";
    replaceQuery({ fsaison: f.season === seasons[0] ? null : f.season, fcat: f.cat || null });
    el.innerHTML = html`
      <p class="lede">${t(`fed.${cc}.lede`, { f: fed })}${tab?.as_of ? " " + t("fed.asOf", { d: fmtDate(tab.as_of) }) : ""}
        ${url ? html` <a href="${url}" target="_blank" rel="noopener">${t("fed.source", { f: fed })}</a>` : ""}</p>
      <div class="filters">
        <label class="field"><span>${t("fed.season")}</span>
          <select id="fed-season">${seasons.map((s) => html`<option value="${s}" ${raw(s === f.season ? "selected" : "")}>${s}</option>`)}</select></label>
        <label class="field"><span>${t("f.cat")}</span>
          <select id="fed-cat">${cats.map((c) => html`<option value="${c}" ${raw(c === f.cat ? "selected" : "")}>${c}</option>`)}</select></label>
        <label class="field"><span>${t("f.name")}</span><input type="search" id="fed-q" value="${f.q}" style="width:150px"></label>
      </div>
      ${tab ? html`<section class="card"><div class="card-head"><div><h2 id="fed-title"></h2></div></div><div id="fed-list"></div></section>`
        : html`<div class="notice">${t("fed.noTerrain", { f: fed })}</div>`}`;
    $("#fed-season", el).addEventListener("change", (e) => { f.season = e.target.value; draw(); });
    $("#fed-cat", el).addEventListener("change", (e) => { f.cat = e.target.value; draw(); });
    $("#fed-q", el).addEventListener("input", debounce((e) => { f.q = e.target.value; list(); }, 180));
    if (tab) list();
  }

  function list() {
    const tab = file.seasons[f.season][terrain];
    const q = normalise(f.q);
    const rows = tab.rows.filter((r) => r[3] === f.cat).map((r) => {
      const id = r[0] != null ? String(r[0]) : null;
      const nom = (id && data.runner(id)?.nom) || r[1] || "";
      return { id, nom, name: displayName(nom), key: normalise(nom), club: r[2] || "", rank: r[4], total: r[5], n: r[6], m1: r[7], m2: r[8], pts: r[9] || [] };
    }).filter((r) => !q || r.key.includes(q));
    // the races of the category's runners only (a category does not run every race of the season)
    const used = tab.races.map((_, i) => rows.some((r) => r.pts[i] != null));
    $("#fed-title", el).textContent = t("fed.title", { f: f.cat, n: fmt(rows.length), s: f.season });
    const num = (v) => (v == null ? html`<span class="dim">—</span>` : fmt(v, 2));
    dataTable($("#fed-list", el), {
      rows, sortKey: "rank", sortDir: 1, emptyText: "—",
      columns: [
        { key: "rank", label: t("rk.col.rank"), cls: "rank num", sort: (r) => r.rank, defaultDir: 1 },
        { key: "name", label: t("rk.col.name"), sort: (r) => r.key, defaultDir: 1,
          render: (r) => (r.id ? html`<a class="name" href="${link.runner(r.id)}">${r.name}</a>` : r.name) },
        { key: "club", label: t("rk.col.club"), sort: (r) => r.club, defaultDir: 1 },
        { key: "total", label: t("fed.col.total"), align: "r", cls: "num", sort: (r) => r.total, render: (r) => num(r.total) },
        { key: "n", label: t("fed.col.n"), align: "r", cls: "num", sort: (r) => r.n },
        { key: "m1", label: html`<span title="${t("fed.m1.tip")}">M1</span>`, align: "r", cls: "num", sort: (r) => r.m1, render: (r) => num(r.m1) },
        { key: "m2", label: html`<span title="${t("fed.m2.tip")}">M2</span>`, align: "r", cls: "num", sort: (r) => r.m2, render: (r) => num(r.m2) },
        ...tab.races.map(([code, name], i) => (used[i] ? {
          key: `p${i}`, label: html`<span title="${name}">${code}</span>`, align: "r", cls: "num dim", sort: (r) => r.pts[i],
          render: (r) => (r.pts[i] == null ? "" : fmt(r.pts[i], 2)),
        } : null)).filter(Boolean),
      ],
    });
  }
  draw();
}

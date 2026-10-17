// Reusable interface pieces.

import { html, raw, esc, fmt, $, $$, debounce, normalise, displayName, fmtCat } from "./util.js";
import * as data from "./data.js";
import { t } from "./i18n.js";
import * as store from "./store.js";
import { methodColor, METHOD_DASH } from "./charts.js";

export const methodLabel = (m) => t(`m.${m}`);
/** Short form for dense table headers. */
export const methodShort = (m) => t(`m.${m}.short`);
/** The two quantities of a method, named as the World Ranking separates them (owner, 2026-10-14): a race's points,
 *  « score Top » / « score officiel », and a runner's ranking value, « CN Top » / « CN officiel ». The Fit shares the
 *  Top's scores; the linear pair has its own. `lower`: inside a sentence. */
export const cnLabel = (m) => t(`cn.${m}`);
export const scoreLabel = (m, lower = false) => { const s = t(`score.${m}`); return lower ? s.charAt(0).toLowerCase() + s.slice(1) : s; };

/** A short line in a method's dash pattern (charts.METHOD_DASH), for legends. */
export function dashKey(m) {
  const d = METHOD_DASH[m];
  return html`<svg class="dash-svg" width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3"
    stroke="currentColor" stroke-width="2" ${raw(Array.isArray(d) ? `stroke-dasharray="${d.join(" ")}"` : "")}/></svg>`;
}
/**
 * Method picker: toggle buttons, at least one stays on. `dash` shows the
 * line style instead of the colour — for pages where colour identifies
 * something else (compared runners or clubs).
 */
/** The site's method switch (app.renderHeader, at the right of the second row): Officiel | Top, every available
 *  method for the analysts. The pages have no method choice of their own since 2026-10-12. */
/** The site's method, at the right of the header's second row: « Calcul du CN » (owner, 2026-10-13: the buttons alone
 *  did not say what they chose), then Officiel | Top, each with a one-line tooltip (`m.<method>.tip`); analysts get a
 *  list of every method. */
export function methodSwitch() {
  const cur = store.get().method, ms = store.available();
  const tip = (m) => t(`m.${m}.tip`);
  const pick = ms.length <= 2
    ? html`<div class="seg method-switch" role="group" aria-label="${t("cm.method")}">${ms.map((m) => html`<button type="button"
        data-method-pick="${m}" aria-pressed="${m === cur}" title="${tip(m)}">${methodShort(m)}</button>`)}</div>`
    : html`<label class="method-switch" title="${tip(cur)}"><span class="sr-only">${t("cm.method")}</span><select id="method-pick" aria-label="${t("cm.method")}">
        ${ms.map((m) => html`<option value="${m}" ${raw(m === cur ? "selected" : "")} title="${tip(m)}">${methodLabel(m)}</option>`)}</select></label>`;
  return html`<div class="method-pick"><span class="lab" title="${t("msw.tip")}">${t("msw.label")}</span>${pick}</div>`;
}
// (the pages' former method choices: nothing to draw any more)
export const methodChips = () => "";
export const bindMethodChips = () => {};
export const methodSeg = () => "";
export const bindMethodSeg = () => {};

export function seg(name, options, value) {
  return html`<div class="seg" role="group">
    ${options.map(([v, label]) => html`<button type="button" data-seg="${name}" data-value="${v}"
      aria-pressed="${String(v) === String(value)}">${label}</button>`)}
  </div>`;
}

export function tile(label, value, sub, keyColor) {
  return html`<div class="tile">
    <div class="tile-label">${keyColor ? html`<span class="key" style="background:${raw(keyColor)}"></span>` : ""}${label}</div>
    <div class="tile-value">${value}</div>
    ${sub ? html`<div class="tile-sub">${sub}</div>` : ""}
  </div>`;
}

/** The results tables' one way of showing a race score (Courses, Récemment, En direct): the score and, beside it, the
 *  gap to the runner's CN, coloured — green above their level, red below; a failed run (score 0) has none.
 *  `title`: a tooltip on the score (Récemment: the CN after the race). `below`: a second line (the published score). */
export function scoreCell(score, cn, { title = "", below = "" } = {}) {
  if (score == null) return html`<span class="dim">—</span>`;
  const g = score && cn ? score - cn : null;
  return html`<span ${raw(title ? `title="${esc(title)}"` : "")}>${score ? fmt(score) : html`<span class="dim">0</span>`}</span><span class="gap ${
    g == null ? "" : g > 0 ? "delta-up" : g < 0 ? "delta-down" : "dim"}">${g == null ? "" : `${g > 0 ? "+" : g < 0 ? "−" : "±"}${fmt(Math.abs(g))}`}</span>${below}`;
}
/**
 * A page's sections as tabs (owner, 2026-10-12: on every page with several sections, rather than a long scroll).
 * tabs: [[key, label]]. The panels are the elements with data-panel="key"; only the current one is shown. The tab
 * chosen is in the address (?onglet=…, none for the first), so a link or a reload opens it.
 */
export const pageTabs = (tabs, current) => html`<nav class="page-tabs" role="tablist">${tabs.map(([k, label]) =>
  html`<button type="button" role="tab" data-ptab="${k}" aria-selected="${k === current}">${label}</button>`)}</nav>`;
/** The tab asked for in the address, else the first. */
export const tabFrom = (tabs, query) => (tabs.some(([k]) => k === query.onglet) ? query.onglet : tabs[0][0]);
/** Binds the tabs; returns show(key). onShow(key) runs each time a tab is shown (a panel may draw itself then). */
export function bindPageTabs(root, tabs, current, onShow) {
  const show = (k) => {
    $$("[data-ptab]", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ptab === k)));
    $$("[data-panel]", root).forEach((p) => { p.hidden = p.dataset.panel !== k; });
    const [path, qs] = location.hash.split("?");
    const q = new URLSearchParams(qs || "");
    if (k === tabs[0][0]) q.delete("onglet"); else q.set("onglet", k);
    const next = `${path}${q.toString() ? `?${q}` : ""}`;
    if (next !== location.hash) history.replaceState(null, "", next);
    // charts drawn while their panel was hidden have no width yet: size them now it shows
    requestAnimationFrame(() => $$(`[data-panel="${k}"] [_echarts_instance_]`, root)
      .forEach((el) => window.echarts?.getInstanceByDom(el)?.resize()));
    onShow?.(k);
  };
  $$("[data-ptab]", root).forEach((b) => b.addEventListener("click", () => show(b.dataset.ptab)));
  $$("[data-panel]", root).forEach((p) => { p.hidden = p.dataset.panel !== current; });
  onShow?.(current);
  return show;
}

/** The short text beside a page's title (id page-lede), for pages whose views change it (Statistiques, Clubs). */
export const setLede = (text) => { const el = document.getElementById("page-lede"); if (el) el.textContent = text; };

/** A results table's column header with what the figure is below it (« CN Top » / « J-15 »). */
export const subHead = (label, sub) => html`${label}<div class="th-sub">${sub}</div>`;

export const methodKey = (m, dash = false) =>
  html`<span class="key" style="background:${raw(methodColor(m))}${raw(
    dash && METHOD_DASH[m] !== "solid" ? ";background:repeating-linear-gradient(90deg," + methodColor(m) + " 0 5px,transparent 5px 8px)" : "")}"></span>`;

/**
 * A chart card with its table twin. Every chart ships a table view: three of
 * the light-mode series colours sit below 3:1 contrast, so the values must be
 * reachable without relying on colour.
 */
export function chartCard({ id, title, hint, tools = "", tall = false, short = false }) {
  return html`<section class="card" aria-labelledby="${id}-title">
    <div class="card-head">
      <div><h2 id="${id}-title">${title}</h2>${hint ? html`<div class="hint">${hint}</div>` : ""}</div>
      <div class="row">${tools}
        <div class="seg view-toggle" role="group">
          <button type="button" data-view="${id}" data-mode="chart" aria-pressed="true">${t("chart.chart")}</button>
          <button type="button" data-view="${id}" data-mode="table" aria-pressed="false">${t("chart.table")}</button>
        </div>
      </div>
    </div>
    <div class="card-body">
      <div id="${id}-legend" class="legend" style="margin-bottom:8px"></div>
      <div id="${id}" class="chart${tall ? " chart-tall" : ""}${short ? " chart-short" : ""}" role="img" aria-label="${title}"></div>
      <div id="${id}-table" class="table-wrap hidden" style="max-height:420px"></div>
    </div>
  </section>`;
}
export function bindChartCard(root, id) {
  $$(`[data-view="${id}"]`, root).forEach((b) => b.addEventListener("click", () => {
    const table = b.dataset.mode === "table";
    $(`#${id}`, root).classList.toggle("hidden", table);
    $(`#${id}-table`, root).classList.toggle("hidden", !table);
    $$(`[data-view="${id}"]`, root).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (!table) window.echarts?.getInstanceByDom($(`#${id}`, root))?.resize();
  }));
}
export function legend(items) {
  return html`${items.map((it) => html`<span>${it.dot
    ? html`<span class="dot" style="background:${raw(it.color)}"></span>`
    : html`<span class="key" style="background:${raw(it.color)}"></span>`}${it.label}</span>`)}`;
}

/**
 * Sortable table over an array of row objects, in a vertical scroll area with a sticky header
 * (no pages). Up to ALL_BELOW rows are all in the page, so the browser's find works; a longer
 * list (the whole ranking) shows its first rows and loads the next ones as the user scrolls.
 * columns: [{ key, label, align, sort: (row) => value, render: (row) => html, cls }]
 */
const ALL_BELOW = 2500, CHUNK = 400;
export function dataTable(container, { columns, rows, sortKey, sortDir = -1,
  rowClass, onRender, emptyText = "—", caption, onSort, maxHeight, compact = false }) {
  let key = sortKey, dir = sortDir, all = [], shown = 0;
  function sorted() {
    const col = columns.find((c) => c.key === key);
    if (!col || !col.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }
  const rowHtml = (r, i) => html`<tr class="${rowClass ? rowClass(r) : ""}">
    ${columns.map((c) => html`<td class="${c.align || ""} ${c.cls || ""}">${cell(c, r, i)}</td>`)}</tr>`;
  // a column keyed "cat" holds FFCO classes: M21 / W35 in English (util.fmtCat)
  const cell = (c, r, i) => { const v = c.render ? c.render(r, i) : r[c.key]; return c.key === "cat" && typeof v === "string" ? fmtCat(v) : v; };
  // under the table: the rows shown so far, or, once the table is long enough to scroll within the page, their number
  const status = () => (shown < all.length
    ? t("table.more", { shown: fmt(shown), all: fmt(all.length) }) : all.length > 15 ? t("table.rows", { n: fmt(all.length) }) : "");

  /** Append the next rows (up to index `upTo` if given). */
  function more(upTo) {
    if (shown >= all.length) return;
    const end = Math.min(all.length, Math.max(upTo ?? 0, shown + CHUNK));
    const tmp = document.createElement("tbody");
    tmp.innerHTML = all.slice(shown, end).map((r, k) => rowHtml(r, shown + k)).join("");
    onRender?.(tmp, all.slice(shown, end));              // bind the new rows only
    $("tbody", container).append(...tmp.children);
    shown = end;
    $(".table-more", container).textContent = status();
  }

  function draw() {
    all = sorted();
    shown = all.length <= ALL_BELOW ? all.length : CHUNK;
    container.innerHTML = html`
      <div class="table-wrap table-scroll" ${raw(maxHeight ? `style="--table-max:${maxHeight}"` : "")}>
        <table class="data ${compact ? "compact" : ""}">
          ${caption ? html`<caption class="sr-only">${caption}</caption>` : ""}
          <thead><tr>${columns.map((c) => html`<th scope="col" class="${c.align || ""} ${c.sort ? "sortable" : ""} ${c.cls || ""}"
              data-key="${c.key}" ${raw(c.sort ? `aria-sort="${key === c.key ? (dir > 0 ? "ascending" : "descending") : "none"}"` : "")}>
              ${c.label}${key === c.key ? html`<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`)}</tr></thead>
          <tbody>${all.length ? all.slice(0, shown).map((r, i) => rowHtml(r, i))
            : html`<tr><td colspan="${columns.length}" class="empty">${emptyText}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="table-more muted">${status()}</div>`;
    $$("th.sortable", container).forEach((th) => th.addEventListener("click", () => {
      if (key === th.dataset.key) dir = -dir; else { key = th.dataset.key; dir = columns.find((c) => c.key === key).defaultDir || -1; }
      if (onSort?.(key, dir) === false) return;   // the page took over (e.g. re-ranked)
      draw();
    }));
    const wrap = $(".table-scroll", container);
    wrap.addEventListener("scroll", () => {
      if (shown < all.length && wrap.scrollTop + wrap.clientHeight > wrap.scrollHeight - 500) more();
    });
    onRender?.(container, all.slice(0, shown));
  }
  draw();
  return {
    update(newRows) { rows = newRows; draw(); },
    /** Make sure the first row matching `pred` is in the page; false if absent. */
    goTo(pred) {
      const i = all.findIndex(pred);
      if (i < 0) return false;
      if (i >= shown) more(i + 50);
      return true;
    },
    redraw: draw,
    rows: () => sorted(),
  };
}

export function statusLabel(s) {
  const l = t(`status.${s}`);
  return l ? html`<span class="status">${l}</span>` : "";
}
export function terrainTag(tcode) {
  return html`<span class="tag tag-${(tcode || "For").toLowerCase()}">${t(`terrain.${tcode}`)}</span>`;
}
export function errorBox(msg) {
  return html`<div class="card"><div class="empty">${msg}</div></div>`;
}

/**
 * A page's filters, folded behind a « Filtres » bar on a phone or a small tablet (980 px wide or less, as on « Bientôt »),
 * open on a wider screen, where the bar is hidden (app.css .filters-fold).
 */
const NARROW = window.matchMedia("(max-width: 980px)");
export const filterFold = (inner) => html`<details class="filters-fold" data-fold ${raw(NARROW.matches ? "" : "open")}>
  <summary><span>${t("f.filters")}</span></summary>${inner}</details>`;
// a screen that widens (a tablet turned, a window enlarged) shows the filters again
NARROW.addEventListener("change", (e) => { if (!e.matches) $$("details[data-fold]").forEach((d) => { d.open = true; }); });

/** Inline runner search: markup for a text box whose results call onPick(lic). */
export function runnerSearch(id, placeholder) {
  return html`<div class="search inline" id="${id}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input type="search" autocomplete="off" placeholder="${placeholder}" aria-label="${placeholder}">
    <div class="search-results hidden" role="listbox"></div>
  </div>`;
}
export function bindRunnerSearch(root, { onPick, isPicked = () => false }) {
  const input = $("input", root), box = $(".search-results", root);
  let active = -1;
  const all = data.runners().list;
  const run = debounce(() => {
    const q = normalise(input.value.trim());
    if (q.length < 2) { box.classList.add("hidden"); return; }
    const terms = q.split(/\s+/);
    const items = all.filter((r) => terms.every((w) => normalise(r.nom).includes(w)) || r.lic === q)
      .sort((a, b) => b.n - a.n).slice(0, 12);
    active = -1;
    box.innerHTML = items.length ? html`${items.map((r) => html`<button type="button" data-lic="${r.lic}" ${raw(isPicked(r.lic) ? "disabled" : "")}>
        <span>${displayName(r.nom)}<div class="sub">${r.cat || ""} · ${data.clubName(r.club)}</div></span>
        <span class="sub num">${isPicked(r.lic) ? "✓" : `${fmt(r.n)} ${t("rn.races")}`}</span></button>`)}`
      : html`<div class="empty">${t("search.none")}</div>`;
    box.classList.remove("hidden");
  }, 120);
  const pick = (lic) => { box.classList.add("hidden"); input.value = ""; onPick(lic); };
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    const btns = $$("button:not([disabled])", box);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, Math.min(btns.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      btns.forEach((b, i) => b.classList.toggle("active", i === active));
    } else if (e.key === "Enter" && btns[Math.max(0, active)]) {
      e.preventDefault();
      pick(btns[Math.max(0, active)].dataset.lic);
    } else if (e.key === "Escape") box.classList.add("hidden");
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lic]");
    if (b && !b.disabled) pick(b.dataset.lic);
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) box.classList.add("hidden"); });
}

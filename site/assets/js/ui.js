// Reusable interface pieces.

import { html, raw, esc, fmt, $, $$, debounce, normalise, displayName } from "./util.js";
import * as data from "./data.js";
import { t } from "./i18n.js";
import * as store from "./store.js";
import { methodColor, METHOD_DASH } from "./charts.js";

export const methodLabel = (m) => t(`m.${m}`);
/** Short form for dense table headers. */
export const methodShort = (m) => t(`m.${m}.short`);

const DASH_SAMPLE = { official: "solid", fair: "dashed", top6w: "dotted" };
/**
 * Method picker: toggle buttons, at least one stays on. `dash` shows the
 * line style instead of the colour — for pages where colour identifies
 * something else (compared runners or clubs).
 */
export function methodChips(selected = store.get().methods, { dash = false } = {}) {
  return html`<div class="chips" role="group" aria-label="${t("f.methods")}">
    ${store.METHODS.map((m) => html`<button type="button" class="chip toggle" data-method="${m}"
        aria-pressed="${selected.includes(m)}" title="${t(`m.${m}.long`)}">
        <span class="tick" aria-hidden="true"></span>
        ${dash
          ? html`<span class="dash-key" style="border-top-style:${raw(DASH_SAMPLE[m])}"></span>`
          : html`<span class="key" style="background:${raw(methodColor(m))}"></span>`}${methodLabel(m)}
      </button>`)}
  </div>`;
}
export function bindMethodChips(root, onChange) {
  $$("[data-method]", root).forEach((b) =>
    b.addEventListener("click", () => { store.toggleMethod(b.dataset.method); onChange?.(); }));
}
/** Single-choice method toggle (one method at a time). */
export function methodSeg(value) {
  return html`<div class="chips" role="radiogroup" aria-label="${t("cm.method")}">
    ${store.METHODS.map((m) => html`<button type="button" class="chip toggle" data-method1="${m}" role="radio"
      aria-pressed="${m === value}" aria-checked="${m === value}" title="${t(`m.${m}.long`)}">
      <span class="tick" aria-hidden="true"></span><span class="key" style="background:${raw(methodColor(m))}"></span>${methodLabel(m)}</button>`)}
  </div>`;
}
export function bindMethodSeg(root, onChange) {
  $$("[data-method1]", root).forEach((b) => b.addEventListener("click", () => onChange(b.dataset.method1)));
}

// Forêt/Sprint now lives in the site header (app.js); pages no longer draw it.
export const terrainSeg = () => "";
export const bindTerrainSeg = () => {};

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
    ${columns.map((c) => html`<td class="${c.align || ""} ${c.cls || ""}">${c.render ? c.render(r, i) : r[c.key]}</td>`)}</tr>`;
  const status = () => (shown < all.length
    ? `${fmt(shown)} / ${fmt(all.length)} — faites défiler pour afficher la suite` : "");

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
  return html`<span class="tag ${tcode === "Spr" ? "tag-spr" : "tag-for"}">${t(`terrain.${tcode}`)}</span>`;
}
export function errorBox(msg) {
  return html`<div class="card"><div class="empty">${msg}</div></div>`;
}

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

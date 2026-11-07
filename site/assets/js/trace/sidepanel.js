// The analyses' side panels (owner, 2026-11-01: « the map is the key and should always be fully visible »): on each side of the
// map a panel of tabs — « Analyse solo »'s curves, legs and computed routes on the left, its display and computing settings on
// the right; « Analyse multi »'s alike —, resized by its splitter, folded to a thin rail by its ‹ / › button, the rail showing
// the tabs' names (a click on one opens the panel on it). The page lays the panels out and keeps their state. On a phone (owner,
// 2026-11-06) the panels are drawers over the map instead: slid away at the opening, a handle on the map's edge slides each in
// and back, one open at a time (app.css).

import { html, raw, $, $$ } from "../util.js";
import { t } from "../i18n.js";

/** The map following the runners (a crosshair): the push button of both analyses' control bar. */
export const PAN_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M8 .8v3M8 12.2v3M.8 8h3M12.2 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

/** The control bar laid over the map's top edge on a computer (owner, 2026-11-07: the map a strip taller; app.css, from 901 px):
 *  its height kept as `--bar-h` on the map's column, which the map's tools and top marks sit under; inset() is the band it covers
 *  (0 on a phone, where the bar stays above the map, or while it is hidden), for the views fitted to keep their content below it.
 *  onChange(inset) when that band changes. */
export function floatBar(col, bar, onChange = () => {}) {
  const wide = matchMedia("(min-width: 901px)");
  let last = -1;
  const inset = () => (wide.matches && bar && !bar.hidden ? bar.offsetHeight : 0);
  const update = () => {
    const h = inset();
    if (h === last) return;
    last = h; col.style.setProperty("--bar-h", `${h}px`); onChange(h);
  };
  const ro = new ResizeObserver(update);
  if (bar) ro.observe(bar);
  wide.addEventListener("change", update);
  update();
  return { inset, update, destroy() { ro.disconnect(); wide.removeEventListener("change", update); } };
}

/** On a phone (drawers), the right drawer's handle kept below the map's tools, which stand at the map's right edge (owner,
 *  2026-11-07): at 58 % of the height when that is clear of them, else just under them; when the layout is too short for both (a
 *  phone held sideways, a small screen), the handle back in its place and the tools moved clear of it (`.tools-in`, app.css). */
export function clearHandle(getLayout, getTools) {
  const phone = matchMedia("(max-width: 900px)");
  const ro = new ResizeObserver(() => place());
  let seen = [], retry = 0;                                          // the elements observed (the page may lay its map out again)
  function place() {
    const layout = getLayout(), tools = getTools(), h = layout?.querySelector(".sp-right .sp-handle");
    const els = [layout, tools, h];
    if (els.some((e, k) => e !== seen[k])) { ro.disconnect(); els.forEach((e) => e && ro.observe(e)); seen = els; }
    if (!h || !tools) { clearTimeout(retry); retry = setTimeout(place, 500); return; }         // laid out again: looked for once more
    h.classList.remove("sp-handle-short");
    const reset = () => { h.style.top = ""; h.style.transform = ""; };
    if (!phone.matches || !tools.offsetParent) { reset(); layout.classList.remove("tools-in"); return; }
    const L = layout.getBoundingClientRect(), T = tools.getBoundingClientRect(), room = L.height - 52, end = T.bottom - L.top + 8;
    const fit = (hh) => Math.max(0.58 * L.height - hh / 2, end);
    let hh = h.offsetHeight;
    // too short for the handle with its tab's name: its arrow alone (owner, 2026-11-07: the tools at the edge, an iPhone's height)
    if (fit(hh) + hh > room) { h.classList.add("sp-handle-short"); hh = h.offsetHeight; }
    if (fit(hh) + hh <= room) { h.style.top = `${fit(hh)}px`; h.style.transform = "none"; layout.classList.remove("tools-in"); }
    else { h.classList.remove("sp-handle-short"); reset(); layout.classList.add("tools-in"); }
  }
  phone.addEventListener("change", place);
  place();
  return { place, destroy() { clearTimeout(retry); ro.disconnect(); phone.removeEventListener("change", place); place = () => {}; } };
}

/** The panel's markup: id, side ("left" | "right"), tabs [{ key, label }]; each tab's pane is a div[data-pane=key] the page
 *  fills (inner: the panes' markup by key, optional). */
export function panelHtml({ id, side, tabs, inner = {}, cls = "" }) {
  const fold = side === "left" ? "‹" : "›", open = side === "left" ? "›" : "‹";
  return html`<aside class="sp sp-${side} ${cls}" id="${id}" data-collapsed="0">
    <div class="sp-head"><div class="sp-tabs" role="tablist">${tabs.map((b) => html`<button type="button" role="tab" class="sp-tab" data-tab="${b.key}" aria-selected="false" title="${b.tip || ""}">${b.label}</button>`)}</div>
      <button type="button" class="btn btn-sm sp-fold" title="${t("sp.fold")}" aria-label="${t("sp.fold")}">${fold}</button></div>
    <div class="sp-rail"><button type="button" class="btn btn-sm sp-unfold" title="${t("sp.unfold")}" aria-label="${t("sp.unfold")}">${open}</button>
      ${tabs.map((b) => html`<button type="button" class="sp-rail-tab" data-rail="${b.key}" title="${b.tip || b.label}">${b.label}</button>`)}</div>
    <div class="sp-body">${tabs.map((b) => html`<div class="sp-pane" data-pane="${b.key}" hidden>${raw(inner[b.key] || "")}</div>`)}</div>
    <button type="button" class="sp-handle" aria-expanded="true"><span class="sp-handle-arrow">${open}</span><span class="sp-handle-label"></span></button></aside>`;
}

/** A phone (the layout's own breakpoint, app.css): the panels are drawers over the map, slid away at the opening, one open at a time. */
export const drawers = () => matchMedia("(max-width: 900px)").matches;
/** The pace strip's « Allure » button's arrow: open ▾; folded ▸, or ▴ on a phone where it slides up over the map. */
export const stripArrow = (on) => (on ? "▾" : drawers() ? "▴" : "▸");

/** The analyses' top line's icons (owner, 2026-11-06): beside their words on a computer, in their place on a phone (app.css). */
const svg = (body) => `<svg class="ico" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICONS = {
  map: svg('<path d="M2.5 5 7 3l6 2 4.5-2v12L13 17l-6-2-4.5 2z"/><path d="M7 3v12M13 5v12"/>'),
  times: svg('<circle cx="10" cy="11" r="6.5"/><path d="M10 11V7.5M8 1.8h4M10 1.8v2.7M15.2 4.6l1.3-1.3"/>'),
  add: svg('<path d="M2.5 16.5c2-4 4-.5 6-4s3.5-6 6.5-6"/><circle cx="15" cy="6.5" r="1.4" fill="currentColor"/><path d="M5 3v5M2.5 5.5h5"/>'),
  // the map framed on the routes (owner, 2026-11-07: it was « ⤢ », as full screen): four corners round a route
  fit: svg('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><path d="M6.5 13.5c1.5-3 2.5-1 4-3.5s2-3 3-3.5"/>'),
  // the whole course (owner, 2026-11-07: back from a leg's view): its start triangle, a control, its finish, joined
  course: svg('<path d="M3 16.5 5.6 12 8.2 16.5z"/><circle cx="10" cy="5" r="2.2"/><circle cx="15.5" cy="14" r="2.4"/><circle cx="15.5" cy="14" r="1.1"/><path d="M6.3 11.2 8.9 6.9M11.2 6.9l3.1 5"/>'),
};
/** A button's content: its icon and its words (the words hidden on a phone, the button's title saying them). */
export const iconLabel = (icon, text) => `${ICONS[icon]}<span class="ico-lbl">${text}</span>`;

/**
 * The panel's behaviour: el the <aside>; state { tab, collapsed }; onChange(state) after a change (the page saves it and lays
 * its grid out again; onShow(key) after a tab is shown — charts drawn hidden have no size). Returns { show(key), fold(on),
 * setTab(key, visible) (a tab offered or not), pane(key), state }.
 */
export function bindPanel(el, state, { onChange = () => {}, onShow = () => {} } = {}) {
  const visible = (k) => { const b = $(`[data-tab="${k}"]`, el); return b && !b.hidden; };
  let want = state.tab;                                    // the tab asked for: shown as soon as it is offered, until the reader picks one
  const first = () => $$(".sp-tab", el).find((b) => !b.hidden)?.dataset.tab;
  function show(key, quiet) {
    if (!visible(key)) key = first();
    state.tab = key;
    $$(".sp-tab", el).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === key)));
    $$(".sp-rail-tab", el).forEach((b) => b.classList.toggle("on", b.dataset.rail === key));
    $$(".sp-pane", el).forEach((p) => { p.hidden = p.dataset.pane !== key; });
    const label = $(".sp-handle-label", el);
    if (label) label.textContent = $(`.sp-tab[data-tab="${key}"]`, el)?.textContent || "";
    if (!quiet) onChange(state);
    if (!state.collapsed && !quiet) onShow(key);
  }
  const handle = $(".sp-handle", el), left = el.classList.contains("sp-left");
  function fold(on, quiet) {
    state.collapsed = !!on;
    el.dataset.collapsed = on ? "1" : "0";
    if (handle) {                                          // its arrow points where the drawer goes
      handle.setAttribute("aria-expanded", String(!on));
      $(".sp-handle-arrow", handle).textContent = on === left ? "›" : "‹";
      handle.title = t(on ? "sp.slideIn" : "sp.slideOut");
      handle.setAttribute("aria-label", handle.title);
    }
    // a phone: one drawer open at a time (the other panels of the same layout slide away)
    if (!on && drawers()) [...el.parentElement.children].forEach((o) => { if (o !== el && o.classList.contains("sp")) o.dispatchEvent(new CustomEvent("sp:close")); });
    if (!quiet) onChange(state);
    if (!on && !quiet) onShow(state.tab);
  }
  $$(".sp-tab", el).forEach((b) => b.addEventListener("click", () => { want = b.dataset.tab; show(b.dataset.tab); }));
  $(".sp-fold", el).addEventListener("click", () => fold(true));
  $(".sp-unfold", el).addEventListener("click", () => fold(false));
  handle?.addEventListener("click", () => fold(!state.collapsed));
  el.addEventListener("sp:close", () => { if (!state.collapsed) fold(true); });
  $$(".sp-rail-tab", el).forEach((b) => b.addEventListener("click", () => { want = b.dataset.rail; fold(false, true); show(b.dataset.rail); }));
  if (drawers()) state.collapsed = true;                   // a phone opens on the whole map, both drawers slid away
  fold(state.collapsed, true);
  show(state.tab, true);
  return {
    show, fold, state,
    pane: (k) => $(`[data-pane="${k}"]`, el),
    setTab(key, on) {
      const b = $(`[data-tab="${key}"]`, el), r = $(`[data-rail="${key}"]`, el);
      if (b) b.hidden = !on;
      if (r) r.hidden = !on;
      if (!on && state.tab === key) show(first(), true);
      else if (on && (key === want || !visible(state.tab))) show(key, true);
    },
  };
}

/** A splitter between a panel and the map: dragging sets the panel's width (px) through set(w), from the layout's box. */
export function bindSplitter(split, layout, side, set, done) {
  split.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); split.classList.add("dragging"); document.body.style.userSelect = "none";
    const rect = layout.getBoundingClientRect();
    const move = (ev) => set(side === "left" ? ev.clientX - rect.left - 4 : rect.right - ev.clientX - 4, rect);
    const up = () => {
      split.classList.remove("dragging"); document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      done?.();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  });
}

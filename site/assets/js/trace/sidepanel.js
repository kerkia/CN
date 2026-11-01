// The analyses' side panels (owner, 2026-11-01: « the map is the key and should always be fully visible »): on each side of the
// map a panel of tabs — « Analyse solo »'s curves, legs and computed routes on the left, its display and computing settings on
// the right; « Analyse multi »'s alike —, resized by its splitter, folded to a thin rail by its ‹ / › button, the rail showing
// the tabs' names (a click on one opens the panel on it). The page lays the panels out and keeps their state.

import { html, raw, $, $$ } from "../util.js";
import { t } from "../i18n.js";

/** The panel's markup: id, side ("left" | "right"), tabs [{ key, label }]; each tab's pane is a div[data-pane=key] the page
 *  fills (inner: the panes' markup by key, optional). */
export function panelHtml({ id, side, tabs, inner = {}, cls = "" }) {
  const fold = side === "left" ? "‹" : "›", open = side === "left" ? "›" : "‹";
  return html`<aside class="sp sp-${side} ${cls}" id="${id}" data-collapsed="0">
    <div class="sp-head"><div class="sp-tabs" role="tablist">${tabs.map((b) => html`<button type="button" role="tab" class="sp-tab" data-tab="${b.key}" aria-selected="false">${b.label}</button>`)}</div>
      <button type="button" class="btn btn-sm sp-fold" title="${t("sp.fold")}" aria-label="${t("sp.fold")}">${fold}</button></div>
    <div class="sp-rail"><button type="button" class="btn btn-sm sp-unfold" title="${t("sp.unfold")}" aria-label="${t("sp.unfold")}">${open}</button>
      ${tabs.map((b) => html`<button type="button" class="sp-rail-tab" data-rail="${b.key}" title="${b.label}">${b.label}</button>`)}</div>
    <div class="sp-body">${tabs.map((b) => html`<div class="sp-pane" data-pane="${b.key}" hidden>${raw(inner[b.key] || "")}</div>`)}</div></aside>`;
}

/**
 * The panel's behaviour: el the <aside>; state { tab, collapsed }; onChange(state) after a change (the page saves it and lays
 * its grid out again; onShow(key) after a tab is shown — charts drawn hidden have no size). Returns { show(key), fold(on),
 * setTab(key, visible) (a tab offered or not), pane(key), state }.
 */
export function bindPanel(el, state, { onChange = () => {}, onShow = () => {} } = {}) {
  const visible = (k) => { const b = $(`[data-tab="${k}"]`, el); return b && !b.hidden; };
  const first = () => $$(".sp-tab", el).find((b) => !b.hidden)?.dataset.tab;
  function show(key, quiet) {
    if (!visible(key)) key = first();
    state.tab = key;
    $$(".sp-tab", el).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === key)));
    $$(".sp-rail-tab", el).forEach((b) => b.classList.toggle("on", b.dataset.rail === key));
    $$(".sp-pane", el).forEach((p) => { p.hidden = p.dataset.pane !== key; });
    if (!quiet) onChange(state);
    if (!state.collapsed && !quiet) onShow(key);
  }
  function fold(on, quiet) {
    state.collapsed = !!on;
    el.dataset.collapsed = on ? "1" : "0";
    if (!quiet) onChange(state);
    if (!on && !quiet) onShow(state.tab);
  }
  $$(".sp-tab", el).forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  $(".sp-fold", el).addEventListener("click", () => fold(true));
  $(".sp-unfold", el).addEventListener("click", () => fold(false));
  $$(".sp-rail-tab", el).forEach((b) => b.addEventListener("click", () => { state.collapsed = false; el.dataset.collapsed = "0"; show(b.dataset.rail); }));
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
      else if (on && !visible(state.tab)) show(key, true);
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

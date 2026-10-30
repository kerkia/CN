// Arena's tabs (owner, 2026-10-30). The competitions page: today's and the coming competitions (the Agenda, the ones under
// way marked live) and the past ones (« Résultats »: the last 60 days), two pages shown as one. A race's page: its results,
// then — when the race has split times — the analysis's views as more tabs (« Analyse de course », pages/splits.js).

import { html } from "./util.js";
import { t } from "./i18n.js";

/** The split-time analysis's views, in their order (pages/splits.js). */
export const SPLIT_VIEWS = ["table", "gaps", "clock", "legs", "profile", "h2h", "groups", "follow", "regular", "summary"];

/** The competitions page's two tabs: "coming" or "past". */
export const arenaTabs = (cur) => html`<nav class="page-tabs" role="tablist">
  <a role="tab" href="#/agenda" aria-selected="${cur === "coming"}">${t("arena.tab.coming")}</a>
  <a role="tab" href="#/resultats" aria-selected="${cur === "past"}">${t("arena.tab.past")}</a></nav>`;

/** A race's address: its results, or one of the analysis's views (q: doc, c). */
export function raceHref(key, view, q = {}) {
  const p = new URLSearchParams({ course: key });
  if (q.doc) p.set("doc", q.doc);
  if (q.c) p.set("c", q.c);
  if (view && view !== "results" && view !== "table") p.set("vw", view);
  return `#/${!view || view === "results" ? "resultats" : "analyse-course"}?${p}`;
}

/** The results tab, as a link (the analysis's own views are buttons the splits page binds). */
export const resultsTab = (key, cur) => html`<a role="tab" href="${raceHref(key, "results")}" aria-selected="${cur === "results"}">${t("arena.tab.results")}</a>`;

/** A race's tabs on its results page: the results (shown), then each view of the analysis when the race has split times. */
export const raceTabs = (key, withSplits, q = {}) => html`<nav class="page-tabs race-tabs" role="tablist">${resultsTab(key, "results")}${
  withSplits ? SPLIT_VIEWS.map((v) => html`<a role="tab" href="${raceHref(key, v, q)}" aria-selected="false">${t(`spl.tab.${v}`)}</a>`) : ""}</nav>`;

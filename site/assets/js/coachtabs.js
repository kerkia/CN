// Coach's analyses, each one page whatever the race (owner, 2026-10-30: « a merged workflow for competitions and trainings »):
// « Analyse solo » on a competition of the last 60 days (#/analyse, its published times beside the trace) or on a training or
// any other race (#/analyse-solo); « Analyse multi » on a competition's analysis (#/analyse-competition) or a training's
// (#/analyse-club). Two tabs at the top of each.

import { html } from "./util.js";
import { t } from "./i18n.js";

const TABS = {
  solo: [["race", "#/analyse", "coach.solo.race"], ["free", "#/analyse-solo", "coach.solo.free"]],
  multi: [["race", "#/analyse-competition", "coach.multi.race"], ["club", "#/analyse-club", "coach.multi.club"]],
};

/** The tabs of an analysis: tool "solo" or "multi", cur the tab shown. */
export const coachTabs = (tool, cur) => html`<nav class="page-tabs" role="tablist">${TABS[tool].map(([k, href, key]) =>
  html`<a role="tab" href="${href}" aria-selected="${k === cur}">${t(key)}</a>`)}</nav>`;

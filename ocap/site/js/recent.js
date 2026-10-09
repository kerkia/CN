// « Récemment »: the races of the last 60 days and the results their organisers published, with the split-time
// analyses (no CN) — next step.
import { t } from "./i18n.js";

export function render(view) {
  view.innerHTML = `<header class="bar"><h1>${t("recent.title")}</h1></header><p class="muted pad">${t("wip")}</p>`;
}

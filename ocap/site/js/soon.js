// « Bientôt »: the coming races (FFCO's agenda, without anything of the CN) — next step.
import { t } from "./i18n.js";

export function render(view) {
  view.innerHTML = `<header class="bar"><h1>${t("soon.title")}</h1></header><p class="muted pad">${t("wip")}</p>`;
}

// The three views of the Réseau page — around one runner, among the best, by territory —
// as one switch shown at the top of each of them, so any view can be reached from any other.

import { html, $$ } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as auth from "../auth.js";
import { link } from "../app.js";

const MODES = ["ego", "leaders", "territories"];

/** current: "ego" | "leaders" | "territories". */
export const modeSwitch = (current) => html`<div class="seg" role="group" aria-label="${t("nw.mode")}">
  ${MODES.map((m) => html`<button type="button" data-net-mode="${m}" aria-pressed="${m === current}">${t(`nw.mode.${m}`)}</button>`)}</div>`;

export function bindModeSwitch(root) {
  $$("[data-net-mode]", root).forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.netMode;
    // "around one runner": the last runner looked at, else the logged-in one
    location.hash = m === "leaders" ? link.networkLeaders()
      : m === "territories" ? link.territories()
      : link.network(store.get().lastRunner || auth.session()?.lic);
  }));
}

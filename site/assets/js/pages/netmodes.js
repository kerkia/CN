// The views of the Réseau page — around one runner, among the best, by territory, the statistics
// (figures, participation, ages) — as one switch shown at the top of each of them, so any view can be
// reached from any other. It sits at the right of the intro text, at the same place in every view.

import { html, $$ } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as auth from "../auth.js";
import { link } from "../app.js";

const MODES = ["ego", "leaders", "territories", "stats"];

/** current: "ego" | "leaders" | "territories" | "stats". */
export const modeSwitch = (current) => html`<div class="seg" role="group" aria-label="${t("nw.mode")}">
  ${MODES.map((m) => html`<button type="button" data-net-mode="${m}" aria-pressed="${m === current}">${t(`nw.mode.${m}`)}</button>`)}</div>`;

/** The head of a Réseau view: the title, then the intro text and, at its right, the switch. */
export const netHead = (current, title, lede) => html`<div class="page-head net-head"><h1>${title}</h1>
  <div class="net-sub"><p class="lede">${lede}</p>${modeSwitch(current)}</div></div>`;

export function bindModeSwitch(root) {
  $$("[data-net-mode]", root).forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.netMode;
    // the views counting both disciplines keep the one chosen (?t=)
    const sp = new URLSearchParams(location.hash.split("?")[1] || "").get("t");
    // "around one runner": the last runner looked at, else the logged-in one
    location.hash = m === "leaders" ? link.networkLeaders()
      : m === "territories" ? link.territories({ t: sp })
      : m === "stats" ? link.stats({ t: sp })
      : link.network(store.get().lastRunner || auth.session()?.lic, { t: sp });
  }));
}

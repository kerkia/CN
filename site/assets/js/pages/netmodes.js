// The four views of the Réseau page — around one runner, among the best, by territory, by
// age — as one switch shown at the top of each of them, so any view can be reached from any other.

import { html, $$ } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as auth from "../auth.js";
import { link } from "../app.js";

const MODES = ["ego", "leaders", "territories", "ages"];

/** current: "ego" | "leaders" | "territories" | "ages". */
export const modeSwitch = (current) => html`<div class="seg" role="group" aria-label="${t("nw.mode")}">
  ${MODES.map((m) => html`<button type="button" data-net-mode="${m}" aria-pressed="${m === current}">${t(`nw.mode.${m}`)}</button>`)}</div>`;

export function bindModeSwitch(root) {
  $$("[data-net-mode]", root).forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.netMode;
    // the views counting both disciplines keep the one chosen (?t=)
    const sp = new URLSearchParams(location.hash.split("?")[1] || "").get("t");
    // "around one runner": the last runner looked at, else the logged-in one
    location.hash = m === "leaders" ? link.networkLeaders()
      : m === "territories" ? link.territories({ t: sp })
      : m === "ages" ? link.ages({ t: sp })
      : link.network(store.get().lastRunner || auth.session()?.lic, { t: sp });
  }));
}

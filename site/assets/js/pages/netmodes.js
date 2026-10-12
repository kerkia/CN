// The views of the Réseau page — around one runner, among the best, by territory, the statistics
// (figures, participation, ages) — as one switch shown at the top of each of them, so any view can be
// reached from any other. It sits at the right of the intro text, at the same place in every view.

import { html, $$ } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as auth from "../auth.js";
import { link } from "../app.js";
import { setLede } from "../ui.js";

const MODES = ["ego", "leaders", "territories", "stats", "ages"];

/** current: "ego" | "leaders" | "territories" | "stats" | "ages" — the page's tabs (ui.pageTabs' look). */
export const modeSwitch = (current) => html`<nav class="page-tabs" role="tablist" aria-label="${t("nw.mode")}">
  ${MODES.map((m) => html`<button type="button" role="tab" data-net-mode="${m}" aria-selected="${m === current}">${t(`nw.mode.${m}`)}</button>`)}</nav>`;

/** A view's text, shown beside the page's title (network.render's head); nothing in the view itself. */
export const netHead = (current, title, lede) => { setLede(lede); return ""; };

/** A view's address: the views counting both disciplines keep the one chosen (?t=); « around one runner »: the
 *  last runner looked at, else the logged-in one. */
export function modeHref(m) {
  const sp = new URLSearchParams(location.hash.split("?")[1] || "").get("t");
  return m === "leaders" ? link.networkLeaders()
    : m === "territories" ? link.territories({ t: sp })
    : m === "stats" ? link.stats({ t: sp })
    : m === "ages" ? link.ages({ t: sp })
    : link.network(store.get().lastRunner || auth.session()?.lic, { t: sp });
}

/** The tabs are bound once by the page (network.render); the views' own call does nothing. */
export function bindModeSwitch() {}

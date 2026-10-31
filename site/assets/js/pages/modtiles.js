// A module's own landing on a phone (owner, 2026-10-31): Coach's (#/coach) and Stats' (#/stats) pages as tiles, one a menu
// entry, so that every page is in sight at once (app.moduleHome leads there on a phone; a computer has them in the bar).

import { html } from "../util.js";
import { t } from "../i18n.js";
import { moduleMenus } from "../app.js";
import * as auth from "../auth.js";
import { icon } from "./hub.js";

export async function render(main, r) {
  const m = r.path.split("/").filter(Boolean)[0] === "stats" ? "stats" : "coach";
  const items = moduleMenus()[m];
  main.innerHTML = html`<div class="mod-tiles-page" data-mod="${m}">
    <div class="mod-tiles-head">${icon(m)}<p>${t(m === "coach" ? auth.ownerKey("mod.coach.tag") : `mod.${m}.tag`)}</p></div>
    <div class="mod-tiles">${items.map(([k, href, text]) => html`<a class="mod-tile" href="${href}">
      <b>${text}</b><span>${t(`mt.${k}`)}</span></a>`)}</div>
  </div>`;
  return { title: t(`mod.${m}`) };
}

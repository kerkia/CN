// A module's own landing (owner, 2026-10-31): Coach's (#/coach), Orga's (#/orga) and, on a phone, Stats' (#/stats) pages as
// tiles, one a menu entry, so that every page is in sight at once (app.moduleHome leads there). On a computer three a row (owner,
// 2026-10-31: Coach's and Orga's six as two rows of three), four tiles as two rows of two.

import { html } from "../util.js";
import { t } from "../i18n.js";
import { moduleMenus, tilesModule } from "../app.js";
import * as auth from "../auth.js";
import { icon } from "./hub.js";

export async function render(main, r) {
  const m = tilesModule(r);
  const items = moduleMenus()[m];
  main.innerHTML = html`<div class="mod-tiles-page" data-mod="${m}">
    <div class="mod-tiles-head">${icon(m)}<p>${t(m === "coach" ? auth.ownerKey("mod.coach.tag") : `mod.${m}.tag`)}</p></div>
    <div class="mod-tiles" style="--cols:${items.length === 4 ? 2 : 3}">${items.map(([k, href, text]) => html`<a class="mod-tile" href="${href}">
      <b>${text}</b><span>${t(`mt.${k}`)}</span></a>`)}</div>
  </div>`;
  return { title: t(`mod.${m}`) };
}

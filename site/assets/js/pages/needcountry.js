// What a page of France's data shows to an account that has not joined France (owner, 2026-10-20): the login gate refuses
// the data (_middleware.js `needsFrance`); the page says what joining France opens and leads to Réglages › Mes pays.

import { html } from "../util.js";
import { t } from "../i18n.js";

export async function render(main) {
  main.innerHTML = html`<section class="card account-card"><div class="card-head"><h1 style="font-size:20px;margin:0">${t("cty.need.title")}</h1></div>
    <div class="card-body stack" style="gap:12px">
      <p style="margin:0">${t("cty.need.text")}</p>
      <p class="soft" style="margin:0">${t("cty.need.how")}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/reglages?onglet=pays">${t("cty.need.join")}</a>
        <a class="btn" href="#/agenda">${t("cty.need.agenda")}</a>
      </div>
    </div></section>`;
  return { title: t("cty.need.title") };
}

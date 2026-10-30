// The modules page (#/modules; owner, 2026-10-30): where one lands once signed in or entered without an account, and where
// the logo leads back. Ozimut's four modules — Arena, Stats, Coach, Orga — side by side, each opening on its first page; the
// session's own actions under them (sign out; for a visitor without an account: sign in, create an account, leave). Also
// the page an Orga address shows to an account that has not turned the module on, or on a phone (route « orgaOff »).

import { html, raw, $, nameParts } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { MODULES, moduleMenus, moduleHome, isPhone, orgaOpen, leaveGuest } from "../app.js";

// one drawing a module, in the module's colour (currentColor)
const ICONS = {
  arena: `<path d="M8 4v17" /><path d="M8 4h11v9H8" /><path d="M8 4l11 9" />`,
  stats: `<path d="M4 20h16" /><path d="M7 20v-7" /><path d="M12 20V6" /><path d="M17 20v-10" />`,
  coach: `<circle cx="12" cy="13" r="7" /><path d="M12 13l3-3" /><path d="M10 3h4" /><path d="M12 3v3" />`,
  orga: `<rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" />`,
};
const icon = (m) => raw(`<svg class="hub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[m]}</svg>`);

/** Turn the Orga module on for this account, then show the page again. */
async function turnOrgaOn(btn) {
  btn.disabled = true;
  const r = await auth.api("api/account/settings", { orga: true });
  if (!r.ok) { btn.disabled = false; btn.insertAdjacentHTML("afterend", html`<p class="notice">${t("hub.orga.err")}</p>`.toString()); return false; }
  await auth.refresh();
  return true;
}

/** What the Orga card says, and its button, by who is visiting and on what. */
function orgaState() {
  const me = auth.session();
  if (!me) return { note: t("hub.orga.guest"), action: html`<a class="btn btn-primary" href="#/compte/inscription">${t("hub.register")}</a>` };
  if (isPhone()) return { note: t("hub.orga.phone") };
  if (!me.orga) return { note: t("hub.orga.off"), action: html`<button type="button" class="btn btn-primary" data-orga-on>${t("hub.orga.on")}</button>` };
  return null;
}

// Arena is one page, the competitions: its card says what a competition chosen there offers (owner, 2026-10-30), not links
const ARENA_STEPS = ["agenda", "results", "live", "splits"];      // (the GPS analyses are Coach's, owner 2026-10-30)

function card(m) {
  const items = moduleMenus()[m];
  const locked = m === "orga" ? orgaState() : null;
  const guest = !auth.session();
  return html`<section class="hub-card" data-mod="${m}">
    <div class="hub-card-head">${icon(m)}<div><h2>${t(`mod.${m}`)}</h2><p>${t(`mod.${m}.tag`)}</p></div></div>
    <p class="hub-text">${t(`hub.${m}.text`)}</p>
    ${guest && m === "stats" ? html`<p class="muted hub-note">${t("hub.stats.guest")}</p>` : ""}
    ${guest && m === "coach" ? html`<p class="muted hub-note">${t("hub.coach.guest")}</p>` : ""}
    ${locked ? html`<p class="muted hub-note">${locked.note}</p>${locked.action ? html`<div class="hub-actions">${locked.action}</div>` : ""}`
      : html`<ul class="hub-pages">${m === "arena" ? ARENA_STEPS.map((k) => html`<li><span>${t(`hub.arena.step.${k}`)}</span></li>`)
        : items.map(([, href, text]) => html`<li><a href="${href}">${text}</a></li>`)}</ul>
        <div class="hub-actions"><a class="btn btn-primary" href="${moduleHome(m)}">${t("hub.open", { mod: t(`mod.${m}`) })}</a></div>`}
  </section>`;
}

function session() {
  const me = auth.session();
  if (me) {
    return html`<div class="hub-session"><span>${t("hub.signedAs", { name: nameParts(me.nom).first || me.nom })}</span>
      <a href="#/reglages">${t("st.link")}</a><a href="#/documentation">${t("nav.docs")}</a>
      <button type="button" class="btn btn-sm" data-hub-logout>${t("auth.logout")}</button></div>`;
  }
  return html`<div class="hub-session"><span>${t("hub.guestAs")}</span>
    <a class="btn btn-sm btn-primary" href="#/?s=login">${t("hub.login")}</a>
    <a class="btn btn-sm" href="#/compte/inscription">${t("hub.register")}</a>
    <button type="button" class="btn btn-sm btn-ghost" data-hub-leave>${t("hub.leave")}</button></div>`;
}

export async function render(main, r) {
  if (r.route === "orgaOff") return orgaOff(main);
  const me = auth.session();
  main.innerHTML = html`<div class="hub">
    <div class="hub-head"><h1>${me ? t("hub.hello", { name: nameParts(me.nom).first || me.nom }) : t("hub.welcome")}</h1>
      <p class="lede">${t("hub.lede")}</p></div>
    <div class="hub-grid">${MODULES.map(card)}</div>
    ${session()}
  </div>`;
  main.addEventListener("click", async (e) => {
    const on = e.target.closest("[data-orga-on]");
    if (on && (await turnOrgaOn(on))) { location.hash = moduleMenus().orga[0][1]; return; }
    if (e.target.closest("[data-hub-logout]")) {
      await auth.logout();
      data.dropPrivate();
      location.hash = "#/";
    }
    if (e.target.closest("[data-hub-leave]")) leaveGuest();
  });
  return { title: t("mod.pick") };
}

/** An Orga page to an account without the module, or on a phone: why, and the way to turn it on. */
function orgaOff(main) {
  const st = orgaState() || { note: t("hub.orga.off") };
  main.innerHTML = html`<div class="hub hub-narrow">
    <div class="hub-grid one">${card("orga")}</div>
    <p><a href="#/modules">${t("mod.back")}</a></p>
  </div>`;
  main.addEventListener("click", async (e) => {
    const on = e.target.closest("[data-orga-on]");
    if (on && (await turnOrgaOn(on)) && orgaOpen()) window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  return { title: t("mod.orga"), note: st.note };
}

// The site's country (owner, 2026-10-20): one choice for the whole site, beside the language, as the method is. The pages
// that depend on a country (Agenda, Résultats, the organisers' pickers; the rankings once another country has data) show
// that country's. Offered only once two countries have data (meta.json `countries`; France alone until then). Default: the
// first country the account joined successfully that has data, else the first that has data. Kept on the device
// (localStorage ocn.country). Countries are ISO alpha-2 codes, named in the reader's language by the browser.

import { html } from "./util.js";
import { t, lang } from "./i18n.js";
import * as data from "./data.js";
import * as auth from "./auth.js";

const KEY = "ocn.country";
/** The countries whose data the site holds. */
export const withData = () => (Array.isArray(data.meta()?.countries) && data.meta().countries.length ? data.meta().countries : ["FR"]);
/** A country's name in the site's language. */
export function name(cc) {
  try { return new Intl.DisplayNames([lang()], { type: "region" }).of(cc) || cc; } catch (e) { return cc; }
}
/** The site's country now. */
export function current() {
  const ok = withData();
  let kept = null;
  try { kept = localStorage.getItem(KEY); } catch (e) { /* none */ }
  if (ok.includes(kept)) return kept;
  const mine = (auth.session()?.countries || []).filter((c) => c.status === "ok").map((c) => c.cc);
  return mine.find((cc) => ok.includes(cc)) || ok[0];
}
export function pick(cc) {
  try { localStorage.setItem(KEY, cc); } catch (e) { /* this visit only: the default again next time */ }
}
/** An event or race of a country (the data's `country`; France when it has none, as everything before 2026-10-20). */
export const of = (x) => x?.country || "FR";

/** The header's menu, beside the language's: nothing while only one country has data. */
export function menu() {
  const ok = withData();
  if (ok.length < 2) return "";
  const cur = current();
  return html`<div class="nav-group lang-menu" data-group="country">
    <button class="icon-btn nav-top" type="button" aria-expanded="false" aria-haspopup="menu" title="${t("cty.menu")}" aria-label="${t("cty.menu")}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>
      <span class="lang-code">${cur}</span>
    </button>
    <div class="nav-menu" role="menu">${ok.map((cc) => html`<button type="button" role="menuitemradio" aria-checked="${String(cc === cur)}" data-country-pick="${cc}">${name(cc)}</button>`)}</div>
  </div>`;
}

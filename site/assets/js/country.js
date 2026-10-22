// The site's country (owner, 2026-10-20): one choice for the whole site, beside the language, as the method is. The pages
// that depend on a country (Agenda, Résultats, En direct, the organisers' pickers; the rankings once another country has data)
// show that country's. One place to choose it, the header's menu (owner, 2026-10-21: the Agenda's « Pays » field and En direct's
// repeated it): first the countries whose data the site reads (meta.json `countries`; France alone until then) and those the
// account has joined, whose competitions their organisers declare (functions/api/declared.js), then every other IOF member —
// liveresultat carries races of many (« En direct »). Default: the first country the account joined successfully, else the
// first with data. Kept on the device (localStorage ocn.country). Countries are ISO alpha-2 codes, named in the reader's language by the browser.

import { html } from "./util.js";
import { t, lang } from "./i18n.js";
import * as data from "./data.js";
import * as auth from "./auth.js";
import { flag } from "./vendor.js";

const KEY = "ocn.country";
/** The countries the site offers: those whose data it holds, then those the account has joined (their organisers' competitions). */
export function withData() {
  const read = Object.keys(data.site()?.countries || {});
  if (!read.length) read.push("FR");
  const mine = (auth.session()?.countries || []).filter((c) => c.status === "ok").map((c) => c.cc);
  return [...new Set([...read, ...mine])];
}
/** A country's name in the site's language. */
export function name(cc) {
  try { return new Intl.DisplayNames([lang()], { type: "region" }).of(cc) || cc; } catch (e) { return cc; }
}
/** The site's country now. */
export function current() {
  const ok = withData();
  let kept = null;
  try { kept = localStorage.getItem(KEY); } catch (e) { /* none */ }
  if (ok.includes(kept) || MEMBERS.includes(kept)) return kept;
  const mine = (auth.session()?.countries || []).filter((c) => c.status === "ok").map((c) => c.cc);
  return mine.find((cc) => ok.includes(cc)) || ok[0];
}
export function pick(cc) {
  try { localStorage.setItem(KEY, cc); } catch (e) { /* this visit only: the default again next time */ }
}
/** An event or race of a country (the data's `country`; France when it has none, as everything before 2026-10-20). */
export const of = (x) => x?.country || "FR";
/** What the site has of a country (data/meta.json `countries`): { access, federation, ranking, agenda, methods… }, or null. */
export const info = (cc = current()) => data.site()?.countries?.[cc] || null;
/** Who may read a country's data: "members" (France) or "all" (Spain); a country the site has no data for: null. */
export const access = (cc) => info(cc)?.access || null;
/** Does the site rank a country's runners (its runners, ranking, clubs… pages)? */
export const ranks = (cc = current()) => !!info(cc)?.ranking;

/** The header's menu, beside the language's: the countries with data or joined, then every other member country. */
/** A country's flag (owner, 2026-10-22: beside every country choice), or nothing for an unknown one. */
export const flagImg = (cc, cls = "cty-flag") => (cc && /^[A-Z]{2}$/.test(cc)
  ? html`<img class="${cls}" src="${flag(cc)}" alt="" width="18" height="13" loading="lazy" decoding="async">` : "");

export function menu() {
  const ok = withData();
  const cur = current();
  const item = (cc) => html`<button type="button" role="menuitemradio" aria-checked="${String(cc === cur)}" data-country-pick="${cc}">${flagImg(cc)}${name(cc)}</button>`;
  return html`<div class="nav-group lang-menu" data-group="country">
    <button class="icon-btn nav-top" type="button" aria-expanded="false" aria-haspopup="menu" title="${t("cty.menu")}" aria-label="${t("cty.menu")}">
      ${flagImg(cur) || html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>`}
      <span class="lang-code">${cur}</span>
    </button>
    <div class="nav-menu cty-menu" role="menu">${ok.map(item)}<div class="nav-menu-head">${t("cty.others")}</div>${sortedMembers(ok).map(item)}</div>
  </div>`;
}

// The IOF's member countries (2026), as functions/_lib/countries.js `COUNTRIES` — keep the two in step.
export const MEMBERS = ["FR",
  "AR", "AT", "AU", "AZ", "BA", "BE", "BG", "BR", "BY", "CA", "CH", "CL", "CN", "CO", "CY", "CZ", "DE", "DK", "EC", "EE",
  "ES", "FI", "GB", "GE", "GR", "HK", "HR", "HU", "IE", "IL", "IN", "IS", "IT", "JP", "KE", "KR", "KZ", "LT", "LU", "LV",
  "MA", "MD", "ME", "MK", "MN", "MT", "MX", "MY", "NL", "NO", "NZ", "PH", "PK", "PL", "PT", "RO", "RS", "RU", "SE", "SG",
  "SI", "SK", "TH", "TN", "TR", "TW", "UA", "US", "UY", "UZ", "VN", "XK", "ZA"];
/** The member countries by name in the site's language, France first; `except` left out. */
export const sortedMembers = (except = []) => ["FR", ...MEMBERS.slice(1).sort((a, b) => name(a).localeCompare(name(b), lang()))]
  .filter((cc) => !except.includes(cc));

/**
 * One membership's fields (registration, Réglages › Mes pays): country, club, member id — the id is France's FFCO licence
 * (required, checked), elsewhere optional. `fixed`: the country cannot be changed (registration while only France is open,
 * a membership being edited). `row`: { cc, club, id }.
 */
export function membershipFields(prefix, { row = {}, fixed = false, except = [], allowNone = false } = {}) {
  const cc = row.cc || (allowNone ? "" : "FR");
  return html`<div class="cty-fields" data-cty="${prefix}">
    <label class="field"><span>${t("cty.field.country")}</span><span class="cty-pick"><span class="cty-pick-flag">${flagImg(cc)}</span>
      <select name="${prefix}-cc" ${fixed ? "disabled" : ""}>
        ${allowNone ? html`<option value="" ${cc ? "" : "selected"}>${t("cty.field.none")}</option>` : ""}
        ${sortedMembers(except.filter((x) => x !== cc)).map((c) => html`<option value="${c}" ${c === cc ? "selected" : ""}>${name(c)}</option>`)}
      </select></span></label>
    <div class="row cty-more" style="gap:12px;flex-wrap:wrap" ${cc ? "" : "hidden"}>
      <label class="field" style="flex:1;min-width:160px"><span>${t("cty.field.club")}</span>
        <input name="${prefix}-club" type="text" maxlength="80" value="${row.club || ""}" autocomplete="off"></label>
      <label class="field" style="flex:1;min-width:160px"><span class="cty-id-label">${t(cc === "FR" ? "cty.field.id.FR" : "cty.field.id")}</span>
        <input name="${prefix}-id" type="text" maxlength="30" value="${row.id || ""}" autocomplete="off" ${cc === "FR" ? 'inputmode="numeric" required' : ""}></label>
    </div>
  </div>`;
}
/** Wire the fields drawn by `membershipFields` inside `root`: the id's label and need follow the country. */
export function bindMembershipFields(root) {
  for (const box of root.querySelectorAll("[data-cty]")) {
    const sel = box.querySelector("select"), more = box.querySelector(".cty-more"), id = box.querySelector(`[name$="-id"]`);
    const sync = () => {
      const fr = sel.value === "FR";
      box.querySelector(".cty-pick-flag").innerHTML = flagImg(sel.value);
      more.hidden = !sel.value;
      box.querySelector(".cty-id-label").textContent = t(fr ? "cty.field.id.FR" : "cty.field.id");
      id.required = fr && !!sel.value;
      if (fr) id.setAttribute("inputmode", "numeric"); else id.removeAttribute("inputmode");
    };
    sel.addEventListener("change", sync);
    sync();
  }
}
/** The membership a form holds under `prefix`: { country, club, id }, or null when no country is chosen. */
export function readMembership(form, prefix) {
  const cc = form.querySelector(`[name="${prefix}-cc"]`)?.value;
  if (!cc) return null;
  return { country: cc, club: form.querySelector(`[name="${prefix}-club"]`)?.value || "", id: form.querySelector(`[name="${prefix}-id"]`)?.value || "" };
}

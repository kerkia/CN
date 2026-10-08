// Public account pages (reachable logged out): sign-up, e-mail confirmation, forgotten
// password, reset, resend, privacy policy. #/compte/<view>[?token=…]

import { html, $, esc } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { SITE } from "../app.js";

const VIEWS = {
  inscription: register, verifier: verify, "mot-de-passe": forgot, reinitialiser: reset,
  renvoyer: resend, confidentialite: privacy,
};

export async function render(main, { arg, query }) {
  const view = VIEWS[arg] || register;
  return view(main, query);
}

const card = (title, body) => html`<section class="card account-card"><div class="card-head"><h1 style="font-size:20px;margin:0">${title}</h1></div>
  <div class="card-body">${body}</div></section>`;
const toLogin = () => html`<a class="btn btn-primary" href="#/" style="justify-content:center">${t("ac.toLogin")}</a>`;
const show = (el, text, ok = false) => { el.textContent = text; el.className = `notice${ok ? " ok" : ""}`; el.hidden = false; };

/** Wire a form: disable the button while `go` runs; `go` returns an error message, or null when done. */
function bind(form, label, go) {
  const err = $(".notice", form), btn = $("button[type=submit]", form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true; btn.textContent = t("ac.sending");
    const msg = await go(new FormData(form), err);
    if (msg) { show(err, msg); btn.disabled = false; btn.textContent = label; }
  });
}

// ---- sign-up ---------------------------------------------------------------------------------
async function register(main) {
  let open = true;
  try { open = (await (await fetch("api/account/status")).json()).registration; } catch (e) { open = false; }
  main.innerHTML = card(t("ac.reg.title"), !open
    ? html`<div class="notice info">${t("ac.reg.closed")}</div><a class="btn" href="#/" style="justify-content:center">${t("ac.toLogin")}</a>`
    : html`<p class="soft" style="margin:0">${t("ac.reg.lede")}</p>
      <form id="reg" class="stack" style="gap:12px" autocomplete="on">
        <div class="row" style="gap:12px;flex-wrap:nowrap">
          <label class="field" style="flex:1"><span>${t("ac.reg.first")}</span><input name="first" type="text" autocomplete="given-name" required maxlength="60"></label>
          <label class="field" style="flex:1"><span>${t("ac.reg.last")}</span><input name="last" type="text" autocomplete="family-name" required maxlength="60"></label>
        </div>
        <label class="field"><span>${t("ac.reg.licence")}</span><input name="licence" type="text" inputmode="numeric" autocomplete="off" required maxlength="12"></label>
        <label class="field"><span>${t("ac.email")}</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
        <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
        <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
        <div class="hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
        <label class="check"><input name="consent" type="checkbox" required><span>${t("ac.reg.consent")}
          <a href="#/compte/confidentialite">${t("ac.reg.privacy")}</a></span></label>
        <div class="notice" hidden></div>
        <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${t("ac.reg.submit")}</button>
      </form>
      <a href="#/">${t("ac.toLogin")}</a>`);
  const form = $("#reg");
  if (!form) return { title: t("ac.reg.title") };
  bind(form, t("ac.reg.submit"), async (f) => {
    if (f.get("password") !== f.get("password2")) return t("ac.reg.err.password2");
    const r = await auth.api("api/account/register", {
      email: f.get("email"), password: f.get("password"), first: f.get("first"), last: f.get("last"),
      licence: f.get("licence"), consent: f.get("consent") === "on", website: f.get("website"),
    });
    if (r.ok) {
      form.outerHTML = html`<div class="notice ok">${t("ac.reg.done")} <b>${f.get("email")}</b>.</div>
        <p class="soft" style="margin:0">${t("ac.reg.done2")}</p>
        ${r.data?.mail === "queued" ? html`<p class="muted" style="margin:0">${t("ac.reg.queued")}</p>` : ""}
        <p style="margin:0"><a href="#/compte/renvoyer">${t("ac.resend")}</a></p>`.toString();
      return null;
    }
    if (r.status === 0) return t("ac.err.unavailable");
    if (r.status === 429) return t("ac.err.rate");
    if (r.status === 503) return t("ac.reg.closed");
    return t(`ac.reg.err.${r.data?.error}`) !== `ac.reg.err.${r.data?.error}` ? t(`ac.reg.err.${r.data?.error}`) : t("ac.err.generic");
  });
  return { title: t("ac.reg.title") };
}

// ---- e-mail confirmation (the link in the message) ----------------------------------------------
async function verify(main, query) {
  main.innerHTML = card(t("ac.verify.title"), html`<div id="vr" class="notice info">${t("ac.verify.run")}</div>`);
  const r = query.token ? await auth.api("api/account/verify", { token: query.token }) : { ok: false, status: 410 };
  const box = $("#vr");
  if (r.ok) {
    show(box, t("ac.verify.ok"), true);
    box.insertAdjacentHTML("afterend", toLogin().toString());
  } else {
    show(box, r.status === 0 ? t("ac.err.unavailable") : t("ac.verify.bad"));
    box.insertAdjacentHTML("afterend", html`<a href="#/compte/renvoyer">${t("ac.resend")}</a>`.toString());
  }
  return { title: t("ac.verify.title") };
}

// ---- single-field mail forms: resend / forgot -----------------------------------------------------
function emailForm(main, { title, lede, label, endpoint, done }) {
  main.innerHTML = card(title, html`<p class="soft" style="margin:0">${lede}</p>
    <form id="ef" class="stack" style="gap:12px">
      <label class="field"><span>${t("ac.email")}</span><input name="email" type="email" autocomplete="email" required></label>
      <div class="notice" hidden></div>
      <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${label}</button>
    </form><a href="#/">${t("ac.toLogin")}</a>`);
  bind($("#ef"), label, async (f, err) => {
    const r = await auth.api(endpoint, { email: f.get("email") });
    if (r.status === 0) return t("ac.err.unavailable");
    if (r.status === 429) return t("ac.err.rate");
    $("#ef").outerHTML = html`<div class="notice ok">${done}</div>`.toString();
    return null;
  });
  return { title };
}
function resend(main) {
  return emailForm(main, {
    title: t("ac.resend.title"), lede: t("ac.resend.lede"), label: t("ac.resend"), endpoint: "api/account/resend", done: t("ac.resend.done"),
  });
}
function forgot(main) {
  return emailForm(main, {
    title: t("ac.forgot.title"), lede: t("ac.forgot.lede"), label: t("ac.forgot.submit"), endpoint: "api/account/forgot", done: t("ac.forgot.done"),
  });
}

// ---- new password (the link in the reset message) -----------------------------------------------
async function reset(main, query) {
  main.innerHTML = card(t("ac.reset.title"), html`<form id="rf" class="stack" style="gap:12px">
      <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
      <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="10" maxlength="200"></label>
      <div class="notice" hidden></div>
      <button class="btn btn-primary" type="submit" style="height:40px;justify-content:center">${t("ac.reset.submit")}</button>
    </form>`);
  bind($("#rf"), t("ac.reset.submit"), async (f) => {
    if (f.get("password") !== f.get("password2")) return t("ac.reg.err.password2");
    const r = await auth.api("api/account/reset", { token: query.token, password: f.get("password") });
    if (r.ok) {
      $("#rf").outerHTML = html`<div class="notice ok">${t("ac.reset.ok")}</div>${toLogin()}`.toString();
      return null;
    }
    if (r.status === 0) return t("ac.err.unavailable");
    return r.status === 422 ? t("ac.reg.err.password") : t("ac.reset.bad");
  });
  return { title: t("ac.reset.title") };
}

// ---- privacy policy -----------------------------------------------------------------------------
async function privacy(main) {
  main.innerHTML = html`<section class="card account-card" style="max-width:760px"><div class="card-head"><h1 style="font-size:20px;margin:0">${t("pv.title")}</h1></div>
    <div class="card-body prose">
      <p>${SITE} est un site indépendant, sans lien avec la FFCO. Il est exploité à titre personnel et non commercial. Contact : <b>ocn@kerkia.com</b>.</p>
      <h2 style="font-size:16px">Données des résultats</h2>
      <p>Les classements, résultats et calculs affichés proviennent des résultats publiés par la FFCO sur cn.ffcorientation.fr (nom, club, catégorie, numéro de licence, temps, place). Pour faire retirer ou rectifier une donnée vous concernant, écrivez-nous : nous en examinerons la demande, sachant que la source reste le site de la FFCO.</p>
      <p>La page « Récemment » montre aussi, pour les courses des 30 derniers jours, les résultats que les organisateurs publient eux-mêmes (sur leur site, liveresultat, WinSplits, Helga…) ou déposent sur ${SITE}.</p>
      <h2 style="font-size:16px">Dépôts de résultats</h2>
      <p>Quand vous déposez un fichier de résultats, nous enregistrons votre compte, la course, le nom et la taille du fichier et la date du dépôt. Le fichier est conservé 60 jours dans le stockage du site (Cloudflare), puis effacé ; les résultats qu'il contient restent affichés. L'administrateur voit qui a déposé quoi et peut retirer un dépôt.</p>
      <h2 style="font-size:16px">Données de votre compte</h2>
      <ul>
        <li><b>Ce que nous conservons :</b> adresse e-mail, prénom, nom et numéro de licence que vous avez saisis, mot de passe (sous forme chiffrée irréversible), date d'inscription et de dernière connexion, votre réglage de notification et la liste des courses déjà annoncées par e-mail.</li>
        <li><b>Pourquoi :</b> réserver l'accès aux licenciés de la FFCO, confirmer votre adresse, réinitialiser votre mot de passe, détecter plusieurs comptes pour une même licence et, si vous le demandez, vous prévenir de la mise en ligne de vos courses.</li>
        <li><b>Combien de temps :</b> jusqu'à la suppression du compte, que vous pouvez faire à tout moment dans Réglages.</li>
        <li><b>Qui y a accès :</b> l'administrateur du site, et les prestataires techniques qui hébergent le site et envoient les e-mails (Cloudflare et Resend). Aucune donnée n'est vendue ni utilisée à des fins publicitaires.</li>
      </ul>
      <h2 style="font-size:16px">Statistiques d'utilisation</h2>
      <p>Pour savoir comment le site est utilisé et l'améliorer, il compte, pour chaque compte, le nombre de pages vues par jour et par
        rubrique (Classement, Coureur, Réseau…) et le nombre de visites. Rien d'autre n'est enregistré (ni ce que vous cherchez, ni l'adresse IP).
        Ces chiffres ne sont visibles que de l'administrateur, conservés 13 mois, et supprimés avec le compte.</p>
      <h2 style="font-size:16px">Cookies</h2>
      <p>Un seul cookie, strictement nécessaire, maintient votre connexion. Le navigateur garde aussi vos préférences d'affichage (thème, discipline choisie). Aucun traceur publicitaire ni outil de mesure d'audience tiers.</p>
      <h2 style="font-size:16px">Vos droits</h2>
      <p>Vous pouvez supprimer votre compte vous-même (Réglages), ou demander l'accès, la rectification ou l'effacement de vos données en écrivant à ocn@kerkia.com. Vous pouvez aussi saisir la CNIL.</p>
      <p><a href="#/">← ${t("ac.toLogin")}</a></p>
    </div></section>`.toString();
  return { title: t("pv.title") };
}

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
        <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
        <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
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
      <label class="field"><span>${t("ac.password")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
      <label class="field"><span>${t("ac.password2")}</span><input name="password2" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
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
  // the GDPR's information (articles 13 and 14) and the legal notices (LCEN, article 6): reviewed 2026-10-15 — keep the date
  // below up to date when what the site keeps changes
  main.innerHTML = html`<section class="card account-card" style="max-width:760px"><div class="card-head"><h1 style="font-size:20px;margin:0">${t("pv.title")}</h1></div>
    <div class="card-body prose">
      <p>${SITE} est un site indépendant, sans lien avec la FFCO, publié à titre personnel et non commercial par <b>Yann Le Helloco</b>,
        responsable du traitement des données décrites ici. Contact : <b>ocn@kerkia.com</b>.</p>
      <h2 style="font-size:16px">Utilisation équitable</h2>
      <p>${SITE} fonctionne sur des ressources gratuites et limitées, partagées par tous ses utilisateurs. Il est fait pour être
        consulté personnellement par les licenciés, dans un navigateur. Sans notre accord préalable, sont donc exclus : la collecte
        automatisée (robots, scripts, aspiration des pages ou des fichiers de données), les téléchargements en masse, la
        réutilisation des données à d'autres fins, et tout usage qui chargerait le site au détriment des autres. Un compte qui ne
        respecte pas ces règles peut être suspendu.</p>
      <p>Vous avez un besoin particulier — une étude, les besoins d'un club ou d'une ligue, des données pour un autre outil ?
        Écrivez-nous (« Nous écrire », ou ocn@kerkia.com) : nous l'étudierons volontiers.</p>
      <h2 style="font-size:16px">Données des résultats, y compris des licenciés sans compte</h2>
      <p>Les classements, résultats et calculs affichés proviennent des résultats publiés par la FFCO sur cn.ffcorientation.fr :
        nom, club, catégorie, numéro de licence, temps et place de chaque licencié classé, qu'il ait ou non un compte sur ${SITE},
        jeunes licenciés compris. ${SITE} en tire des CN recalculés, des classements, des comparaisons et des statistiques (clubs,
        territoires, pyramide des âges, coureurs croisés en course). La page « Résultats » montre aussi, pour les courses des 60
        derniers jours, les résultats que les organisateurs publient eux-mêmes (sur leur site, liveresultat, WinSplits, Helga…) ou
        déposent sur ${SITE}, rapprochés des licences par le nom et le club.</p>
      <p>Base légale : notre intérêt légitime à informer les licenciés et à analyser le classement national, à partir de résultats
        déjà publiés. Sur ${SITE}, ces données ne sont visibles que des comptes connectés, réservés aux licenciés. Vous pouvez vous
        opposer à leur affichage, ou en demander la rectification, en écrivant à ocn@kerkia.com : nous cessons de les afficher sauf
        motif légitime impérieux, sachant que la source reste le site de la FFCO. Un parent peut exercer ces droits pour un enfant
        mineur.</p>
      <h2 style="font-size:16px">Dépôts de résultats</h2>
      <p>Quand vous déposez un fichier de résultats, nous enregistrons votre compte, la course, le nom et la taille du fichier et la date du dépôt. Le fichier est conservé 60 jours dans le stockage du site (Cloudflare), puis effacé ; les résultats qu'il contient restent affichés. L'administrateur voit qui a déposé quoi et peut retirer un dépôt.</p>
      <h2 style="font-size:16px">Analyses de traces GPS</h2>
      <p>La page « Analyse solo » lit votre carte et votre trace GPS dans votre navigateur : rien n'est envoyé ; elles y restent le temps de votre visite.
        Dans une « Analyse multi » (un entraînement ou une compétition), l'organisateur dépose les cartes et les parcours, et chaque participant peut ajouter
        sa propre trace : elle est alors envoyée et conservée dans le stockage du site (Cloudflare), avec votre nom et votre numéro de licence,
        réduite aux positions et aux heures sur la zone de la carte (ni fréquence cardiaque, ni cadence, ni le trajet hors de la carte). Elle est visible
        des personnes qui peuvent ouvrir l'analyse — tous les licenciés connectés, les membres du club de l'organisateur ou ceux qui ont son mot de
        passe, selon son choix. Vous pouvez la retirer à tout moment ; elle est effacée avec l'analyse et avec votre compte. Les cartes
        d'une analyse sont conservées tant qu'elle existe ; si son organisateur supprime son compte, l'analyse reste, sans son nom.
        Vos propres courbes (allure, fréquence cardiaque, cadence…) dans une « Analyse multi » viennent de votre fichier, gardé dans votre
        navigateur sur cet appareil : il n'est pas envoyé, et personne d'autre ne les voit.</p>
      <h2 style="font-size:16px">Données de votre compte</h2>
      <ul>
        <li><b>Ce que nous conservons :</b> adresse e-mail, prénom, nom et numéro de licence que vous avez saisis (vérifiés à l'inscription
          d'après les résultats publiés par la FFCO), mot de passe (sous forme chiffrée irréversible), date d'inscription et de
          dernière connexion, vos réglages d'alertes (régions choisies) et la liste des courses déjà annoncées par e-mail, et, pour le
          simulateur de relais, les coureurs que vous ajoutez (nom, catégorie, CN estimé) et ceux que vous marquez indisponibles, que vous
          seul voyez. N'y ajoutez que des personnes d'accord.</li>
        <li><b>Pourquoi, et sur quelle base :</b> fournir le service que vous demandez en créant un compte — réserver l'accès aux licenciés de
          la FFCO, confirmer votre adresse, réinitialiser votre mot de passe ; notre intérêt légitime à détecter plusieurs comptes pour
          une même licence ; votre choix pour les alertes par e-mail, que vous pouvez couper à tout moment dans Réglages.</li>
        <li><b>Combien de temps :</b> jusqu'à la suppression du compte, que vous pouvez faire à tout moment dans Réglages. Un e-mail en
          attente d'envoi est effacé dès qu'il part.</li>
        <li><b>Qui y a accès :</b> l'administrateur du site, et les prestataires techniques indiqués plus bas. Aucune donnée n'est vendue
          ni utilisée à des fins publicitaires.</li>
      </ul>
      <p>Un message envoyé par « Nous écrire » nous parvient par e-mail, avec votre adresse, votre nom et le navigateur utilisé ; il est
        gardé dans notre messagerie le temps de vous répondre et de suivre la demande.</p>
      <h2 style="font-size:16px">Statistiques d'utilisation</h2>
      <p>Pour savoir comment le site est utilisé et l'améliorer (notre intérêt légitime), il compte, pour chaque compte, le nombre de
        pages vues par jour et par rubrique (Classement, Coureur, Réseau…) et le nombre de visites. Rien d'autre n'est enregistré (ni ce
        que vous cherchez, ni l'adresse IP). Ces chiffres ne sont visibles que de l'administrateur, conservés 13 mois, et supprimés avec le
        compte.</p>
      <h2 style="font-size:16px">Sécurité</h2>
      <p>Pour limiter les tentatives répétées (connexion, inscription, mot de passe oublié), le site compte les essais par adresse IP et
        par adresse e-mail ; ces compteurs sont effacés au bout d'un jour environ. Comme tout site, l'hébergeur peut aussi traiter
        l'adresse IP pour acheminer les pages et protéger le site contre les attaques.</p>
      <h2 style="font-size:16px">Prestataires et transferts hors de l'Union européenne</h2>
      <ul>
        <li><b>Cloudflare, Inc.</b> (États-Unis) héberge le site, sa base de comptes et son stockage de fichiers. Les transferts vers les
          États-Unis reposent sur le cadre de protection des données UE-États-Unis (Data Privacy Framework), auquel Cloudflare est
          certifié.</li>
        <li><b>Resend</b> (Plus Five Five, Inc., États-Unis) envoie les e-mails du site : votre adresse et le contenu du message.
          Transferts encadrés par les clauses contractuelles types de la Commission européenne.</li>
        <li><b>GitHub, Inc.</b> (États-Unis) exécute les mises à jour automatiques du site : les résultats et les fichiers déposés y sont
          traités, jamais les comptes. Transferts encadrés par les clauses contractuelles types.</li>
      </ul>
      <h2 style="font-size:16px">Cookies et stockage du navigateur</h2>
      <p>Un seul cookie, strictement nécessaire, maintient votre connexion (30 jours au plus). Le navigateur garde aussi vos préférences
        d'affichage (thème, discipline, méthode choisies, saisies du calculateur VMA ou du simulateur de relais) : elles restent sur votre
        appareil. Aucun traceur publicitaire ni outil de mesure d'audience tiers ; aucun consentement n'est donc demandé.</p>
      <h2 style="font-size:16px">Vos droits</h2>
      <p>Vous pouvez supprimer votre compte vous-même (Réglages). Vous pouvez aussi demander l'accès à vos données, leur rectification,
        leur effacement, la limitation de leur traitement ou leur portabilité, et vous opposer à un traitement fondé sur notre intérêt
        légitime, en écrivant à ocn@kerkia.com : nous répondons dans un délai d'un mois. Si vous estimez que vos droits ne sont pas
        respectés, vous pouvez adresser une réclamation à la CNIL
        (<a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">cnil.fr/fr/plaintes</a>).</p>
      <h2 style="font-size:16px">Mentions légales</h2>
      <p><b>Éditeur et directeur de la publication :</b> Yann Le Helloco, particulier, publication non professionnelle — ocn@kerkia.com.<br>
        <b>Hébergeur :</b> Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis — +1 888 993 5273.</p>
      <p class="muted">Dernière mise à jour : 15 octobre 2026.</p>
      <p><a href="#/">← ${t("ac.toLogin")}</a></p>
    </div></section>`.toString();
  return { title: t("pv.title") };
}

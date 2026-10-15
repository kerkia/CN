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
      <p>${SITE} est un site indépendant, sans lien avec la Fédération française de course d'orientation (FFCO). Il est édité à titre
        personnel et non commercial par <b>Yann Le Helloco</b>, responsable du traitement des données personnelles décrites ci-dessous
        au sens du règlement (UE) 2016/679 (RGPD). Contact : <b>ocn@kerkia.com</b>.</p>
      <h2 style="font-size:16px">Conditions d'utilisation</h2>
      <p>${SITE} fonctionne avec des ressources gratuites et limitées, partagées entre tous ses utilisateurs. Il est destiné à être
        consulté personnellement par les licenciés, au moyen d'un navigateur. Sauf accord préalable de l'éditeur, sont en conséquence
        interdits : la collecte automatisée (robots, scripts, aspiration des pages ou des fichiers de données), les téléchargements
        massifs, la réutilisation des données à d'autres fins et tout usage de nature à surcharger le site au détriment des autres
        utilisateurs. Un compte qui ne respecte pas ces règles peut être suspendu.</p>
      <p>Pour un besoin particulier (étude, besoins d'un club ou d'une ligue, données destinées à un autre outil), il est possible
        d'écrire à l'éditeur, par la page « Nous écrire » ou à ocn@kerkia.com : la demande sera examinée.</p>
      <h2 style="font-size:16px">Données des résultats, y compris celles des licenciés sans compte</h2>
      <p>Les classements, résultats et calculs affichés proviennent des résultats publiés par la FFCO sur cn.ffcorientation.fr : nom,
        club, catégorie, numéro de licence, temps et place de chaque licencié classé, qu'il dispose ou non d'un compte sur ${SITE}, y
        compris les licenciés mineurs. ${SITE} en tire des CN recalculés, des classements, des comparaisons et des statistiques (clubs,
        territoires, pyramide des âges, coureurs rencontrés en course). La page « Résultats » présente en outre, pour les courses des
        60 derniers jours, les résultats publiés par les organisateurs eux-mêmes (sur leur site, liveresultat, WinSplits, Helga, etc.)
        ou déposés sur ${SITE}, rapprochés des licences d'après le nom et le club.</p>
      <p>Ce traitement repose sur l'intérêt légitime de l'éditeur à informer les licenciés et à analyser le classement national à
        partir de résultats déjà publiés. Sur ${SITE}, ces données ne sont accessibles qu'aux comptes connectés, réservés aux
        licenciés. Toute personne concernée peut en demander la rectification ou demander à ne plus y être identifiée (voir
        « Vos droits ») ; la source demeure le site de la FFCO.</p>
      <h2 style="font-size:16px">Dépôts de résultats</h2>
      <p>Lors du dépôt d'un fichier de résultats, sont enregistrés le compte de l'auteur du dépôt, la course, le nom et la taille du
        fichier ainsi que la date du dépôt. Le fichier est conservé 60 jours dans l'espace de stockage du site (Cloudflare), puis
        effacé ; les résultats qu'il contient restent affichés. L'administrateur voit l'auteur de chaque dépôt et peut retirer un
        dépôt.</p>
      <h2 style="font-size:16px">Analyses de traces GPS</h2>
      <p>La page « Analyse solo » lit la carte et la trace GPS dans votre navigateur : aucune donnée n'est transmise au site, et ces
        fichiers ne sont conservés que le temps de la visite.</p>
      <p>Dans une « Analyse multi » (entraînement ou compétition), l'organisateur dépose les cartes et les parcours, et chaque
        participant peut y ajouter sa propre trace. Celle-ci est alors transmise et conservée dans l'espace de stockage du site
        (Cloudflare), avec le nom et le numéro de licence du participant, réduite aux positions et aux heures situées sur l'emprise de
        la carte (sans fréquence cardiaque, cadence ni trajet hors de la carte). Elle est visible des personnes autorisées à ouvrir
        l'analyse, selon le choix de l'organisateur : tous les licenciés connectés, les membres de son club ou les détenteurs du mot
        de passe. Chaque participant peut retirer sa trace à tout moment ; elle est effacée avec l'analyse et avec son compte. Les
        cartes d'une analyse sont conservées tant que celle-ci existe ; si l'organisateur supprime son compte, l'analyse est maintenue,
        sans son nom. Dans une « Analyse multi », vos propres courbes (allure, fréquence cardiaque, cadence, etc.) proviennent de votre
        fichier, conservé dans votre navigateur sur cet appareil : il n'est pas transmis, et vous seul y avez accès.</p>
      <h2 style="font-size:16px">Tracé des circuits</h2>
      <p>Un événement de la page « Tracer » (ses circuits, sa carte, ses versions, les commentaires de l'équipe et les états des
        postes notés en mode terrain) est conservé dans l'espace de stockage du site (Cloudflare) et n'est accessible qu'à son équipe :
        son créateur et les licenciés qu'il y ajoute, dont le nom et le numéro de licence sont enregistrés avec leur rôle. Les
        versions, les commentaires et les états des postes portent le nom de leur auteur. En mode terrain, l'état noté sur un poste
        enregistre aussi la position du téléphone à cet instant (pour la comparer à la carte), visible de l'équipe, et l'équipe
        peut y joindre des photos des postes (elles peuvent montrer des personnes : évitez-le), effacées avec l'événement ; la position
        n'est lue que pendant ce mode, avec l'autorisation du navigateur. Si l'équipe chiffre l'événement, ces données sont chiffrées
        dans le navigateur et illisibles pour le site. L'événement est conservé jusqu'à sa suppression par son créateur ; si
        celui-ci supprime son compte, il passe au premier traceur (à défaut, contrôleur) de l'équipe qui a un compte, sinon il est
        supprimé. Le calcul de la dénivelée envoie au service d'altitude de l'IGN (Géoplateforme, France) les seules coordonnées des
        postes et des coudes des circuits, sans nom ni code.</p>
      <h2 style="font-size:16px">Questions à l'IA</h2>
      <p>Sur la page « IA », votre question est envoyée au modèle de langage qui écrit la requête, avec la description des tables du
        site, la date du jour, votre numéro de licence et la méthode et la discipline choisies : par défaut le modèle d'O'CN, exécuté
        par Cloudflare (Workers AI) ; ni le site ni Cloudflare ne conservent les questions. La requête s'exécute ensuite dans votre
        navigateur, sur les données que le site publie : elles ne sont transmises à aucun modèle. Si vous utilisez votre propre clé
        d'API (Anthropic, OpenAI, Google ou OpenRouter), votre navigateur envoie ces mêmes éléments directement à ce fournisseur, sous
        votre compte et selon ses conditions (avec une clé gratuite, Google peut se servir des questions pour améliorer ses
        produits) ; la clé reste dans votre navigateur et n'est jamais transmise à O'CN.</p>
      <h2 style="font-size:16px">Données de votre compte</h2>
      <ul>
        <li><b>Données conservées :</b> l'adresse e-mail ; les prénom, nom et numéro de licence saisis, vérifiés lors de l'inscription
          d'après les résultats publiés par la FFCO ; le mot de passe, sous une forme chiffrée irréversible ; les dates d'inscription et
          de dernière connexion ; les réglages d'alertes (régions choisies) et la liste des courses déjà annoncées par e-mail ; pour le
          simulateur de relais, les coureurs ajoutés (nom, catégorie, CN estimé) et ceux marqués indisponibles, visibles de vous seul.
          N'y ajoutez que des personnes qui y consentent.</li>
        <li><b>Finalités et bases légales :</b> l'exécution du service demandé lors de la création du compte (réserver l'accès aux
          licenciés de la FFCO, confirmer l'adresse e-mail, réinitialiser le mot de passe) ; l'intérêt légitime de l'éditeur à détecter
          les comptes multiples pour une même licence ; votre consentement pour les alertes par e-mail, que vous pouvez retirer à tout
          moment dans Réglages.</li>
        <li><b>Durée de conservation :</b> jusqu'à la suppression du compte, que vous pouvez effectuer à tout moment dans Réglages. Un
          e-mail en attente d'envoi est effacé dès son envoi.</li>
        <li><b>Destinataires :</b> l'administrateur du site et les prestataires techniques mentionnés ci-dessous. Aucune donnée n'est
          vendue ni utilisée à des fins publicitaires.</li>
      </ul>
      <p>Un message envoyé par la page « Nous écrire » parvient à l'éditeur par e-mail, accompagné de votre adresse, de votre nom et du
        navigateur utilisé ; il est conservé dans sa messagerie le temps nécessaire au traitement de la demande.</p>
      <h2 style="font-size:16px">Statistiques d'utilisation</h2>
      <p>Afin de connaître l'usage du site et de l'améliorer (intérêt légitime), le site enregistre, pour chaque compte, le nombre de
        pages vues par jour et par rubrique (Classement, Coureur, Réseau, etc.) et le nombre de visites. Aucune autre donnée n'est
        enregistrée à ce titre : ni les recherches effectuées, ni l'adresse IP. Ces statistiques ne sont accessibles qu'à
        l'administrateur ; elles sont conservées 13 mois et supprimées avec le compte.</p>
      <h2 style="font-size:16px">Sécurité</h2>
      <p>Afin de limiter les tentatives répétées (connexion, inscription, mot de passe oublié), le site comptabilise les essais par
        adresse IP et par adresse e-mail (intérêt légitime) ; ces compteurs sont effacés au bout d'un jour environ. L'hébergeur peut en
        outre traiter l'adresse IP pour acheminer les pages et protéger le site contre les attaques.</p>
      <h2 style="font-size:16px">Prestataires et transferts hors de l'Union européenne</h2>
      <p>Les prestataires suivants traitent des données pour le compte de l'éditeur :</p>
      <ul>
        <li><b>Cloudflare, Inc.</b> (États-Unis) héberge le site, sa base de comptes et son espace de stockage de fichiers, et exécute
          le modèle de langage de la page « IA ». Les
          transferts vers les États-Unis reposent sur le cadre de protection des données UE-États-Unis (Data Privacy Framework),
          auquel Cloudflare a adhéré.</li>
        <li><b>Resend</b> (Plus Five Five, Inc., États-Unis) assure l'envoi des e-mails du site, ce qui implique l'adresse du
          destinataire et le contenu du message. Les transferts sont encadrés par les clauses contractuelles types de la Commission
          européenne.</li>
        <li><b>GitHub, Inc.</b> (États-Unis) exécute les mises à jour automatiques du site ; les résultats et les fichiers déposés y sont
          traités, à l'exclusion des données de compte. Les transferts sont encadrés par les clauses contractuelles types.</li>
      </ul>
      <h2 style="font-size:16px">Cookies et stockage local</h2>
      <p>Le site dépose un seul cookie, strictement nécessaire à son fonctionnement : il maintient votre connexion, pendant 30 jours
        au plus. Le navigateur conserve également, sur votre appareil, vos préférences d'affichage (thème, discipline et méthode
        choisies), vos saisies dans le calculateur VMA ou le simulateur de relais et, pour le tracé des circuits, ses réglages d'affichage, la clé
        d'un événement chiffré, tirée de sa phrase de passe (le temps de l'onglet), les états du mode terrain en attente de réseau et, si vous
        gardez un événement pour travailler hors ligne, sa copie (circuits et carte, chiffrés s'il l'est) et les fichiers du site, effacés à la déconnexion ;
        si vous utilisez votre propre clé d'API sur la page « IA », cette clé (le temps de l'onglet, ou sur l'appareil si vous le demandez ;
        effacée à la déconnexion). Le site n'utilise aucun traceur publicitaire ni
        aucun outil tiers de mesure d'audience ; aucun consentement n'est donc requis.</p>
      <h2 style="font-size:16px">Vos droits</h2>
      <p>Conformément au RGPD, vous disposez d'un droit d'accès, de rectification, d'effacement et de portabilité de vos données, d'un
        droit à la limitation de leur traitement et d'un droit d'opposition aux traitements fondés sur l'intérêt légitime de
        l'éditeur.</p>
      <p>Vous pouvez en particulier demander à ne plus être identifié sur ${SITE}, sauf motif légitime et impérieux : votre nom et
        votre numéro de licence y sont alors remplacés, sur l'ensemble du site, par une mention anonyme (« Coureur anonyme »). Vos
        temps et vos places restent pris en compte, sans votre nom ni votre numéro de licence, afin que les classements des autres
        licenciés ne soient pas modifiés ; la mesure est réversible à votre demande. Une demande d'effacement des données de résultats
        est satisfaite de la même manière ; un compte, en revanche, est supprimé intégralement. Les données d'un licencié mineur sont
        anonymisées, et son compte supprimé s'il en a un, sur simple demande de son représentant légal, qui exerce ces droits en son
        nom.</p>
      <p>Vous pouvez supprimer vous-même votre compte, dans Réglages. Les autres demandes sont à adresser à ocn@kerkia.com ; il y est
        répondu dans un délai d'un mois. En cas de doute raisonnable sur l'identité du demandeur, un justificatif peut être demandé.
        Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la CNIL
        (<a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">cnil.fr/fr/plaintes</a>).</p>
      <h2 style="font-size:16px">Mentions légales</h2>
      <p><b>Éditeur et directeur de la publication :</b> Yann Le Helloco, particulier, publication à titre non professionnel ;
        contact : ocn@kerkia.com.<br>
        <b>Hébergeur :</b> Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis ; téléphone : +1 888 993 5273.</p>
      <p class="muted">Dernière mise à jour : 15 octobre 2026.</p>
      <p><a href="#/">← ${t("ac.toLogin")}</a></p>
    </div></section>`.toString();
  return { title: t("pv.title") };
}

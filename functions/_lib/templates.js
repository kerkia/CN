// The e-mails the site sends, in the recipient's language (users.lang: "fr", the reference, or "en"; 2026-10-17).
// Each returns { subject, html, text }. The FFCO's own data (race names, places, regions, officials) stays as published.

import { siteUrl } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const L = (lang) => (lang === "en" ? "en" : "fr");
const locale = (lang) => (L(lang) === "en" ? "en-GB" : "fr-FR");

const FRAME = {
  fr: { tagline: "La course d'orientation, en cartes et en chiffres",
    foot: (from) => `Site indépendant, sans lien avec la FFCO. Message envoyé automatiquement ; vous pouvez écrire à ${from}.`,
    copy: "Si le bouton ne fonctionne pas, copiez ce lien :" },
  en: { tagline: "Orienteering, in maps and numbers",
    foot: (from) => `An independent site, not affiliated with the FFCO. Automatic message; you can write to ${from}.`,
    copy: "If the button doesn't work, copy this link:" },
};
function wrap(env, title, bodyHtml, lang) {
  const F = FRAME[L(lang)];
  return `<!doctype html><html lang="${L(lang)}"><body style="margin:0;background:#f4f6f9;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b2430">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:20px;color:#1b1a17;margin-bottom:12px"><span style="color:#e8641c">O</span>zimut <span style="font-weight:500;font-size:13px;color:#5b6675">${F.tagline}</span></div>
<div style="background:#fff;border-radius:10px;padding:22px 24px;line-height:1.5">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}</div>
<p style="font-size:12px;color:#5b6675;margin:14px 4px">${esc(F.foot(env.MAIL_FROM))}</p>
</div></body></html>`;
}
const button = (href, label, lang) => `<p style="margin:18px 0"><a href="${esc(href)}" style="background:#d4561a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${esc(label)}</a></p>
<p style="font-size:12px;color:#5b6675;word-break:break-all">${FRAME[L(lang)].copy} ${esc(href)}</p>`;

export function verifyMail(env, token, firstName, lang) {
  const url = `${siteUrl(env)}/#/compte/verifier?token=${encodeURIComponent(token)}`;
  if (L(lang) === "en") return {
    subject: "Confirm your email address — Ozimut",
    html: wrap(env, "Confirm your email address", `<p>Hello ${esc(firstName)},</p>
<p>Thank you for registering. Click below to confirm your email address and activate your account (link valid for 24 hours).</p>${button(url, "Confirm my address", lang)}
<p style="font-size:13px;color:#5b6675">If you didn't register, ignore this message: nothing will be activated.</p>`, lang),
    text: `Hello ${firstName},\n\nConfirm your email address to activate your Ozimut account (link valid for 24 hours):\n${url}\n\nIf you didn't register, ignore this message.`,
  };
  return {
    subject: "Confirmez votre adresse e-mail — Ozimut",
    html: wrap(env, "Confirmez votre adresse e-mail", `<p>Bonjour ${esc(firstName)},</p>
<p>Merci de votre inscription. Cliquez ci-dessous pour confirmer votre adresse e-mail et activer votre compte (lien valable 24 heures).</p>${button(url, "Confirmer mon adresse", lang)}
<p style="font-size:13px;color:#5b6675">Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : rien ne sera activé.</p>`, lang),
    text: `Bonjour ${firstName},\n\nConfirmez votre adresse e-mail pour activer votre compte Ozimut (lien valable 24 h) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
  };
}

export function resetMail(env, token, lang) {
  const url = `${siteUrl(env)}/#/compte/reinitialiser?token=${encodeURIComponent(token)}`;
  if (L(lang) === "en") return {
    subject: "Resetting your password — Ozimut",
    html: wrap(env, "Reset your password", `<p>A password reset was requested for this account. The link below is valid for 1 hour.</p>${button(url, "Choose a new password", lang)}
<p style="font-size:13px;color:#5b6675">If you didn't ask for anything, ignore this message: your password stays unchanged.</p>`, lang),
    text: `A password reset was requested for your Ozimut account. Link valid for 1 hour:\n${url}\n\nIf you didn't ask for anything, ignore this message.`,
  };
  return {
    subject: "Réinitialisation de votre mot de passe — Ozimut",
    html: wrap(env, "Réinitialiser votre mot de passe", `<p>Une réinitialisation de mot de passe a été demandée pour ce compte. Le lien ci-dessous est valable 1 heure.</p>${button(url, "Choisir un nouveau mot de passe", lang)}
<p style="font-size:13px;color:#5b6675">Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.</p>`, lang),
    text: `Une réinitialisation de mot de passe a été demandée pour votre compte Ozimut. Lien valable 1 heure :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message.`,
  };
}

/** To an administrator who asked for it (in their language): an account was just confirmed. total: confirmed accounts now. */
export function newUserMail(env, user, total, lang) {
  const url = `${siteUrl(env)}/#/admin`;
  const who = `${user.first_name} ${user.last_name}`;
  const day = String(user.created_at).slice(0, 10);
  if (L(lang) === "en") {
    const lines = [`Email: ${user.email}`, `Licence: ${user.licence} (${user.display_name})`, `Registered on: ${day}`, `Confirmed accounts: ${total}`];
    return {
      subject: `New account: ${who} — Ozimut`,
      html: wrap(env, `New account: ${who}`, `<p>A new account has just been confirmed.</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Open the admin page", lang)}
<p style="font-size:13px;color:#5b6675">You receive this message because the new sign-ups alert is on, on the admin page.</p>`, lang),
      text: `A new account has just been confirmed: ${who}
${lines.join("\n")}

Administration (to turn this alert off): ${url}`,
    };
  }
  const lines = [`E-mail : ${user.email}`, `Licence : ${user.licence} (${user.display_name})`,
    `Inscrit le : ${day}`, `Comptes confirmés : ${total}`];
  return {
    subject: `Nouveau compte : ${who} — Ozimut`,
    html: wrap(env, `Nouveau compte : ${who}`, `<p>Un nouveau compte vient d'être confirmé.</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Ouvrir la page d'administration", lang)}
<p style="font-size:13px;color:#5b6675">Vous recevez ce message parce que l'alerte des nouvelles inscriptions est activée sur la page d'administration.</p>`, lang),
    text: `Un nouveau compte vient d'être confirmé : ${who}
${lines.join("\n")}

Administration (pour désactiver cette alerte) : ${url}`,
  };
}

/** To the administrators (each in their language): an organiser uploaded a results file on « Résultats » (or, kind
 *  "courses", the course setter's circuits from « Organisation › Tracer »). */
export function uploadMail(env, user, up, lang) {
  const url = `${siteUrl(env)}/#/admin?onglet=depots`;
  const courses = up.kind === "courses", starts = up.kind === "startlist";
  const kb = Math.max(1, Math.round(up.size / 1024));
  if (L(lang) === "en") {
    const lines = [`Race: ${up.race}`, `File: ${up.filename} (${kb} KB)`,
      `Uploaded by: ${user.first_name} ${user.last_name} — ${user.email} — licence ${user.licence}`];
    const head = courses ? "Courses uploaded" : starts ? "Start list uploaded" : "Results uploaded";
    const intro = courses ? "The courses of a race (the course setter's IOF XML file) have just been uploaded to “Results”."
      : starts ? "An organiser has just uploaded the start list of a coming race (“Organisation › Start times”)."
      : "A results file has just been uploaded to “Results”.";
    const when = courses ? "They complete the race's results lists (length, climb, controls), once the race is over."
      : "It is published at the next collection run.";
    return {
      subject: `${head}: ${up.race} — Ozimut`,
      html: wrap(env, head, `<p>${intro} ${when}</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "See the uploads", lang)}`, lang),
      text: `${intro}
${lines.join("\n")}

The uploads (to remove one): ${url}`,
    };
  }
  const lines = [`Course : ${up.race}`, `Fichier : ${up.filename} (${kb} Ko)`,
    `Déposé par : ${user.first_name} ${user.last_name} — ${user.email} — licence ${user.licence}`];
  const head = courses ? "Circuits déposés" : starts ? "Horaires de départ déposés" : "Résultats déposés";
  const intro = courses ? "Les circuits d'une course (fichier IOF XML du traceur) viennent d'être déposés sur « Résultats »."
    : starts ? "Un organisateur vient de déposer les horaires de départ d'une course à venir (« Organisation › Horaires »)."
    : "Un fichier de résultats vient d'être déposé sur « Résultats ».";
  const when = courses ? "Ils complètent les listes de résultats de la course (longueur, dénivelé, postes), une fois la course passée."
    : "Il est publié au prochain passage de la collecte.";
  return {
    subject: `${head} : ${up.race} — Ozimut`,
    html: wrap(env, head, `<p>${intro} ${when}</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Voir les dépôts", lang)}`, lang),
    text: `${intro}
${lines.join("\n")}

Les dépôts (pour en retirer un) : ${url}`,
  };
}

/** To the administrator (in their language): several verified accounts claim the same licence. */
export function duplicateAlert(env, licence, accounts, lang) {
  const url = `${siteUrl(env)}/#/admin`;
  const en = L(lang) === "en";
  const lines = accounts.map((a) => `${a.email} — ${a.first_name} ${a.last_name} — ${en ? "registered on" : "inscrit le"} ${String(a.created_at).slice(0, 10)}${a.status === "disabled" ? (en ? " (disabled)" : " (désactivé)") : ""}`);
  if (en) return {
    subject: `Licence ${licence}: ${accounts.length} accounts — Ozimut`,
    html: wrap(env, `Licence ${licence}: ${accounts.length} accounts`, `<p>Several confirmed accounts match the same FFCO licence:</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Open the admin page", lang)}`, lang),
    text: `Several confirmed accounts for licence ${licence}:\n${lines.join("\n")}\n\nAdministration: ${url}`,
  };
  return {
    subject: `Licence ${licence} : ${accounts.length} comptes — Ozimut`,
    html: wrap(env, `Licence ${licence} : ${accounts.length} comptes`, `<p>Plusieurs comptes confirmés correspondent à la même licence FFCO :</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Ouvrir la page d'administration", lang)}`, lang),
    text: `Plusieurs comptes confirmés pour la licence ${licence} :\n${lines.join("\n")}\n\nAdministration : ${url}`,
  };
}

/** races: [{ id, prov?, title, date, location }] — one digest per runner and update, in their language; `prov`: an
 *  organiser's results, on « Résultats » (before FFCO's), else FFCO's on « Courses classées ». */
export function digestMail(env, user, races) {
  const lang = L(user.lang), en = lang === "en";
  const base = siteUrl(env);
  const n = races.length;
  const rows = races.map((r) => ({ ...r, url: r.prov ? `${base}/#/resultats?course=${encodeURIComponent(r.prov)}`
    : `${base}/#/courses?id=${encodeURIComponent(r.id)}`, note: r.prov ? (en ? "organiser's results" : "résultats de l'organisateur") : "" }));
  const settings = `${base}/#/reglages`;
  const list = `<ul style="padding-left:18px">${rows.map((r) => `<li style="margin:6px 0"><a href="${esc(r.url)}">${esc(r.title)}</a>${r.location ? ` — ${esc(r.location)}` : ""}${r.date ? ` (${esc(r.date)})` : ""}${r.note ? ` <span style="color:#5b6675">· ${esc(r.note)}</span>` : ""}</li>`).join("")}</ul>`;
  const listText = rows.map((r) => `- ${r.title}${r.location ? ` (${r.location})` : ""}${r.date ? ` ${r.date}` : ""}${r.note ? ` · ${r.note}` : ""}\n  ${r.url}`).join("\n");
  if (en) return {
    subject: n === 1 ? `New race online: ${races[0].title} — Ozimut` : `${n} new races online — Ozimut`,
    html: wrap(env, n === 1 ? "One of your races is online" : `${n} of your races are online`, `<p>Hello ${esc(user.first_name)},</p>
${list}
<p style="font-size:13px;color:#5b6675">You receive this message because you turned notifications on. <a href="${esc(settings)}">Change my settings</a>.</p>`, lang),
    text: `Hello ${user.first_name},\n\n${listText}\n\nTo stop receiving these messages: ${settings}`,
  };
  return {
    subject: n === 1 ? `Nouvelle course en ligne : ${races[0].title} — Ozimut` : `${n} nouvelles courses en ligne — Ozimut`,
    html: wrap(env, n === 1 ? "Une de vos courses est en ligne" : `${n} de vos courses sont en ligne`, `<p>Bonjour ${esc(user.first_name)},</p>
${list}
<p style="font-size:13px;color:#5b6675">Vous recevez ce message parce que vous avez activé les notifications. <a href="${esc(settings)}">Modifier mes réglages</a>.</p>`, lang),
    text: `Bonjour ${user.first_name},\n\n${listText}\n\nPour ne plus recevoir ces messages : ${settings}`,
  };
}

/**
 * events: the new courses (full details as sent by update.py) in the regions the user follows.
 * The first FULL are described completely, the rest as a compact list.
 */
const FULL = 15, COMPACT = 60;
const longDate = (iso, lang) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
const shortDate = (iso, lang) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale(lang), { day: "numeric", month: "short", year: "numeric" }) : "");
const a = (href, label) => `<a href="${esc(href)}">${esc(label || href)}</a>`;
/** The plain-text twin of an escaped HTML fragment. */
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// a race's type as update.py writes it (« Forêt MD », « Nuit », « Entraînement VTT »…), word by word in English
const TYPE_EN = { "Forêt": "Forest", Nuit: "Night", Relais: "Relay", "Pédestre": "Foot", VTT: "MTB", "Entraînement": "Training",
  Formation: "Workshop", Moyenne: "Middle", Longue: "Long", Autre: "Other" };
const typeOf = (s, lang) => (L(lang) === "en" ? String(s || "").replace(/[\p{L}']+/gu, (w) => TYPE_EN[w] ?? w) : s || "");

const AGENDA = {
  fr: {
    place: "Lieu", type: "Type", cn: "Classement national", cnYes: "<b>oui</b> — compte pour le CN", cnNo: "non",
    manif: "Manifestation", org: "Organisateur", referee: "Arbitre titulaire", referee2: "Arbitre stagiaire",
    controller: "Contrôleur des circuits", delegate: "Délégué", monitor: "Moniteur", contact: "Contact", phone: "Téléphone",
    email: "E-mail", site: "Site web", signs: "Fléchage", invitation: "Annonce de course", invitationLink: "Télécharger l'annonce (PDF)",
    gps: "Itinéraire GPS", route: "Ouvrir l'itinéraire", obs: "Observations",
    noReg: "Pas d'inscription en ligne indiquée sur le site de la FFCO.",
    close: (d) => `clôture des inscriptions le <b>${d}</b>`, mods: (d) => `modifications (puces, compositions) jusqu'au ${d}`,
    count: (n, teams) => `${n} inscrit${n > 1 ? "s" : ""}${teams != null ? ` (${teams} équipe${teams > 1 ? "s" : ""})` : ""} à ce jour`,
    regOnline: "Inscriptions en ligne", noDates: " — dates de clôture non encore publiées", colon: " :",
    invitationArrow: "Annonce de course (PDF) →", access: "Accès", accessSrc: "(extrait de l'annonce)", accessText: "Accès (extrait de l'annonce)",
    see: "Voir sur Ozimut", ffco: "Fiche sur le site de la FFCO", hello: "Bonjour", also: "Et aussi :",
    more: (n, link) => `… et ${n} autre${n > 1 ? "s" : ""} dans l'${link}.`, moreText: (n, url) => `… et ${n} autre${n > 1 ? "s" : ""} : ${url}`,
    agenda: "agenda", why: (w, link) => `Vous recevez ce message parce que vous avez activé l'alerte ${w}. ${link}.`, settings: "Modifier mes réglages",
    stop: "Pour modifier ou arrêter cette alerte :",
    new: {
      subject: (n, e) => (n === 1 ? `Nouvelle course à l'agenda : ${e.name} — Ozimut` : `${n} nouvelles courses à l'agenda — Ozimut`),
      title: (n) => (n === 1 ? "Une nouvelle course à l'agenda" : `${n} nouvelles courses à l'agenda`),
      intro: (n) => `${n === 1 ? "Une course vient" : "Des courses viennent"} d'être ajoutée${n > 1 ? "s" : ""} à l'agenda dans les régions que vous suivez :`,
      why: "« nouvelles courses »",
    },
    deadline: {
      subject: (n, e) => (n === 1 ? `Inscriptions bientôt closes : ${e.name} — Ozimut` : `${n} courses : inscriptions bientôt closes — Ozimut`),
      title: (n) => (n === 1 ? "Inscriptions bientôt closes" : `Inscriptions bientôt closes pour ${n} courses`),
      intro: (n) => `Les inscriptions ferment dans les 8 prochains jours pour ${n === 1 ? "cette course" : "ces courses"}, dans les régions que vous suivez :`,
      why: "« clôture des inscriptions »",
    },
  },
  en: {
    place: "Venue", type: "Type", cn: "National ranking", cnYes: "<b>yes</b> — counts for the CN", cnNo: "no",
    manif: "Event", org: "Organiser", referee: "Event adviser", referee2: "Trainee event adviser",
    controller: "Course controller", delegate: "Delegate", monitor: "Instructor", contact: "Contact", phone: "Phone",
    email: "Email", site: "Website", signs: "Signposting", invitation: "Race announcement", invitationLink: "Download the announcement (PDF)",
    gps: "GPS route", route: "Open the route", obs: "Notes",
    noReg: "No online entry given on the FFCO website.",
    close: (d) => `entries close on <b>${d}</b>`, mods: (d) => `changes (SI cards, team line-ups) until ${d}`,
    count: (n, teams) => `${n} entr${n !== 1 ? "ies" : "y"}${teams != null ? ` (${teams} team${teams !== 1 ? "s" : ""})` : ""} so far`,
    regOnline: "Online entries", noDates: " — deadlines not published yet", colon: ":",
    invitationArrow: "Race announcement (PDF) →", access: "Getting there", accessSrc: "(from the announcement)", accessText: "Getting there (from the announcement)",
    see: "See on Ozimut", ffco: "Page on the FFCO website", hello: "Hello", also: "And also:",
    more: (n, link) => `… and ${n} more in the ${link}.`, moreText: (n, url) => `… and ${n} more: ${url}`,
    agenda: "calendar", why: (w, link) => `You receive this message because you turned on the ${w} alert. ${link}.`, settings: "Change my settings",
    stop: "To change or stop this alert:",
    new: {
      subject: (n, e) => (n === 1 ? `New race in the calendar: ${e.name} — Ozimut` : `${n} new races in the calendar — Ozimut`),
      title: (n) => (n === 1 ? "A new race in the calendar" : `${n} new races in the calendar`),
      intro: (n) => `${n === 1 ? "A race has" : "Races have"} just been added to the calendar in the regions you follow:`,
      why: "“new races”",
    },
    deadline: {
      subject: (n, e) => (n === 1 ? `Entries closing soon: ${e.name} — Ozimut` : `${n} races: entries closing soon — Ozimut`),
      title: (n) => (n === 1 ? "Entries closing soon" : `Entries closing soon for ${n} races`),
      intro: (n) => `Entries close within the next 8 days for ${n === 1 ? "this race" : "these races"}, in the regions you follow:`,
      why: "“entry deadline”",
    },
  },
};

/** [label, htmlValue, textValue] rows of one course. */
function courseRows(env, e, lang) {
  const T = AGENDA[L(lang)];
  const rows = [];
  const add = (label, html, text) => { if (html) rows.push([label, html, text ?? plain(html)]); };
  add(T.place, e.place ? `${esc(e.place)}${e.dep ? ` (${esc(e.dep)}${e.depName ? ` · ${esc(e.depName)}` : ""})` : ""}${e.region ? ` — ${esc(e.region)}` : ""}` : "");
  add(T.type, esc([typeOf(e.type, lang), e.groupe].filter(Boolean).join(" · ")));
  add(T.cn, e.cn ? T.cnYes : T.cnNo);
  add(T.manif, esc(e.manif));
  add(T.org, esc(e.org));
  add(T.referee, esc(e.referee));
  add(T.referee2, esc(e.referee2));
  add(T.controller, esc(e.controller));
  add(T.delegate, esc(e.delegate));
  add(T.monitor, esc(e.monitor));
  add(T.contact, esc(e.contact));
  add(T.phone, e.phone ? a(`tel:${e.phone.replace(/\s+/g, "")}`, e.phone) : "", e.phone);
  add(T.email, e.email ? a(`mailto:${e.email}`, e.email) : "", e.email);
  add(T.site, e.site ? a(e.site) : "", e.site);
  add(T.signs, e.flechage ? (/^https?:\/\//.test(e.flechage) ? a(e.flechage) : esc(e.flechage)) : "", e.flechage);
  add(T.invitation, e.invitation ? a(e.invitation, T.invitationLink) : "", e.invitation);
  const g = e.gps;
  if (g) {
    add(T.gps, `${a(`https://www.google.com/maps/dir/?api=1&destination=${g[0]},${g[1]}&travelmode=driving`, "Google Maps")} · ${a(`https://waze.com/ul?ll=${g[0]},${g[1]}&navigate=yes`, "Waze")} <span style="color:#5b6675">(${g[0]}, ${g[1]})</span>`,
      `https://www.google.com/maps/dir/?api=1&destination=${g[0]},${g[1]} (${g[0]}, ${g[1]})`);
  } else if (e.mapUrl) add(T.gps, a(e.mapUrl, T.route), e.mapUrl);
  add(T.obs, e.obs ? esc(e.obs).replace(/\n/g, "<br>") : "", e.obs);
  return rows;
}

function registrationBlock(e, lang) {
  const T = AGENDA[L(lang)];
  const r = e.reg;
  if (!r) return { html: `<i>${T.noReg}</i>`, text: T.noReg };
  const bits = [];
  if (r.close) bits.push(T.close(esc(shortDate(r.close, lang))));
  if (r.mods) bits.push(T.mods(esc(shortDate(r.mods, lang))));
  if (r.count != null) bits.push(esc(T.count(r.count, r.teams)));
  const bitsText = bits.map(plain);
  return {
    html: `${a(r.url, T.regOnline)}${bits.length ? ` — ${bits.join(", ")}` : T.noDates}`,
    text: `${T.regOnline}${T.colon} ${r.url}${bitsText.length ? ` — ${bitsText.join(", ")}` : T.noDates}`,
  };
}

// the two agenda alerts: a course newly in the agenda, or its registrations closing within 8 days
export function agendaMail(env, user, events, kind = "new") {
  const lang = L(user.lang), T = AGENDA[lang], K = T[kind];
  const base = siteUrl(env);
  const n = events.length;
  const full = events.slice(0, FULL), compact = events.slice(FULL, FULL + COMPACT), more = n - full.length - compact.length;
  const link = (e) => `${base}/#/agenda?id=${encodeURIComponent(e.id)}`;
  const ffco = (e) => `https://api.ffcorientation.fr/iframe/courses/${encodeURIComponent(e.id)}/`;
  const settings = `${base}/#/reglages`;
  const type = (e) => typeOf(e.type, lang);

  const blockHtml = (e) => {
    const rows = courseRows(env, e, lang), reg = registrationBlock(e, lang);
    return `<div style="border:1px solid #dde3ea;border-radius:8px;padding:12px 14px;margin:12px 0">
<div style="font-size:16px;font-weight:700">${a(link(e), e.name)}</div>
<div style="color:#5b6675;margin:2px 0 8px">${esc(longDate(e.date, lang))}${e.type ? ` · ${esc(type(e))}` : ""}</div>
${e.invitation ? `<div style="margin-bottom:8px"><b>${a(e.invitation, T.invitationArrow)}</b></div>` : ""}
<div style="background:#f4f6f9;border-radius:6px;padding:8px 10px;margin-bottom:8px">${reg.html}</div>
${e.access ? `<div style="background:#f4f6f9;border-radius:6px;padding:8px 10px;margin-bottom:8px"><b>${T.access}</b> <span style="color:#5b6675;font-size:12px">${T.accessSrc}</span><div style="white-space:pre-line;font-size:13.5px;margin-top:4px">${esc(e.access)}</div></div>` : ""}
<table style="border-collapse:collapse;font-size:14px">${rows.map(([l, h]) => `<tr><td style="padding:2px 12px 2px 0;color:#5b6675;vertical-align:top;white-space:nowrap">${esc(l)}</td><td style="padding:2px 0">${h}</td></tr>`).join("")}</table>
<div style="margin-top:8px;font-size:13px">${a(link(e), T.see)} · ${a(ffco(e), T.ffco)}</div>
</div>`;
  };
  const blockText = (e) => {
    const rows = courseRows(env, e, lang), reg = registrationBlock(e, lang);
    return [`${e.name}`, `${longDate(e.date, lang)}${e.type ? ` · ${type(e)}` : ""}`, ...(e.invitation ? [`${T.invitation}${T.colon} ${e.invitation}`] : []),
      reg.text, ...(e.access ? [`${T.accessText}${T.colon}\n${e.access}`] : []),
      ...rows.map(([l, , t]) => `${l}${T.colon} ${t}`), `Ozimut${T.colon} ${link(e)}`, `FFCO${T.colon} ${ffco(e)}`].join("\n");
  };
  const compactLine = (e) => `${e.name} — ${shortDate(e.date, lang)}${e.place ? `, ${e.place}` : ""}${e.type ? ` (${type(e)})` : ""}`;

  return {
    subject: K.subject(n, events[0]),
    html: wrap(env, K.title(n), `<p>${T.hello} ${esc(user.first_name)},</p>
<p>${K.intro(n)}</p>
${full.map(blockHtml).join("")}
${compact.length ? `<p><b>${T.also}</b></p><ul style="padding-left:18px">${compact.map((e) => `<li style="margin:4px 0">${a(link(e), e.name)} — ${esc(shortDate(e.date, lang))}${e.place ? `, ${esc(e.place)}` : ""}${e.type ? ` (${esc(type(e))})` : ""}</li>`).join("")}</ul>` : ""}
${more > 0 ? `<p>${T.more(more, a(`${base}/#/agenda`, T.agenda))}</p>` : ""}
<p style="font-size:13px;color:#5b6675">${T.why(K.why, a(settings, T.settings))}</p>`, lang),
    text: `${T.hello} ${user.first_name},\n\n${K.intro(n)}\n\n${full.map(blockText).join("\n\n---\n\n")}${compact.length ? `\n\n${T.also}\n${compact.map((e) => `- ${compactLine(e)}\n  ${link(e)}`).join("\n")}` : ""}${more > 0 ? `\n\n${T.moreText(more, `${base}/#/agenda`)}` : ""}\n\n${T.stop} ${settings}`,
  };
}

/** A message from the contact page, to the administrator (in French: the site's own address reads it). msg: { category,
 *  subject, html, text, from, browser, files }. */
export function contactMail(env, user, msg) {
  const base = siteUrl(env);
  const who = `${user.first_name} ${user.last_name}`;
  const rows = [
    ["De", `${esc(who)} (${esc(user.display_name)}) — <a href="mailto:${esc(user.email)}">${esc(user.email)}</a>`, `${who} (${user.display_name}) — ${user.email}`],
    ["Licence", `<a href="${esc(`${base}/#/coureur/${encodeURIComponent(user.licence)}`)}">${esc(user.licence)}</a>`, user.licence],
    ["Type", esc(msg.category), msg.category],
    ...(user.lang === "en" ? [["Langue", "anglais", "anglais"]] : []),
    ...(msg.from ? [["Depuis la page", esc(msg.from), msg.from]] : []),
    ...(msg.browser ? [["Navigateur", esc(msg.browser), msg.browser]] : []),
    ...(msg.files.length ? [["Pièces jointes", esc(msg.files.join(", ")), msg.files.join(", ")]] : []),
  ];
  return {
    subject: `[Ozimut · ${msg.category}] ${msg.subject}`,
    html: wrap(env, msg.subject, `<table style="border-collapse:collapse;font-size:13.5px;margin-bottom:14px">${rows.map(([l, h]) =>
      `<tr><td style="padding:2px 12px 2px 0;color:#5b6675;vertical-align:top;white-space:nowrap">${l}</td><td style="padding:2px 0">${h}</td></tr>`).join("")}</table>
<div style="border-top:1px solid #dde3ea;padding-top:12px">${msg.html || `<p style="white-space:pre-line">${esc(msg.text)}</p>`}</div>
<p style="font-size:12px;color:#5b6675">Répondre à ce message écrit directement à ${esc(user.email)}.</p>`, "fr"),
    text: `${rows.map(([l, , t]) => `${l} : ${t}`).join("\n")}\n\n${msg.text}`,
  };
}

// Push notifications (functions/_lib/push.js, site/sw-push.js): { title, body, url, tag } in the account's language.
const clock = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${sec ? `:${String(sec).padStart(2, "0")}` : ""}`;
};
/** A runner's start time, published (or changed: `changed`) on the start list of a coming race.
 *  s = { key, name, date, place, start_s, cls } */
export function startPush(lang, s, changed) {
  const en = L(lang) === "en";
  const day = s.date ? new Date(s.date + "T00:00:00").toLocaleDateString(locale(lang), { weekday: "short", day: "numeric", month: "short" }) : "";
  const where = [s.name, day].filter(Boolean).join(" · ");
  const what = `${en ? "Start" : "Départ"} ${clock(s.start_s)}${s.cls ? ` · ${s.cls}` : ""}`;
  return {
    title: en ? (changed ? "Start time changed" : "Your start time") : (changed ? "Heure de départ modifiée" : "Votre heure de départ"),
    body: `${where}
${what}`, url: `/#/resultats?course=${encodeURIComponent(s.key)}`, tag: `start-${s.key}`,
  };
}
/** Réglages' « Envoyer un essai ». */
export function testPush(lang) {
  const en = L(lang) === "en";
  return { title: "Ozimut", body: en ? "Notifications work on this device." : "Les notifications fonctionnent sur cet appareil.",
    url: "/#/reglages", tag: "test" };
}

const pushDay = (iso, lang) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(locale(lang), { weekday: "short", day: "numeric", month: "short" }) : "");
/** A list of names for one line: the first two, then « +3 ». */
const fewNames = (names, en) => (names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} ${en ? "and" : "et"} ${names.length - 2} ${en ? "more" : "autres"}`);
/** « A race you ran is online » (the push twin of digestMail). races: [{ id, prov?, title, date }] */
export function resultsPush(lang, races) {
  const en = L(lang) === "en", n = races.length, r = races[0];
  const url = n > 1 ? "/#/resultats" : r.prov ? `/#/resultats?course=${encodeURIComponent(r.prov)}` : `/#/courses?id=${encodeURIComponent(r.id)}`;
  return {
    title: en ? (n === 1 ? "Your results are online" : `${n} of your races are online`) : (n === 1 ? "Vos résultats sont en ligne" : `${n} de vos courses sont en ligne`),
    body: n === 1 ? [r.title, pushDay(r.date, lang)].filter(Boolean).join(" · ") : fewNames(races.map((x) => x.title), en),
    url, tag: n === 1 ? `results-${r.prov || r.id}` : "results",
  };
}
/** The agenda's alerts: new races in the regions followed (`kind` "new"), or registrations closing soon ("deadline").
 *  events: as announceAgenda keeps them ({ id, name, date, place, reg: { close } }). */
export function agendaPush(lang, events, kind = "new") {
  const en = L(lang) === "en", n = events.length, e = events[0];
  const url = n === 1 ? `/#/agenda?id=${encodeURIComponent(e.id)}` : "/#/agenda";
  if (kind === "deadline") return {
    title: en ? "Registrations closing soon" : "Clôture des inscriptions proche",
    body: n === 1 ? `${e.name} · ${en ? "closes" : "clôture"} ${pushDay(e.reg?.close, lang)}` : fewNames(events.map((x) => x.name), en),
    url, tag: n === 1 ? `deadline-${e.id}` : "deadline",
  };
  return {
    title: en ? (n === 1 ? "A new race in your regions" : `${n} new races in your regions`) : (n === 1 ? "Une nouvelle course dans vos régions" : `${n} nouvelles courses dans vos régions`),
    body: n === 1 ? [e.name, pushDay(e.date, lang), e.place].filter(Boolean).join(" · ") : fewNames(events.map((x) => x.name), en),
    url, tag: n === 1 ? `agenda-${e.id}` : "agenda",
  };
}

/** A runner's start time by e-mail (the twin of startPush; users.starts_alert). s = { key, name, date, place, start_s, cls } */
export function startMail(env, user, s, changed) {
  const lang = L(user.lang), en = lang === "en";
  const url = `${siteUrl(env)}/#/resultats?course=${encodeURIComponent(s.key)}`, settings = `${siteUrl(env)}/#/reglages`;
  const when = clock(s.start_s), day = longDate(s.date, lang);
  const rows = [[en ? "Race" : "Course", s.name], [en ? "Date" : "Date", day], [en ? "Place" : "Lieu", s.place],
    [en ? "Course / class" : "Circuit / catégorie", s.cls], [en ? "Start time" : "Heure de départ", when]].filter(([, v]) => v);
  const table = `<table style="border-collapse:collapse;margin:8px 0">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#5b6675">${esc(k)}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
  const text = rows.map(([k, v]) => `${k}${en ? ":" : " :"} ${v}`).join("\n");
  if (en) return {
    subject: `${changed ? "Start time changed" : "Your start time"}: ${when} — ${s.name} — Ozimut`,
    html: wrap(env, changed ? "Your start time has changed" : "Your start time", `<p>Hello ${esc(user.first_name)},</p>
<p>${changed ? "The start list of your race was updated:" : "The start list of your race is published:"}</p>${table}${button(url, "See the start list", lang)}
<p style="font-size:13px;color:#5b6675">You receive this message because you asked for your start times by email. <a href="${esc(settings)}">Change my settings</a>.</p>`, lang),
    text: `Hello ${user.first_name},\n\n${text}\n\n${url}\n\nTo stop receiving these messages: ${settings}`,
  };
  return {
    subject: `${changed ? "Heure de départ modifiée" : "Votre heure de départ"} : ${when} — ${s.name} — Ozimut`,
    html: wrap(env, changed ? "Votre heure de départ a changé" : "Votre heure de départ", `<p>Bonjour ${esc(user.first_name)},</p>
<p>${changed ? "La liste de départ de votre course a été mise à jour :" : "La liste de départ de votre course est publiée :"}</p>${table}${button(url, "Voir la liste de départ", lang)}
<p style="font-size:13px;color:#5b6675">Vous recevez ce message parce que vous avez demandé vos heures de départ par e-mail. <a href="${esc(settings)}">Modifier mes réglages</a>.</p>`, lang),
    text: `Bonjour ${user.first_name},\n\n${text}\n\n${url}\n\nPour ne plus recevoir ces messages : ${settings}`,
  };
}

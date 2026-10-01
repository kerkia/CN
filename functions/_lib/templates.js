// The e-mails the site sends (French). Each returns { subject, html, text }.

import { siteUrl } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function wrap(env, title, bodyHtml) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f6f9;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1b2430">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="font-weight:700;font-size:20px;color:#0d366b;margin-bottom:12px">O'CN <span style="font-weight:500;font-size:13px;color:#5b6675">Observatoire du classement national de CO</span></div>
<div style="background:#fff;border-radius:10px;padding:22px 24px;line-height:1.5">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}</div>
<p style="font-size:12px;color:#5b6675;margin:14px 4px">Site indépendant, sans lien avec la FFCO. Message envoyé automatiquement ; vous pouvez écrire à ${esc(env.MAIL_FROM)}.</p>
</div></body></html>`;
}
const button = (href, label) => `<p style="margin:18px 0"><a href="${esc(href)}" style="background:#0d366b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${esc(label)}</a></p>
<p style="font-size:12px;color:#5b6675;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien : ${esc(href)}</p>`;

export function verifyMail(env, token, firstName) {
  const url = `${siteUrl(env)}/#/compte/verifier?token=${encodeURIComponent(token)}`;
  return {
    subject: "Confirmez votre adresse e-mail — O'CN",
    html: wrap(env, "Confirmez votre adresse e-mail", `<p>Bonjour ${esc(firstName)},</p>
<p>Merci de votre inscription. Cliquez ci-dessous pour confirmer votre adresse e-mail et activer votre compte (lien valable 24 heures).</p>${button(url, "Confirmer mon adresse")}
<p style="font-size:13px;color:#5b6675">Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : rien ne sera activé.</p>`),
    text: `Bonjour ${firstName},\n\nConfirmez votre adresse e-mail pour activer votre compte O'CN (lien valable 24 h) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
  };
}

export function resetMail(env, token) {
  const url = `${siteUrl(env)}/#/compte/reinitialiser?token=${encodeURIComponent(token)}`;
  return {
    subject: "Réinitialisation de votre mot de passe — O'CN",
    html: wrap(env, "Réinitialiser votre mot de passe", `<p>Une réinitialisation de mot de passe a été demandée pour ce compte. Le lien ci-dessous est valable 1 heure.</p>${button(url, "Choisir un nouveau mot de passe")}
<p style="font-size:13px;color:#5b6675">Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.</p>`),
    text: `Une réinitialisation de mot de passe a été demandée pour votre compte O'CN. Lien valable 1 heure :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message.`,
  };
}

/** To the administrator: several verified accounts claim the same licence. */
export function duplicateAlert(env, licence, accounts) {
  const url = `${siteUrl(env)}/#/admin`;
  const lines = accounts.map((a) => `${a.email} — ${a.first_name} ${a.last_name} — inscrit le ${String(a.created_at).slice(0, 10)}${a.status === "disabled" ? " (désactivé)" : ""}`);
  return {
    subject: `Licence ${licence} : ${accounts.length} comptes — O'CN`,
    html: wrap(env, `Licence ${licence} : ${accounts.length} comptes`, `<p>Plusieurs comptes confirmés correspondent à la même licence FFCO :</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${button(url, "Ouvrir la page d'administration")}`),
    text: `Plusieurs comptes confirmés pour la licence ${licence} :\n${lines.join("\n")}\n\nAdministration : ${url}`,
  };
}

/** races: [{ id, title, date, location }] — one digest per runner and update. */
export function digestMail(env, user, races) {
  const base = siteUrl(env);
  const n = races.length;
  const rows = races.map((r) => ({ ...r, url: `${base}/#/courses?id=${encodeURIComponent(r.id)}` }));
  const settings = `${base}/#/reglages`;
  return {
    subject: n === 1 ? `Nouvelle course en ligne : ${races[0].title} — O'CN` : `${n} nouvelles courses en ligne — O'CN`,
    html: wrap(env, n === 1 ? "Une de vos courses est en ligne" : `${n} de vos courses sont en ligne`, `<p>Bonjour ${esc(user.first_name)},</p>
<ul style="padding-left:18px">${rows.map((r) => `<li style="margin:6px 0"><a href="${esc(r.url)}">${esc(r.title)}</a>${r.location ? ` — ${esc(r.location)}` : ""}${r.date ? ` (${esc(r.date)})` : ""}</li>`).join("")}</ul>
<p style="font-size:13px;color:#5b6675">Vous recevez ce message parce que vous avez activé les notifications. <a href="${esc(settings)}">Modifier mes réglages</a>.</p>`),
    text: `Bonjour ${user.first_name},\n\n${rows.map((r) => `- ${r.title}${r.location ? ` (${r.location})` : ""}${r.date ? ` ${r.date}` : ""}\n  ${r.url}`).join("\n")}\n\nPour ne plus recevoir ces messages : ${settings}`,
  };
}

/**
 * events: the new courses (full details as sent by update.py) in the regions the user follows.
 * The first FULL are described completely, the rest as a compact list.
 */
const FULL = 15, COMPACT = 60;
const frLong = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
const frShort = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
const a = (href, label) => `<a href="${esc(href)}">${esc(label || href)}</a>`;
/** The plain-text twin of an escaped HTML fragment. */
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** [label, htmlValue, textValue] rows of one course. */
function courseRows(env, e) {
  const base = siteUrl(env);
  const rows = [];
  const add = (label, html, text) => { if (html) rows.push([label, html, text ?? plain(html)]); };
  add("Lieu", e.place ? `${esc(e.place)}${e.dep ? ` (${esc(e.dep)}${e.depName ? ` · ${esc(e.depName)}` : ""})` : ""}${e.region ? ` — ${esc(e.region)}` : ""}` : "");
  add("Type", esc([e.type, e.groupe].filter(Boolean).join(" · ")));
  add("Classement national", e.cn ? "<b>oui</b> — compte pour le CN" : "non");
  add("Manifestation", esc(e.manif));
  add("Organisateur", esc(e.org));
  add("Arbitre titulaire", esc(e.referee));
  add("Arbitre stagiaire", esc(e.referee2));
  add("Contrôleur des circuits", esc(e.controller));
  add("Délégué", esc(e.delegate));
  add("Contact", esc(e.contact));
  add("Téléphone", e.phone ? a(`tel:${e.phone.replace(/\s+/g, "")}`, e.phone) : "", e.phone);
  add("E-mail", e.email ? a(`mailto:${e.email}`, e.email) : "", e.email);
  add("Site web", e.site ? a(e.site) : "", e.site);
  add("Fléchage", e.flechage ? (/^https?:\/\//.test(e.flechage) ? a(e.flechage) : esc(e.flechage)) : "", e.flechage);
  add("Invitation", e.invitation ? a(e.invitation, "Télécharger l'invitation") : "", e.invitation);
  add("Observations", e.obs ? esc(e.obs).replace(/\n/g, "<br>") : "", e.obs);
  return rows;
}

function registrationBlock(e) {
  const r = e.reg;
  if (!r) return { html: "<i>Pas d'inscription en ligne indiquée sur le site de la FFCO.</i>", text: "Pas d'inscription en ligne indiquée sur le site de la FFCO." };
  const bits = [];
  if (r.close) bits.push(`clôture des inscriptions le <b>${esc(frShort(r.close))}</b>`);
  if (r.mods) bits.push(`modifications (puces, compositions) jusqu'au ${esc(frShort(r.mods))}`);
  if (r.count != null) bits.push(`${esc(r.count)} inscrit${r.count > 1 ? "s" : ""} à ce jour`);
  const bitsText = bits.map(plain);
  return {
    html: `${a(r.url, "Inscriptions en ligne")}${bits.length ? ` — ${bits.join(", ")}` : " — dates de clôture non encore publiées"}`,
    text: `Inscriptions en ligne : ${r.url}${bitsText.length ? ` — ${bitsText.join(", ")}` : " — dates de clôture non encore publiées"}`,
  };
}

export function agendaMail(env, user, events) {
  const base = siteUrl(env);
  const n = events.length;
  const full = events.slice(0, FULL), compact = events.slice(FULL, FULL + COMPACT), more = n - full.length - compact.length;
  const link = (e) => `${base}/#/agenda?id=${encodeURIComponent(e.id)}`;
  const ffco = (e) => `https://api.ffcorientation.fr/iframe/courses/${encodeURIComponent(e.id)}/`;
  const settings = `${base}/#/reglages`;

  const blockHtml = (e) => {
    const rows = courseRows(env, e), reg = registrationBlock(e);
    return `<div style="border:1px solid #dde3ea;border-radius:8px;padding:12px 14px;margin:12px 0">
<div style="font-size:16px;font-weight:700">${a(link(e), e.name)}</div>
<div style="color:#5b6675;margin:2px 0 8px">${esc(frLong(e.date))}${e.type ? ` · ${esc(e.type)}` : ""}</div>
<div style="background:#f4f6f9;border-radius:6px;padding:8px 10px;margin-bottom:8px">${reg.html}</div>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([l, h]) => `<tr><td style="padding:2px 12px 2px 0;color:#5b6675;vertical-align:top;white-space:nowrap">${esc(l)}</td><td style="padding:2px 0">${h}</td></tr>`).join("")}</table>
<div style="margin-top:8px;font-size:13px">${a(link(e), "Voir dans O'CN")} · ${a(ffco(e), "Fiche sur le site de la FFCO")}</div>
</div>`;
  };
  const blockText = (e) => {
    const rows = courseRows(env, e), reg = registrationBlock(e);
    return [`${e.name}`, `${frLong(e.date)}${e.type ? ` · ${e.type}` : ""}`, reg.text,
      ...rows.map(([l, , t]) => `${l} : ${t}`), `O'CN : ${link(e)}`, `FFCO : ${ffco(e)}`].join("\n");
  };

  return {
    subject: n === 1 ? `Nouvelle course à l'agenda : ${events[0].name} — O'CN` : `${n} nouvelles courses à l'agenda — O'CN`,
    html: wrap(env, n === 1 ? "Une nouvelle course à l'agenda" : `${n} nouvelles courses à l'agenda`, `<p>Bonjour ${esc(user.first_name)},</p>
<p>${n === 1 ? "Une course vient" : "Des courses viennent"} d'être ajoutée${n > 1 ? "s" : ""} à l'agenda dans les régions que vous suivez :</p>
${full.map(blockHtml).join("")}
${compact.length ? `<p><b>Et aussi :</b></p><ul style="padding-left:18px">${compact.map((e) => `<li style="margin:4px 0">${a(link(e), e.name)} — ${esc(frShort(e.date))}${e.place ? `, ${esc(e.place)}` : ""}${e.type ? ` (${esc(e.type)})` : ""}</li>`).join("")}</ul>` : ""}
${more > 0 ? `<p>… et ${more} autre${more > 1 ? "s" : ""} dans l'${a(`${base}/#/agenda`, "agenda")}.</p>` : ""}
<p style="font-size:13px;color:#5b6675">Vous recevez ce message parce que vous avez activé l'alerte « nouvelles courses ». ${a(settings, "Modifier mes réglages")}.</p>`),
    text: `Bonjour ${user.first_name},\n\n${n === 1 ? "Une course vient" : "Des courses viennent"} d'être ajoutée${n > 1 ? "s" : ""} à l'agenda dans les régions que vous suivez :\n\n${full.map(blockText).join("\n\n---\n\n")}${compact.length ? `\n\nEt aussi :\n${compact.map((e) => `- ${e.name} — ${frShort(e.date)}${e.place ? `, ${e.place}` : ""}${e.type ? ` (${e.type})` : ""}\n  ${link(e)}`).join("\n")}` : ""}${more > 0 ? `\n\n… et ${more} autre${more > 1 ? "s" : ""} : ${base}/#/agenda` : ""}\n\nPour modifier ou arrêter cette alerte : ${settings}`,
  };
}

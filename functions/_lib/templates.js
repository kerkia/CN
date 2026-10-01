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

// The beta notices (owner, 2026-10-16): the tools just made and little tested — « Tracer », « Analyse multi », « Organisation ›
// Direct » — open with a notice to acknowledge, once per browser and tool (localStorage; a new version `v` of a notice shows it
// again), and carry a « Bêta » label and a short note with a link to « Nous écrire » (a bug report, its subject filled in).
// Texts: beta.* in the catalogues.

import { t } from "./i18n.js";

/** « Nous écrire » as a bug report, its subject filled in, the page one comes from noted. */
const feedback = (n) => `#/contact?${new URLSearchParams({ type: "bug", sujet: t(`beta.${n.id}.subject`), from: location.hash || "#/" })}`;
const NOTICES = {
  tracer: { id: "tracer", key: "ocn.tr.beta", v: "1", guide: "#/methodes?onglet=tracer", try: "beta.try.m" },
  multi: { id: "multi", key: "ocn.beta.multi", v: "1", try: "beta.try.f" },
  direct: { id: "direct", key: "ocn.beta.direct", v: "1", try: "beta.try.m" },
};
const acked = (n) => { try { return localStorage.getItem(n.key) === n.v; } catch (e) { return false; } };
const ack = (n) => { try { localStorage.setItem(n.key, n.v); } catch (e) { /* this visit only */ } };

/** The « Bêta » label, for a title or a bar. */
export const betaTag = (tip = t("beta.mark.tip")) => `<span class="beta-tag" title="${tip}">${t("beta.tag")}</span>`;
/** The note under a page's head: what the beta means, the links to write to us and to the guide. */
export function betaNote(tool) {
  const n = NOTICES[tool];
  return `<p class="beta-note">${t(`beta.${n.id}.note`)} ${t("beta.feedback")} <a href="${feedback(n)}">${t("beta.write")}</a>${n.guide ? ` · <a href="${n.guide}">${t("beta.guide")}</a>` : ""}</p>`;
}
/** The notice, until it is acknowledged (« J'ai compris », or one of its links followed). Resolves once closed. */
export function betaNotice(tool) {
  const n = NOTICES[tool];
  if (!n || acked(n) || document.querySelector(".beta-modal")) return Promise.resolve();
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "tr-modal beta-modal";
    m.innerHTML = `<div class="tr-dialog" role="dialog" aria-modal="true" aria-labelledby="beta-title"><h2 id="beta-title">${t(`beta.${n.id}.title`)}</h2>
      <div class="tr-form">${t(`beta.${n.id}.body`, { try: t(n.try) })}<p>${t("beta.feedback")} <a href="${feedback(n)}" data-link>${t("beta.write")}</a>.${n.guide ? ` ${t("beta.learn", { href: n.guide })}` : ""}</p>
      <div class="tr-dlg-btns"><button type="button" class="btn btn-primary" data-ok>${t("beta.ok")}</button></div></div></div>`;
    const done = (ok) => { if (ok) ack(n); m.remove(); document.removeEventListener("keydown", onKey, true); resolve(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    m.querySelector("[data-ok]").addEventListener("click", () => done(true));
    m.querySelectorAll("[data-link]").forEach((a) => a.addEventListener("click", () => done(true)));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(m);
    m.querySelector("[data-ok]").focus();
  });
}

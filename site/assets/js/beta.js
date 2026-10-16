// The beta notices (owner, 2026-10-16): the tools just made and little tested — « Tracer », « Analyse multi », « Organisation ›
// Direct » — open with a notice to acknowledge, once per browser and tool (localStorage; a new version `v` of a notice shows it
// again), and carry a « Bêta » label and a short note with a link to « Nous écrire » (a bug report, its subject filled in).

/** « Nous écrire » as a bug report, its subject filled in, the page one comes from noted. */
const feedback = (n) => `#/contact?${new URLSearchParams({ type: "bug", sujet: n.subject, from: location.hash || "#/" })}`;
const try1 = "essayez-le librement, et dites-nous ce que vous en pensez — chaque remarque et chaque bug signalé nous aident à l'améliorer.";
const NOTICES = {
  tracer: {
    key: "ocn.tr.beta", v: "1", title: "Le tracé, en version bêta", subject: "Tracé : ", guide: "#/methodes?onglet=tracer",
    body: `<p>Le tracé vient d'être réalisé et n'a encore été que peu testé. C'est une <b>version bêta</b> : ${try1}</p>
      <p>Pour l'instant, nous ne le conseillons pas encore pour préparer une vraie compétition, mais nous espérons qu'il le sera bientôt. En attendant, il
        convient très bien aux <b>cartes d'entraînement</b>.</p>`,
    note: "Version bêta, encore peu testée : idéale pour les cartes d'entraînement, pas encore conseillée pour une compétition.",
  },
  multi: {
    key: "ocn.beta.multi", v: "1", title: "Analyse multi, en version bêta", subject: "Analyse multi : ",
    body: `<p>« Analyse multi » vient d'être réalisée et n'a encore été que peu testée. C'est une <b>version bêta</b> : ${try1.replace("essayez-le", "essayez-la")}</p>
      <p>Il peut encore y rester des erreurs : une carte mal calée, une trace décalée, un passage à un poste mal daté, un temps d'interposte faux. Vérifiez ce qui
        vous étonne, et signalez-le-nous.</p>`,
    note: "Version bêta, encore peu testée : il peut rester des erreurs dans les cartes calées, les traces et les temps.",
  },
  direct: {
    key: "ocn.beta.direct", v: "1", title: "Diffuser en direct, en version bêta", subject: "Diffuser en direct : ",
    body: `<p>« Diffuser en direct » vient d'être réalisé et n'a encore été que peu testé. C'est une <b>version bêta</b> : ${try1}</p>
      <p>Pour l'instant, ne comptez pas sur lui seul pour le direct d'une compétition : gardez votre solution habituelle (liveresultat, l'affichage à
        l'aréna). Essayez-le d'abord à un entraînement, ou à côté de votre direct habituel.</p>`,
    note: "Version bêta, encore peu testée : essayez-la à un entraînement ou à côté de votre direct habituel ; ne comptez pas encore sur elle seule pour une compétition.",
  },
};
const acked = (n) => { try { return localStorage.getItem(n.key) === n.v; } catch (e) { return false; } };
const ack = (n) => { try { localStorage.setItem(n.key, n.v); } catch (e) { /* this visit only */ } };

/** The « Bêta » label, for a title or a bar. */
export const betaTag = (tip = "Version bêta : encore peu testée") => `<span class="beta-tag" title="${tip}">Bêta</span>`;
/** The note under a page's head: what the beta means, the links to write to us and to the guide. */
export function betaNote(tool) {
  const n = NOTICES[tool];
  return `<p class="beta-note">${n.note} Un bug, une remarque ? <a href="${feedback(n)}">Nous écrire</a>${n.guide ? ` · <a href="${n.guide}">Le guide</a>` : ""}</p>`;
}
/** The notice, until it is acknowledged (« J'ai compris », or one of its links followed). Resolves once closed. */
export function betaNotice(tool) {
  const n = NOTICES[tool];
  if (!n || acked(n) || document.querySelector(".beta-modal")) return Promise.resolve();
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "tr-modal beta-modal";
    m.innerHTML = `<div class="tr-dialog" role="dialog" aria-modal="true" aria-labelledby="beta-title"><h2 id="beta-title">${n.title}</h2>
      <div class="tr-form">${n.body}<p>Un bug, une remarque ? <a href="${feedback(n)}" data-link>Nous écrire</a>.${n.guide ? ` Pour apprendre à s'en servir : <a href="${n.guide}" data-link>le guide</a>.` : ""}</p>
      <div class="tr-dlg-btns"><button type="button" class="btn btn-primary" data-ok>J'ai compris</button></div></div></div>`;
    const done = (ok) => { if (ok) ack(n); m.remove(); document.removeEventListener("keydown", onKey, true); resolve(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    m.querySelector("[data-ok]").addEventListener("click", () => done(true));
    m.querySelectorAll("[data-link]").forEach((a) => a.addEventListener("click", () => done(true)));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(m);
    m.querySelector("[data-ok]").focus();
  });
}

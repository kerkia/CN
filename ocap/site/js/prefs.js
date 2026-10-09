// « Réglages »: the language, the user's name (to spot them in results), the runners they follow — all on this phone.
import { t, lang } from "./i18n.js";
import { settings, save } from "./settings.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function render(view) {
  const s = settings();
  view.innerHTML = `<header class="bar"><h1>${t("set.title")}</h1></header>
    <section class="card">
      <h2>${t("set.lang")}</h2>
      <div class="seg" role="radiogroup" aria-label="${t("set.lang")}">
        ${[["auto", t("set.lang.auto")], ["fr", "Français"], ["en", "English"]].map(([v, l]) =>
          `<button role="radio" aria-checked="${s.lang === v}" class="${s.lang === v ? "on" : ""}" data-lang="${v}">${l}</button>`).join("")}
      </div>
    </section>
    <section class="card">
      <h2>${t("set.me")}</h2>
      <p class="muted small">${t("set.me.hint")}</p>
      <label class="field"><span>${t("set.first")}</span><input id="first" autocomplete="given-name" value="${esc(s.first)}"></label>
      <label class="field"><span>${t("set.last")}</span><input id="last" autocomplete="family-name" value="${esc(s.last)}"></label>
      <p class="saved small" id="saved" hidden>${t("set.saved")}</p>
    </section>
    <section class="card">
      <h2>${t("set.follow")}</h2>
      <div id="follow">${s.follow.length ? s.follow.map((f) => `<div class="frow"><div><div>${esc(f.name)}</div><div class="muted small">${esc(f.club)}</div></div>
        <button class="star on" data-k="${esc(f.k)}" aria-label="${esc(f.name)}">★</button></div>`).join("")
        : `<p class="muted small">${t("set.follow.none")}</p>`}</div>
    </section>
    <section class="card"><h2>${t("set.about")}</h2><p class="muted small">${t("set.about.text")}</p></section>`;
  view.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
    save({ lang: b.dataset.lang });
    document.dispatchEvent(new Event("ocap:lang"));
  }));
  let timer;
  const keep = () => {
    save({ first: view.querySelector("#first").value.trim(), last: view.querySelector("#last").value.trim() });
    const el = view.querySelector("#saved");
    el.hidden = false; clearTimeout(timer); timer = setTimeout(() => (el.hidden = true), 1500);
  };
  view.querySelector("#first").addEventListener("input", keep);
  view.querySelector("#last").addEventListener("input", keep);
  view.querySelector("#follow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    save({ follow: settings().follow.filter((f) => f.k !== b.dataset.k) });
    b.closest(".frow").remove();
  });
  return null;
}
export const _lang = lang;

// The site in pictures, on the home page under the hero (owner, 2026-10-19: the presentation shown to Swiss Orienteering,
// published on the site, in French and English). A course through the site: a purple line from the start triangle, through
// numbered controls (the sections), to the finish. The screenshots (assets/tour/<lang>/*.webp) were taken on a scrambled
// copy of the data — invented names, licences and clubs, times shifted — so this public page shows nobody's real results
// (the public page never shows real results or names); « En direct » and the notifications are drawn mockups.

import { html, raw, $, $$, fmt } from "./util.js";
import { t, lang } from "./i18n.js";

const LEGS = [
  { id: "runner", who: ["r"], main: "runner-calc", side: ["dark-progress", "compare"], row: ["runner-map", "runner-network", "runner-seasons"] },
  { id: "ranking", who: ["r", "c"], main: "ranking", side: ["categories", "courses"], strip: ["stats-territories", "stats-ages", "stats-participation", "stats-leaders"] },
  { id: "method", who: ["r", "l"], duel: true, pair: ["docs", "docs-top"] },
  { id: "races", who: ["r"], main: "agenda-start", side: ["race", "@live"], row: ["dark-splits", "@notif", "settings"] },
  { id: "training", who: ["r", "c"], main: "@trace", side: ["game-forestroute", "vma"], strip: ["game-photo", "game-contour", "game-rapid", "game-maze"] },
  { id: "clubs", who: ["c", "l"], main: "relays", side: ["club", "clubcompare"], pair: ["clubs", "ia"] },
  { id: "orga", who: ["o", "c"], main: "@tracer", side: ["orga-starts", "orga-results"], pair: ["orga-competitions", "results"] },
  { id: "phones", who: ["all"], phones: ["phone-ranking", "phone-agenda", "phone-race", "phone-settings", "phone-runner"] },
];
const MAIL = "contact@ozimut.com";       // i18n-ignore
const src = (name) => (name === "@trace" ? "assets/reel-trace.webp" : name === "@tracer" ? "assets/reel-tracer.webp"
  : `assets/tour/${lang() === "en" ? "en" : "fr"}/${name}.webp`);
const capKey = (name) => name.replace(/^@/, "");

const cap = (name) => {
  const k = capKey(name), b = t(`tour.cap.${k}.b`), rest = t(`tour.cap.${k}`);
  return html`<figcaption><b>${b}</b>${rest ? html` ${rest}` : ""}</figcaption>`;
};
const shot = (name, { small = false } = {}) => {
  if (name === "@live") return live();
  if (name === "@notif") return notif();
  return html`<figure><div class="tour-shot"><img src="${src(name)}" alt="${t(`tour.cap.${capKey(name)}.b`)}" loading="lazy" decoding="async"
    tabindex="0" title="${t("tour.zoom")}"></div>${small ? html`<figcaption><b>${t(`tour.cap.${capKey(name)}.b`)}</b>${t(`tour.cap.${capKey(name)}`) ? html` ${t(`tour.cap.${capKey(name)}`)}` : ""}</figcaption>` : cap(name)}</figure>`;
};
// the mockups: a live results table and a phone's lock screen, invented
function live() {
  const rows = [[1, "Lucas Fontaine", "14:52", 2], [2, "Hugo Mercier", "15:03", 5, true], [3, "Antoine Girard", "15:11", 1], [4, "Théo Rousseau", "15:40", 3]];   // i18n-ignore
  return html`<figure class="tour-mock"><div class="tour-mock-head">${t("tour.live.title")} <em>${t("tour.live.badge")}</em></div>
    <table><thead><tr><th>${t("tour.live.pl")}</th><th>${t("tour.live.runner")}</th><th class="num">${t("tour.live.time")}</th><th class="num">${t("tour.live.expected")}</th></tr></thead>
    <tbody>${rows.map(([p, n, tm, ex, nw]) => html`<tr class="${nw ? "new" : ""}"><td>${p}</td><td>${n}${nw ? html` <span class="tour-new">${t("tour.live.new")}</span>` : ""}</td>
      <td class="num">${tm}</td><td class="num">${ex}</td></tr>`)}</tbody></table>
    <figcaption><b>${t("tour.cap.live.b")}</b> ${t("tour.cap.live")} <i>${t("tour.mockup")}</i></figcaption></figure>`;
}
const logo = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.5 L28.5 16 L16 16 Z" fill="#e8641c"/><path d="M3.5 16 L16 28.5 L16 16 Z" fill="#18201b"/><path d="M16 3.5 L28.5 16 L16 28.5 L3.5 16 Z" fill="none" stroke="#18201b" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
function notif() {
  const n = (i) => html`<div class="tour-notif">${raw(logo)}<b>${t(`tour.notif.${i}.t`)}</b><span>${t(`tour.notif.${i}.b`)}</span><small>${t(`tour.notif.${i}.s`)}</small></div>`;
  return html`<figure><div class="tour-phone"><div class="tour-lock" role="img" aria-label="${t("tour.cap.notif.b")}">
      <div class="tour-clock num">07:42</div><div class="tour-day">${t("tour.notif.day")}</div>${n(1)}${n(2)}</div></div>
    <figcaption><b>${t("tour.cap.notif.b")}</b> ${t("tour.cap.notif")} <i>${t("tour.mockup")}</i></figcaption></figure>`;
}

function leg(L, i) {
  const head = html`<div class="tour-ctrl" aria-hidden="true">${i + 1}</div>
    <div class="tour-leg-head"><div><div class="tour-eyebrow">${t(`tour.${L.id}.eyebrow`)}</div><h2>${t(`tour.${L.id}.title`)}</h2>
      <p class="tour-lede">${t(`tour.${L.id}.lede`)}</p></div>
      <div class="tour-who">${L.who.map((w) => html`<span class="tour-who-${w}">${t(`tour.who.${w}`)}</span>`)}</div></div>`;
  const duel = L.duel ? html`<div class="tour-duel">${["forest", "sprint"].map((d) => html`<div><h3>${t(`tour.method.${d}`)}</h3>
      <div class="tour-vs"><s>${t(`tour.method.${d}.a`)}</s><b>${t(`tour.method.${d}.b`)}</b></div><p>${t("tour.method.note")}</p></div>`)}</div>` : "";
  const main = L.main ? html`<div class="tour-g-main">${shot(L.main)}<div class="tour-g-side">${L.side.map((s) => shot(s))}</div></div>` : "";
  const row = L.row ? html`<div class="tour-g-3">${L.row.map((s) => shot(s))}</div>` : "";
  const strip = L.strip ? html`<div class="tour-g-4">${L.strip.map((s) => shot(s, { small: true }))}</div>` : "";
  const pair = L.pair ? html`<div class="tour-g-2">${L.pair.map((s) => shot(s))}</div>` : "";
  const phones = L.phones ? html`<div class="tour-g-5">${L.phones.map((s) => html`<figure><div class="tour-phone"><img src="${src(s)}"
      alt="${t(`tour.cap.${s}.b`)}" loading="lazy" decoding="async" tabindex="0" title="${t("tour.zoom")}"></div><figcaption><b>${t(`tour.cap.${s}.b`)}</b></figcaption></figure>`)}</div>` : "";
  return html`<section class="tour-leg" id="tour-${L.id}">${head}${duel}${main}${row}${strip}${pair}${phones}</section>`;
}

/** The section, under the hero. counts: meta.json's { runners, competitions, results }. */
export function tourHtml(counts = {}) {
  const fig = (v, k) => (v ? html`<div class="tour-fig"><b>${fmt(v)}</b><span>${t(k)}</span></div>` : "");
  const tick = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12.5l3.2 3L17 8.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return html`<section class="tour" aria-labelledby="tour-title">
    <header class="tour-top"><div class="tour-eyebrow">${t("tour.eyebrow")}</div><h2 id="tour-title">${t("tour.title")}</h2>
      <p class="tour-lede">${t("tour.lede")}</p>
      <div class="tour-figs">${fig(counts.runners, "tour.fig.runners")}${fig(counts.competitions, "tour.fig.competitions")}${fig(counts.results, "tour.fig.results")}
        <div class="tour-fig"><b>4</b><span>${t("tour.fig.specs")}</span></div></div></header>
    <div class="tour-course">
      <svg class="tour-start" viewBox="0 0 45 45" aria-hidden="true"><path d="M22.5 5 L41 37 L4 37 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
      ${LEGS.map(leg)}
      <section class="tour-leg tour-finish" id="tour-finish">
        <svg class="tour-ctrl tour-ctrl-finish" viewBox="0 0 45 45" aria-hidden="true"><circle cx="22.5" cy="22.5" r="20" stroke="currentColor" stroke-width="3"/><circle cx="22.5" cy="22.5" r="13" fill="none" stroke="currentColor" stroke-width="3"/></svg>
        <div class="tour-leg-head"><div><div class="tour-eyebrow">${t("tour.finish.eyebrow")}</div><h2>${t("tour.finish.title")}</h2></div></div>
        <div class="tour-finish-band">
          <ul class="tour-pledge">${[1, 2, 3, 4, 5].map((i) => html`<li>${raw(tick)}<span><b>${t(`tour.pledge.${i}.b`)}</b> ${t(`tour.pledge.${i}`)}</span></li>`)}</ul>
          <div class="tour-cta"><h3>${t("tour.cta.title")}</h3><p>${t("tour.cta.text")}</p>
            <div class="tour-cta-row"><a class="btn btn-primary" href="#/compte/inscription">${t("tour.cta.register")}</a></div>
            <p class="tour-cta-mail"><span>${t("tour.cta.mail")}</span> <b id="tour-mail">${MAIL}</b>
              <button type="button" class="btn btn-sm" id="tour-copy">${t("tour.cta.copy")}</button></p></div>
        </div>
      </section>
    </div>
    <p class="tour-note">${t("tour.note")}</p>
    <dialog class="tour-box" id="tour-box"><img alt=""><p></p></dialog>
  </section>`;
}

/** The screenshots open larger; the address copies. */
export function mountTour(root) {
  const box = $("#tour-box", root);
  if (!box) return;
  const img = $("img", box), cap = $("p", box);
  $$(".tour-shot img, .tour-phone img", root).forEach((el) => {
    const open = () => {
      img.src = el.currentSrc || el.src; img.alt = el.alt;
      cap.textContent = el.closest("figure")?.querySelector("figcaption")?.textContent || el.alt;
      try { box.showModal(); } catch (e) { box.setAttribute("open", ""); }
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  box.addEventListener("click", () => box.close());
  $("#tour-copy", root)?.addEventListener("click", (e) => {
    const b = e.currentTarget;
    navigator.clipboard?.writeText(MAIL).then(() => { b.textContent = t("tour.cta.copied"); }).catch(() => {
      const r = document.createRange(); r.selectNodeContents($("#tour-mail", root)); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  });
}

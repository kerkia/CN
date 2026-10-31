// « Symboles de carte » (Coach; owner, 2026-10-31, beside « Définitions de postes »): the symbols of orienteering maps as a
// legend shows them — two tabs, the forest map (ISOM 2017-2) and the sprint map (ISSprOM 2019-2, revision 6), each named at
// the top of the page with its year; group by group (which is also colour by colour), each symbol's swatch, number, name and
// what it means (isom.js draws them). The sprint tab tags the symbols a forest map does not have. At the top of the forest
// tab, what each colour says and how green slows the runner. A search, and a practice mode: the names hidden (what does this
// drawing mean?) or the drawings hidden (what does it look like?), a tap showing what is hidden.

import { html, raw, $, $$, normalise } from "../util.js";
import { t } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs } from "../ui.js";
import { GROUPS, FORBIDDEN, GROUPS_SPRINT, FORBIDDEN_SPRINT, SPRINT_ONLY, colour, isomSvg } from "../isom.js";

const MODES = { "": "off", names: "names", pics: "pics" };
const FROM_QUERY = { noms: "names", dessins: "pics" };
// the colours' meaning, in the order a reader meets them, with the colour of their chip
const COLOURS = [["brown", "brown"], ["black", "black"], ["blue", "blue"], ["yellow", "yellow"], ["paper", "paper"], ["green", "green"], ["purple", "purple"]];
// how fast one runs through the forest's colours (the specification's shares of normal speed)
const RUN = [["paper", 405], ["green30", 406], ["green60", 408], ["green", 410]];

export async function render(main, { query = {} } = {}) {
  const tabs = [["foret", t("ms.tab.forest")], ["sprint", t("ms.tab.sprint")]];
  const tab = tabFrom(tabs, query);
  let practice = FROM_QUERY[query.mode] || "";
  const chip = (k) => html`<span class="ms-chip${k === "paper" ? " paper" : ""}" style="background:${colour(k)}"></span>`;
  const item = (code, sprint) => {
    const p = sprint ? "ms.sp" : "ms", name = t(`${p}.s.${code}`), note = t(`${p}.n.${code}`);
    const forbidden = (sprint ? FORBIDDEN_SPRINT : FORBIDDEN).has(code), only = sprint && SPRINT_ONLY.has(code);
    return html`<button type="button" class="ms-item" data-words="${normalise(`${code} ${name} ${note}${only ? ` ${t("ms.sp.only")}` : ""}`)}" aria-label="${code} ${name}">
      <span class="ms-pic">${raw(isomSvg(code, 126, "ms-sw", sprint))}</span>
      <span class="ms-txt"><span class="ms-name"><span class="ms-code">${code}</span>${name}${only ? html` <span class="ms-tag sprint" title="${t("ms.sp.only.tip")}">${t("ms.sp.only")}</span>` : ""}${forbidden ? html` <span class="ms-tag">${t("ms.forbidden")}</span>` : ""}</span>
        <span class="ms-note">${note}</span></span></button>`;
  };
  const section = (g, sprint) => html`<section class="card ms-sec" id="ms-${sprint ? "sp-" : ""}${g.key}"><div class="card-head"><div>
      <h2><span class="ms-chips">${g.colours.map(chip)}</span>${t(`ms.g.${g.key}`)}</h2><div class="hint">${t(sprint && g.key === "man" ? "ms.g.sprint.man.hint" : `ms.g.${g.key}.hint`)}</div></div></div>
      <div class="ms-grid">${g.codes.map((c) => item(c, sprint))}</div></section>`;
  const intro = html`<section class="card ms-intro"><div class="card-head"><div><h2>${t("ms.colours")}</h2><div class="hint">${t("ms.colours.hint")}</div></div></div>
    <div class="ms-intro-body">
      <ul class="ms-colours">${COLOURS.map(([k, c]) => html`<li>${chip(c)}<span><b>${t(`ms.c.${k}`)}</b> ${t(`ms.c.${k}.say`)}</span></li>`)}</ul>
      <div class="ms-run"><div class="ms-run-h">${t("ms.run")}</div>
        <div class="ms-run-row">${RUN.map(([c, code]) => html`<div class="ms-run-cell"><span class="ms-run-sw${c === "paper" ? " paper" : ""}" style="background:${colour(c)}"></span>
          <b>${t(`ms.run.${code}`)}</b><span>${t(`ms.s.${code}`)}</span></div>`)}</div></div>
    </div></section>`;
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ms.title")}</h1><p class="lede">${t("ms.lede")}</p></div></div>
    <ul class="ms-stds"><li>${t("ms.std.forest")}</li><li>${t("ms.std.sprint")}</li></ul>
    ${pageTabs(tabs, tab)}
    <div class="filters cd-filters">
      <label class="field" style="flex:1 1 220px"><span>${t("cd.search")}</span><input type="search" id="ms-q" placeholder="${t("ms.search.ph")}"></label>
      <label class="field"><span>${t("cd.practice")}</span><select id="ms-practice">${Object.entries(MODES)
        .map(([k, v]) => html`<option value="${k}" ${raw(k === practice ? "selected" : "")}>${t(`ms.practice.${v}`)}</option>`)}</select></label>
    </div>
    <p class="muted cd-hint" id="ms-hint"></p>
    <div data-panel="foret" ${raw(tab === "foret" ? "" : "hidden")}>
      ${intro}${GROUPS.map((g) => section(g, false))}
      <p class="muted ms-source">${t("ms.source")}</p>
    </div>
    <div data-panel="sprint" ${raw(tab === "sprint" ? "" : "hidden")}>
      <p class="ms-sp-intro">${t("ms.sp.intro")}</p>
      ${GROUPS_SPRINT.map((g) => section(g, true))}
      <p class="muted ms-source">${t("ms.source.sprint")}</p>
    </div>`;

  function filter() {
    const q = normalise($("#ms-q").value.trim());
    $$(".ms-item", main).forEach((b) => { b.hidden = !!q && !q.split(/\s+/).every((w) => b.dataset.words.includes(w)); });
    $$(".ms-sec", main).forEach((s) => { s.hidden = !$$(".ms-item", s).some((b) => !b.hidden); });
    $(".ms-intro", main).hidden = !!q;
    main.classList.toggle("ms-practising", !!practice);
    main.classList.toggle("ms-hide-names", practice === "names");
    main.classList.toggle("ms-hide-pics", practice === "pics");
    const hint = $("#ms-hint");
    hint.hidden = !practice;
    hint.textContent = practice ? t(`ms.practice.hint.${practice}`) : "";
  }
  bindPageTabs(main, tabs, tab);
  filter();
  $("#ms-q").addEventListener("input", filter);
  $("#ms-practice").addEventListener("change", (e) => {
    practice = e.target.value;
    $$(".ms-item.shown", main).forEach((b) => b.classList.remove("shown"));
    filter();
  });
  // practice: a tap shows what is hidden, a second hides it again
  main.addEventListener("click", (e) => {
    const b = e.target.closest(".ms-item");
    if (b && practice) b.classList.toggle("shown");
  });
  return { title: t("ms.title") };
}

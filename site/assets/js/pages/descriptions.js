// « Définitions de postes » (Coach; owner, 2026-10-30): the IOF control description symbols, column by column, each drawn
// with its name and the text a description sheet prints for it, in any of the symbol file's 23 languages. The symbols are
// Purple Pen's (BSD licence, credited in the site's legal notices), the same the Tracer draws (tracer/symbols.js). A search
// over the names and texts, and a practice mode that hides the names until a symbol is tapped.

import { html, raw, $, $$, normalise } from "../util.js";
import { t, lang } from "../i18n.js";
import { loadSymbols, loadAllTexts, languages, symbolsFor, symbolName, symbolText, symbolPaths } from "../tracer/symbols.js";

// the columns of a description sheet, and the special instructions (Purple Pen's kinds); column D by its families (the
// symbols' numbers: 1 landforms, 2 rocks, 3 water, 4 vegetation, 5 man-made, 6 special features)
const COLUMNS = ["C", "D", "E", "F", "G", "H"];
const D_FAMILIES = ["1", "2", "3", "4", "5", "6"];
const SPECIAL = ["W", "X", "Y", "Z", "V"];

/** A symbol drawn as SVG: a square cell, or a row of eight for a special instruction. */
function svg(s, size = 56) {
  const wide = s.k >= "T";
  const w = wide ? size * 8 : size, h = size;
  const d = (cmds) => cmds.map(([c, ...n]) => c + n.map((v) => +v.toFixed(2)).join(" ")).join("");
  const parts = symbolPaths(s, 0, 0, w, h).map((p) => (p.fill ? `<path d="${d(p.d)}" fill="currentColor"/>`
    : `<path d="${d(p.d)}" fill="none" stroke="currentColor" stroke-width="${Math.max(0.6, p.stroke).toFixed(2)}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"/>`));
  return raw(`<svg class="cd-sym${wide ? " wide" : ""}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${parts.join("")}</svg>`);
}

export async function render(main, { query = {} } = {}) {
  await loadSymbols();
  const langs = languages();
  let L = langs[query.langue] ? query.langue : langs[lang()] ? lang() : "en";
  let practice = query.mode === "pratique";
  if (L !== "fr" && L !== "en") await loadAllTexts();
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cd.title")}</h1><p class="lede">${t("cd.lede")}</p></div></div>
    <div class="filters cd-filters">
      <label class="field"><span>${t("cd.lang")}</span><select id="cd-lang">${Object.entries(langs).sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([k, v]) => html`<option value="${k}" ${raw(k === L ? "selected" : "")}>${v.name}</option>`)}</select></label>
      <label class="field" style="flex:1 1 220px"><span>${t("cd.search")}</span><input type="search" id="cd-q" placeholder="${t("cd.search.ph")}"></label>
      <label class="check" style="align-self:flex-end"><input type="checkbox" id="cd-practice" ${practice ? "checked" : ""}><span>${t("cd.practice")}</span></label>
    </div>
    <p class="muted cd-hint" id="cd-hint" ${practice ? "" : "hidden"}>${t("cd.practice.hint")}</p>
    <div id="cd-body"></div>
    <p class="muted" style="font-size:12.5px;margin-top:18px">${t("cd.source")}</p>`;

  const sheet = (kind) => symbolsFor(kind);
  const card = (s) => {
    // (a column C or G text is a pattern around the feature's own, « {0}, le plus au Nord »: shown with an ellipsis)
    const name = symbolName(s, L), text = s.k >= "T" ? "" : (symbolText(s, L) || "").replace(/\{\d\}/g, "…");
    const words = normalise(`${name} ${text} ${s.id}`);
    return html`<button type="button" class="cd-card${s.k >= "T" ? " wide" : ""}" data-words="${words}" aria-label="${name}">
      ${svg(s)}<span class="cd-id">${/^[0-9]/.test(s.id) ? s.id.replace(/@.*/, "") : ""}</span>
      <span class="cd-name">${name}</span>${text && normalise(text) !== normalise(name) ? html`<span class="cd-text">« ${text} »</span>` : ""}</button>`;
  };
  const section = (title, hint, list) => (list.length ? html`<section class="card cd-sec"><div class="card-head"><div><h2>${title}</h2>${hint ? html`<div class="hint">${hint}</div>` : ""}</div></div>
      <div class="cd-grid">${list.map(card)}</div></section>` : "");
  function draw() {
    $("#cd-body").innerHTML = html`${COLUMNS.flatMap((c) => (c === "D"
      ? D_FAMILIES.map((f) => section(t("cd.col.D", { f: t(`cd.fam.${f}`) }), f === "1" ? t("cd.col.D.hint") : "", sheet("D").filter((s) => s.id.split(".")[0] === f)))
      : [section(t(`cd.col.${c}`), t(`cd.col.${c}.hint`), sheet(c))]))}
      ${section(t("cd.special"), t("cd.special.hint"), SPECIAL.flatMap(sheet))}`;
    filter();
  }
  function filter() {
    const q = normalise($("#cd-q").value.trim());
    $$(".cd-card", main).forEach((b) => { b.hidden = !!q && !q.split(/\s+/).every((w) => b.dataset.words.includes(w)); });
    $$(".cd-sec", main).forEach((s) => { s.hidden = !$$(".cd-card", s).some((b) => !b.hidden); });
    main.classList.toggle("cd-practising", practice);
  }
  draw();
  $("#cd-lang").addEventListener("change", async (e) => {
    L = e.target.value;
    if (L !== "fr" && L !== "en") await loadAllTexts();
    draw();
  });
  $("#cd-q").addEventListener("input", filter);
  $("#cd-practice").addEventListener("change", (e) => {
    practice = e.target.checked;
    $("#cd-hint").hidden = !practice;
    $$(".cd-card.shown", main).forEach((b) => b.classList.remove("shown"));
    filter();
  });
  // practice: a tap shows a symbol's name, a second hides it again
  main.addEventListener("click", (e) => {
    const b = e.target.closest(".cd-card");
    if (b && practice) b.classList.toggle("shown");
  });
  return { title: t("cd.title") };
}

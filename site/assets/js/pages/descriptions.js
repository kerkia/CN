// « Définitions de postes » (Coach; owner, 2026-10-30): the IOF control description symbols, column by column, each drawn
// with its name and the text a description sheet prints for it, in any of the symbol file's 23 languages. The symbols are
// Purple Pen's (BSD licence, credited in the site's legal notices), the same the Tracer draws (tracer/symbols.js). A search
// over the names and texts, and a practice mode that hides the names until a symbol is tapped. Beside each symbol, the feature
// as a map draws it (mapsymbols.js; owner, 2026-10-30, after Maprunner's posters), and at the top a worked line of a sheet,
// its eight columns explained and the line written out in the language chosen (the Tracer's textifier). Practice: the names
// hidden, or the map alone (imagine the description) or the symbol alone (imagine the map), the rest found by a tap.

import { html, raw, $, $$, normalise } from "../util.js";
import { t, lang } from "../i18n.js";
import { loadSymbols, loadAllTexts, languages, symbol, symbolsFor, symbolName, symbolText, symbolPaths } from "../tracer/symbols.js";
import { textifier } from "../tracer/textify.js";
import { mapSvg } from "../mapsymbols.js";

// the columns of a description sheet, and the special instructions (Purple Pen's kinds); column D by its families (the
// symbols' numbers: 1 landforms, 2 rocks, 3 water, 4 vegetation, 5 man-made, 6 special features)
const COLUMNS = ["C", "D", "E", "F", "G", "H"];
const D_FAMILIES = ["1", "2", "3", "4", "5", "6"];
const SPECIAL = ["W", "X", "Y", "Z", "V"];
// the practice modes: off, the names hidden, the map alone, the symbol alone (the address's « mode=pratique|carte|symbole »)
const MODES = { "": "off", names: "names", map: "map", sym: "sym" };
const FROM_QUERY = { pratique: "names", carte: "map", symbole: "sym" };
// the worked line at the top (our own example): control 7, code 145, « the eastern stony depression, 8 × 4 m, north part;
// refreshments » — C, D, E, the F size, G, H (Purple Pen's control: symbols C, D, E, F-combination, G, H)
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const EXAMPLE = { num: "7", code: "145", symbols: ["0.1E", "1.12", "8.6", null, "11.3N", "12.2"], colF: "8x4" };

/** A symbol drawn as SVG: a square cell, or a row of eight for a special instruction. */
function svg(s, size = 56, cls = "cd-sym") {
  const wide = s.k >= "T";
  const w = wide ? size * 8 : size, h = size;
  const d = (cmds) => cmds.map(([c, ...n]) => c + n.map((v) => +v.toFixed(2)).join(" ")).join("");
  const parts = symbolPaths(s, 0, 0, w, h).map((p) => (p.fill ? `<path d="${d(p.d)}" fill="currentColor"/>`
    : `<path d="${d(p.d)}" fill="none" stroke="currentColor" stroke-width="${Math.max(0.6, p.stroke).toFixed(2)}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"/>`));
  return raw(`<svg class="${cls}${wide ? " wide" : ""}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${parts.join("")}</svg>`);
}

export async function render(main, { query = {} } = {}) {
  await loadSymbols();
  const langs = languages();
  let L = langs[query.langue] ? query.langue : langs[lang()] ? lang() : "en";
  let practice = FROM_QUERY[query.mode] || "";
  if (L !== "fr" && L !== "en") await loadAllTexts();
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cd.title")}</h1><p class="lede">${t("cd.lede")}</p></div></div>
    <div class="filters cd-filters">
      <label class="field"><span>${t("cd.lang")}</span><select id="cd-lang">${Object.entries(langs).sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([k, v]) => html`<option value="${k}" ${raw(k === L ? "selected" : "")}>${v.name}</option>`)}</select></label>
      <label class="field" style="flex:1 1 220px"><span>${t("cd.search")}</span><input type="search" id="cd-q" placeholder="${t("cd.search.ph")}"></label>
      <label class="field"><span>${t("cd.practice")}</span><select id="cd-practice">${Object.entries(MODES)
        .map(([k, v]) => html`<option value="${k}" ${raw(k === practice ? "selected" : "")}>${t(`cd.practice.${v}`)}</option>`)}</select></label>
    </div>
    <p class="muted cd-hint" id="cd-hint"></p>
    <div id="cd-body"></div>
    <p class="muted" style="font-size:12.5px;margin-top:18px">${t("cd.source")}</p>`;

  const sheet = (kind) => symbolsFor(kind);
  const card = (s) => {
    // (a column C or G text is a pattern around the feature's own, « {0}, le plus au Nord »: shown with an ellipsis)
    const name = symbolName(s, L), text = s.k >= "T" ? "" : (symbolText(s, L) || "").replace(/\{\d\}/g, "…");
    const words = normalise(`${name} ${text} ${s.id}`);
    const map = s.k >= "T" ? "" : mapSvg(s.id, 64);
    return html`<button type="button" class="cd-card${s.k >= "T" ? " wide" : ""}" data-words="${words}" ${raw(map ? "data-map" : "")} aria-label="${name}">
      <span class="cd-pics">${svg(s)}${raw(map)}</span><span class="cd-id">${/^[0-9]/.test(s.id) ? s.id.replace(/@.*/, "") : ""}</span>
      <span class="cd-name">${name}</span>${text && normalise(text) !== normalise(name) ? html`<span class="cd-text">${t("cd.quote", { x: text })}</span>` : ""}</button>`;
  };
  const section = (title, hint, list, id = "") => (list.length ? html`<section class="card cd-sec" ${raw(id ? `id="cd-col-${id}"` : "")}><div class="card-head"><div><h2>${title}</h2>${hint ? html`<div class="hint">${hint}</div>` : ""}</div></div>
      <div class="cd-grid">${list.map(card)}</div></section>` : "");
  // the worked line: the eight cells under their letters, the line in words, what each column says (C-H lead to their part)
  function intro() {
    const cell = (id) => (id ? svg(symbol(id), 40, "cd-cell-sym") : "");
    const [c, d, e, , g, h] = EXAMPLE.symbols;
    const cells = [EXAMPLE.num, EXAMPLE.code, cell(c), cell(d), cell(e), EXAMPLE.colF.replace("x", "×"), cell(g), cell(h)];
    const words = textifier({ controls: { x: { kind: "normal", ...EXAMPLE } }, descStandard: "2018" }, L).control("x");
    return html`<section class="card cd-intro"><div class="card-head"><div><h2>${t("cd.intro")}</h2><div class="hint">${t("cd.intro.hint")}</div></div></div>
      <div class="cd-intro-body">
        <div class="cd-row" role="img" aria-label="${words}">${LETTERS.map((l, i) => html`<div class="cd-rc"><span class="cd-rl">${l}</span><span class="cd-rv${i < 2 || i === 5 ? " txt" : ""}">${cells[i]}</span></div>`)}</div>
        <p class="cd-row-text">${t("cd.intro.words", { x: words })}</p>
        <ul class="cd-letters">${LETTERS.map((l) => html`<li>${l >= "C" ? html`<button type="button" class="cd-letter" data-goto="${l}">${l}</button>` : html`<span class="cd-letter">${l}</span>`}<span>${t(`cd.letter.${l}`)}</span></li>`)}</ul>
      </div></section>`;
  }
  function draw() {
    $("#cd-body").innerHTML = html`${intro()}${COLUMNS.flatMap((c) => (c === "D"
      ? D_FAMILIES.map((f) => section(t("cd.col.D", { f: t(`cd.fam.${f}`) }), f === "1" ? t("cd.col.D.hint") : "", sheet("D").filter((s) => s.id.split(".")[0] === f), f === "1" ? "D" : ""))
      : [section(t(`cd.col.${c}`), t(`cd.col.${c}.hint`), sheet(c), c)]))}
      ${section(t("cd.special"), t("cd.special.hint"), SPECIAL.flatMap(sheet))}`;
    filter();
  }
  function filter() {
    const q = normalise($("#cd-q").value.trim());
    $$(".cd-card", main).forEach((b) => {
      b.hidden = ((practice === "map" || practice === "sym") && !("map" in b.dataset)) || (!!q && !q.split(/\s+/).every((w) => b.dataset.words.includes(w)));
    });
    $$(".cd-sec", main).forEach((s) => { s.hidden = !$$(".cd-card", s).some((b) => !b.hidden); });
    $(".cd-intro", main).hidden = !!q;
    main.classList.toggle("cd-practising", !!practice);
    main.classList.toggle("cd-by-map", practice === "map");
    main.classList.toggle("cd-by-sym", practice === "sym");
    const hint = $("#cd-hint");
    hint.hidden = !practice;
    hint.textContent = practice ? t(practice === "names" ? "cd.practice.hint" : `cd.practice.hint.${practice}`) : "";
  }
  draw();
  $("#cd-lang").addEventListener("change", async (e) => {
    L = e.target.value;
    if (L !== "fr" && L !== "en") await loadAllTexts();
    draw();
  });
  $("#cd-q").addEventListener("input", filter);
  $("#cd-practice").addEventListener("change", (e) => {
    practice = e.target.value;
    $$(".cd-card.shown", main).forEach((b) => b.classList.remove("shown"));
    filter();
  });
  // practice: a tap shows a symbol's name, a second hides it again; a column's letter in the worked line leads to its part
  main.addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) { document.getElementById(`cd-col-${go.dataset.goto}`)?.scrollIntoView({ behavior: "smooth" }); return; }
    const b = e.target.closest(".cd-card");
    if (b && practice) b.classList.toggle("shown");
  });
  return { title: t("cd.title") };
}

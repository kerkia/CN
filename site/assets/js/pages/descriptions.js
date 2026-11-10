// « Définitions de postes » (Coach; owner, 2026-10-30): the IOF control description symbols, column by column, each drawn
// with its name and the text a description sheet prints for it, in any of the symbol file's 23 languages. The symbols are
// Purple Pen's (BSD licence, credited in the site's legal notices), the same the Tracer draws (tracer/symbols.js). A search
// over the names and texts, and a practice mode that hides the names until a symbol is tapped. Beside each symbol, the feature
// as a map draws it, and at the top a worked line of a sheet, its eight columns explained and the line written out in the
// language chosen (the Tracer's textifier). Practice: the names hidden, or the map alone (imagine the description) or the
// symbol alone (imagine the map), the rest found by a tap.
// Everything from the specifications and only from them (owner, 2026-11-04; iscd.js): the numbers, names and descriptions of
// ISCD 2024, and beside a column D symbol the map symbols that ISCD's own « ISOM/ISSprOM » column names, drawn as « Symboles
// de carte » draws them (isom.js); the other columns have none. Two tabs (owner, 2026-10-31): « Forêt » with ISOM 2017-2's
// symbols, « Sprint » with ISSprOM 2019-2's (column D keeping the features that have one).

import { html, raw, $, $$, normalise } from "../util.js";
import { t, lang } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs } from "../ui.js";
import { loadSymbols, loadAllTexts, languages, symbol, symbolsFor, symbolName } from "../tracer/symbols.js";
import { cdSymbolSvg as svg } from "../cdsymbol.js";
import { textifier } from "../tracer/textify.js";
import { iscdRef, mapCodes, mapSwatches } from "../iscd.js";

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
const num = (ref) => ref.split(".").map(Number);
const byRef = (a, b) => { const x = num(a), y = num(b); return x[0] - y[0] || x[1] - y[1]; };

/** The page; `embedded` (« Apprendre », pages/learn.js): no title of its own, the page's heading says it. */
export async function render(main, { query = {}, embedded = false } = {}) {
  const tabs = [["foret", t("ms.tab.forest")], ["sprint", t("ms.tab.sprint")]];
  let tab = tabFrom(tabs, query);
  await loadSymbols();
  const langs = languages();
  let L = langs[query.langue] ? query.langue : langs[lang()] ? lang() : "en";
  let practice = FROM_QUERY[query.mode] || "";
  if (L !== "fr" && L !== "en") await loadAllTexts();
  main.innerHTML = html`
    ${embedded ? html`<p class="lede learn-lede">${t("cd.lede")}</p>` : html`<div class="page-head"><div><h1>${t("cd.title")}</h1><p class="lede">${t("cd.lede")}</p></div></div>`}
    <ul class="ms-stds"><li>${t("cd.std")}</li><li>${t("cd.std.maps")}</li></ul>
    ${pageTabs(tabs, tab)}
    <div class="filters cd-filters">
      <label class="field"><span>${t("cd.lang")}</span><select id="cd-lang">${Object.entries(langs).sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([k, v]) => html`<option value="${k}" ${raw(k === L ? "selected" : "")}>${v.name}</option>`)}</select></label>
      <label class="field" style="flex:1 1 220px"><span>${t("cd.search")}</span><input type="search" id="cd-q" placeholder="${t("cd.search.ph")}"></label>
      <label class="field"><span>${t("cd.practice")}</span><select id="cd-practice">${Object.entries(MODES)
        .map(([k, v]) => html`<option value="${k}" ${raw(k === practice ? "selected" : "")}>${t(`cd.practice.${v}`)}</option>`)}</select></label>
    </div>
    <p class="muted cd-hint" id="cd-hint"></p>
    <div id="cd-intro"></div>
    <div data-panel="foret" ${raw(tab === "foret" ? "" : "hidden")}><div id="cd-body"></div></div>
    <div data-panel="sprint" ${raw(tab === "sprint" ? "" : "hidden")}><p class="ms-sp-intro">${t("cd.sprint.intro")}</p><div id="cd-body-sp"></div></div>
    <p class="muted" style="font-size:12.5px;margin-top:18px">${t("cd.source")}</p>`;

  const sheet = (kind) => symbolsFor(kind);
  const uiLang = lang();
  // a symbol's name and description: the specification's (ISCD 2024), in the site's language; directional ones made from
  // their pattern. When the sheet's language is another, the name a sheet prints in it (Purple Pen's) under it.
  const nameOf = (r) => (r.dir && r.ref.startsWith("0.") ? t(`cd.cdir.${r.dir}`) : t(`cd.s.${r.ref}`, { d: r.dir ? t(`cd.gdir.${r.dir}`) : "" }));
  // a family drawn in eight directions (columns C and G) says its description once, on its first card
  let described = new Set();
  const card = (s, sprint) => {
    const r = iscdRef(s.id);
    const name = nameOf(r), desc = described.has(r.ref) ? "" : t(`cd.d.${r.ref}`);
    described.add(r.ref);
    const alt = L !== uiLang ? symbolName(s, L) : "";
    const d = s.k === "D";
    const map = d ? mapSwatches(r.ref, sprint) : "";
    const words = normalise(`${name} ${t(`cd.d.${r.ref}`)} ${alt} ${r.ref}${d ? ` ${mapCodes(r.ref, sprint).join(" ")}` : ""}`);
    return html`<button type="button" class="cd-card${s.k >= "T" ? " wide" : ""}${map ? " has-map" : ""}" data-words="${words}" ${raw(map ? "data-map" : "")} aria-label="${name}">
      <span class="cd-pics">${svg(s)}</span><span class="cd-id">${r.ref}</span>
      <span class="cd-name">${name}</span>${alt && normalise(alt) !== normalise(name) ? html`<span class="cd-alt" lang="${L}" title="${t("cd.alt", { l: langs[L]?.name || L })}">${alt}</span>` : ""}
      ${desc ? html`<span class="cd-text">${desc}</span>` : ""}${raw(map)}</button>`;
  };
  const section = (title, hint, list, id, sprint) => (list.length ? html`<section class="card cd-sec" ${raw(id ? `id="cd-${sprint ? "sp-" : ""}col-${id}"` : "")}><div class="card-head"><div><h2>${title}</h2>${hint ? html`<div class="hint">${hint}</div>` : ""}</div></div>
      <div class="cd-grid">${list.map((s) => card(s, sprint))}</div></section>` : "");
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
  function body(sprint) {
    described = new Set();
    // the specification's symbols only; on the sprint tab, column D's features with an ISSprOM symbol
    const keep = (list) => list.filter((s) => iscdRef(s.id) && (!sprint || s.k !== "D" || mapCodes(iscdRef(s.id).ref, true).length));
    return html`${COLUMNS.flatMap((c) => (c === "D"
      ? D_FAMILIES.map((f) => section(t("cd.col.D", { f: t(`cd.fam.${f}`) }), f === "1" ? t("cd.col.D.hint") : "", keep(sheet("D").filter((s) => s.id.split(".")[0] === f)), f === "1" ? "D" : "", sprint))
      : [section(t(`cd.col.${c}`), t(`cd.col.${c}.hint`), keep(sheet(c)), c, sprint)]))}
      ${section(t("cd.special"), t("cd.special.hint"), keep(SPECIAL.flatMap(sheet)).sort((a, b) => byRef(iscdRef(a.id).ref, iscdRef(b.id).ref)), "", sprint)}`;
  }
  // the tab shown drawn at once, the other when it is first opened (owner, 2026-11-10: the page was slow to come; each tab
  // holds some 5 000 elements of drawings)
  let drawn = {};
  function drawTab(k) {
    if (drawn[k]) return;
    drawn[k] = true;
    if (k === "sprint") $("#cd-body-sp").innerHTML = body(true);
    else $("#cd-body").innerHTML = body(false);
  }
  function draw() {
    $("#cd-intro").innerHTML = intro();
    drawn = {};
    $("#cd-body").innerHTML = "";
    $("#cd-body-sp").innerHTML = "";
    drawTab(tab);
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
  bindPageTabs(main, tabs, tab, (k) => { tab = k; if (!drawn[k]) { drawTab(k); filter(); } });
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
    if (go) { document.getElementById(`cd-${tab === "sprint" ? "sp-" : ""}col-${go.dataset.goto}`)?.scrollIntoView({ behavior: "smooth" }); return; }
    const b = e.target.closest(".cd-card");
    if (b && practice) b.classList.toggle("shown");
  });
  return { title: t("cd.title") };
}

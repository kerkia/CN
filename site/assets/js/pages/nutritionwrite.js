// « Rédaction » (Coach; owner, 2026-11-01): « Nutrition »'s authors' page, seen by its authors and the administrators alone
// (app.js NUTRITION_ROUTES; the server checks every change). Two tabs and the editor:
//  - « Articles »: every article one may change (an administrator: all), searched and filtered; ticked ones are published,
//    taken back as drafts, added to or taken out of a theme, deleted — and, by an administrator, given to another author;
//  - « Thèmes »: the themes created, renamed in each language (those left empty translated by the AI) and deleted;
//  - the editor (?id=<n>, ?nouveau=1): the article's text under one ribbon of the usual tools (undo, styles, bold…, colours,
//    lists, alignment, links, images, tables, the HTML itself), its settings beside it (language, themes, cover, summary,
//    publication date, « à la une », the author for an administrator), a preview as readers see it. What is typed is kept in
//    this browser until it is saved (localStorage ocn.nut.draft.<id|new>), offered back after a reload or a crash.

import { html, raw, $, $$, normalise, debounce } from "../util.js";
import { t, tn, lang, LANGS } from "../i18n.js";
import { replaceQuery } from "../app.js";
import { pageTabs, tabFrom, bindPageTabs } from "../ui.js";
import { sanitize, plainText } from "../nutrition/sanitize.js";
import { call, catName, readingTime, fmtDay, isLive, langName, uploadImage } from "../nutrition/common.js";

const DRAFT = (id) => `ocn.nut.draft.${id || "new"}`;
const readDraft = (id) => { try { return JSON.parse(localStorage.getItem(DRAFT(id)) || "null"); } catch (e) { return null; } };
const writeDraft = (id, d) => { try { if (d) localStorage.setItem(DRAFT(id), JSON.stringify(d)); else localStorage.removeItem(DRAFT(id)); } catch (e) {} };
const COLOURS = ["#0b0b0b", "#52514e", "#c62828", "#e8641c", "#a66d00", "#2e7d32", "#1c5cab", "#6a1b9a"];
const MARKS = ["#fff59d", "#c8e6c9", "#bbdefb", "#ffccbc", "#e1bee7"];

export async function render(main, r) {
  let cleanup = () => {};
  const go = async (q) => {
    cleanup();
    cleanup = (q.id || q.nouveau ? await editor(main, q) : await lists(main, q)) || (() => {});
  };
  await go(r.query);
  return { title: t("nav.nutritionWrite"), onQuery: go, cleanup: () => cleanup() };
}

/** The data of the page: the articles one may manage, the themes, the authors (administrators). */
async function load() {
  const res = await call("?manage=1");
  if (!res.ok) return null;
  return res.data;
}
const statusOf = (p) => (p.status !== "published" ? "draft" : isLive(p) ? "published" : "scheduled");
const statusTag = (p) => html`<span class="nut-st ${statusOf(p)}">${t(`nutw.st.${statusOf(p)}`)}</span>`;

// ==============================================================================================================
// the articles and the themes
// ==============================================================================================================
async function lists(main, query) {
  main.innerHTML = html`<div class="empty">${t("nut.loading")}</div>`;
  const d = await load();
  if (!d) { main.innerHTML = html`<div class="card"><div class="empty">${t("nut.err.load")}</div></div>`; return; }
  const admin = d.role === "admin";
  let { posts, categories } = d;
  const tabs = [["articles", t("nutw.tab.posts")], ["themes", t("nutw.tab.themes")]];
  const tab = tabFrom(tabs, query);
  const sel = new Set();
  const f = { q: "", status: "", theme: "", author: "" };

  main.innerHTML = html`<div class="nut-w">
    <div class="page-head"><div><h1>${t("nav.nutritionWrite")}</h1><p class="lede">${t("nutw.lede")}</p></div>
      <div class="row"><a class="btn" href="#/sante">${t("nutw.toBlog")}</a><a class="btn btn-primary" href="#/redaction?nouveau=1">${t("nut.write")}</a></div></div>
    ${pageTabs(tabs, tab)}
    <div data-panel="articles">
      <div class="card"><div class="card-body">
        <div class="row nut-filters">
          <input type="search" id="nw-q" placeholder="${t("nut.search")}" aria-label="${t("nut.search")}">
          <select id="nw-status" aria-label="${t("nutw.f.status")}"><option value="">${t("nutw.f.allStatus")}</option>
            ${["published", "scheduled", "draft"].map((s) => html`<option value="${s}">${t(`nutw.st.${s}`)}</option>`)}</select>
          <select id="nw-theme" aria-label="${t("nut.themes")}"></select>
          ${admin ? html`<select id="nw-author" aria-label="${t("nutw.col.author")}"><option value="">${t("nutw.f.allAuthors")}</option>
            ${[...new Set(posts.map((p) => p.author))].sort().map((a) => html`<option value="${a}">${a}</option>`)}</select>` : ""}
        </div>
        <div id="nw-bulk" class="nut-bulk" hidden></div>
        <div id="nw-table" class="table-wrap"></div>
      </div></div>
    </div>
    <div data-panel="themes"><div id="nw-themes"></div></div>
  </div>`;
  bindPageTabs(main, tabs, tab);

  const catOptions = (first) => html`${first ? html`<option value="">${first}</option>` : ""}${[...categories].sort((a, b) => catName(a).localeCompare(catName(b), lang()))
    .map((c) => html`<option value="${c.id}">${catName(c)}</option>`)}`;
  const visible = () => posts.filter((p) => (!f.q || normalise(`${p.title} ${p.summary} ${p.author}`).includes(normalise(f.q)))
    && (!f.status || statusOf(p) === f.status) && (!f.theme || (f.theme === "sans" ? !p.cats.length : p.cats.includes(Number(f.theme)))) && (!f.author || p.author === f.author));

  function drawTable() {
    // « Sans thème »: the articles to classify (?theme=sans on the readers' page too)
    $("#nw-theme").innerHTML = `${catOptions(t("nut.allThemes"))}${html`<option value="sans">${t("nut.noTheme")}</option>`}`;
    $("#nw-theme").value = f.theme;
    const rows = visible();
    for (const id of [...sel]) if (!rows.some((p) => p.id === id && p.canEdit)) sel.delete(id);
    const editable = rows.filter((p) => p.canEdit);
    $("#nw-table").innerHTML = rows.length ? html`<table class="data compact nut-wtable" data-freeze="1" data-freeze-phone="1"><thead><tr>
      <th class="c"><input type="checkbox" id="nw-all" aria-label="${t("nutw.selectAll")}" ${editable.length && editable.every((p) => sel.has(p.id)) ? "checked" : ""}></th>
      <th>${t("nutw.col.title")}</th><th>${t("nutw.col.status")}</th><th>${t("nutw.col.date")}</th><th>${t("nutw.col.author")}</th>
      <th>${t("nut.themes")}</th><th>${t("nutw.col.lang")}</th><th class="r">${t("nutw.col.words")}</th><th class="r" title="${t("nutw.col.likes.hint")}">${t("nutw.col.likes")}</th><th></th></tr></thead>
      <tbody>${rows.map((p) => html`<tr>
        <td class="c"><input type="checkbox" data-sel="${p.id}" ${p.canEdit ? "" : "disabled"} ${sel.has(p.id) ? "checked" : ""} aria-label="${p.title}"></td>
        <td>${p.canEdit ? html`<a href="#/redaction?id=${p.id}">${p.title}</a>` : p.title}${p.pinned ? html` <span class="nut-chip pin">${t("nut.pinned")}</span>` : ""}</td>
        <td>${statusTag(p)}</td>
        <td class="num">${fmtDay(p.published || p.updated)}</td>
        <td>${p.author}</td>
        <td>${p.cats.map((c) => categories.find((x) => x.id === c)).filter(Boolean).map((c) => html`<span class="nut-chip">${catName(c)}</span> `)}</td>
        <td>${p.lang.toUpperCase()}</td>
        <td class="r num">${p.words}</td>
        <td class="r num">${p.likes || ""}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">${isLive(p) ? html`<a class="btn btn-sm" href="#/sante?article=${p.id}">${t("nutw.view")}</a>` : ""}
          ${p.canEdit ? html`<a class="btn btn-sm" href="#/redaction?id=${p.id}">${t("nut.edit")}</a>` : ""}</div></td>
      </tr>`)}</tbody></table>` : html`<div class="empty">${posts.length ? t("nut.noneFilter") : t("nutw.none")}</div>`;
    $("#nw-all")?.addEventListener("change", (e) => { for (const p of editable) e.target.checked ? sel.add(p.id) : sel.delete(p.id); drawTable(); });
    $$("[data-sel]", $("#nw-table")).forEach((b) => b.addEventListener("change", () => { b.checked ? sel.add(Number(b.dataset.sel)) : sel.delete(Number(b.dataset.sel)); drawBulk(); }));
    drawBulk();
  }

  function drawBulk() {
    const bar = $("#nw-bulk");
    bar.hidden = !sel.size;
    if (!sel.size) return;
    bar.innerHTML = html`<b>${tn("nutw.selected", sel.size)}</b>
      <button type="button" class="btn btn-sm" data-op="publish">${t("nutw.bulk.publish")}</button>
      <button type="button" class="btn btn-sm" data-op="unpublish">${t("nutw.bulk.unpublish")}</button>
      ${categories.length ? html`<select data-cat="addCat" aria-label="${t("nutw.bulk.addCat")}">${catOptions(t("nutw.bulk.addCat"))}</select>
        <select data-cat="removeCat" aria-label="${t("nutw.bulk.removeCat")}">${catOptions(t("nutw.bulk.removeCat"))}</select>` : ""}
      ${admin ? html`<select data-author aria-label="${t("nutw.bulk.author")}"><option value="">${t("nutw.bulk.author")}</option>
        ${(d.authors || []).map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select>` : ""}
      <button type="button" class="btn btn-sm nut-danger" data-op="delete">${t("nutw.bulk.delete")}</button>
      <button type="button" class="btn btn-sm" data-op="none">${t("nutw.bulk.none")}</button>`;
    const run = async (body, msg) => {
      if (msg && !confirm(msg)) return;
      bar.querySelectorAll("button, select").forEach((x) => { x.disabled = true; });
      const res = await call("/bulk", { method: "POST", body: { ids: [...sel], ...body } });
      if (!res.ok) alert(t("nutw.err.save"));
      if (res.ok && body.op === "delete") for (const id of sel) writeDraft(id, null);
      const fresh = await load();
      if (fresh) ({ posts, categories } = fresh);
      if (res.ok && body.op === "delete") sel.clear();
      drawTable();
    };
    bar.querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.op === "none") { sel.clear(); drawTable(); return; }
      run({ op: b.dataset.op }, b.dataset.op === "delete" ? tn("nutw.bulk.delete.confirm", sel.size) : null);
    }));
    bar.querySelectorAll("[data-cat]").forEach((s) => s.addEventListener("change", () => { if (s.value) run({ op: s.dataset.cat, cat: Number(s.value) }); }));
    bar.querySelector("[data-author]")?.addEventListener("change", (e) => {
      const a = (d.authors || []).find((x) => x.id === Number(e.target.value));
      if (a) run({ op: "author", author: a.id }, tn("nutw.bulk.author.confirm", sel.size, { a: a.name }));
    });
  }

  $("#nw-q").addEventListener("input", debounce((e) => { f.q = e.target.value.trim(); drawTable(); }, 150));
  $("#nw-status").addEventListener("change", (e) => { f.status = e.target.value; drawTable(); });
  $("#nw-theme").addEventListener("change", (e) => { f.theme = e.target.value; drawTable(); });
  $("#nw-author")?.addEventListener("change", (e) => { f.author = e.target.value; drawTable(); });

  // ---- the themes --------------------------------------------------------------------------------------------
  function drawThemes() {
    const count = (id) => posts.filter((p) => p.cats.includes(id)).length;
    const cap = (l) => { const n = langName(l); return n.charAt(0).toUpperCase() + n.slice(1); };
    const field = (c, l) => html`<input type="text" data-l="${l}" maxlength="60" value="${c?.names?.[l] || ""}" placeholder="${cap(l)}" aria-label="${cap(l)}">`;
    $("#nw-themes").innerHTML = html`<div class="card"><div class="card-head"><h2>${t("nutw.th.new")}</h2><span class="hint">${t("nutw.th.hint")}</span></div>
      <div class="card-body"><form id="nw-th-new" class="nut-th-row">${[lang(), ...LANGS.filter((l) => l !== lang())].map((l) => field(null, l))}
        <button class="btn btn-primary" type="submit">${t("nutw.th.add")}</button></form></div></div>
      <div class="card"><div class="card-head"><h2>${t("nut.themes")}</h2></div><div class="card-body">
      ${categories.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr>${[lang(), ...LANGS.filter((l) => l !== lang())].map((l) => html`<th>${cap(l)}</th>`)}<th class="r">${t("nutw.th.posts")}</th><th></th></tr></thead>
        <tbody>${categories.map((c) => html`<tr data-cat="${c.id}">${[lang(), ...LANGS.filter((l) => l !== lang())].map((l) => html`<td>${field(c, l)}</td>`)}
          <td class="r num">${count(c.id)}</td>
          <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button type="button" class="btn btn-sm" data-save>${t("nutw.th.rename")}</button>
            <button type="button" class="btn btn-sm nut-danger" data-del>${t("nutw.bulk.delete")}</button></div></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">${t("nutw.th.none")}</div>`}</div></div>`;
    const namesOf = (box) => Object.fromEntries($$("[data-l]", box).map((i) => [i.dataset.l, i.value.trim()]).filter(([, v]) => v));
    $("#nw-th-new").addEventListener("submit", async (e) => {
      e.preventDefault();
      const names = namesOf(e.target);
      if (!Object.keys(names).length) return;
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = t("nutw.th.translating");          // the AI fills the other languages: a few seconds
      const res = await call("/categories", { method: "POST", body: { names } });
      if (res.ok) categories = [...categories, res.data.category];
      else alert(t("nutw.err.save"));
      drawThemes();
    });
    $$("tr[data-cat]", $("#nw-themes")).forEach((tr) => {
      const id = Number(tr.dataset.cat);
      tr.querySelector("[data-save]").addEventListener("click", async (e) => {
        const names = namesOf(tr);
        if (!Object.keys(names).length) return;
        e.target.disabled = true;
        e.target.textContent = t("nutw.th.translating");
        const res = await call(`/categories/${id}`, { method: "PUT", body: { names } });
        if (res.ok) categories = categories.map((c) => (c.id === id ? { ...c, ...res.data.category } : c));
        else alert(t("nutw.err.save"));
        drawThemes();
      });
      tr.querySelector("[data-del]").addEventListener("click", async () => {
        const c = categories.find((x) => x.id === id);
        if (!confirm(tn("nutw.th.delete.confirm", count(id), { name: catName(c) }))) return;
        const res = await call(`/categories/${id}`, { method: "DELETE" });
        if (res.ok) { categories = categories.filter((x) => x.id !== id); posts = posts.map((p) => ({ ...p, cats: p.cats.filter((x) => x !== id) })); }
        drawThemes();
        drawTable();
      });
    });
  }
  drawTable();
  drawThemes();
}

// ==============================================================================================================
// the editor
// ==============================================================================================================
// the ribbon: groups of buttons; [command, icon, label key, shortcut]; "|" a narrow gap
const ICON = {
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3", redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  bold: "M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z", italic: "M14 4h-4M14 20h-4M15 4 9 20", underline: "M7 4v7a5 5 0 0 0 10 0V4M5 21h14",
  strike: "M5 12h14M16 6.5A4 4 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 4 8 2.5 8 7 0 1.8-1.7 3.2-4 3.2a4.5 4.5 0 0 1-4.3-2.5",
  sup: "M4 7l7 10M11 7l-7 10M15 9l2.5-4 2.5 4M15.5 7.5h4", sub: "M4 5l7 10M11 5l-7 10M15 19l2.5-4 2.5 4M15.5 17.5h4",
  clear: "M6 4h12M12 4l-3 16M3 21 21 3", ul: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  ol: "M10 6h10M10 12h10M10 18h10M4 4.5 5 4v4M4 14.5c0-1 2-1 2 0 0 .7-2 2-2 2h2M4 18h2v2H4", outdent: "M21 6H9M21 12h-8M21 18H9M7 9l-3 3 3 3",
  indent: "M21 6H9M21 12h-8M21 18H9M4 9l3 3-3 3", left: "M4 6h16M4 10h10M4 14h16M4 18h10", center: "M4 6h16M7 10h10M4 14h16M7 18h10",
  right: "M4 6h16M10 10h10M4 14h16M10 18h10", justify: "M4 6h16M4 10h16M4 14h16M4 18h16",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  unlink: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66M3 3l18 18",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01", table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14",
  hr: "M3 12h18M7 7h10M7 17h10", quote: "M7 7c-2 1-3 3-3 6v4h5v-5H6c0-2 1-3 2-3.5zM17 7c-2 1-3 3-3 6v4h5v-5h-3c0-2 1-3 2-3.5z",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4", source: "M4 5h16v14H4zM9 10l-2 2 2 2M15 10l2 2-2 2", color: "M6 20 12 4l6 16M8.5 14h7",
  mark: "M9 11l6-6 4 4-6 6zM9 11l-4 4v3h3l4-4M3 21h18", rowAdd: "M4 5h16v6H4zM12 15v6M9 18h6", colAdd: "M5 4h6v16H5zM15 12h6M18 9v6",
  rowDel: "M4 5h16v6H4zM9 18h6", colDel: "M5 4h6v16H5zM15 12h6", imgFull: "M3 6h18v12H3z", imgHalf: "M3 6h9v12H3zM15 9h6M15 12h6M15 15h4",
  imgThird: "M3 8h6v8H3zM12 9h9M12 12h9M12 15h6", emoji: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
};
const svg = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
const BLOCKS = [["p", "nutw.blk.p"], ["h2", "nutw.blk.h2"], ["h3", "nutw.blk.h3"], ["h4", "nutw.blk.h4"], ["blockquote", "nutw.blk.quote"], ["pre", "nutw.blk.pre"]];
const GROUPS = [
  ["history", [["undo", "undo", "Ctrl+Z"], ["redo", "redo", "Ctrl+Y"]]],
  ["font", ["block", ["bold", "bold", "Ctrl+B"], ["italic", "italic", "Ctrl+I"], ["underline", "underline", "Ctrl+U"], ["strikeThrough", "strike"],
    ["superscript", "sup"], ["subscript", "sub"], ["foreColor", "color"], ["hiliteColor", "mark"], ["removeFormat", "clear"]]],
  ["para", [["insertUnorderedList", "ul"], ["insertOrderedList", "ol"], ["outdent", "outdent"], ["indent", "indent"],
    ["justifyLeft", "left"], ["justifyCenter", "center"], ["justifyRight", "right"], ["justifyFull", "justify"]]],
  ["insert", [["createLink", "link", "Ctrl+K"], ["unlink", "unlink"], ["insertImage", "image"], ["insertTable", "table"], ["insertHorizontalRule", "hr"], ["emoji", "emoji"]]],
  ["table", [["rowAdd", "rowAdd"], ["colAdd", "colAdd"], ["rowDel", "rowDel"], ["colDel", "colDel"]]],
  ["image", [["imgFull", "imgFull"], ["imgHalf", "imgHalf"], ["imgThird", "imgThird"]]],
  ["view", [["source", "source"]]],
];
const STATES = ["bold", "italic", "underline", "strikeThrough", "superscript", "subscript", "insertUnorderedList", "insertOrderedList",
  "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"];
const EMOJI = ["🥗", "🍎", "🍌", "🥑", "🥕", "🥦", "🍝", "🍚", "🥜", "🧀", "🥚", "🐟", "💧", "☕", "🍫", "🏃", "⏱️", "✅", "⚠️", "💡"];

async function editor(main, query) {
  main.innerHTML = html`<div class="empty">${t("nut.loading")}</div>`;
  const d = await load();
  if (!d) { main.innerHTML = html`<div class="card"><div class="empty">${t("nut.err.load")}</div></div>`; return; }
  const admin = d.role === "admin";
  const categories = d.categories;
  let post = null;
  if (query.id) {
    const res = await call(`/posts/${Number(query.id)}`);
    if (!res.ok || !res.data.canEdit) { main.innerHTML = html`<a class="nut-back" href="#/redaction">${t("nutw.back")}</a><div class="card"><div class="empty">${t("nut.err.missing")}</div></div>`; return; }
    post = res.data;
  }
  const blank = { title: "", summary: "", body: "<p><br></p>", lang: lang(), cats: [], cover: "", status: "draft", published: "", pinned: false, authorId: d.me };
  const a = { ...blank, ...(post || {}), published: post?.published ? post.published.slice(0, 10) : "" };
  let saved = "";
  let busy = false;

  main.innerHTML = html`<div class="nut-ed">
    <div class="nut-ed-top">
      <a class="nut-back" href="#/redaction">${t("nutw.back")}</a>
      <span id="ne-state" class="muted"></span>
      <span class="grow"></span>
      ${post ? statusTag(post) : ""}
      <div class="seg" role="group"><button type="button" data-mode="edit" aria-pressed="true">${t("nutw.mode.edit")}</button><button type="button" data-mode="preview" aria-pressed="false">${t("nutw.mode.preview")}</button></div>
      ${post ? html`<button type="button" class="btn nut-danger" id="ne-del">${t("nutw.bulk.delete")}</button>` : ""}
      <button type="button" class="btn" id="ne-save" title="Ctrl+S">${t("nutw.saveDraft")}</button>
      <button type="button" class="btn btn-primary" id="ne-pub"></button>
    </div>
    <div id="ne-restore"></div>
    <div class="nut-ed-grid">
      <div class="nut-ed-main">
        <input type="text" id="ne-title" class="nut-ed-title" maxlength="200" placeholder="${t("nutw.f.title")}" aria-label="${t("nutw.f.title")}">
        <div class="nut-ribbon" role="toolbar" aria-label="${t("nutw.ribbon")}">${GROUPS.map(([g, items]) => html`<div class="nut-rg" data-group="${g}">
          <div class="nut-rg-items">${items.map((it) => it === "block"
            ? html`<select data-block aria-label="${t("nutw.blk")}" title="${t("nutw.blk")}">${BLOCKS.map(([v, k]) => html`<option value="${v}">${t(k)}</option>`)}</select>`
            : html`<button type="button" data-cmd="${it[0]}" title="${t(`nutw.cmd.${it[0]}`)}${it[2] ? ` (${it[2]})` : ""}" aria-label="${t(`nutw.cmd.${it[0]}`)}">${raw(svg(it[1]))}${it[0] === "foreColor" || it[0] === "hiliteColor" ? raw(`<i class="nut-swatch" data-swatch="${it[0]}"></i>`) : ""}</button>`)}</div>
          <div class="nut-rg-label">${t(`nutw.grp.${g}`)}</div></div>`)}</div>
        <div id="ne-pop" class="nut-pop" hidden></div>
        <div id="ne-body" class="nut-body nut-ed-body" contenteditable="true" spellcheck="true" aria-label="${t("nutw.f.body")}"></div>
        <textarea id="ne-src" class="nut-ed-src" hidden spellcheck="false" aria-label="${t("nutw.cmd.source")}"></textarea>
        <div id="ne-preview" class="nut-ed-preview" hidden></div>
        <div class="nut-ed-foot muted" id="ne-count"></div>
      </div>
      <aside class="nut-ed-side card"><div class="card-body">
        <label class="nut-field">${t("nutw.f.lang")}<select id="ne-lang">${LANGS.map((l) => html`<option value="${l}">${langName(l)}</option>`)}</select></label>
        ${admin ? html`<label class="nut-field">${t("nutw.col.author")}<select id="ne-author">${(d.authors || []).map((u) => html`<option value="${u.id}">${u.name}</option>`)}
          ${post && !(d.authors || []).some((u) => u.id === post.authorId) ? html`<option value="${post.authorId ?? ""}">${post.author}</option>` : ""}</select></label>` : ""}
        <label class="nut-field">${t("nutw.f.date")}<input type="date" id="ne-date"><span class="hint">${t("nutw.f.date.hint")}</span></label>
        <label class="nut-check"><input type="checkbox" id="ne-pin"> ${t("nutw.f.pinned")}</label>
        <div class="nut-field">${t("nut.themes")}<div id="ne-cats" class="nut-catpick"></div>
          <form id="ne-newcat" class="row"><input type="text" maxlength="60" placeholder="${t("nutw.th.newShort")}" aria-label="${t("nutw.th.newShort")}"><button class="btn btn-sm" type="submit">${t("nutw.th.add")}</button></form></div>
        <div class="nut-field">${t("nutw.f.cover")}<div id="ne-cover" class="nut-coverpick"></div></div>
        <label class="nut-field">${t("nutw.f.summary")}<textarea id="ne-sum" rows="4" maxlength="600"></textarea><span class="hint">${t("nutw.f.summary.hint")}</span></label>
      </div></aside>
    </div>
    <input type="file" id="ne-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
  </div>`;

  const body = $("#ne-body"), src = $("#ne-src"), pop = $("#ne-pop");
  $("#ne-title").value = a.title;
  body.innerHTML = sanitize(a.body) || "<p><br></p>";
  $("#ne-lang").value = a.lang;
  if ($("#ne-author")) $("#ne-author").value = String(a.authorId ?? "");
  $("#ne-date").value = a.published;
  $("#ne-pin").checked = !!a.pinned;
  $("#ne-sum").value = a.summary;
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {}
  let sourceMode = false, lastImg = null, savedRange = null;
  const colour = { foreColor: COLOURS[2], hiliteColor: MARKS[0] };
  saved = JSON.stringify(current());          // as the page reads it back (the HTML cleaned once)

  // ---- the article as it stands ----
  function snapshotOf(x) {
    return { title: x.title, summary: x.summary, body: x.body, lang: x.lang, cats: [...x.cats].sort(), cover: x.cover, published: x.published || "",
      pinned: !!x.pinned, author: x.authorId ?? null };
  }
  function current() {
    if (sourceMode) body.innerHTML = sanitize(src.value);
    return snapshotOf({ title: $("#ne-title").value.trim(), summary: $("#ne-sum").value.trim(), body: sanitize(body.innerHTML), lang: $("#ne-lang").value,
      cats: a.cats, cover: a.cover, published: $("#ne-date").value, pinned: $("#ne-pin").checked, authorId: $("#ne-author") ? Number($("#ne-author").value) || null : a.authorId });
  }
  const dirty = () => JSON.stringify(current()) !== saved;
  function drawState() {
    const c = current();
    const words = (plainText(c.body).match(/[\p{L}\p{N}]+/gu) || []).length;
    $("#ne-count").textContent = `${tn("nutw.words", words)} · ${readingTime(words)}`;
    $("#ne-state").textContent = busy ? t("nutw.saving") : dirty() ? t("nutw.unsaved") : post ? t("nutw.savedAt", { d: fmtDay(post.updated) }) : "";
    const live = post?.status === "published";
    $("#ne-pub").textContent = live ? t("nutw.update") : c.published && c.published > new Date().toISOString().slice(0, 10) ? t("nutw.schedule") : t("nutw.publish");
    $("#ne-save").textContent = live ? t("nutw.unpublish") : t("nutw.saveDraft");
    // nothing to save (owner, 2026-11-01): « Mettre à jour » of a published article and « Enregistrer le brouillon » of a saved
    // draft greyed out until something changes; publishing a draft or taking an article back to draft stay offered
    const same = !!post && !dirty();
    $("#ne-pub").disabled = busy || (live && same);
    $("#ne-save").disabled = busy || (!live && same);
  }
  const keepLocalLater = debounce(() => {
    if (dirty()) writeDraft(post?.id, { at: Date.now(), base: post?.version || 0, a: current() });
    else writeDraft(post?.id, null);
    drawState();
  }, 600);
  // a change offers the buttons at once (the check that it really differs from what is saved follows)
  const keepLocal = () => { if (!busy) $("#ne-pub").disabled = $("#ne-save").disabled = false; keepLocalLater(); };

  // a copy kept in this browser and never saved: offered back
  const local = readDraft(post?.id);
  if (local && local.base === (post?.version || 0) && JSON.stringify(local.a) !== saved) {
    $("#ne-restore").innerHTML = html`<div class="nut-note">${t("nutw.restore", { d: new Date(local.at).toLocaleString() })}
      <button type="button" class="btn btn-sm" data-r="yes">${t("nutw.restore.yes")}</button><button type="button" class="btn btn-sm" data-r="no">${t("nutw.restore.no")}</button></div>`;
    $("#ne-restore").addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      if (b.dataset.r === "yes") {
        const x = local.a;
        $("#ne-title").value = x.title; $("#ne-sum").value = x.summary; body.innerHTML = sanitize(x.body); $("#ne-lang").value = x.lang;
        $("#ne-date").value = x.published; $("#ne-pin").checked = x.pinned; a.cats = x.cats; a.cover = x.cover;
        if ($("#ne-author") && x.author) $("#ne-author").value = String(x.author);
        drawCats(); drawCover(); drawState();
      } else writeDraft(post?.id, null);
      $("#ne-restore").innerHTML = "";
    });
  }

  // ---- themes and cover ----
  function drawCats() {
    $("#ne-cats").innerHTML = categories.length ? html`${[...categories].sort((x, y) => catName(x).localeCompare(catName(y), lang())).map((c) => html`<label class="nut-chip pick${a.cats.includes(c.id) ? " on" : ""}">
      <input type="checkbox" value="${c.id}" ${a.cats.includes(c.id) ? "checked" : ""}> ${catName(c)}</label>`)}` : html`<span class="muted">${t("nutw.th.none")}</span>`;
    $$("input", $("#ne-cats")).forEach((i) => i.addEventListener("change", () => {
      const id = Number(i.value);
      a.cats = i.checked ? [...a.cats, id] : a.cats.filter((x) => x !== id);
      i.parentElement.classList.toggle("on", i.checked);
      keepLocal();
    }));
  }
  $("#ne-newcat").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input"), name = inp.value.trim();
    if (!name) return;
    e.target.querySelector("button").disabled = true;
    e.target.querySelector("button").textContent = t("nutw.th.translating");
    const res = await call("/categories", { method: "POST", body: { names: { [$("#ne-lang").value]: name } } });
    e.target.querySelector("button").disabled = false;
    e.target.querySelector("button").textContent = t("nutw.th.add");
    if (!res.ok) { alert(t("nutw.err.save")); return; }
    categories.push(res.data.category);
    a.cats = [...a.cats, res.data.category.id];
    inp.value = "";
    drawCats(); keepLocal();
  });
  function drawCover() {
    $("#ne-cover").innerHTML = a.cover ? html`<img src="${a.cover}" alt=""><div class="row"><button type="button" class="btn btn-sm" data-cv="change">${t("nutw.cover.change")}</button>
      <button type="button" class="btn btn-sm" data-cv="drop">${t("nutw.cover.drop")}</button></div>`
      : html`<button type="button" class="btn btn-sm" data-cv="change">${t("nutw.cover.add")}</button>`;
  }
  $("#ne-cover").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cv]");
    if (!b) return;
    if (b.dataset.cv === "drop") { a.cover = ""; drawCover(); keepLocal(); return; }
    pickImage(async (url) => { a.cover = url; drawCover(); keepLocal(); });
  });

  // ---- images ----
  let onPicked = null;
  function pickImage(cb) { onPicked = cb; $("#ne-file").value = ""; $("#ne-file").click(); }
  async function sendImage(file) {
    $("#ne-state").textContent = t("nutw.uploading");
    try { return await uploadImage(file); } catch (e) { alert(t("nutw.err.image")); return null; } finally { drawState(); }
  }
  $("#ne-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !onPicked) return;
    const url = await sendImage(file);
    if (url) onPicked(url);
  });
  const insertImage = (url) => { restoreRange(); exec("insertHTML", `<img src="${url}" alt="">`); };

  // ---- the ribbon ----
  function rememberRange() {
    const s = getSelection();
    if (s.rangeCount && body.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    body.focus();
    if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  function exec(cmd, val = null) {
    if (sourceMode) return;
    restoreRange();
    document.execCommand("styleWithCSS", false, cmd === "foreColor" || cmd === "hiliteColor");
    document.execCommand(cmd, false, val);
    rememberRange();
    keepLocal();
    reflect();
  }
  const inTable = () => { const n = getSelection().anchorNode; return n && body.contains(n) ? (n.nodeType === 1 ? n : n.parentElement).closest("td, th") : null; };
  function reflect() {
    for (const c of STATES) {
      const b = main.querySelector(`[data-cmd="${c}"]`);
      let on = false;
      try { on = !sourceMode && document.queryCommandState(c); } catch (e) {}
      b?.setAttribute("aria-pressed", String(on));
    }
    let blk = "p";
    try { blk = String(document.queryCommandValue("formatBlock") || "p").toLowerCase().replace(/[<>]/g, ""); } catch (e) {}
    const sel = main.querySelector("[data-block]");
    if (sel) sel.value = BLOCKS.some(([v]) => v === blk) ? blk : "p";
    const cell = inTable();
    main.querySelector('[data-group="table"]').hidden = !cell;
    main.querySelector('[data-group="image"]').hidden = !(lastImg && body.contains(lastImg));
    $$("[data-swatch]", main).forEach((s) => { s.style.background = colour[s.dataset.swatch]; });
    $$(".nut-rg button, .nut-rg select", main).forEach((b) => { if (b.dataset.cmd !== "source") b.disabled = sourceMode; });
    main.querySelector('[data-cmd="source"]').setAttribute("aria-pressed", String(sourceMode));
  }

  function popover(anchor, content, bind) {
    pop.innerHTML = content;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), host = pop.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    pop.style.left = `${Math.max(0, r.left - host.left)}px`;
    pop.style.top = `${r.bottom - host.top + 4}px`;
    bind(pop);
    pop.querySelector("input, button")?.focus();
  }
  const closePop = () => { pop.hidden = true; pop.innerHTML = ""; };

  function tableOp(op) {
    const cell = inTable();
    if (!cell) return;
    const row = cell.parentElement, table = cell.closest("table"), idx = [...row.children].indexOf(cell);
    if (op === "rowAdd") { const n = row.cloneNode(true); n.querySelectorAll("td, th").forEach((c) => { c.innerHTML = "<br>"; }); row.after(n); }
    if (op === "rowDel") { if (table.rows.length > 1) row.remove(); else table.remove(); }
    if (op === "colAdd") for (const tr of table.rows) { const c = tr.children[idx]; const n = (c || tr.lastElementChild).cloneNode(false); n.innerHTML = "<br>"; (c || tr.lastElementChild).after(n); }
    if (op === "colDel") { if (row.children.length > 1) for (const tr of table.rows) tr.children[idx]?.remove(); else table.remove(); }
    keepLocal(); reflect();
  }

  main.querySelector(".nut-ribbon").addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });   // keep the text's selection
  main.querySelector(".nut-ribbon").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b || b.disabled) return;
    const c = b.dataset.cmd;
    closePop();
    if (c === "source") return toggleSource();
    if (c === "createLink") {
      const s = getSelection(), a0 = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest("a");
      return popover(b, html`<form class="row"><input type="url" placeholder="https://…" value="${a0?.getAttribute("href") || ""}" aria-label="${t("nutw.link.url")}" required>
        <button class="btn btn-sm btn-primary" type="submit">${t("nutw.ok")}</button></form>`.toString(), (p) => p.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const url = p.querySelector("input").value.trim();
        closePop();
        if (!/^(https?:|mailto:)/i.test(url)) return;
        restoreRange();
        if (getSelection().isCollapsed && !a0) exec("insertHTML", `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/[<>&]/g, "")}</a>`);
        else exec("createLink", url);
      }));
    }
    if (c === "foreColor" || c === "hiliteColor") {
      const list = c === "foreColor" ? COLOURS : [...MARKS, "transparent"];
      return popover(b, html`<div class="nut-colours">${list.map((x) => html`<button type="button" data-col="${x}" style="background:${x}" title="${x === "transparent" ? t("nutw.mark.none") : x}" aria-label="${x}"></button>`)}
        ${c === "foreColor" ? html`<input type="color" value="${colour.foreColor}" aria-label="${t("nutw.colour.other")}">` : ""}</div>`.toString(), (p) => {
        p.querySelectorAll("[data-col]").forEach((x) => x.addEventListener("click", () => { closePop(); if (x.dataset.col !== "transparent") colour[c] = x.dataset.col; exec(c, x.dataset.col); }));
        p.querySelector("input[type=color]")?.addEventListener("change", (ev) => { closePop(); colour[c] = ev.target.value; exec(c, ev.target.value); });
      });
    }
    if (c === "insertImage") return pickImage(insertImage);
    if (c === "insertTable") {
      return popover(b, html`<form class="row"><label>${t("nutw.table.rows")} <input type="number" min="1" max="30" value="3" name="r"></label>
        <label>${t("nutw.table.cols")} <input type="number" min="1" max="10" value="3" name="c"></label>
        <label class="nut-check"><input type="checkbox" name="h" checked> ${t("nutw.table.head")}</label><button class="btn btn-sm btn-primary" type="submit">${t("nutw.ok")}</button></form>`.toString(),
      (p) => p.querySelector("form").addEventListener("submit", (ev) => {
        ev.preventDefault();
        const f = ev.target, rows = Math.min(30, Math.max(1, Number(f.r.value) || 3)), cols = Math.min(10, Math.max(1, Number(f.c.value) || 3));
        closePop();
        const tr = (tag) => `<tr>${`<${tag}><br></${tag}>`.repeat(cols)}</tr>`;
        // (the header row's cells in the body: Chrome's insertHTML takes a <thead> out of its table)
        exec("insertHTML", `<table><tbody>${f.h.checked ? tr("th") : ""}${tr("td").repeat(f.h.checked ? rows - 1 || 1 : rows)}</tbody></table><p><br></p>`);
      }));
    }
    if (c === "emoji") {
      return popover(b, html`<div class="nut-emoji">${EMOJI.map((x) => html`<button type="button" data-em="${x}">${x}</button>`)}</div>`.toString(),
        (p) => p.querySelectorAll("[data-em]").forEach((x) => x.addEventListener("click", () => { closePop(); exec("insertText", x.dataset.em); })));
    }
    if (["rowAdd", "colAdd", "rowDel", "colDel"].includes(c)) return tableOp(c);
    if (c.startsWith("img") && lastImg) {
      const w = { imgFull: null, imgHalf: "50%", imgThird: "33%" }[c];
      if (w) lastImg.setAttribute("width", w); else lastImg.removeAttribute("width");
      keepLocal(); return;
    }
    exec(c);
  });
  main.querySelector("[data-block]").addEventListener("change", (e) => exec("formatBlock", `<${e.target.value}>`));
  document.addEventListener("selectionchange", onSel);
  function onSel() { if (body.contains(getSelection().anchorNode)) { rememberRange(); reflect(); } }
  const outside = (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".nut-ribbon")) closePop(); };
  document.addEventListener("mousedown", outside);

  function toggleSource() {
    sourceMode = !sourceMode;
    if (sourceMode) { src.value = prettify(sanitize(body.innerHTML)); src.style.height = `${Math.max(320, body.offsetHeight)}px`; }
    else body.innerHTML = sanitize(src.value) || "<p><br></p>";
    body.hidden = sourceMode; src.hidden = !sourceMode;
    reflect();
  }

  body.addEventListener("input", keepLocal);
  src.addEventListener("input", keepLocal);
  ["#ne-title", "#ne-sum", "#ne-date", "#ne-lang", "#ne-pin", "#ne-author"].forEach((s) => $(s)?.addEventListener(s === "#ne-title" || s === "#ne-sum" ? "input" : "change", keepLocal));
  body.addEventListener("click", (e) => { lastImg = e.target.tagName === "IMG" ? e.target : null; $$("img.sel", body).forEach((i) => i.classList.remove("sel")); lastImg?.classList.add("sel"); reflect(); });
  // what is pasted keeps only what an article may hold; images pasted or dropped are sent to the server
  body.addEventListener("paste", async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    e.preventDefault();
    if (files.length) { for (const f of files) { const url = await sendImage(f); if (url) exec("insertHTML", `<img src="${url}" alt="">`); } return; }
    const h = e.clipboardData.getData("text/html");
    if (h) exec("insertHTML", sanitize(h.replace(/<!--[\s\S]*?-->/g, "")));
    else exec("insertText", e.clipboardData.getData("text/plain"));
  });
  body.addEventListener("drop", async (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) { const s = getSelection(); s.removeAllRanges(); s.addRange(pos); rememberRange(); }
    for (const f of files) { const url = await sendImage(f); if (url) insertImage(url); }
  });
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && body.contains(document.activeElement)) { e.preventDefault(); main.querySelector('[data-cmd="createLink"]').click(); }
    if (e.key === "Escape") closePop();
  };
  document.addEventListener("keydown", onKey);
  const onLeave = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onLeave);

  // ---- preview ----
  main.querySelector(".nut-ed-top .seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    const preview = b.dataset.mode === "preview";
    $$("[data-mode]", main).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const c = current();
    $("#ne-preview").innerHTML = html`<article class="nut-article">${c.cover ? html`<img class="nut-article-cover" src="${c.cover}" alt="">` : ""}<div class="nut-article-in">
      <div class="nut-chips">${c.cats.map((id) => categories.find((x) => x.id === id)).filter(Boolean).map((x) => html`<span class="nut-chip">${catName(x)}</span>`)}</div>
      <h1>${c.title || t("nutw.f.title")}</h1>${c.summary ? html`<p class="nut-lead">${c.summary}</p>` : ""}<div class="nut-body">${raw(c.body)}</div></div></article>`;
    $("#ne-preview").hidden = !preview;
    main.querySelector(".nut-ed-main").classList.toggle("previewing", preview);
  });

  // ---- saving ----
  async function save(status, { force = false } = {}) {
    if (busy) return;
    const c = current();
    if (!c.title) { alert(t("nutw.err.title")); $("#ne-title").focus(); return; }
    const st = status || post?.status || "draft";
    busy = true; drawState();
    const payload = { ...c, status: st, author: c.author, ...(post && !force ? { version: post.version } : {}) };
    const res = await call(post ? `/posts/${post.id}` : "/posts", { method: post ? "PUT" : "POST", body: payload });
    busy = false;
    if (res.status === 409) {
      drawState();
      if (confirm(t("nutw.conflict"))) return save(status, { force: true });
      return;
    }
    if (!res.ok) { drawState(); alert(t("nutw.err.save")); return; }
    const was = post?.id;
    post = res.data.post;
    a.cats = post.cats; a.cover = post.cover;
    saved = JSON.stringify(current());
    writeDraft(was, null); writeDraft(post.id, null);
    if (!was) replaceQuery({ id: post.id });
    main.querySelector(".nut-ed-top .nut-st")?.remove();
    main.querySelector(".nut-ed-top .grow").insertAdjacentHTML("afterend", statusTag(post).toString());
    if (!$("#ne-del")) $("#ne-save").insertAdjacentHTML("beforebegin", html`<button type="button" class="btn nut-danger" id="ne-del">${t("nutw.bulk.delete")}</button>`.toString()), bindDel();
    drawState();
    $("#ne-state").textContent = t(st === "published" ? "nutw.done.published" : "nutw.done.saved");
  }
  $("#ne-pub").addEventListener("click", () => save("published"));
  $("#ne-save").addEventListener("click", () => save("draft"));
  function bindDel() {
    $("#ne-del")?.addEventListener("click", async () => {
      if (!confirm(t("nutw.delete.confirm", { title: post.title }))) return;
      const res = await call(`/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) { alert(t("nutw.err.save")); return; }
      writeDraft(post.id, null);
      saved = JSON.stringify(current());          // nothing left to lose
      location.hash = "#/redaction";
    });
  }
  bindDel();

  drawCats(); drawCover(); reflect(); drawState();
  if (!post) $("#ne-title").focus();
  return () => {
    document.removeEventListener("selectionchange", onSel);
    document.removeEventListener("mousedown", outside);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("beforeunload", onLeave);
  };
}

/** The HTML laid out one block a line, for the « Code HTML » view. */
const prettify = (h) => h.replace(/(<\/(p|h2|h3|h4|li|blockquote|pre|tr|table|ul|ol|figure|div)>)/g, "$1\n").replace(/(<(ul|ol|table|tbody|thead)>)/g, "$1\n").replace(/<br>(?!\n)/g, "<br>\n").trim();

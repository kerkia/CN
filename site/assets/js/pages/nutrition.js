// « Nutrition » (Coach; owner, 2026-11-01): a blog — articles by theme and by date, written by its authors (« Rédaction »,
// pages/nutritionwrite.js). Shown to the accounts given the right on the admin page, its authors and the administrators
// (app.js NUTRITION_ROUTES; the server checks the same). Left: a search, the themes, the months; right: the articles, those
// « à la une » first, or one article (?article=<id>). An article opens in the language it was written in; « Lire en … »
// asks the server for its translation into the reader's language, made once by the AI and kept (functions/api/nutrition).
// The address keeps the theme, the month, the search and the article (?theme=, ?mois=, ?q=, ?article=).

import { html, raw, $, $$, fmtDate, normalise, debounce } from "../util.js";
import { t, tn, lang } from "../i18n.js";
import { replaceQuery } from "../app.js";
import * as auth from "../auth.js";
import { sanitize } from "../nutrition/sanitize.js";
import { call, catName, readingTime, fmtDay, dayOf, langName } from "../nutrition/common.js";

const PREF = "ocn.nut.translate";        // "1": open the articles in the reader's language
const wantsTranslation = () => { try { return localStorage.getItem(PREF) === "1"; } catch (e) { return false; } };
const setWantsTranslation = (on) => { try { if (on) localStorage.setItem(PREF, "1"); else localStorage.removeItem(PREF); } catch (e) {} };

export async function render(main, { query }) {
  main.innerHTML = html`<div class="empty">${t("nut.loading")}</div>`;
  const res = await call("");
  if (!res.ok) {
    main.innerHTML = html`<div class="card"><div class="empty">${t(res.status === 403 ? "nut.err.forbidden" : "nut.err.load")}</div></div>`;
    return { title: t("nav.nutrition") };
  }
  const { posts, categories } = res.data;
  const cats = new Map(categories.map((c) => [c.id, c]));
  const st = { theme: Number(query.theme) || null, month: /^\d{4}-\d{2}$/.test(query.mois || "") ? query.mois : "", q: query.q || "", article: Number(query.article) || null };
  const cache = new Map();          // id -> the article with its body (and translations)

  main.innerHTML = html`<div class="nut">
    <div class="page-head"><div><h1>${t("nav.nutrition")}</h1><p class="lede">${t("nut.lede")}</p></div>
      ${auth.nutritionWrites() ? html`<a class="btn btn-primary" href="#/redaction?nouveau=1">${t("nut.write")}</a>` : ""}</div>
    <div class="nut-layout">
      <aside class="nut-side card">
        <input type="search" id="nut-q" class="nut-search" placeholder="${t("nut.search")}" aria-label="${t("nut.search")}" value="${st.q}">
        <h3>${t("nut.themes")}</h3><div id="nut-themes" class="nut-facets"></div>
        <h3>${t("nut.archive")}</h3><div id="nut-months" class="nut-facets"></div>
      </aside>
      <section id="nut-main" class="nut-main"></section>
    </div></div>`;

  const matches = (p, { theme = st.theme, month = st.month } = {}) => {
    if (theme && !p.cats.includes(theme)) return false;
    if (month && dayOf(p.published).slice(0, 7) !== month) return false;
    if (st.q) {
      const q = normalise(st.q);
      if (!normalise(`${p.title} ${p.summary} ${p.author} ${p.cats.map((c) => catName(cats.get(c))).join(" ")}`).includes(q)) return false;
    }
    return true;
  };
  const monthLabel = (ym) => { const s = fmtDate(`${ym}-01`, "month"); return s.charAt(0).toUpperCase() + s.slice(1); };

  function drawFacets() {
    const byTheme = (id) => posts.filter((p) => matches(p, { theme: id })).length;
    $("#nut-themes").innerHTML = html`<button type="button" data-theme="" aria-pressed="${!st.theme}">${t("nut.allThemes")}<span>${posts.filter((p) => matches(p, { theme: null })).length}</span></button>
      ${[...categories].sort((a, b) => catName(a).localeCompare(catName(b), lang())).map((c) => html`<button type="button" data-theme="${c.id}" aria-pressed="${st.theme === c.id}">${catName(c)}<span>${byTheme(c.id)}</span></button>`)}`;
    const months = new Map();
    for (const p of posts) if (matches(p, { month: "" })) { const m = dayOf(p.published).slice(0, 7); months.set(m, (months.get(m) || 0) + 1); }
    const years = new Map();
    for (const m of [...months.keys()].sort().reverse()) { const y = m.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(m); }
    $("#nut-months").innerHTML = html`<button type="button" data-month="" aria-pressed="${!st.month}">${t("nut.allDates")}</button>
      ${[...years].map(([y, ms]) => html`<div class="nut-year">${y}</div>${ms.map((m) => html`<button type="button" data-month="${m}" aria-pressed="${st.month === m}">${monthLabel(m)}<span>${months.get(m)}</span></button>`)}`)}`;
  }

  const chips = (p) => html`${p.cats.map((c) => cats.get(c)).filter(Boolean).map((c) => html`<a class="nut-chip" href="#/nutrition?theme=${c.id}" data-chip="${c.id}">${catName(c)}</a>`)}`;
  const meta = (p) => html`<span>${fmtDay(p.published)}</span><span>${t("nut.by", { a: p.author })}</span><span>${readingTime(p.words)}</span>${p.lang !== lang() ? html`<span class="nut-lang" title="${t("nut.written", { lang: langName(p.lang) })}">${p.lang.toUpperCase()}</span>` : ""}`;

  function card(p, big = false) {
    return html`<article class="nut-card${big ? " big" : ""}" data-open="${p.id}" tabindex="0">
      ${p.cover ? html`<img class="nut-cover" src="${p.cover}" alt="" loading="lazy">` : html`<div class="nut-cover nut-cover-none" aria-hidden="true">${raw(LEAF)}</div>`}
      <div class="nut-card-body">
        <div class="nut-chips">${p.pinned ? html`<span class="nut-chip pin">${t("nut.pinned")}</span>` : ""}${chips(p)}</div>
        <h2><a href="#/nutrition?article=${p.id}">${p.title}</a></h2>
        ${p.summary ? html`<p class="nut-summary">${p.summary}</p>` : ""}
        <div class="nut-meta">${meta(p)}</div>
      </div></article>`;
  }

  function drawList() {
    const list = posts.filter((p) => matches(p));
    const filtered = st.theme || st.month || st.q;
    const pinned = filtered ? [] : list.filter((p) => p.pinned);
    const rest = list.filter((p) => !pinned.includes(p));
    const head = filtered ? html`<div class="nut-filterline">${tn("nut.count", list.length)}${st.theme ? html` · ${catName(cats.get(st.theme))}` : ""}${st.month ? html` · ${monthLabel(st.month)}` : ""}${st.q ? html` · ${t("nut.query", { q: st.q })}` : ""}
      <button type="button" class="btn btn-sm" id="nut-clear">${t("nut.clear")}</button></div>` : "";
    $("#nut-main").innerHTML = !posts.length ? html`<div class="card"><div class="empty">${t("nut.none")}</div></div>`
      : !list.length ? html`${head}<div class="card"><div class="empty">${t("nut.noneFilter")}</div></div>`
      : html`${head}${pinned.length ? html`<div class="nut-pinned">${pinned.map((p) => card(p, true))}</div>` : ""}<div class="nut-grid">${rest.map((p) => card(p))}</div>`;
    $("#nut-clear")?.addEventListener("click", () => { st.theme = null; st.month = ""; st.q = ""; $("#nut-q").value = ""; sync(); });
  }

  // ---- one article -------------------------------------------------------------------------------------------
  async function drawArticle() {
    const id = st.article;
    const box = $("#nut-main");
    const brief = posts.find((p) => p.id === id);
    box.innerHTML = html`<div class="card nut-article"><div class="empty">${t("nut.loading")}</div></div>`;
    let p = cache.get(id);
    if (!p) {
      const r = await call(`/posts/${id}`);
      if (st.article !== id) return;
      if (!r.ok) { box.innerHTML = html`<a class="nut-back" href="#/nutrition">${t("nut.back")}</a><div class="card"><div class="empty">${t("nut.err.missing")}</div></div>`; return; }
      p = r.data; p.tr = {};
      cache.set(id, p);
    }
    const shown = posts.filter((x) => matches(x));
    const i = shown.findIndex((x) => x.id === id);
    const prev = i > 0 ? shown[i - 1] : null, next = i >= 0 && i < shown.length - 1 ? shown[i + 1] : null;
    const other = p.lang !== lang();
    const tr = p.tr[lang()];
    const showTr = other && tr && !tr.error && p.view === "tr";
    const title = showTr ? tr.title : p.title, summary = showTr ? tr.summary : p.summary, body = showTr ? tr.body : p.body;
    box.innerHTML = html`<a class="nut-back" href="#/nutrition${backQuery()}">${t("nut.back")}</a>
      <article class="card nut-article" lang="${showTr ? lang() : p.lang}">
        ${p.cover ? html`<img class="nut-article-cover" src="${p.cover}" alt="">` : ""}
        <div class="nut-article-in">
          <div class="nut-chips">${chips(p)}</div>
          <h1>${title}</h1>
          <div class="nut-meta">${meta(p)}${p.updated && dayOf(p.updated) > dayOf(p.published) ? html`<span>${t("nut.updated", { d: fmtDay(p.updated) })}</span>` : ""}
            ${p.canEdit ? html`<a href="#/redaction?id=${p.id}">${t("nut.edit")}</a>` : ""}</div>
          ${other ? html`<div class="nut-trbar" lang="${lang()}">
            ${showTr ? html`<span>${t("nut.tr.done", { from: t(`nut.from.${p.lang}`) })}</span><button type="button" class="btn btn-sm" data-view="orig">${t("nut.tr.orig")}</button>`
              : html`<span>${t("nut.written", { lang: langName(p.lang) })}</span><button type="button" class="btn btn-sm" data-view="tr">${t("nut.tr.offer", { lang: langName(lang()) })}</button>`}
            <label class="nut-always"><input type="checkbox" id="nut-always" ${wantsTranslation() ? "checked" : ""}> ${t("nut.tr.always")}</label>
            <span id="nut-trmsg" class="muted">${tr?.error ? t(`nut.tr.err.${tr.error}`) : ""}</span></div>` : ""}
          ${summary ? html`<p class="nut-lead">${summary}</p>` : ""}
          <div class="nut-body">${raw(sanitize(body))}</div>
        </div>
      </article>
      <nav class="nut-pager">${prev ? html`<a href="#/nutrition?article=${prev.id}${backQuery("&")}">${t("nut.prev")}<b>${prev.title}</b></a>` : html`<span></span>`}
        ${next ? html`<a class="next" href="#/nutrition?article=${next.id}${backQuery("&")}">${t("nut.next")}<b>${next.title}</b></a>` : ""}</nav>`;
    $$("[data-view]", box).forEach((b) => b.addEventListener("click", () => translate(p, b.dataset.view)));
    $("#nut-always", box)?.addEventListener("change", (e) => { setWantsTranslation(e.target.checked); if (e.target.checked && !showTr) translate(p, "tr"); });
    if (other && !p.view && wantsTranslation()) translate(p, "tr");
  }

  async function translate(p, view) {
    p.view = view;
    if (view === "tr" && (!p.tr[lang()] || p.tr[lang()].error)) {
      const btn = $("[data-view]");
      if (btn) btn.disabled = true;
      const msg = $("#nut-trmsg");
      if (msg) msg.textContent = t("nut.tr.wait");
      const r = await call(`/posts/${p.id}?lang=${lang()}`);
      p.tr[lang()] = r.ok ? r.data.translation || { error: "model" } : { error: "model" };
      if (p.tr[lang()].error) p.view = "orig";
    }
    if (st.article === p.id) drawArticle();
  }

  const backQuery = (sep = "?") => {
    const q = new URLSearchParams(Object.entries({ theme: st.theme || "", mois: st.month, q: st.q }).filter(([, v]) => v)).toString();
    return q ? sep + q : "";
  };

  function draw() {
    drawFacets();
    if (st.article) drawArticle(); else drawList();
  }
  function sync() {
    replaceQuery({ theme: st.theme || "", mois: st.month, q: st.q, article: st.article || "" });
    draw();
    if (st.article) window.scrollTo({ top: 0 });
  }

  main.querySelector(".nut-side").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("theme" in b.dataset) st.theme = Number(b.dataset.theme) || null;
    else if ("month" in b.dataset) st.month = b.dataset.month;
    else return;
    st.article = null;
    sync();
  });
  $("#nut-q").addEventListener("input", debounce((e) => { st.q = e.target.value.trim(); st.article = null; sync(); }, 200));
  $("#nut-main").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const c = e.target.closest("[data-open]");
    if (c) location.hash = `#/nutrition?article=${c.dataset.open}${backQuery("&")}`;
  });
  $("#nut-main").addEventListener("keydown", (e) => {
    const c = e.target.closest?.("[data-open]");
    if (c && e.key === "Enter") location.hash = `#/nutrition?article=${c.dataset.open}${backQuery("&")}`;
  });
  draw();

  // the address changed (a theme chip, an article, Back): drawn in place
  function onQuery(q) {
    const article = Number(q.article) || null;
    Object.assign(st, { theme: Number(q.theme) || null, month: /^\d{4}-\d{2}$/.test(q.mois || "") ? q.mois : "", q: q.q || "", article });
    $("#nut-q").value = st.q;
    draw();
    window.scrollTo({ top: 0 });
  }
  return { title: t("nav.nutrition"), onQuery };
}

// an article without a picture: a leaf, in the forest's green
const LEAF = `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 38C10 20 22 9 40 8c0 19-11 30-28 30z"/><path d="M10 38 28 20"/></svg>`;

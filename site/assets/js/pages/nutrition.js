// « Nutrition » (Coach; owner, 2026-11-01): a blog — articles by theme and by date, written by its authors (« Rédaction »,
// pages/nutritionwrite.js). Shown to the accounts given the right on the admin page, its authors and the administrators
// (app.js NUTRITION_ROUTES; the server checks the same). Left: a search, the themes, the months; right: the articles, those
// « à la une » first, or one article (?article=<id>). An article opens in the language it was written in; « Lire en … »
// asks the server for its translation into the reader's language, made once by the AI and kept (functions/api/nutrition).
// The address keeps the theme, the month, the search and the article (?theme=, ?mois=, ?q=, ?article=). Readers like an article
// (one like an account; no comments: owner, 2026-11-01), and under it three related ones are offered (`related`).

import { html, raw, $, $$, fmtDate, normalise, debounce } from "../util.js";
import { t, tn, lang } from "../i18n.js";
import { replaceQuery } from "../app.js";
import * as auth from "../auth.js";
import { sanitize } from "../nutrition/sanitize.js";
import { call, catName, readingTime, fmtDay, dayOf, langName } from "../nutrition/common.js";

// the articles without a theme: a filter of their own, shown only while some are (owner, 2026-11-01); ?theme=sans
const NONE = "sans";
const themeOf = (v) => (v === NONE ? NONE : Number(v) || null);
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
  const st = { theme: themeOf(query.theme), month: /^\d{4}-\d{2}$/.test(query.mois || "") ? query.mois : "", q: query.q || "", article: Number(query.article) || null };
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
    if (theme === NONE ? p.cats.length : theme && !p.cats.includes(theme)) return false;
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
      ${[...categories].sort((a, b) => catName(a).localeCompare(catName(b), lang())).map((c) => html`<button type="button" data-theme="${c.id}" aria-pressed="${st.theme === c.id}">${catName(c)}<span>${byTheme(c.id)}</span></button>`)}
      ${byTheme(NONE) || st.theme === NONE ? html`<button type="button" data-theme="${NONE}" aria-pressed="${st.theme === NONE}" class="nut-none">${t("nut.noTheme")}<span>${byTheme(NONE)}</span></button>` : ""}`;
    const months = new Map();
    for (const p of posts) if (matches(p, { month: "" })) { const m = dayOf(p.published).slice(0, 7); months.set(m, (months.get(m) || 0) + 1); }
    const years = new Map();
    for (const m of [...months.keys()].sort().reverse()) { const y = m.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(m); }
    $("#nut-months").innerHTML = html`<button type="button" data-month="" aria-pressed="${!st.month}">${t("nut.allDates")}</button>
      ${[...years].map(([y, ms]) => html`<div class="nut-year">${y}</div>${ms.map((m) => html`<button type="button" data-month="${m}" aria-pressed="${st.month === m}">${monthLabel(m)}<span>${months.get(m)}</span></button>`)}`)}`;
  }

  const chips = (p) => html`${p.cats.map((c) => cats.get(c)).filter(Boolean).map((c) => html`<a class="nut-chip" href="#/sante?theme=${c.id}" data-chip="${c.id}">${catName(c)}</a>`)}`;
  const meta = (p) => html`<span>${fmtDay(p.published)}</span><span>${t("nut.by", { a: p.author })}</span><span>${readingTime(p.words)}</span>${p.lang !== lang() ? html`<span class="nut-lang" title="${t("nut.written", { lang: langName(p.lang) })}">${p.lang.toUpperCase()}</span>` : ""}${p.likes ? html`<span class="nut-likes" title="${tn("nut.likes", p.likes)}">${raw(HEART)} ${p.likes}</span>` : ""}`;

  function card(p, big = false) {
    return html`<article class="nut-card${big ? " big" : ""}" data-open="${p.id}" tabindex="0">
      ${p.cover ? html`<img class="nut-cover" src="${p.cover}" alt="" loading="lazy">` : html`<div class="nut-cover nut-cover-none" aria-hidden="true">${raw(LEAF)}</div>`}
      <div class="nut-card-body">
        <div class="nut-chips">${p.pinned ? html`<span class="nut-chip pin">${t("nut.pinned")}</span>` : ""}${chips(p)}</div>
        <h2><a href="#/sante?article=${p.id}">${p.title}</a></h2>
        ${p.summary ? html`<p class="nut-summary">${p.summary}</p>` : ""}
        <div class="nut-meta">${meta(p)}</div>
      </div></article>`;
  }

  function drawList() {
    const list = posts.filter((p) => matches(p));
    const filtered = st.theme || st.month || st.q;
    const pinned = filtered ? [] : list.filter((p) => p.pinned);
    const rest = list.filter((p) => !pinned.includes(p));
    const head = filtered ? html`<div class="nut-filterline">${tn("nut.count", list.length)}${st.theme ? html` · ${st.theme === NONE ? t("nut.noTheme") : catName(cats.get(st.theme))}` : ""}${st.month ? html` · ${monthLabel(st.month)}` : ""}${st.q ? html` · ${t("nut.query", { q: st.q })}` : ""}
      <button type="button" class="btn btn-sm" id="nut-clear">${t("nut.clear")}</button></div>` : "";
    $("#nut-main").innerHTML = !posts.length ? html`<div class="card"><div class="empty">${t("nut.none")}</div></div>`
      : !list.length ? html`${head}<div class="card"><div class="empty">${t("nut.noneFilter")}</div></div>`
      : html`${head}${pinned.length ? html`<div class="nut-pinned">${pinned.map((p) => card(p, true))}</div>` : ""}<div class="nut-grid">${rest.map((p) => card(p))}</div>`;
    $("#nut-clear")?.addEventListener("click", () => { st.theme = null; st.month = ""; st.q = ""; $("#nut-q").value = ""; sync(); });
  }

  // ---- related articles (owner, 2026-11-01): the themes shared count most, then the words their titles and summaries share,
  // then the nearer date; the latest ones fill in when nothing is shared ----
  // short words of the four languages that say nothing about a subject (i18n-ignore-next 2)
  const STOP = new Set(["avec", "dans", "pour", "plus", "sans", "sont", "être", "avoir", "mais", "comme", "cette", "votre", "leurs", "after",
    "with", "your", "that", "this", "from", "have", "what", "when", "nach", "eine", "einen", "oder", "nicht", "para", "como", "pero", "antes"]);
  const wordsOf = (p) => new Set(normalise(`${p.title} ${p.summary}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
  function related(p, n = 3) {
    const mine = wordsOf(p), t0 = Date.parse(p.published || 0);
    return posts.filter((x) => x.id !== p.id).map((x) => {
      const shared = x.cats.filter((c) => p.cats.includes(c)).length;
      const w = wordsOf(x), common = [...w].filter((k) => mine.has(k)).length;
      const days = Math.abs(Date.parse(x.published || 0) - t0) / 86400e3;
      return { x, score: 3 * shared + (common ? (2 * common) / Math.sqrt((mine.size || 1) * (w.size || 1)) : 0) + 0.5 / (1 + days / 30) };
    }).sort((a, b) => b.score - a.score).slice(0, n).map((r) => r.x);
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
      if (!r.ok) { box.innerHTML = html`<a class="nut-back" href="#/sante">${t("nut.back")}</a><div class="card"><div class="empty">${t("nut.err.missing")}</div></div>`; return; }
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
    box.innerHTML = html`<a class="nut-back" href="#/sante${backQuery()}">${t("nut.back")}</a>
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
          <div class="nut-likebar"><button type="button" class="nut-like" id="nut-like" aria-pressed="${p.liked}" title="${t(p.liked ? "nut.unlike" : "nut.like")}">${raw(HEART)}
            <span>${t("nut.like")}</span></button><span class="muted" id="nut-likes">${p.likes ? tn("nut.likes", p.likes) : ""}</span></div>
        </div>
      </article>
      ${related(p).length ? html`<section class="nut-related"><h2>${t("nut.related")}</h2><div class="nut-grid">${related(p).map((x) => card(x))}</div></section>` : ""}
      <nav class="nut-pager">${prev ? html`<a href="#/sante?article=${prev.id}${backQuery("&")}">${t("nut.prev")}<b>${prev.title}</b></a>` : html`<span></span>`}
        ${next ? html`<a class="next" href="#/sante?article=${next.id}${backQuery("&")}">${t("nut.next")}<b>${next.title}</b></a>` : ""}</nav>`;
    $$("[data-view]", box).forEach((b) => b.addEventListener("click", () => translate(p, b.dataset.view)));
    $("#nut-like", box).addEventListener("click", async (e) => {
      const btn = e.currentTarget, on = !p.liked;
      btn.disabled = true;
      const r = await call(`/posts/${p.id}/like`, { method: "POST", body: { on } });
      btn.disabled = false;
      if (!r.ok) return;
      p.liked = r.data.liked; p.likes = r.data.likes;
      if (brief) Object.assign(brief, { liked: p.liked, likes: p.likes });
      btn.setAttribute("aria-pressed", String(p.liked));
      btn.title = t(p.liked ? "nut.unlike" : "nut.like");
      $("#nut-likes", box).textContent = p.likes ? tn("nut.likes", p.likes) : "";
    });
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
    if ("theme" in b.dataset) st.theme = themeOf(b.dataset.theme);
    else if ("month" in b.dataset) st.month = b.dataset.month;
    else return;
    st.article = null;
    sync();
  });
  $("#nut-q").addEventListener("input", debounce((e) => { st.q = e.target.value.trim(); st.article = null; sync(); }, 200));
  $("#nut-main").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const c = e.target.closest("[data-open]");
    if (c) location.hash = `#/sante?article=${c.dataset.open}${backQuery("&")}`;
  });
  $("#nut-main").addEventListener("keydown", (e) => {
    const c = e.target.closest?.("[data-open]");
    if (c && e.key === "Enter") location.hash = `#/sante?article=${c.dataset.open}${backQuery("&")}`;
  });
  draw();

  // the address changed (a theme chip, an article, Back): drawn in place
  function onQuery(q) {
    const article = Number(q.article) || null;
    Object.assign(st, { theme: themeOf(q.theme), month: /^\d{4}-\d{2}$/.test(q.mois || "") ? q.mois : "", q: q.q || "", article });
    $("#nut-q").value = st.q;
    draw();
    window.scrollTo({ top: 0 });
  }
  return { title: t("nav.nutrition"), onQuery };
}

const HEART = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 2.7 4.5 6.6 4.5c2.2 0 3.7 1.3 5.4 3.3 1.7-2 3.2-3.3 5.4-3.3 3.9 0 5.7 4.1 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>`;
// an article without a picture: a leaf, in the forest's green
const LEAF = `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 38C10 20 22 9 40 8c0 19-11 30-28 30z"/><path d="M10 38 28 20"/></svg>`;

// « Mes cartes » (Coach; owner, 2026-11-01): each account's archive of its maps and the routes it ran on them, as DOMA keeps
// them — a gallery, each map with its runs drawn on it. A run comes from « Analyse solo » (« Enregistrer dans Mes cartes »,
// trace/mymapsave.js), from QuickRoute's JPEG files or Ozimut's own (a JPEG carrying the map and its runs: trace/mymaps.js),
// one by one or in a zip. Private: a link to the whole archive or to one map shares it with whoever holds it
// (#/mes-cartes?partage=<token>[&carte=<id>]; a visitor without an account too). Every map goes out as Ozimut's file, one
// or all in a zip, and comes back the same. DOMA: no import yet — its button asks the Ozimut team to turn it on for the
// account, a message ready to send. No quota for now (owner).

import { html, raw, $, $$, fmt, fmtDate, fmtTime, fileAccept } from "../util.js";
import { t, tn, loadArea, lang } from "../i18n.js";
import * as auth from "../auth.js";
import { replaceQuery } from "../app.js";
import * as MM from "../trace/mymaps.js";

await loadArea("mymaps");

const SKEY = "ocn.mm.prefs";
// a map alone: an image, a PDF (its first page), a KMZ (its image, georeferenced); with its runs: QuickRoute's and Ozimut's JPEGs, a zip of them
const ACCEPT_MAP = ".jpg,.jpeg,.png,.webp,.pdf,.kmz,image/jpeg,image/png,image/webp,application/pdf";
const ACCEPT_ALL = `${ACCEPT_MAP},.zip,application/zip`;
const prefs = (() => { try { return JSON.parse(localStorage.getItem(SKEY) || "{}") || {}; } catch (e) { return {}; } })();
const keepPrefs = () => { try { localStorage.setItem(SKEY, JSON.stringify(prefs)); } catch (e) { /* this visit */ } };
const km = (m) => (m == null ? "—" : t("mm.km", { n: fmt(m / 1000, 1) }));
const pace = (dur, dist) => (dur && dist ? `${fmtTime(Math.round((dur / dist) * 1000))} ${t("mm.perKm")}` : "—");
const size = (b) => (b < 1024 * 1024 ? t("mm.kb", { n: fmt(Math.max(1, b / 1024)) }) : t("mm.mb", { n: fmt(b / 1024 / 1024, 1) }));
const yearOf = (m) => (m.day || m.created || "").slice(0, 4);
const shareUrl = (token, map) => `${location.origin}${location.pathname}#/mes-cartes?partage=${token}${map ? `&carte=${map}` : ""}`;

export async function render(main, { query = {} } = {}) {
  const me = auth.session();
  const token = /^[a-z2-9]{8,40}$/.test(query.partage || "") ? query.partage : null;
  let st = { maps: [], links: { archive: null, maps: {} }, name: "", archive: false };
  let q = query.q || "", year = query.annee || "";
  main.innerHTML = html`<div class="mm" id="mm"><div class="empty">${t("mm.loading")}</div></div>`;
  if (!token && !me) {
    $("#mm").innerHTML = html`<div class="card"><div class="card-body"><p>${t("mm.needAccount")}</p></div></div>`;
    return { title: t("mm.title") };
  }
  try {
    st = token ? { ...(await MM.shared(token)), links: { archive: null, maps: {} } } : await MM.list();
  } catch (e) {
    $("#mm").innerHTML = html`<div class="card"><div class="card-body"><p>${t(token ? "mm.shared.gone" : e.status === 503 ? "mm.err.notReady" : "mm.err.load")}</p></div></div>`;
    return { title: t("mm.title") };
  }
  const mine = !token;
  const byId = (id) => st.maps.find((m) => m.id === id);
  let viewer = null;

  function draw() {
    viewer?.close(); viewer = null;
    const id = query.carte || (token && !st.archive ? st.maps[0]?.id : null);
    if (id && byId(id)) return openMap(byId(id));
    drawList();
  }

  // ---- the gallery ---------------------------------------------------------------------------------------------------
  function drawList() {
    const years = [...new Set(st.maps.map(yearOf).filter(Boolean))].sort().reverse();
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = st.maps.filter((m) => (!year || yearOf(m) === year)
      && words.every((w) => [m.title, m.place, m.notes, ...m.runs.map((r) => r.title)].join(" ").toLowerCase().includes(w)));
    const nRuns = st.maps.reduce((n, m) => n + m.runs.length, 0), bytes = st.maps.reduce((n, m) => n + m.bytes + m.runs.reduce((k, r) => k + (r.bytes || 0), 0), 0);
    $("#mm").innerHTML = html`
      <div class="page-head"><div><h1>${token ? t("mm.shared.title", { name: st.name }) : t("mm.title")}</h1>
        <p class="lede">${token ? t(st.traces ? "mm.shared.lede" : "mm.shared.ledeMap") : t("mm.lede")}</p></div>
        ${mine ? html`<div class="mm-acts">
          <label class="btn btn-primary btn-sm" for="mm-files">${t("mm.import")}</label><input type="file" id="mm-files" multiple hidden accept="${fileAccept(ACCEPT_ALL)}">
          <label class="btn btn-sm" for="mm-blank" title="${t("mm.addMap.hint")}">${t("mm.addMap")}</label><input type="file" id="mm-blank" multiple hidden accept="${fileAccept(ACCEPT_MAP)}">
          <button type="button" class="btn btn-sm" id="mm-doma">${t("mm.doma")}</button>
          <button type="button" class="btn btn-sm" id="mm-export" ${raw(st.maps.length ? "" : "disabled")}>${t("mm.exportAll")}</button>
          <button type="button" class="btn btn-sm" id="mm-share">${st.links.archive ? `🔗 ${t("mm.shared.on")}` : t("mm.share")}</button></div>` : ""}</div>
      ${mine && st.maps.length ? html`<p class="muted mm-hint">${raw(t("mm.hint", { solo: `<a href="#/analyse-solo">${t("mm.solo")}</a>` }))}</p>` : ""}
      ${st.maps.length ? html`<div class="filters mm-filters">
          <input type="search" id="mm-q" placeholder="${t("mm.search")}" value="${q}" aria-label="${t("mm.search")}">
          <select id="mm-year" aria-label="${t("mm.year")}"><option value="">${t("mm.allYears")}</option>${years.map((y) => html`<option ${raw(y === year ? "selected" : "")}>${y}</option>`)}</select>
          <span class="muted">${tn("mm.count.maps", st.maps.length)}${token && !st.traces ? "" : ` · ${tn("mm.count.runs", nRuns)}`}${mine ? ` · ${size(bytes)}` : ""}</span></div>
        <div class="mm-grid">${shown.map(card)}</div>
        ${shown.length ? "" : html`<div class="empty">${t("mm.none.filter")}</div>`}`
      : html`<div class="card"><div class="card-body prose mm-empty">${mine ? raw(t("mm.none", { solo: `<a href="#/analyse-solo">${t("mm.solo")}</a>` })) : t("mm.shared.none")}</div></div>`}
      <div class="mm-busy" id="mm-busy" hidden></div>`;
    $("#mm-q")?.addEventListener("input", (e) => { q = e.target.value; replaceQuery({ partage: token, q: q || null, annee: year || null }); redrawGrid(); });
    $("#mm-year")?.addEventListener("change", (e) => { year = e.target.value; replaceQuery({ partage: token, q: q || null, annee: year || null }); drawList(); });
    $$(".mm-card").forEach((c) => c.addEventListener("click", (e) => { e.preventDefault(); go(c.dataset.id); }));
    if (!mine) return;
    for (const id of ["#mm-files", "#mm-blank"]) $(id).addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) importFiles(f); });
    $("#mm-doma").addEventListener("click", domaDialog);
    $("#mm-export").addEventListener("click", () => exportDialog(st.maps));
    $("#mm-share").addEventListener("click", () => shareDialog(null));
    dropZone($("#mm"));
  }
  function redrawGrid() {
    const pos = $("#mm-q")?.selectionStart;
    drawList();
    const i = $("#mm-q");
    if (i) { i.focus(); i.setSelectionRange(pos, pos); }
  }
  const thumb = (m) => (m.thumb ? MM.mapUrl(m.id, "thumb", token) : MM.mapUrl(m.id, "map", token));
  const card = (m) => {
    const dur = m.runs.reduce((s, r) => s + (r.dur || 0), 0), dist = m.runs.reduce((s, r) => s + (r.dist || 0), 0);
    return html`<a class="mm-card" href="#/mes-cartes?${raw(token ? `partage=${token}&` : "")}carte=${m.id}" data-id="${m.id}">
      <span class="mm-thumb"><img src="${thumb(m)}" alt="" loading="lazy">${mine && st.links.maps[m.id] ? html`<span class="mm-tag" title="${t("mm.shared.on")}">🔗</span>` : ""}</span>
      <b>${m.title || t("mm.untitled")}</b>
      <span class="muted">${[m.day ? fmtDate(m.day) : "", m.place].filter(Boolean).join(" · ")}</span>
      <span class="muted">${token && !st.traces ? "" : m.runs.length ? html`${tn("mm.count.runs", m.runs.length)}${dist ? ` · ${km(dist)}` : ""}${dur ? ` · ${fmtTime(Math.round(dur))}` : ""}` : t("mm.mapOnly")}</span></a>`;
  };
  function go(id) {
    query = { ...query, carte: id };
    replaceQuery({ partage: token, carte: id, q: null, annee: null });
    draw();
    window.scrollTo(0, 0);
  }
  function back() {
    query = { ...query, carte: null };
    replaceQuery({ partage: token, carte: null, q: q || null, annee: year || null });
    draw();
  }

  // ---- one map: drawn with its runs -------------------------------------------------------------------------------------
  function openMap(m) {
    const hidden = new Set();
    let colourBy = prefs.colour === "pace" ? "pace" : "run";
    $("#mm").innerHTML = html`
      ${!token || st.archive ? html`<p class="mm-back"><a href="#/mes-cartes${raw(token ? `?partage=${token}` : "")}" id="mm-back">‹ ${token ? t("mm.shared.back", { name: st.name }) : t("mm.title")}</a></p>` : ""}
      <div class="page-head"><div><h1>${m.title || t("mm.untitled")}</h1>
        <p class="lede meta">${[m.day ? fmtDate(m.day) : "", m.place, `${fmt(m.w)} × ${fmt(m.h)} px`, token ? t("mm.shared.by", { name: st.name }) : ""].filter(Boolean).join(" · ")}</p></div>
        <div class="mm-acts">${mine ? html`<button type="button" class="btn btn-sm" id="mm-edit">${t("mm.edit")}</button>
          <button type="button" class="btn btn-sm" id="mm-mshare">${st.links.maps[m.id] ? `🔗 ${t("mm.shared.on")}` : t("mm.shareMap")}</button>` : ""}
          <button type="button" class="btn btn-sm" id="mm-mexport">${t("mm.exportMap")}</button>
          ${mine ? html`<button type="button" class="btn btn-sm mm-danger" id="mm-del">${t("mm.delete")}</button>` : ""}</div></div>
      ${m.notes ? html`<p class="mm-notes">${m.notes}</p>` : ""}
      <div class="mm-view">
        <div class="mm-map"><canvas id="mm-canvas"></canvas>
          <div class="an-tools mm-tools"><button type="button" class="btn btn-sm" id="mm-zin" title="+">+</button><button type="button" class="btn btn-sm" id="mm-zout" title="−">−</button>
            <button type="button" class="btn btn-sm" id="mm-fit" title="${t("mm.fit")}">⤢</button></div>
          <div class="mm-legend" id="mm-legend" hidden></div></div>
        <aside class="mm-side card"><div class="card-body">
          <div class="mm-side-h"><b>${t("mm.runs")}</b>
            <select id="mm-colour" aria-label="${t("mm.colour")}"><option value="run">${t("mm.colour.run")}</option><option value="pace" ${raw(colourBy === "pace" ? "selected" : "")}>${t("mm.colour.pace")}</option></select></div>
          <ul class="mm-runs" id="mm-runs"></ul>
          ${m.runs.length ? "" : html`<p class="muted">${t(token ? (st.traces ? "mm.noRuns.shared" : "mm.shared.noTraces") : "mm.noRuns")}</p>`}
        </div></aside>
      </div>`;
    $("#mm-back")?.addEventListener("click", (e) => { e.preventDefault(); back(); });
    const cv = $("#mm-canvas"), g = cv.getContext("2d");
    let image = null, view = null, runs = new Map();          // run id -> decoded
    const colours = new Map(m.runs.map((r, i) => [r.id, MM.COLOURS[i % MM.COLOURS.length]]));
    const drawSide = () => {
      $("#mm-runs").innerHTML = html`${m.runs.map((r) => html`<li class="mm-run ${raw(hidden.has(r.id) ? "off" : "")}" data-id="${r.id}">
        <label><input type="checkbox" ${raw(hidden.has(r.id) ? "" : "checked")} data-show="${r.id}"><span class="mm-sw" style="background:${colours.get(r.id)}"></span>
          <b>${r.title || t("mm.untitledRun")}</b></label>
        <span class="muted">${[r.day ? fmtDate(r.day) : "", r.dur ? fmtTime(Math.round(r.dur)) : "", km(r.dist), pace(r.dur, r.dist)].filter((x) => x && x !== "—").join(" · ")}</span>
        <span class="muted mm-src">${t(`mm.src.${r.source}`) !== `mm.src.${r.source}` ? t(`mm.src.${r.source}`) : ""}${r.personal ? ` · ${t("mm.personal.kept")}` : ""}</span>
        ${mine ? html`<span class="mm-run-acts"><button type="button" class="btn btn-ghost btn-sm" data-ren="${r.id}">${t("mm.rename")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rm="${r.id}">${t("mm.remove")}</button></span>` : ""}</li>`)}`;
      $$("[data-show]").forEach((b) => b.addEventListener("change", () => { if (b.checked) hidden.delete(b.dataset.show); else hidden.add(b.dataset.show); drawSide(); paint(); }));
      $$("[data-ren]").forEach((b) => b.addEventListener("click", async () => {
        const r = m.runs.find((x) => x.id === b.dataset.ren), v = prompt(t("mm.rename.ask"), r.title || "");
        if (v == null) return;
        try { Object.assign(r, (await MM.updateRun(r.id, { title: v.trim() })).run); drawSide(); } catch (e) { alert(t("mm.err.save")); }
      }));
      $$("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm(t("mm.remove.ask"))) return;
        try { await MM.deleteRun(b.dataset.rm); m.runs = m.runs.filter((x) => x.id !== b.dataset.rm); runs.delete(b.dataset.rm); drawSide(); paint(); } catch (e) { alert(t("mm.err.save")); }
      }));
    };
    drawSide();
    $("#mm-colour").addEventListener("change", (e) => { colourBy = prefs.colour = e.target.value; keepPrefs(); paint(); });

    // the canvas: the map at the view's zoom, the runs over it; dragged, wheeled, pinched
    const dpr = () => window.devicePixelRatio || 1;
    function size() {
      const box = cv.parentElement.getBoundingClientRect();
      cv.width = Math.round(box.width * dpr()); cv.height = Math.round(box.height * dpr());
    }
    function fit() {
      if (!image) return;
      const w = cv.width / dpr(), h = cv.height / dpr(), k = Math.min(w / image.width, h / image.height) * 0.98;
      view = { k, ox: (w - image.width * k) / 2, oy: (h - image.height * k) / 2 };
    }
    function paint() {
      if (!image || !view) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = getComputedStyle(cv).getPropertyValue("--plane") || "#ddd";
      g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr() * view.k, 0, 0, dpr() * view.k, dpr() * view.ox, dpr() * view.oy);
      g.imageSmoothingQuality = "high";
      g.drawImage(image, 0, 0);
      const shown = m.runs.filter((r) => !hidden.has(r.id) && runs.get(r.id));
      const lw = 3.2 / view.k;
      for (const r of shown) {
        const d = runs.get(r.id);
        for (const c of d.ctl) {
          g.strokeStyle = "rgba(164, 33, 160, .9)"; g.lineWidth = 2.2 / view.k;
          g.beginPath(); g.arc(c.x, c.y, 13 / view.k, 0, 2 * Math.PI); g.stroke();
        }
      }
      if (colourBy === "pace") for (const r of shown) paceRun(runs.get(r.id), lw);
      else MM.drawRuns(g, shown.map((r) => ({ ...runs.get(r.id), colour: colours.get(r.id) })), { width: lw, alpha: 0.85 });
      $("#mm-legend").hidden = colourBy !== "pace";
    }
    const PACE = ["#1a9850", "#66bd63", "#a6d96a", "#fee08b", "#fdae61", "#f46d43", "#d73027"];
    function paceRun(d, lw) {
      // each stretch of ~10 s by its speed against the run's own (fast green, slow red): read on pixels, so whatever the scale
      const sp = [];
      for (let i = 1; i < d.n; i++) { const dt = (d.ms[i] - d.ms[i - 1]) / 1000; sp.push(dt > 0 && !d.br.has(i) ? Math.hypot(d.x[i] - d.x[i - 1], d.y[i] - d.y[i - 1]) / dt : null); }
      const sm = sp.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - 5); k <= Math.min(sp.length - 1, i + 5); k++) if (sp[k] != null) { s += sp[k]; n++; } return n ? s / n : null; });
      const sorted = sm.filter((v) => v != null).sort((a, b) => a - b);
      if (!sorted.length) return;
      const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.floor(sorted.length * 0.9)] || lo + 1;
      g.save(); g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 0.9;
      for (let i = 1; i < d.n; i++) {
        if (d.br.has(i) || sm[i - 1] == null) continue;
        const f = Math.max(0, Math.min(1, (hi - sm[i - 1]) / (hi - lo || 1)));
        g.strokeStyle = PACE[Math.round(f * (PACE.length - 1))];
        g.beginPath(); g.moveTo(d.x[i - 1], d.y[i - 1]); g.lineTo(d.x[i], d.y[i]); g.stroke();
      }
      g.restore();
    }
    $("#mm-legend").innerHTML = html`<span>${t("mm.pace.fast")}</span>${PACE.map((c) => html`<i style="background:${c}"></i>`)}<span>${t("mm.pace.slow")}</span>`;
    const zoomAt = (f, sx, sy) => {
      if (!view) return;
      const k = Math.max(0.02, Math.min(40, view.k * f)), r = k / view.k;
      view = { k, ox: sx - (sx - view.ox) * r, oy: sy - (sy - view.oy) * r };
      paint();
    };
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const b = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - b.left, e.clientY - b.top); }, { passive: false });
    const ptrs = new Map();
    let pinch = null;
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = null; });
    cv.addEventListener("pointermove", (e) => {
      if (!ptrs.has(e.pointerId) || !view) return;
      const [px, py] = ptrs.get(e.pointerId);
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = cv.getBoundingClientRect();
        if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        pinch = d;
        return;
      }
      view.ox += e.clientX - px; view.oy += e.clientY - py;
      paint();
    });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    $("#mm-zin").addEventListener("click", () => zoomAt(1.4, cv.width / dpr() / 2, cv.height / dpr() / 2));
    $("#mm-zout").addEventListener("click", () => zoomAt(1 / 1.4, cv.width / dpr() / 2, cv.height / dpr() / 2));
    $("#mm-fit").addEventListener("click", () => { fit(); paint(); });
    const ro = new ResizeObserver(() => { const had = !!view; size(); if (!had) fit(); paint(); });
    ro.observe(cv.parentElement);
    viewer = { close: () => ro.disconnect() };
    size();

    (async () => {
      try {
        const blob = await (await fetch(MM.mapUrl(m.id, "map", token), { credentials: "same-origin" })).blob();
        image = await createImageBitmap(blob);
        fit(); paint();
      } catch (e) { $(".mm-map").insertAdjacentHTML("beforeend", html`<div class="empty">${t("mm.err.load")}</div>`.toString()); }
      await Promise.all(m.runs.map(async (r) => { try { runs.set(r.id, MM.decodeRun(await MM.getRun(r.id, token))); } catch (e) { /* drawn without it */ } }));
      paint();
    })();

    if (mine) {
      $("#mm-edit").addEventListener("click", () => editDialog(m));
      $("#mm-mshare").addEventListener("click", () => shareDialog(m));
      $("#mm-del").addEventListener("click", async () => {
        if (!confirm(t("mm.delete.ask", { title: m.title || t("mm.untitled") }))) return;
        try { await MM.deleteMap(m.id); st.maps = st.maps.filter((x) => x.id !== m.id); back(); } catch (e) { alert(t("mm.err.save")); }
      });
    }
    $("#mm-mexport").addEventListener("click", () => exportDialog([m]));
  }

  // ---- dialogs -----------------------------------------------------------------------------------------------------------
  function dialog(inner, { wide = false } = {}) {
    const d = document.createElement("dialog");
    d.className = `mm-dlg${wide ? " wide" : ""}`;
    d.innerHTML = String(inner);
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
    d.showModal();
    return d;
  }
  const dlgHead = (title) => html`<div class="mm-dlg-h"><b>${title}</b><button type="button" class="btn btn-ghost btn-sm" data-close aria-label="${t("mm.close")}">✕</button></div>`;

  function editDialog(m) {
    const d = dialog(html`${dlgHead(t("mm.edit"))}<form class="stack mm-form" method="dialog">
      <label class="field"><span>${t("mm.f.title")}</span><input name="title" maxlength="200" value="${m.title}"></label>
      <label class="field"><span>${t("mm.f.day")}</span><input name="day" type="date" value="${m.day || ""}"></label>
      <label class="field"><span>${t("mm.f.place")}</span><input name="place" maxlength="200" value="${m.place}"></label>
      <label class="field"><span>${t("mm.f.notes")}</span><textarea name="notes" rows="4" maxlength="4000">${m.notes}</textarea></label>
      <div class="row"><button class="btn btn-primary" type="submit">${t("mm.save")}</button><button class="btn" type="button" data-close>${t("mm.cancel")}</button></div></form>`);
    $("form", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const { map } = await MM.updateMap(m.id, { title: f.get("title"), day: f.get("day") || null, place: f.get("place"), notes: f.get("notes") });
        Object.assign(m, map); d.close(); openMap(m);
      } catch (err) { alert(t("mm.err.save")); }
    });
  }

  // a link shares the maps with the routes run on them, or the maps alone (owner, 2026-11-01): chosen before the link is made,
  // changed on the link kept (same address)
  function shareDialog(m) {
    const cur = () => (m ? st.links.maps[m.id] : st.links.archive);
    let traces = cur()?.traces ?? true;
    // a QuickRoute map carries its route in the picture itself: shared alone, the route still shows
    const painted = (m ? [m] : st.maps).some((x) => x.runs.some((r) => r.source === "quickroute"));
    const d = dialog(html`${dlgHead(t(m ? "mm.shareMap" : "mm.share"))}<div class="stack mm-form" id="mm-sh"></div>`);
    const fill = () => {
      const link = cur();
      $("#mm-sh", d).innerHTML = html`<p>${t(m ? "mm.share.mapText" : "mm.share.allText")}</p>
        <fieldset class="mm-what"><legend>${t("mm.share.what")}</legend>
          <label class="mm-check"><input type="radio" name="mm-what" value="1" ${raw(traces ? "checked" : "")}> <span>${t("mm.share.withTraces")}</span></label>
          <label class="mm-check"><input type="radio" name="mm-what" value="0" ${raw(traces ? "" : "checked")}> <span>${t("mm.share.mapOnly")}</span></label>
          ${painted ? html`<p class="muted">${t("mm.share.qrNote")}</p>` : ""}</fieldset>
        ${link ? html`<div class="mm-link"><input readonly value="${shareUrl(link.token, m?.id)}" id="mm-url"><button type="button" class="btn btn-sm btn-primary" id="mm-copy">${t("mm.copy")}</button></div>
          <p class="muted">${t(link.traces ? "mm.share.who" : "mm.share.whoMap")}</p>
          <div class="row"><button type="button" class="btn btn-sm mm-danger" id="mm-off">${t("mm.share.off")}</button></div>`
        : html`<p class="muted">${t("mm.share.private")}</p><div class="row"><button type="button" class="btn btn-primary" id="mm-on">${t("mm.share.make")}</button></div>`}`;
      $("#mm-copy", d)?.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText($("#mm-url", d).value); $("#mm-copy", d).textContent = t("mm.copied"); } catch (e) { $("#mm-url", d).select(); }
      });
      const set = async (on) => {
        try {
          const r = await MM.setLink(m?.id, on, traces);
          const v = r.token ? { token: r.token, traces: r.traces } : null;
          if (m) { if (v) st.links.maps[m.id] = v; else delete st.links.maps[m.id]; } else st.links.archive = v;
          fill();
        } catch (e) { alert(t("mm.err.save")); }
      };
      $$('input[name="mm-what"]', d).forEach((r) => r.addEventListener("change", () => { traces = r.value === "1"; if (cur()) set(true); }));
      $("#mm-on", d)?.addEventListener("click", () => set(true));
      $("#mm-off", d)?.addEventListener("click", () => set(false));
    };
    fill();
    d.addEventListener("close", () => (m ? openMap(m) : drawList()));
  }

  function exportDialog(maps) {
    const anyPersonal = mine && maps.some((m) => m.runs.some((r) => r.personal));
    const d = dialog(html`${dlgHead(t(maps.length > 1 ? "mm.exportAll" : "mm.exportMap"))}<div class="stack mm-form">
      <p>${t(maps.length > 1 ? "mm.export.allText" : "mm.export.text")}</p>
      ${anyPersonal ? html`<label class="mm-check"><input type="checkbox" id="mm-xp"> ${t("mm.export.personal")}</label>` : ""}
      <div class="row"><button type="button" class="btn btn-primary" id="mm-xgo">${t("mm.export.go")}</button><span class="muted" id="mm-xstate"></span></div></div>`);
    $("#mm-xgo", d).addEventListener("click", async () => {
      const personal = !!$("#mm-xp", d)?.checked, btn = $("#mm-xgo", d), state = $("#mm-xstate", d);
      btn.disabled = true;
      try {
        const out = [];
        for (const [i, m] of maps.entries()) {
          state.textContent = maps.length > 1 ? t("mm.export.progress", { i: i + 1, n: maps.length }) : t("mm.export.making");
          const blob = await (await fetch(MM.mapUrl(m.id, "map", token), { credentials: "same-origin" })).blob();
          const image = await createImageBitmap(blob);
          const runs = await Promise.all(m.runs.map(async (r) => ({ ...r, rec: await MM.getRun(r.id, token) })));
          out.push({ name: MM.fileName(m.title, m.day), blob: await MM.ozimutFile(m, blob, image, runs, { personal }) });
          image.close?.();
        }
        if (out.length === 1) MM.download(out[0].blob, out[0].name);
        else MM.download(await MM.zipOf(out), `${t("mm.export.zipName")}.zip`);
        d.close();
      } catch (e) { console.error(e); state.textContent = t("mm.err.export"); btn.disabled = false; }
    });
  }

  // ---- imports -----------------------------------------------------------------------------------------------------------
  function dropZone(el) {
    el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); el.classList.add("mm-drop"); } });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("mm-drop"); });
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("mm-drop"); const f = [...(e.dataTransfer?.files || [])]; if (f.length) importFiles(f); });
  }
  async function importFiles(files) {
    const d = dialog(html`${dlgHead(t("mm.import"))}<div class="stack mm-form" id="mm-imp"><p class="muted">${t("mm.imp.reading")}</p></div>`, { wide: true });
    const box = $("#mm-imp", d), entries = [], failed = [];
    for (const f of files) {
      try { for (const e of await MM.readFile(f)) entries.push({ ...e, file: f.name, sha: await MM.sha256(e.blob), on: true }); }
      catch (e) { failed.push([f.name, e.message === "newer" ? "mm.imp.newer" : "mm.imp.unknown"]); }
    }
    const shaKnown = new Map(st.maps.map((m) => [m.sha, m]));
    for (const e of entries) {
      const old = shaKnown.get(e.sha);
      e.newRuns = e.runs.filter((r) => !old?.runs.some((o) => o.start === r.start));
      if (old && !e.newRuns.length) e.on = false;
    }
    const personal = entries.some((e) => e.runs.some((r) => r.personal));
    box.innerHTML = html`
      ${entries.length ? html`<p>${t("mm.imp.found")}</p><ul class="mm-imp">${entries.map((e, i) => html`<li><label>
        <input type="checkbox" data-i="${i}" ${raw(e.on ? "checked" : "")} ${raw(shaKnown.has(e.sha) && !e.newRuns.length ? "disabled" : "")}>
        <b>${e.title || e.file}</b> <span class="muted">${[e.day ? fmtDate(e.day) : "", e.runs.length ? tn("mm.count.runs", e.runs.length) : t("mm.mapOnly"), t(`mm.from.${e.from}`)].filter(Boolean).join(" · ")}</span>
        ${shaKnown.has(e.sha) ? html` <span class="mm-tag-s">${e.newRuns.length ? t("mm.imp.addRuns") : t("mm.imp.already")}</span>` : ""}</label></li>`)}</ul>` : ""}
      ${failed.length ? html`<div class="notice">${failed.map(([n, k]) => html`<div><b>${n}</b> — ${t(k)}</div>`)}</div>` : ""}
      ${entries.some((e) => e.from === "quickroute") ? html`<p class="muted">${t("mm.imp.qrNote")}</p>` : ""}
      ${personal ? html`<label class="mm-check"><input type="checkbox" id="mm-ip"> ${t("mm.personal.ask")}</label><p class="muted">${t("mm.personal.why")}</p>` : ""}
      <div class="row">${entries.length ? html`<button type="button" class="btn btn-primary" id="mm-igo">${t("mm.imp.go")}</button>` : ""}
        <button type="button" class="btn" data-close>${t("mm.cancel")}</button><span class="muted" id="mm-istate"></span></div>`;
    $$("[data-close]", box).forEach((b) => b.addEventListener("click", () => d.close()));
    $$("[data-i]", box).forEach((c) => c.addEventListener("change", () => { entries[c.dataset.i].on = c.checked; }));
    $("#mm-igo", box)?.addEventListener("click", async () => {
      const go = entries.filter((e) => e.on), keep = !!$("#mm-ip", box)?.checked, btn = $("#mm-igo", box), state = $("#mm-istate", box);
      btn.disabled = true;
      let done = 0, errors = 0;
      for (const e of go) {
        state.textContent = t("mm.imp.progress", { i: done + 1, n: go.length });
        try { await MM.save({ ...e, runs: e.newRuns }, { personal: keep }); } catch (err) { console.error(err); errors++; }
        done++;
      }
      st = await MM.list();
      d.close();
      drawList();
      if (errors) alert(tn("mm.imp.errors", errors));
    });
  }

  // ---- DOMA: not open yet; a message asks the Ozimut team to turn it on (owner, 2026-11-01) -------------------------------
  function domaDialog() {
    const d = dialog(html`${dlgHead(t("mm.doma.title"))}<form class="stack mm-form" id="mm-df">
      <p>${t("mm.doma.text")}</p>
      <label class="field"><span>${t("mm.doma.url")}</span><input name="url" type="url" required placeholder="https://doma.example.org/" autocomplete="url"></label>
      <label class="field"><span>${t("mm.doma.user")}</span><input name="user" maxlength="100" placeholder="${t("mm.doma.user.ph")}"></label>
      <label class="field"><span>${t("mm.doma.note")}</span><textarea name="note" rows="3" maxlength="2000"></textarea></label>
      <p class="muted">${t("mm.doma.reply", { email: me?.email || "" })}</p>
      <div class="notice" id="mm-derr" hidden></div>
      <div class="row"><button class="btn btn-primary" type="submit">${t("mm.doma.send")}</button><button class="btn" type="button" data-close>${t("mm.cancel")}</button></div></form>`);
    $("#mm-df", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), url = String(f.get("url") || "").trim(), err = $("#mm-derr", d);
      if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)) { err.textContent = t("mm.doma.badUrl"); err.hidden = false; return; }
      const lines = [t("mm.doma.msg.intro"), "", `${t("mm.doma.msg.url")} ${url}`, `${t("mm.doma.msg.user")} ${String(f.get("user") || "").trim() || "—"}`,
        `${t("mm.doma.msg.account")} ${me?.nom || ""} (${me?.email || ""}, #${me?.uid ?? ""})`, `${t("mm.doma.msg.lang")} ${lang()}`,
        `${t("mm.doma.msg.maps")} ${st.maps.length}`];
      const note = String(f.get("note") || "").trim();
      if (note) lines.push("", note);
      const text = lines.join("\n");
      const htmlBody = text.split("\n").map((l) => `<p>${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</p>`).join("");
      const btn = $("button[type=submit]", d);
      btn.disabled = true;
      const res = await auth.api("api/contact", { category: "aide", subject: t("mm.doma.subject"), text, html: htmlBody, from: "#/mes-cartes", browser: navigator.userAgent, attachments: [] });
      btn.disabled = false;
      if (!res.ok) { err.textContent = t(res.status === 429 ? "mm.doma.rate" : "mm.doma.fail"); err.hidden = false; return; }
      $("#mm-df", d).innerHTML = html`<p>${t("mm.doma.sent")}</p><div class="row"><button class="btn btn-primary" type="button" data-close>${t("mm.close")}</button></div>`;
      $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
    });
  }

  draw();
  return { title: t("mm.title"), cleanup: () => { viewer?.close(); $$(".mm-dlg").forEach((d) => d.close()); } };
}

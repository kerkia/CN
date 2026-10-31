// « Annuaire » (Stats › Clubs, ?onglet=annuaire; owner, 2026-10-31): every club FFCO lists with its website, as a tree —
// the ligues, each with its website, their départements with their committee's (CDCO), their clubs with their own — beside a
// map of France's ligues and départements. A node chosen in the tree lights up on the map with what it holds (a ligue its
// départements, a département its own area); the map is never zoomed, so any ligue stays in reach (owner, 2026-10-31): a click
// on it chooses the ligue, a second one inside it the département, and opens that node in the tree. A website FFCO does not
// give is said (« site non trouvé »), as is a département without a committee. Each node also says how many of its
// licensees hold a value in the site's method at the last month-end (any discipline) and how many raced in 12 months, and,
// for FFCO's licensees only, the contacts FFCO prints — its « Bureau » (officers and roles), phone and e-mail: a file of its
// own (clubdir_contacts.json) the login gate refuses to anyone else, demo accounts included. The data: France's
// clubdir.json, from FFCO's structure pages and club directory, read again every week by the provisional results' runs
// (ffco_scraper/prov/clubdir.py); the map: geo/departements.json and geo/regions.json (as the runner's « Carte »).

import { html, $, $$, fmt, normalise, debounce, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import * as store from "../store.js";
import { TERRAINS } from "../store.js";
import { tile, setLede } from "../ui.js";
import { link, replaceQuery } from "../app.js";
import { featuresOf } from "../geo.js";

const SVG = "http://www.w3.org/2000/svg";
const geoCache = new Map();
const geo = (kind) => {
  if (!geoCache.has(kind)) geoCache.set(kind, fetch(`assets/geo/${kind}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return geoCache.get(kind);
};
// a map feature's directory département ('2A' -> '20')
const deptOfFeat = (code) => (code === "2A" || code === "2B" ? "20" : code);

/** A website shown short: its host and path, without the scheme, « www. » and a final slash. */
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const siteCell = (site, none, src) => (site
  ? html`<a class="cdir-site" href="${site}" target="_blank" rel="noopener noreferrer" title="${site}">${shortUrl(site)}</a>${
    src === "agenda" ? html` <span class="cdir-src" title="${t("cdir.fromAgenda.tip")}">${t("cdir.fromAgenda")}</span>` : ""}`
  : html`<span class="cdir-none">${none}</span>`);
/** A phone number as a link: France's « 06 14 17 54 71 » dialled as +33614175471. */
const telHref = (s) => {
  const d = s.replace(/[^\d+]/g, "");
  return `tel:${/^0\d{9}$/.test(d) ? `+33${d.slice(1)}` : d}`;
};

/**
 * Per club number: the licensees holding a value in `method` at `month` in each discipline and in any (`lics`), and those
 * whose last race is within the 12 months to it (`active`).
 */
async function clubStats(method, month) {
  const year = Number(month.slice(0, 4));
  const [attrs, ...maps] = await Promise.all([data.attrsAt(year),
    ...TERRAINS.map((tr) => data.cnAt(method, tr, month).catch(() => new Map()))]);
  const by = new Map();
  const get = (code) => {
    if (!by.has(code)) by.set(code, { lics: new Set(), active: 0, ...Object.fromEntries(TERRAINS.map((tr) => [tr, 0])) });
    return by.get(code);
  };
  TERRAINS.forEach((tr, i) => maps[i].forEach((_, lic) => {
    const code = data.clubParts((attrs.get(lic) || [])[1] || data.runner(lic)?.club || "").code;
    if (!code) return;
    const g = get(code);
    g[tr]++;
    g.lics.add(lic);
  }));
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  const from = d.toISOString().slice(0, 10);
  for (const r of data.runners()?.list || []) {
    const code = r.last && r.last > from && r.last <= month ? data.clubParts(r.club).code : null;
    if (code) get(code).active++;
  }
  return by;
}

export async function render(el, { query }) {
  setLede(t("cdir.lede"));
  const [dir, contacts, deps, regs] = await Promise.all([data.countryJson("FR", "clubdir.json"),
    // FFCO's licensees only (the login gate answers 403 to others): without it, no contacts
    data.countryJson("FR", "clubdir_contacts.json").catch(() => null), geo("departements"), geo("regions")]);
  if (!dir?.ligues?.length) {
    el.innerHTML = html`<div class="notice info">${t("cdir.none")}</div>`;
    return { title: `${t("cl.title")} · ${t("cl.view.annuaire")}` };
  }
  const known = data.meta()?.names?.clubs || {};
  // the nodes: "L:AR" a ligue, "D:69" a département, "C:0109" a club (its contacts unfolded); each département's ligue
  const ligueOfDept = new Map(), ligues = new Map(), depts = new Map();
  for (const lg of dir.ligues) {
    ligues.set(lg.code, lg);
    for (const d of lg.depts) { ligueOfDept.set(d.code, lg.code); depts.set(d.code, d); }
  }
  const valid = (k) => (k?.startsWith("L:") && ligues.has(k.slice(2))) || (k?.startsWith("D:") && depts.has(k.slice(2)));
  let sel = valid(query.sel) ? query.sel : null;
  const open = new Set();
  if (sel) { open.add(sel); if (sel.startsWith("D:")) open.add(`L:${ligueOfDept.get(sel.slice(2))}`); }
  let q = query.q || "";
  const contactOf = (key) => contacts?.[key[0]]?.[key.slice(2)] || null;

  // the figures: computed once the ranking's files are in (the tree is drawn before, then again)
  const method = store.get().method, month = data.latestMonth();
  let stats = null;
  const figs = new Map();                          // node key -> { all, active, For, Spr, VTT, Ski }
  const sumOf = (clubs) => {
    const s = { all: 0, active: 0, ...Object.fromEntries(TERRAINS.map((tr) => [tr, 0])) };
    for (const cl of clubs) {
      const g = stats.get(cl.code);
      if (!g) continue;
      s.all += g.lics.size; s.active += g.active;
      for (const tr of TERRAINS) s[tr] += g[tr];
    }
    return s;
  };
  function computeFigs() {
    for (const lg of dir.ligues) {
      for (const d of lg.depts) {
        figs.set(`D:${d.code}`, sumOf(d.clubs));
        for (const cl of d.clubs) figs.set(`C:${cl.code}`, sumOf([cl]));
      }
      figs.set(`L:${lg.code}`, sumOf(lg.depts.flatMap((d) => d.clubs)));
    }
  }
  const rankedTip = (f) => t("cdir.ranked.tip", { month: fmtDate(month),
    by: TERRAINS.filter((tr) => f[tr]).map((tr) => `${t(`terrain.${tr}`)} ${fmt(f[tr])}`).join(", ") || "—" });
  const rankedMeta = (key) => {
    const f = figs.get(key);
    return f ? html` · <span title="${rankedTip(f)}">${fmt(f.all)} ${f.all === 1 ? t("cdir.ranked.one") : t("cdir.ranked.other")}</span>` : "";
  };

  const c = dir.counts;
  el.innerHTML = html`
    <div class="tiles cdir-tiles">
      ${tile(t("cdir.tile.ligues"), `${fmt(c.liguesSite)} / ${fmt(c.ligues)}`, t("cdir.tile.withSite"))}
      ${tile(t("cdir.tile.cdco"), `${fmt(c.cdcoSite)} / ${fmt(c.cdco)}`, t("cdir.tile.withSite"))}
      ${tile(t("cdir.tile.clubs"), `${fmt(c.clubsSite)} / ${fmt(c.clubs)}`, t("cdir.tile.withSite"))}
    </div>
    <div class="cdir">
      <section class="card cdir-list">
        <div class="card-head"><h2>${t("cdir.title")}</h2>
          <div class="row">
            <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("f.name")}</span>
              <input type="search" id="cdir-q" value="${q}" style="width:170px"></label>
            <button class="btn btn-sm" type="button" data-all="open">${t("cdir.openAll")}</button>
            <button class="btn btn-sm" type="button" data-all="close">${t("cdir.closeAll")}</button>
          </div></div>
        <div class="cdir-tree" role="tree" aria-label="${t("cdir.title")}"></div>
        <p class="dim cdir-foot">${t("cdir.source")}${contacts ? html` ${t("cdir.contactsNote")}` : ""}</p>
      </section>
      <section class="card cdir-side">
        <div class="cdir-mapbox">
          <svg class="cdir-map" xmlns="${SVG}" role="img" aria-label="${t("cdir.map.title")}" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="cdir-tip" hidden></div>
        </div>
        <p class="cdir-caption"></p>
        <p class="cdir-figs"></p>
        <p class="dim cdir-hint">${t("cdir.map.hint")}</p>
      </section>
    </div>`;
  const tree = $(".cdir-tree", el), svg = $(".cdir-map", el), tip = $(".cdir-tip", el);

  // ---- the tree
  const count = (n, one, other) => `${fmt(n)} ${n === 1 ? one : other}`;
  const tog = (key, isOpen) => html`<button type="button" class="cdir-tog" data-tog="${key}" aria-label="${isOpen ? t("cdir.close") : t("cdir.open")}">${isOpen ? "▾" : "▸"}</button>`;
  /** What an opened node says: its figures, then its contacts (FFCO's licensees only). */
  function info(key, { figures = true } = {}) {
    const f = figures && figs.get(key), ct = contactOf(key);
    if (!f && !ct) return "";
    return html`<div class="cdir-info">
      ${f ? html`<div title="${rankedTip(f)}">${t("cdir.figs", { n: fmt(f.all), active: fmt(f.active) })}</div>` : ""}
      ${ct?.bureau?.length ? html`<div><span class="cdir-lab">${t("cdir.bureau")}</span> ${ct.bureau.map(([n, r], i) => html`${i ? ", " : ""}<span class="cdir-person">${n}</span>${r ? html` <span class="dim">(${r})</span>` : ""}`)}</div>` : ""}
      ${ct?.tel || ct?.email ? html`<div class="cdir-reach">
        ${ct.tel ? html`<span><span class="cdir-lab">${t("cdir.tel")}</span> <a href="${telHref(ct.tel)}">${ct.tel}</a></span>` : ""}
        ${ct.email ? html`<span><span class="cdir-lab">${t("cdir.email")}</span> <a href="mailto:${ct.email}">${ct.email}</a></span>` : ""}
      </div>` : ""}
    </div>`;
  }
  const clubRow = (cl) => {
    const ck = `C:${cl.code}`, has = !!contactOf(ck), cOpen = has && open.has(ck), f = figs.get(ck);
    return html`<li class="cdir-node cdir-club" role="treeitem" ${has ? html`aria-expanded="${cOpen}"` : ""} data-key="${ck}">
      <div class="cdir-row">
        ${has ? tog(ck, cOpen) : ""}
        <span class="cdir-code">${cl.code}</span>
        ${known[cl.code] ? html`<a class="cdir-name" href="${link.club(cl.code)}">${cl.name}</a>` : html`<span class="cdir-name">${cl.name}</span>`}
        ${f?.all ? html`<span class="cdir-meta" title="${rankedTip(f)}">${count(f.all, t("cdir.ranked.one"), t("cdir.ranked.other"))}</span>` : ""}
        ${siteCell(cl.site, t("cdir.noSite"), cl.src)}
      </div>
      ${cOpen ? info(ck, { figures: false }) : ""}
    </li>`;
  };
  const matches = (cl, qn) => normalise(`${cl.code} ${cl.name}`).includes(qn);
  function drawTree() {
    const qn = normalise(q.trim());
    const parts = [];
    for (const lg of dir.ligues) {
      const ds = lg.depts.map((d) => ({ d, clubs: qn ? d.clubs.filter((cl) => matches(cl, qn)) : d.clubs }))
        .filter(({ d, clubs }) => !qn || clubs.length || normalise(`${d.code} ${d.name}`).includes(qn));
      if (qn && !ds.length && !normalise(lg.name).includes(qn)) continue;
      const lk = `L:${lg.code}`, lOpen = open.has(lk) || !!qn;
      const nClubs = lg.depts.reduce((s, d) => s + d.clubs.length, 0);
      parts.push(html`<li class="cdir-node cdir-l${sel === lk ? " sel" : ""}" role="treeitem" aria-expanded="${lOpen}" data-key="${lk}">
        <div class="cdir-row">
          ${tog(lk, lOpen)}
          <button type="button" class="cdir-pick" data-pick="${lk}" aria-pressed="${sel === lk}">${lg.name}</button>
          <span class="cdir-meta">${count(lg.depts.length, t("cdir.dept.one"), t("cdir.dept.other"))} · ${count(nClubs, t("cdir.club.one"), t("cdir.club.other"))}${rankedMeta(lk)}</span>
          ${siteCell(lg.site, t("cdir.noSite"))}
        </div>
        ${lOpen ? html`${info(lk)}<ul class="cdir-kids" role="group">${ds.map(({ d, clubs }) => {
          const dk = `D:${d.code}`, dOpen = open.has(dk) || (!!qn && clubs.length > 0);
          return html`<li class="cdir-node cdir-d${sel === dk ? " sel" : ""}" role="treeitem" aria-expanded="${dOpen}" data-key="${dk}">
            <div class="cdir-row">
              ${tog(dk, dOpen)}
              <button type="button" class="cdir-pick" data-pick="${dk}" aria-pressed="${sel === dk}"><span class="cdir-code">${d.code}</span> ${d.name}</button>
              <span class="cdir-meta">${count(d.clubs.length, t("cdir.club.one"), t("cdir.club.other"))}${rankedMeta(dk)}</span>
              ${d.cdco ? html`<span class="cdir-who">${t("cdir.cdco")}</span>${siteCell(d.site, t("cdir.noSite"))}` : html`<span class="cdir-none">${t("cdir.noCdco")}</span>`}
            </div>
            ${dOpen ? html`${info(dk)}${clubs.length ? html`<ul class="cdir-kids" role="group">${clubs.map(clubRow)}</ul>`
              : html`<p class="cdir-empty dim">${t("cdir.noClub")}</p>`}` : ""}
          </li>`;
        })}</ul>` : ""}
      </li>`);
    }
    tree.innerHTML = parts.length ? html`<ul class="cdir-root">${parts}</ul>` : html`<p class="dim">${t("cdir.noMatch")}</p>`;
  }
  function reveal(key) {
    const row = tree.querySelector(`[data-key="${CSS.escape(key)}"] > .cdir-row`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---- the map: the départements filled, the ligues' borders over them; the whole of France always in view
  const feats = deps?.features || [];
  const mapOk = feats.length > 0;
  if (mapOk) {
    let W = 180, E = -180, S = 90, N = -90;
    const rings = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flat();
    for (const ft of feats) {
      rings(ft.geometry).forEach((ring) => ring.forEach(([x, y]) => { W = Math.min(W, x); E = Math.max(E, x); S = Math.min(S, y); N = Math.max(N, y); }));
    }
    const cos = Math.cos(((S + N) / 2) * Math.PI / 180), K = 1000 / Math.max((E - W) * cos, N - S);
    const pathOf = (g) => rings(g).map((ring) => `${ring.map(([x, y], i) => `${i ? "L" : "M"}${((x - W) * cos * K).toFixed(1)} ${((N - y) * K).toFixed(1)}`).join("")}Z`).join("");
    svg.setAttribute("viewBox", `-10 -10 ${((E - W) * cos * K + 20).toFixed(1)} ${((N - S) * K + 20).toFixed(1)}`);
    svg.innerHTML = [
      ...feats.map((ft) => {
        const code = ft.properties.code;
        return `<path class="cdir-dep${ligueOfDept.get(deptOfFeat(code)) ? "" : " off"}" data-feat="${code}" d="${pathOf(ft.geometry)}"/>`;
      }),
      ...(regs?.features || []).map((ft) => `<path class="cdir-lig" d="${pathOf(ft.geometry)}"/>`),
    ].join("");
  } else {
    $(".cdir-side", el).hidden = true;
  }
  function paintMap() {
    if (!mapOk) return;
    const lg = sel ? (sel.startsWith("L:") ? sel.slice(2) : ligueOfDept.get(sel.slice(2))) : null;
    const dsel = sel?.startsWith("D:") ? sel.slice(2) : null;
    $$(".cdir-dep", svg).forEach((p) => {
      const d = deptOfFeat(p.dataset.feat);
      p.classList.toggle("in", !!lg && ligueOfDept.get(d) === lg);
      p.classList.toggle("on", d === dsel || (!!lg && !dsel && ligueOfDept.get(d) === lg));
    });
    $(".cdir-caption", el).textContent = !sel ? t("cdir.map.pick") : dsel ? `${depts.get(dsel).name} · ${ligues.get(lg).name}` : ligues.get(lg).name;
    const f = sel && figs.get(sel), fp = $(".cdir-figs", el);
    fp.textContent = f ? t("cdir.figs", { n: fmt(f.all), active: fmt(f.active) }) : "";
    fp.title = f ? rankedTip(f) : "";
  }

  // ---- the selection, in step on both sides
  function choose(key, { toggle = false, from = "tree" } = {}) {
    if (from === "map") open.clear();          // (the map's choice alone open in the tree: no hunt for it)
    if (toggle && sel === key && open.has(key)) open.delete(key);
    else open.add(key);
    if (key.startsWith("D:")) open.add(`L:${ligueOfDept.get(key.slice(2))}`);
    sel = key;
    drawTree(); paintMap();
    if (from === "map") reveal(key);
    replaceQuery({ sel, q: q || null });
  }
  tree.addEventListener("click", (ev) => {
    const tg = ev.target.closest("[data-tog]");
    if (tg) {
      const k = tg.dataset.tog;
      if (open.has(k)) open.delete(k); else open.add(k);
      drawTree();
      return;
    }
    const pk = ev.target.closest("[data-pick]");
    if (pk) choose(pk.dataset.pick, { toggle: true });
  });
  $$("[data-all]", el).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.all === "open") { for (const lg of dir.ligues) { open.add(`L:${lg.code}`); lg.depts.forEach((d) => open.add(`D:${d.code}`)); } } else open.clear();
    drawTree();
  }));
  $("#cdir-q", el).addEventListener("input", debounce((e) => { q = e.target.value; drawTree(); replaceQuery({ sel, q: q || null }); }, 180));

  if (mapOk) {
    // a click: the ligue first, then (inside the ligue chosen) the département
    svg.addEventListener("click", (ev) => {
      const p = ev.target.closest("[data-feat]");
      if (!p) return;
      const d = deptOfFeat(p.dataset.feat), lg = ligueOfDept.get(d);
      if (!lg) return;
      const cur = sel ? (sel.startsWith("L:") ? sel.slice(2) : ligueOfDept.get(sel.slice(2))) : null;
      choose(cur === lg && depts.has(d) ? `D:${d}` : `L:${lg}`, { from: "map" });
    });
    svg.addEventListener("pointermove", (ev) => {
      const p = ev.target.closest("[data-feat]");
      const d = p && deptOfFeat(p.dataset.feat), lg = d && ligueOfDept.get(d);
      $$(".cdir-dep.hov", svg).forEach((x) => x.classList.remove("hov"));
      if (!lg) { tip.hidden = true; return; }
      featuresOf(d).forEach((f) => svg.querySelector(`[data-feat="${f}"]`)?.classList.add("hov"));
      const dn = depts.get(d);
      tip.textContent = `${d} · ${dn?.name || ""} — ${ligues.get(lg).name}${dn ? ` · ${count(dn.clubs.length, t("cdir.club.one"), t("cdir.club.other"))}` : ""}`;
      const box = svg.parentElement.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX - box.left + 12, box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${ev.clientY - box.top + 14}px`;
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; $$(".cdir-dep.hov", svg).forEach((x) => x.classList.remove("hov")); });
  }

  drawTree(); paintMap();
  if (sel) requestAnimationFrame(() => reveal(sel));
  // the figures, once the ranking's files are in
  if (month) {
    clubStats(method, month).then((s) => {
      if (!el.isConnected) return;
      stats = s;
      computeFigs();
      drawTree(); paintMap();
    }).catch(() => {});
  }
  return { title: `${t("cl.title")} · ${t("cl.view.annuaire")}` };
}

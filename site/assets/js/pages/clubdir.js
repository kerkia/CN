// « Annuaire » (Stats › Clubs, ?onglet=annuaire; owner, 2026-10-31): every club FFCO lists with its website, as a tree —
// the ligues, their départements with their committee (CDCO), their clubs — beside a map of France's ligues and départements.
// A node under the mouse in the tree lights up on the map as a chosen one does (a ligue its départements, a département or a
// club its own area); the map is never zoomed, so any ligue stays in reach: a click on it chooses the ligue, a second one inside
// it the département, and opens that node in the tree. A node chosen (in the tree or on the map) fills the card above the map
// (owner, 2026-11-01): its website (« site non trouvé » when FFCO gives none), its figures — the licensees holding a value in
// the site's method at the last month-end, any discipline, and those who raced in 12 months — and, for FFCO's licensees only,
// the contacts FFCO prints: its « Bureau » (officers and roles), phone and e-mail, a file of its own (clubdir_contacts.json)
// the login gate refuses to anyone else, demo accounts included; a club's card links to its Ozimut page (its name in the tree
// does not). The counts of known websites are one line above the tree. Under 900 px the tree is alone and a choice opens the
// card in its place, with a way back to the list. The data: France's clubdir.json, from FFCO's structure pages and club
// directory, read again every week by the provisional results' runs (ffco_scraper/prov/clubdir.py); the map:
// geo/departements.json and geo/regions.json (as the runner's « Carte »).

import { html, $, $$, fmt, normalise, debounce, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import * as store from "../store.js";
import { TERRAINS } from "../store.js";
import { setLede } from "../ui.js";
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
// the tree alone, a choice opening the card in its place (the map, under 640 px, is not shown at all)
const NARROW = "(max-width: 900px)";

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
  // the nodes: "L:AR" a ligue, "D:69" a département, "C:0109" a club; each département's ligue, each club's département
  const ligueOfDept = new Map(), ligues = new Map(), depts = new Map(), clubs = new Map(), deptOfClub = new Map();
  for (const lg of dir.ligues) {
    ligues.set(lg.code, lg);
    for (const d of lg.depts) {
      ligueOfDept.set(d.code, lg.code); depts.set(d.code, d);
      for (const cl of d.clubs) { clubs.set(cl.code, cl); deptOfClub.set(cl.code, d.code); }
    }
  }
  const valid = (k) => (k?.startsWith("L:") && ligues.has(k.slice(2))) || (k?.startsWith("D:") && depts.has(k.slice(2)))
    || (k?.startsWith("C:") && clubs.has(k.slice(2)));
  /** The ligue and the département a node lies in (a ligue: none). */
  const placeOf = (k) => {
    if (!k) return { lg: null, d: null };
    if (k.startsWith("L:")) return { lg: k.slice(2), d: null };
    const d = k.startsWith("C:") ? deptOfClub.get(k.slice(2)) : k.slice(2);
    return { lg: ligueOfDept.get(d), d };
  };
  let sel = valid(query.sel) ? query.sel : null;
  const open = new Set();
  const openTo = (k) => {
    const { lg, d } = placeOf(k);
    if (lg) open.add(`L:${lg}`);
    if (d) open.add(`D:${d}`);
  };
  if (sel) openTo(sel);
  let q = query.q || "";
  const contactOf = (key) => contacts?.[key[0]]?.[key.slice(2)] || null;

  // the figures: computed once the ranking's files are in (the tree and the card are drawn before, then again)
  const method = store.get().method, month = data.latestMonth();
  let stats = null;
  const figs = new Map();                          // node key -> { all, active, For, Spr, VTT, Ski }
  const sumOf = (list) => {
    const s = { all: 0, active: 0, ...Object.fromEntries(TERRAINS.map((tr) => [tr, 0])) };
    for (const cl of list) {
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
    <div class="cdir">
      <div class="cdir-main">
        <p class="cdir-sum"><span class="cdir-lab">${t("cdir.sum.label")}</span>
          <span><b>${fmt(c.liguesSite)}/${fmt(c.ligues)}</b> ${t("cdir.sum.ligues")}</span>
          <span><b>${fmt(c.cdcoSite)}/${fmt(c.cdco)}</b> ${t("cdir.sum.cdco")}</span>
          <span><b>${fmt(c.clubsSite)}/${fmt(c.clubs)}</b> ${t("cdir.sum.clubs")}</span></p>
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
      </div>
      <div class="cdir-side">
        <button type="button" class="btn btn-sm cdir-back">${t("cdir.info.back")}</button>
        <section class="card cdir-card" aria-live="polite"></section>
        <section class="card cdir-mapcard">
          <div class="cdir-mapbox">
            <svg class="cdir-map" xmlns="${SVG}" role="img" aria-label="${t("cdir.map.title")}" preserveAspectRatio="xMidYMid meet"></svg>
            <div class="cdir-tip" hidden></div>
          </div>
          <p class="dim cdir-hint">${t("cdir.map.hint")}</p>
        </section>
      </div>
    </div>`;
  const root = $(".cdir", el), tree = $(".cdir-tree", el), svg = $(".cdir-map", el), tip = $(".cdir-tip", el), card = $(".cdir-card", el);
  const narrow = matchMedia(NARROW);

  // ---- the tree
  const count = (n, one, other) => `${fmt(n)} ${n === 1 ? one : other}`;
  const tog = (key, isOpen) => html`<button type="button" class="cdir-tog" data-tog="${key}" aria-label="${isOpen ? t("cdir.close") : t("cdir.open")}">${isOpen ? "▾" : "▸"}</button>`;
  const clubRow = (cl) => {
    const ck = `C:${cl.code}`, f = figs.get(ck);
    return html`<li class="cdir-node cdir-club${sel === ck ? " sel" : ""}" role="treeitem" data-key="${ck}">
      <div class="cdir-row">
        <span class="cdir-code">${cl.code}</span>
        <button type="button" class="cdir-pick cdir-name" data-pick="${ck}" aria-pressed="${sel === ck}">${cl.name}</button>
        ${f?.all ? html`<span class="cdir-meta" title="${rankedTip(f)}">${count(f.all, t("cdir.ranked.one"), t("cdir.ranked.other"))}</span>` : ""}
        ${siteCell(cl.site, t("cdir.noSite"), cl.src)}
      </div>
    </li>`;
  };
  const matches = (cl, qn) => normalise(`${cl.code} ${cl.name}`).includes(qn);
  function drawTree() {
    const qn = normalise(q.trim());
    const parts = [];
    for (const lg of dir.ligues) {
      const ds = lg.depts.map((d) => ({ d, clubs: qn ? d.clubs.filter((cl) => matches(cl, qn)) : d.clubs }))
        .filter(({ d, clubs: cs }) => !qn || cs.length || normalise(`${d.code} ${d.name}`).includes(qn));
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
        ${lOpen ? html`<ul class="cdir-kids" role="group">${ds.map(({ d, clubs: cs }) => {
          const dk = `D:${d.code}`, dOpen = open.has(dk) || (!!qn && cs.length > 0);
          return html`<li class="cdir-node cdir-d${sel === dk ? " sel" : ""}" role="treeitem" aria-expanded="${dOpen}" data-key="${dk}">
            <div class="cdir-row">
              ${tog(dk, dOpen)}
              <button type="button" class="cdir-pick" data-pick="${dk}" aria-pressed="${sel === dk}"><span class="cdir-code">${d.code}</span> ${d.name}</button>
              <span class="cdir-meta">${count(d.clubs.length, t("cdir.club.one"), t("cdir.club.other"))}${rankedMeta(dk)}</span>
              ${d.cdco ? html`<span class="cdir-who">${t("cdir.cdco")}</span>${siteCell(d.site, t("cdir.noSite"))}` : html`<span class="cdir-none">${t("cdir.noCdco")}</span>`}
            </div>
            ${dOpen ? (cs.length ? html`<ul class="cdir-kids" role="group">${cs.map(clubRow)}</ul>`
              : html`<p class="cdir-empty dim">${t("cdir.noClub")}</p>`) : ""}
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

  // ---- the card: what the node chosen is, its website, figures and (FFCO's licensees) contacts
  function drawCard() {
    if (!sel) {
      card.innerHTML = html`<p class="dim cdir-card-empty">${t("cdir.info.pick")}</p>`;
      return;
    }
    const kind = sel[0], code = sel.slice(2), { lg, d } = placeOf(sel);
    const node = kind === "L" ? ligues.get(code) : kind === "D" ? depts.get(code) : clubs.get(code);
    const f = figs.get(sel), ct = contactOf(sel);
    const where = kind === "C" ? `${d} ${depts.get(d)?.name || ""} · ${ligues.get(lg)?.name || ""}` : kind === "D" ? ligues.get(lg)?.name : "";
    const kindLabel = kind === "L" ? t("cdir.kind.L") : kind === "D" ? (node.cdco ? t("cdir.kind.D") : t("cdir.kind.Dnone")) : t("cdir.kind.C");
    const title = kind === "L" ? node.name : `${node.code} · ${node.name}`;
    const size = kind === "L" ? `${count(node.depts.length, t("cdir.dept.one"), t("cdir.dept.other"))} · ${count(node.depts.reduce((s, x) => s + x.clubs.length, 0), t("cdir.club.one"), t("cdir.club.other"))}`
      : kind === "D" ? count(node.clubs.length, t("cdir.club.one"), t("cdir.club.other")) : "";
    // a département without a committee has no website of its own to look for
    const site = kind === "D" && !node.cdco ? html`<span class="cdir-none">${t("cdir.noCdco")}</span>` : siteCell(node.site, t("cdir.noSite"), node.src);
    card.innerHTML = html`
      <div class="cdir-card-head">
        <div><div class="cdir-kind">${kindLabel}${where ? html` · <span class="dim">${where}</span>` : ""}</div>
          <h3 class="cdir-card-title">${title}</h3></div>
        ${kind === "C" && known[code] ? html`<a class="btn btn-sm" href="${link.club(code)}">${t("cdir.info.clubPage")}</a>` : ""}
      </div>
      <dl class="cdir-dl">
        <dt>${t("cdir.info.site")}</dt><dd>${site}</dd>
        ${size ? html`<dt>${t("cdir.info.size")}</dt><dd>${size}</dd>` : ""}
        ${f ? html`<dt>${t("cdir.info.figs")}</dt><dd>${t("cdir.figs", { n: fmt(f.all), active: fmt(f.active) })}<div class="dim cdir-small">${rankedTip(f)}</div></dd>` : ""}
        ${ct?.bureau?.length ? html`<dt>${t("cdir.bureau")}</dt><dd><ul class="cdir-people">${ct.bureau.map(([n, r]) => html`<li><span class="cdir-person">${n}</span>${r ? html` <span class="dim">(${r})</span>` : ""}</li>`)}</ul></dd>` : ""}
        ${ct?.tel ? html`<dt>${t("cdir.tel")}</dt><dd><a href="${telHref(ct.tel)}">${ct.tel}</a></dd>` : ""}
        ${ct?.email ? html`<dt>${t("cdir.email")}</dt><dd><a class="cdir-mail" href="mailto:${ct.email}">${ct.email}</a></dd>` : ""}
      </dl>
      ${contacts && !ct && !(kind === "D" && !node.cdco) ? html`<p class="dim cdir-small">${t("cdir.info.noContact")}</p>` : ""}`;
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
    $(".cdir-mapcard", el).hidden = true;
  }
  /** Colours the map for a node: the chosen one, or the one under the mouse in the tree (painted the same way). */
  function paintMap(key = sel) {
    if (!mapOk) return;
    const { lg, d: dsel } = placeOf(key);
    $$(".cdir-dep", svg).forEach((p) => {
      const d = deptOfFeat(p.dataset.feat);
      p.classList.toggle("in", !!lg && ligueOfDept.get(d) === lg);
      p.classList.toggle("on", d === dsel || (!!lg && !dsel && ligueOfDept.get(d) === lg));
    });
  }

  // ---- the selection, in step on the tree, the card and the map
  function showInfo(on) {
    root.classList.toggle("show-info", on);
    if (on) { window.scrollTo({ top: Math.max(0, root.getBoundingClientRect().top + scrollY - 70) }); }
  }
  function choose(key, { toggle = false, from = "tree" } = {}) {
    if (from === "map") open.clear();          // (the map's choice alone open in the tree: no hunt for it)
    if (key.startsWith("C:")) { /* a club: no branch of its own */ }
    else if (toggle && sel === key && open.has(key)) open.delete(key);
    else open.add(key);
    openTo(key);
    sel = key;
    drawTree(); drawCard(); paintMap();
    if (narrow.matches) showInfo(true);
    else if (from === "map") reveal(key);
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
  // the node under the mouse (or the keyboard's focus) lights up on the map, as a chosen one does
  let hovered = null;
  const preview = (ev) => {
    const k = ev.target.closest?.("[data-key]")?.dataset.key || null;
    if (k === hovered) return;
    hovered = k;
    paintMap(k || sel);
  };
  tree.addEventListener("pointerover", preview);
  tree.addEventListener("focusin", preview);
  tree.addEventListener("pointerleave", () => { hovered = null; paintMap(); });
  tree.addEventListener("focusout", (ev) => { if (!tree.contains(ev.relatedTarget)) { hovered = null; paintMap(); } });
  $(".cdir-back", el).addEventListener("click", () => {
    showInfo(false);
    if (sel) requestAnimationFrame(() => tree.querySelector(`[data-key="${CSS.escape(sel)}"] > .cdir-row`)?.scrollIntoView({ block: "center" }));
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
      const cur = placeOf(sel).lg;
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

  drawTree(); drawCard(); paintMap();
  if (sel) requestAnimationFrame(() => reveal(sel));
  // the figures, once the ranking's files are in
  if (month) {
    clubStats(method, month).then((s) => {
      if (!el.isConnected) return;
      stats = s;
      computeFigs();
      drawTree(); drawCard();
    }).catch(() => {});
  }
  return { title: `${t("cl.title")} · ${t("cl.view.annuaire")}` };
}

// « Annuaire » (Stats › Clubs, ?onglet=annuaire; owner, 2026-10-31): every club FFCO lists with its website, as a tree —
// the ligues, each with its website, their départements with their committee's (CDCO), their clubs with their own — beside a
// map of France's ligues and départements. A node chosen in the tree lights up on the map with what it holds (a ligue its
// départements, a département its own area), the map zooming to it; a click on the map chooses the ligue, a second one inside
// it the département, and opens that node in the tree. A website FFCO does not give is said (« site non trouvé »), as is a
// département without a committee. The data: France's clubdir.json, from FFCO's structure pages and club directory, read
// again every week by the provisional results' runs (ffco_scraper/prov/clubdir.py); the map: geo/departements.json and
// geo/regions.json (as the runner's « Carte »).

import { html, raw, $, $$, fmt, normalise, debounce } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { tile, setLede } from "../ui.js";
import { link, replaceQuery } from "../app.js";
import { featuresOf } from "../geo.js";

const SVG = "http://www.w3.org/2000/svg";
const geoCache = new Map();
const geo = (kind) => {
  if (!geoCache.has(kind)) geoCache.set(kind, fetch(`assets/geo/${kind}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return geoCache.get(kind);
};

/** A website shown short: its host and path, without the scheme, « www. » and a final slash. */
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const siteCell = (site, none, src) => (site
  ? html`<a class="cdir-site" href="${site}" target="_blank" rel="noopener noreferrer" title="${site}">${shortUrl(site)}</a>${
    src === "agenda" ? html` <span class="cdir-src" title="${t("cdir.fromAgenda.tip")}">${t("cdir.fromAgenda")}</span>` : ""}`
  : html`<span class="cdir-none">${none}</span>`);

export async function render(el, { query }) {
  setLede(t("cdir.lede"));
  const [dir, deps, regs] = await Promise.all([data.countryJson("FR", "clubdir.json"), geo("departements"), geo("regions")]);
  if (!dir?.ligues?.length) {
    el.innerHTML = html`<div class="notice info">${t("cdir.none")}</div>`;
    return { title: `${t("cl.title")} · ${t("cl.view.annuaire")}` };
  }
  const known = data.meta()?.names?.clubs || {};
  // the nodes: "L:AR" a ligue, "D:69" a département; each département's ligue
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
        <p class="dim cdir-foot">${t("cdir.source")}</p>
      </section>
      <section class="card cdir-side">
        <div class="cdir-mapbox">
          <div class="cdir-tools"><button type="button" class="btn btn-sm" data-zoom="all" title="${t("cdir.map.all")}" aria-label="${t("cdir.map.all")}">⤢</button></div>
          <svg class="cdir-map" xmlns="${SVG}" role="img" aria-label="${t("cdir.map.title")}" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="cdir-tip" hidden></div>
        </div>
        <p class="cdir-caption"></p>
        <p class="dim cdir-hint">${t("cdir.map.hint")}</p>
      </section>
    </div>`;
  const tree = $(".cdir-tree", el), svg = $(".cdir-map", el), tip = $(".cdir-tip", el);

  // ---- the tree
  const count = (n, one, other) => `${fmt(n)} ${n === 1 ? one : other}`;
  const clubRow = (cl) => html`<li class="cdir-club" role="treeitem">
      <span class="cdir-code">${cl.code}</span>
      ${known[cl.code] ? html`<a class="cdir-name" href="${link.club(cl.code)}">${cl.name}</a>` : html`<span class="cdir-name">${cl.name}</span>`}
      ${siteCell(cl.site, t("cdir.noSite"), cl.src)}</li>`;
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
          <button type="button" class="cdir-tog" data-tog="${lk}" aria-label="${lOpen ? t("cdir.close") : t("cdir.open")}">${lOpen ? "▾" : "▸"}</button>
          <button type="button" class="cdir-pick" data-pick="${lk}" aria-pressed="${sel === lk}">${lg.name}</button>
          <span class="cdir-meta">${count(lg.depts.length, t("cdir.dept.one"), t("cdir.dept.other"))} · ${count(nClubs, t("cdir.club.one"), t("cdir.club.other"))}</span>
          ${siteCell(lg.site, t("cdir.noSite"))}
        </div>
        ${lOpen ? html`<ul class="cdir-kids" role="group">${ds.map(({ d, clubs }) => {
          const dk = `D:${d.code}`, dOpen = open.has(dk) || (!!qn && clubs.length > 0);
          return html`<li class="cdir-node cdir-d${sel === dk ? " sel" : ""}" role="treeitem" aria-expanded="${dOpen}" data-key="${dk}">
            <div class="cdir-row">
              <button type="button" class="cdir-tog" data-tog="${dk}" aria-label="${dOpen ? t("cdir.close") : t("cdir.open")}">${dOpen ? "▾" : "▸"}</button>
              <button type="button" class="cdir-pick" data-pick="${dk}" aria-pressed="${sel === dk}"><span class="cdir-code">${d.code}</span> ${d.name}</button>
              <span class="cdir-meta">${count(d.clubs.length, t("cdir.club.one"), t("cdir.club.other"))}</span>
              ${d.cdco ? html`<span class="cdir-who">${t("cdir.cdco")}</span>${siteCell(d.site, t("cdir.noSite"))}` : html`<span class="cdir-none">${t("cdir.noCdco")}</span>`}
            </div>
            ${dOpen ? (clubs.length ? html`<ul class="cdir-kids" role="group">${clubs.map(clubRow)}</ul>`
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

  // ---- the map: the départements filled, the ligues' borders over them
  const feats = deps?.features || [];
  let mapOk = feats.length > 0;
  let full = null;
  const proj = (() => {
    let W = 180, E = -180, S = 90, N = -90;
    const each = (g, f) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach((poly) => poly.forEach((ring) => ring.forEach(f)));
    for (const ft of feats) each(ft.geometry, ([x, y]) => { W = Math.min(W, x); E = Math.max(E, x); S = Math.min(S, y); N = Math.max(N, y); });
    const cos = Math.cos(((S + N) / 2) * Math.PI / 180), K = 1000 / Math.max((E - W) * cos, N - S);
    full = { x: -10, y: -10, w: (E - W) * cos * K + 20, h: (N - S) * K + 20 };
    return { X: (x) => (x - W) * cos * K, Y: (y) => (N - y) * K, each };
  })();
  const boxes = new Map();                       // feature code -> [x0, y0, x1, y1]
  const pathOf = (g, code) => {
    let d = "", b = boxes.get(code) || [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of (g.type === "Polygon" ? [g.coordinates] : g.coordinates)) {
      for (const ring of poly) {
        ring.forEach(([x, y], i) => {
          const px = proj.X(x), py = proj.Y(y);
          b = [Math.min(b[0], px), Math.min(b[1], py), Math.max(b[2], px), Math.max(b[3], py)];
          d += `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
        });
        d += "Z";
      }
    }
    if (code) boxes.set(code, b);
    return d;
  };
  // a map feature's directory département ('2A' -> '20')
  const deptOfFeat = (code) => (code === "2A" || code === "2B" ? "20" : code);
  if (mapOk) {
    svg.setAttribute("viewBox", `${full.x} ${full.y} ${full.w} ${full.h}`);
    const ligueOfFeat = (code) => ligueOfDept.get(deptOfFeat(code)) || null;
    svg.innerHTML = [
      ...feats.map((ft) => {
        const code = ft.properties.code, lg = ligueOfFeat(code);
        return `<path class="cdir-dep${lg ? "" : " off"}" data-feat="${code}" d="${pathOf(ft.geometry, code)}"/>`;
      }),
      ...(regs?.features || []).map((ft) => `<path class="cdir-lig" d="${pathOf(ft.geometry, `R:${ft.properties.code}`)}"/>`),
    ].join("");
  } else {
    $(".cdir-side", el).hidden = true;
  }
  const boxOf = (key) => {
    const codes = key.startsWith("L:") ? ligues.get(key.slice(2)).depts.flatMap((d) => featuresOf(d.code))
      : featuresOf(key.slice(2));
    let b = null;
    for (const c of codes) {
      const x = boxes.get(c);
      if (x) b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x;
    }
    return b;
  };
  function zoomTo(key) {
    if (!mapOk) return;
    const b = key && boxOf(key.startsWith("D:") ? `L:${ligueOfDept.get(key.slice(2))}` : key);
    if (!b) { svg.setAttribute("viewBox", `${full.x} ${full.y} ${full.w} ${full.h}`); return; }
    const m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.12 + 10;
    svg.setAttribute("viewBox", `${b[0] - m} ${b[1] - m} ${b[2] - b[0] + 2 * m} ${b[3] - b[1] + 2 * m}`);
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
    const cap = $(".cdir-caption", el);
    cap.textContent = !sel ? t("cdir.map.pick") : dsel ? `${depts.get(dsel).name} · ${ligues.get(lg).name}` : ligues.get(lg).name;
  }

  // ---- the selection, in step on both sides
  function choose(key, { toggle = false, from = "tree" } = {}) {
    if (from === "map") open.clear();          // (the map's choice alone open in the tree: no hunt for it)
    if (toggle && sel === key && open.has(key)) open.delete(key);
    else open.add(key);
    if (key.startsWith("D:")) open.add(`L:${ligueOfDept.get(key.slice(2))}`);
    const ligueChanged = !sel || (sel.startsWith("L:") ? sel.slice(2) : ligueOfDept.get(sel.slice(2)))
      !== (key.startsWith("L:") ? key.slice(2) : ligueOfDept.get(key.slice(2)));
    sel = key;
    drawTree(); paintMap();
    if (ligueChanged) zoomTo(sel);
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
    $("[data-zoom]", el).addEventListener("click", () => zoomTo(null));
  }

  drawTree(); paintMap(); zoomTo(sel);
  if (sel) requestAnimationFrame(() => reveal(sel));
  return { title: `${t("cl.title")} · ${t("cl.view.annuaire")}` };
}

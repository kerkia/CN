// Who runs with whom. Around one runner: the people met most often on the same
// circuit, how the head-to-head went, and how those people are linked to each
// other. Globally: the leading runners of a discipline and who races whom.

import { html, raw, esc, $, $$, fmt, fmtDate, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { networkChart, css } from "../charts.js";
import {
  terrainSeg, bindTerrainSeg, chartCard, bindChartCard, legend, dataTable, tile,
  methodLabel, seg, runnerSearch, bindRunnerSearch, errorBox, methodSeg, bindMethodSeg,
} from "../ui.js";
import { loadRanking } from "./ranking.js";
import { R, C } from "../data.js";
import { link, replaceQuery } from "../app.js";
import { modeSwitch, bindModeSwitch } from "./netmodes.js";

const NET = { lic: 0, shared: 1, ahead: 2, behind: 3, last: 4 };
const surname = (nom) => {
  const d = displayName(nom).split(" ");
  return d.length > 1 ? d.slice(1).join(" ") : d[0];
};
const scale = (v, lo, hi, a, b) => (hi > lo ? a + ((v - lo) / (hi - lo)) * (b - a) : (a + b) / 2);

// ---- periods -------------------------------------------------------------------
const seasonsDesc = () => data.meta().seasons.map(String).reverse();
const periodSelect = (season) => html`<label class="field"><span>${t("nw.period")}</span><select id="period">
  <option value="">${t("nw.allSeasons")}</option>
  ${seasonsDesc().map((y) => html`<option value="${y}" ${raw(y === season ? "selected" : "")}>${t("f.season")} ${y}</option>`)}</select></label>`;
const seasonEnd = (y) => data.meta().months.filter((m) => m.startsWith(y)).pop() || data.latestMonth();

/** Circuits a runner ran, optionally within one season and one discipline. */
async function circuitsOf(lic, season, terrain) {
  const races = await data.runnerRaces(lic);
  return new Set(races.filter((r) => (!season || r[R.date].startsWith(season)) && (!terrain || r[R.terrain] === terrain))
    .map((r) => r[R.cid]));
}
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

/** Club number, linked to the club page, full name on hover. */
const clubCode = (club) => {
  const code = data.clubParts(club).code;
  return code ? html`<a href="${link.club(code)}" title="${data.clubName(club)}">${code}</a>` : "";
};

/**
 * Co-runners over one season, from that season's results — same shape as the
 * all-time lists: [[licence, shared, ahead, behind, last met]].
 */
async function coRunnersIn(lic, season) {
  const races = (await data.runnerRaces(lic)).filter((r) => r[R.date].startsWith(season));
  const byCourse = new Map();
  for (const r of races) {
    if (!byCourse.has(r[R.course])) byCourse.set(r[R.course], new Set());
    byCourse.get(r[R.course]).add(r[R.cid]);
  }
  const ids = [...byCourse.keys()];
  const files = await Promise.all(ids.map((id) => data.course(id)));
  const acc = new Map();
  const place = (r) => (r[C.status] === "ok" && r[C.place] ? r[C.place] : Infinity);
  files.forEach((f, i) => {
    const mine = byCourse.get(ids[i]), date = data.comp(ids[i])?.date || "";
    for (const circ of f?.circuits || []) {
      if (!mine.has(circ.id)) continue;
      const me = circ.rows.find((r) => r[C.lic] === lic);
      if (!me) continue;
      const pMe = place(me);
      for (const r of circ.rows) {
        if (r[C.lic] === lic) continue;
        const x = acc.get(r[C.lic]) || [r[C.lic], 0, 0, 0, ""];
        const p = place(r);
        x[1]++;
        if (pMe < p) x[2]++; else if (p < pMe) x[3]++;
        if (date > x[4]) x[4] = date;
        acc.set(r[C.lic], x);
      }
    }
  });
  return [...acc.values()].filter((x) => x[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30);
}

export async function render(main, { arg: lic, query }) {
  if (!lic && query.vue === "territoires") return (await import("./territory.js")).render(main, query);
  // no runner in the address: the current runner, unless the leaders' view was asked for
  const who = lic || (query.vue !== "meilleurs" && store.get().lastRunner);
  return who ? ego(main, who, query) : global(main, query);
}

// ---- around one runner ---------------------------------------------------------
async function ego(main, lic, query) {
  const person = data.runner(lic);
  if (!person) { main.innerHTML = errorBox(t("err.notfound")); return; }
  store.set({ lastRunner: lic });
  const season = seasonsDesc().includes(query.s) ? query.s : "";
  const list = season ? await coRunnersIn(lic, season) : await data.coRunners(lic);
  let k = [10, 20, 30].includes(Number(query.k)) ? Number(query.k) : 20;
  let links2 = query.l2 !== "0";
  const myClub = data.clubParts(person.club).code;
  const name = displayName(person.nom);

  main.innerHTML = html`
    <div class="crumbs"><a href="${link.runner(lic)}">${name}</a><span>›</span><span>${t("nw.title")}</span></div>
    <div class="page-head"><div><h1>${t("nw.title")} · ${name}</h1><p class="lede">${t("nw.lede.ego")}</p></div>
      ${modeSwitch("ego")}</div>
    <section class="card" style="margin-bottom:16px"><div class="card-body row">
      ${runnerSearch("nw-search", t("nw.search"))}
      <a class="btn btn-sm" href="${link.runner(lic)}">${t("pg.toRunner")}</a>
    </div></section>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <div class="grid grid-main-side" style="margin-bottom:16px;align-items:start">
      ${chartCard({ id: "net", title: t("nw.graph"), hint: t("nw.graph.hint"), tall: true })}
      <section class="card"><div class="card-head"><div><h2>${t("nw.rivals")}</h2><div class="hint">${t("nw.rivals.hint")}</div></div></div>
        <div id="rivals"></div></section>
    </div>
    <section class="card"><div class="card-head"><h2>${t("nw.list")}</h2></div><div id="list"></div></section>`;
  bindChartCard(main, "net");
  bindRunnerSearch($("#nw-search"), { onPick: (l) => { location.hash = link.network(l); } });
  bindModeSwitch(main);

  if (!list.length) {
    $("#filters").innerHTML = html`${periodSelect(season)}`;
    $("#period").addEventListener("change", (e) => { location.hash = link.network(lic, { s: e.target.value || null }); });
    $("#net").innerHTML = html`<div class="empty">${t("nw.none")}</div>`;
    return { title: `${t("nw.title")} · ${name}` };
  }

  const rows = list.map((x) => {
    const r = data.runner(x[NET.lic]);
    return { lic: x[NET.lic], r, name: displayName(r?.nom || x[NET.lic]), club: r?.club, code: data.clubParts(r?.club).code,
      shared: x[NET.shared], ahead: x[NET.ahead], behind: x[NET.behind], last: x[NET.last] };
  });

  // tiles: the most frequent co-runner, the one you beat most, the one who beats you most
  const often = rows[0];
  const pool = rows.filter((x) => x.shared >= 5);
  const prey = pool.reduce((b, x) => (!b || x.ahead / x.shared > b.ahead / b.shared ? x : b), null);
  const nemesis = pool.reduce((b, x) => (!b || x.behind / x.shared > b.behind / b.shared ? x : b), null);
  const bilan = (x) => `${fmt(x.ahead)} – ${fmt(x.behind)} ${t("nw.over")} ${fmt(x.shared)}`;
  $("#tiles").innerHTML = html`
    ${tile(t("nw.often"), often.name, `${fmt(often.shared)} ${t("nw.shared")}`)}
    ${tile(t("nw.prey"), prey ? prey.name : "—", prey ? bilan(prey) : t("nw.min5"))}
    ${tile(t("nw.nemesis"), nemesis ? nemesis.name : "—", nemesis ? bilan(nemesis) : t("nw.min5"))}
    ${tile(t("nw.sameClub"), fmt(rows.filter((x) => x.code && x.code === myClub).length), `${t("nw.amongTop")} ${fmt(rows.length)}`)}`;

  function drawFilters() {
    $("#filters").innerHTML = html`
      ${periodSelect(season)}
      <div class="field"><span>${t("nw.k")}</span>${seg("k", [["10", "10"], ["20", "20"], ["30", "30"]], String(k))}</div>
      <label class="checkline"><input type="checkbox" id="l2" ${raw(links2 ? "checked" : "")}>${t("nw.links2")}</label>`;
    $$('[data-seg="k"]').forEach((b) => b.addEventListener("click", () => { k = Number(b.dataset.value); drawFilters(); draw(); }));
    $("#l2").addEventListener("change", (e) => { links2 = e.target.checked; draw(); });
    $("#period").addEventListener("change", (e) => { location.hash = link.network(lic, { s: e.target.value || null, k: k === 20 ? null : k }); });
  }

  async function draw() {
    replaceQuery({ s: season || null, k: k === 20 ? null : k, l2: links2 ? null : "0" });
    const top = rows.slice(0, k);
    const inSet = new Set(top.map((x) => x.lic));
    const cSame = css("--s1"), cOther = css("--s2"), cMe = css("--ink");
    const lo = Math.min(...top.map((x) => x.shared)), hi = Math.max(...top.map((x) => x.shared));
    const nodes = [
      { id: lic, name, short: surname(person.nom), size: 30, color: cMe, pin: true, meta: { me: true } },
      ...top.map((x) => ({
        id: x.lic, name: x.name, short: surname(x.r?.nom || x.lic), size: scale(x.shared, lo, hi, 12, 26),
        color: x.code && x.code === myClub ? cSame : cOther, meta: x,
      })),
    ];
    const links = top.map((x) => ({ source: lic, target: x.lic, value: x.shared, width: scale(x.shared, lo, hi, 1, 5) }));
    if (links2 && season) {
      // within a season, links between co-runners come from their own circuits that season
      const sets = await Promise.all(top.map((x) => circuitsOf(x.lic, season)));
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const w = overlap(sets[i], sets[j]);
        if (w >= 2) links.push({ source: top[i].lic, target: top[j].lic, value: w, width: scale(w, lo, hi, 0.5, 2), opacity: 0.16 });
      }
    } else if (links2) {
      const lists = await Promise.all(top.map((x) => data.coRunners(x.lic)));
      const seen = new Set();
      lists.forEach((l, i) => {
        for (const y of l) {
          if (!inSet.has(y[NET.lic])) continue;
          const a = top[i].lic, b = y[NET.lic], key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // secondary links stay faint: the graph is about the runner at the centre
          links.push({ source: a, target: b, value: y[NET.shared], width: scale(y[NET.shared], lo, hi, 0.5, 2), opacity: 0.16 });
        }
      });
    }
    $("#net-legend").innerHTML = legend([
      { color: cMe, label: name, dot: true },
      { color: cSame, label: t("nw.sameClubL"), dot: true },
      { color: cOther, label: t("nw.otherClub"), dot: true },
    ]);
    const nameOf = (id) => nodes.find((n) => n.id === id)?.name || id;
    networkChart($("#net"), {
      nodes, links,
      onClick: (id) => { if (id !== lic) location.hash = link.network(id, { k }); },
      tip: (n) => (n.meta?.me ? `<b>${esc(n.name)}</b>` : `<b>${esc(n.name)}</b><br><span style="color:var(--ink-3)">${esc(data.clubName(n.meta.club))}</span>
        <br>${fmt(n.meta.shared)} ${t("nw.shared")} · ${t("nw.ahead")} ${fmt(n.meta.ahead)} · ${t("nw.behind")} ${fmt(n.meta.behind)}
        <br><span style="color:var(--ink-3)">${t("nw.clickRecenter")}</span>`),
      edgeTip: (l) => `${esc(nameOf(l.source))} — ${esc(nameOf(l.target))}<br><b>${fmt(l.value)}</b> ${t("nw.shared")}`,
    });
    const tableRows = (xs) => html`<table class="data compact"><thead><tr><th>${t("rk.col.name")}</th><th>${t("rk.col.club")}</th><th class="r">${t("nw.sharedShort")}</th>
      <th class="r">${t("nw.ahead")}</th><th class="r">${t("nw.behind")}</th></tr></thead><tbody>${xs.map((x) => html`<tr>
      <td><a href="${link.runner(x.lic)}">${x.name}</a></td><td class="num">${clubCode(x.club)}</td><td class="r num">${fmt(x.shared)}</td>
      <td class="r num">${fmt(x.ahead)}</td><td class="r num">${fmt(x.behind)}</td></tr>`)}</tbody></table>`;
    $("#net-table").innerHTML = tableRows(top);
    // closest rivals: often met and evenly matched
    const rivals = rows.filter((x) => x.shared >= 5)
      .map((x) => ({ ...x, balance: Math.abs(x.ahead - x.behind) / x.shared }))
      .sort((a, b) => a.balance - b.balance || b.shared - a.shared).slice(0, 8);
    $("#rivals").innerHTML = rivals.length ? html`<div class="table-wrap">${tableRows(rivals)}</div>` : html`<div class="empty">${t("nw.min5")}</div>`;
  }

  dataTable($("#list"), {
    rows, sortKey: "shared", sortDir: -1,
    columns: [
      { key: "name", label: t("rk.col.name"), sort: (x) => x.name, defaultDir: 1,
        render: (x) => html`<a class="name" href="${link.runner(x.lic)}">${x.name}</a>` },
      { key: "code", label: t("nw.clubNo"), cls: "num", sort: (x) => x.code, defaultDir: 1, render: (x) => clubCode(x.club) },
      { key: "club", label: t("rk.col.club"), render: (x) => (x.code ? html`<a href="${link.club(x.code)}">${data.clubName(x.club)}</a>` : x.club || "") },
      { key: "cat", label: t("rk.col.cat"), render: (x) => x.r?.cat || "" },
      { key: "shared", label: t("nw.sharedShort"), align: "r", cls: "num", sort: (x) => x.shared, render: (x) => html`<b>${fmt(x.shared)}</b>` },
      { key: "ahead", label: t("nw.ahead"), align: "r", cls: "num", sort: (x) => x.ahead, render: (x) => fmt(x.ahead) },
      { key: "behind", label: t("nw.behind"), align: "r", cls: "num", sort: (x) => x.behind, render: (x) => fmt(x.behind) },
      { key: "last", label: t("nw.last"), align: "r", cls: "num", sort: (x) => x.last, render: (x) => fmtDate(x.last) },
      { key: "go", label: "", render: (x) => html`<a href="${link.network(x.lic)}" title="${t("nw.clickRecenter")}">${t("nav.network")}</a>` },
      { key: "cmp", label: t("nav.compare"), cls: "c", render: (x) => html`<input type="checkbox" data-sel="${x.lic}" ${raw(store.inCompare(x.lic) ? "checked" : "")} aria-label="${x.name}">` },
    ],
    onRender(el) {
      $$("[data-sel]", el).forEach((cb) => cb.addEventListener("change", () => {
        if (!store.toggleCompare(cb.dataset.sel)) { cb.checked = false; alert(t("cp.max")); }
      }));
    },
  });

  drawFilters();
  await draw();
  return { title: `${t("nw.title")} · ${name}` };
}

// ---- the leading runners of a discipline ---------------------------------------
async function global(main, query) {
  let method = store.METHODS.includes(query.m) ? query.m : store.get().methods[0];
  let sexe = ["H", "D", ""].includes(query.sexe) ? query.sexe : "H";
  let n = [30, 60, 100].includes(Number(query.n)) ? Number(query.n) : 60;
  let minShared = [3, 5, 10].includes(Number(query.min)) ? Number(query.min) : 5;
  let season = seasonsDesc().includes(query.s) ? query.s : "";

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nw.title")}</h1><p class="lede">${t("nw.lede.global")}</p></div>
      ${modeSwitch("leaders")}</div>
    <section class="card" style="margin-bottom:16px"><div class="card-body row">
      ${runnerSearch("nw-search", t("nw.search"))}<span class="muted" style="font-size:13.5px">${t("nw.searchHint")}</span>
    </div></section>
    <div class="filters" id="filters"></div>
    <div style="margin-bottom:16px">${chartCard({ id: "net", title: t("nw.graphGlobal"), hint: t("nw.graphGlobal.hint"), tall: true })}</div>
    <section class="card"><div class="card-head"><h2>${t("nw.nodes")}</h2></div><div id="list"></div></section>`;
  bindChartCard(main, "net");
  bindRunnerSearch($("#nw-search"), { onPick: (l) => { location.hash = link.network(l); } });
  bindModeSwitch(main);
  $("#net").style.height = "620px";

  function drawFilters() {
    $("#filters").innerHTML = html`
      ${periodSelect(season)}
      <div class="field"><span>${t("cm.method")}</span>${methodSeg(method)}</div>
      <div class="field"><span>${t("f.sexe")}</span>${seg("sexe", [["H", t("sexe.H")], ["D", t("sexe.D")], ["", t("sexe.all")]], sexe)}</div>
      <div class="field"><span>${t("nw.n")}</span>${seg("n", [["30", "30"], ["60", "60"], ["100", "100"]], String(n))}</div>
      <div class="field"><span>${t("nw.min")}</span>${seg("min", [["3", "3"], ["5", "5"], ["10", "10"]], String(minShared))}</div>`;
    bindMethodSeg(main, (m) => { method = m; drawFilters(); draw(); });
    $("#period").addEventListener("change", (e) => { season = e.target.value; drawFilters(); draw(); });
    const on = (name, fn) => $$(`[data-seg="${name}"]`).forEach((b) => b.addEventListener("click", () => { fn(b.dataset.value); drawFilters(); draw(); }));
    on("sexe", (v) => { sexe = v; });
    on("n", (v) => { n = Number(v); });
    on("min", (v) => { minShared = Number(v); });
  }

  let token = 0;
  async function draw() {
    const my = ++token;
    replaceQuery({ vue: "meilleurs", s: season || null, m: method, sexe: sexe === "H" ? null : sexe || "all", n: n === 60 ? null : n, min: minShared === 5 ? null : minShared });
    const terrain = store.get().terrain;
    $("#net").classList.add("loading-veil");
    // the leading runners at the end of the period, and the circuits they shared in it
    const { rows } = await loadRanking([method], terrain, season ? seasonEnd(season) : data.latestMonth());
    const top = rows.filter((r) => r.cn[method] != null && (!sexe || r.sexe === sexe))
      .sort((a, b) => b.cn[method] - a.cn[method]).slice(0, n);
    const sets = await Promise.all(top.map((r) => circuitsOf(r.lic, season, terrain)));
    if (my !== token) return;
    $("#net").classList.remove("loading-veil");
    const inSet = new Map(top.map((r, i) => [r.lic, i]));
    const edges = new Map();
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const w = overlap(sets[i], sets[j]);
      if (w >= minShared) {
        const a = top[i].lic, b = top[j].lic;
        edges.set(a < b ? `${a}|${b}` : `${b}|${a}`, w);
      }
    }
    const degree = new Map(), strongest = new Map();
    for (const [key, w] of edges) {
      for (const x of key.split("|")) {
        degree.set(x, (degree.get(x) || 0) + 1);
        const other = key.split("|").find((y) => y !== x);
        if (!strongest.has(x) || strongest.get(x)[1] < w) strongest.set(x, [other, w]);
      }
    }
    // colour by ligue: the seven most represented keep a slot, the rest are grouped
    const count = new Map();
    top.forEach((r) => { if (r.ligue) count.set(r.ligue, (count.get(r.ligue) || 0) + 1); });
    const ligues = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7).map(([l]) => l);
    const colorOf = (l) => (ligues.includes(l) ? css(`--s${ligues.indexOf(l) + 1}`) : css("--ink-3"));
    const cns = top.map((r) => r.cn[method]);
    const lo = Math.min(...cns), hi = Math.max(...cns);
    const wmax = Math.max(1, ...edges.values());
    const nodes = top.map((r) => ({
      id: r.lic, name: r.name, short: surname(r.nom), size: scale(r.cn[method], lo, hi, 9, 26),
      color: colorOf(r.ligue), meta: r,
    }));
    const links = [...edges.entries()].map(([key, w]) => {
      const [a, b] = key.split("|");
      return { source: a, target: b, value: w, width: scale(w, minShared, wmax, 0.5, 4) };
    });
    $("#net-legend").innerHTML = legend([
      ...ligues.map((l) => ({ color: colorOf(l), label: `${data.ligueName(l)} (${count.get(l)})`, dot: true })),
      ...(count.size > ligues.length ? [{ color: css("--ink-3"), label: t("nw.otherLigues"), dot: true }] : []),
    ]);
    const nameOf = (id) => top[inSet.get(id)]?.name || id;
    networkChart($("#net"), {
      nodes, links,
      onClick: (id) => { location.hash = link.network(id); },
      tip: (nd) => `<b>${esc(nd.name)}</b> · ${fmt(nd.meta.cn[method])}<br><span style="color:var(--ink-3)">${esc(data.clubName(nd.meta.club))} · ${esc(nd.meta.cat)}</span>
        <br>${fmt(degree.get(nd.id) || 0)} ${t("nw.links")}<br><span style="color:var(--ink-3)">${t("nw.clickEgo")}</span>`,
      edgeTip: (l) => `${esc(nameOf(l.source))} — ${esc(nameOf(l.target))}<br><b>${fmt(l.value)}</b> ${t("nw.shared")}`,
    });
    const tbl = top.map((r, i) => ({ r, pos: i + 1, deg: degree.get(r.lic) || 0, strong: strongest.get(r.lic) }));
    $("#net-table").innerHTML = html`<table class="data compact"><thead><tr><th>#</th><th>${t("rk.col.name")}</th><th>${t("rk.col.club")}</th><th class="r">CN</th>
      <th class="r">${t("nw.links")}</th><th>${t("nw.strongest")}</th></tr></thead><tbody>${tbl.map((x) => html`<tr><td class="num">${x.pos}</td>
      <td>${x.r.name}</td><td class="num">${clubCode(x.r.club)}</td><td class="r num">${fmt(x.r.cn[method])}</td><td class="r num">${fmt(x.deg)}</td>
      <td>${x.strong ? `${nameOf(x.strong[0])} (${fmt(x.strong[1])})` : "—"}</td></tr>`)}</tbody></table>`;
    dataTable($("#list"), {
      rows: tbl, sortKey: "pos", sortDir: 1,
      columns: [
        { key: "pos", label: "#", cls: "rank num", sort: (x) => x.pos, defaultDir: 1 },
        { key: "name", label: t("rk.col.name"), sort: (x) => x.r.name, defaultDir: 1,
          render: (x) => html`<span class="dot" style="background:${raw(colorOf(x.r.ligue))};margin-right:7px"></span><a class="name" href="${link.network(x.r.lic)}">${x.r.name}</a>` },
        { key: "code", label: t("nw.clubNo"), cls: "num", sort: (x) => x.r.clubCode, defaultDir: 1, render: (x) => clubCode(x.r.club) },
        { key: "club", label: t("rk.col.club"), render: (x) => data.clubName(x.r.club) },
        { key: "cat", label: t("rk.col.cat"), render: (x) => x.r.cat },
        { key: "cn", label: "CN", align: "r", cls: "num", sort: (x) => x.r.cn[method], render: (x) => fmt(x.r.cn[method]) },
        { key: "deg", label: t("nw.links"), align: "r", cls: "num", sort: (x) => x.deg, render: (x) => fmt(x.deg) },
        { key: "strong", label: t("nw.strongest"), render: (x) => (x.strong ? html`<a href="${link.runner(x.strong[0])}">${nameOf(x.strong[0])}</a> <span class="dim num">${fmt(x.strong[1])}</span>` : "—") },
      ],
    });
  }

  drawFilters();
  await draw();
  return { title: t("nw.title") };
}

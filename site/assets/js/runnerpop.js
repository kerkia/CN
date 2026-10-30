// A runner's window over a race's results (owner, 2026-10-30: « Résultats » and « Analyse de course », as « En direct » since
// 2026-10-26): a name in a table opens it instead of leading to the runner's page, which is Stats' — Arena's pages never
// lead into another module. For the method chosen in the header only: in each discipline the runner has a value in or raced
// in over 3 years (the race's own first), their value today, their place overall and in their category, their races and
// mispunch rate over 12 months, their podiums and wins over 3 years. ✕, « Fermer », Échap or a tap beside it close it.
// Mark a name with `data-runner-pop="<licence>"` (and `data-name`, `data-club`, `data-cat`, `data-terrain`); `bindRunnerPop`
// opens the window on a click.

import { html, fmt, fmtDate, fmtCat, ord, pctN, addDays } from "./util.js";
import { t, tn } from "./i18n.js";
import * as data from "./data.js";
import * as store from "./store.js";
import { cnLabel } from "./ui.js";
import { loadRanking } from "./pages/ranking.js";

const TERRAINS = ["For", "Spr", "VTT", "Ski"];
const rankings = new Map(), facts = new Map();
const rankingOf = (terrain, m) => {
  const k = `${terrain}|${m}`;
  if (!rankings.has(k)) rankings.set(k, loadRanking([m], terrain, data.latestMonth()).catch(() => null));
  return rankings.get(k);
};

/** A runner's figures in each discipline for method m: { month, out: [{ terrain, cn, rank, n, cat, catRank, catN, pm, podiums, wins }] }. */
export function runnerFacts(lic, m) {
  const k = `${data.loadedCountry()}|${lic}|${m}`;
  if (!facts.has(k)) facts.set(k, (async () => {
    const [races, ...rks] = await Promise.all([data.runnerRaces(lic).catch(() => []), ...TERRAINS.map((tr) => rankingOf(tr, m))]);
    const month = data.latestMonth(), from3 = addDays(month, -3 * 365);
    const out = TERRAINS.map((terrain, i) => {
      const rk = rks[i], me = rk?.rows.find((r) => r.lic === String(lic)), cn = me?.cn[m] ?? null;
      const last3 = races.filter((r) => r[data.R.terrain] === terrain && r[data.R.date] > from3);
      if (cn == null && !last3.length) return null;
      const all = cn == null ? [] : rk.rows.filter((r) => r.cn[m] != null), cat = cn != null && me.cat ? all.filter((r) => r.cat === me.cat) : [];
      return { terrain, cn, rank: me?.rank[m] ?? null, n: all.length, cat: me?.cat || "", catRank: cat.length ? 1 + cat.filter((r) => r.cn[m] > cn).length : null,
        catN: cat.length, pm: data.pmRate(races, terrain, month), podiums: last3.filter((r) => r[data.R.place] && r[data.R.place] <= 3).length,
        wins: last3.filter((r) => r[data.R.place] === 1).length };
    }).filter(Boolean);
    return { month, out };
  })());
  return facts.get(k);
}

/** The figures' blocks (the discipline `terrain` first), or a line saying there are none. */
export async function factsHtml(lic, terrain) {
  if (!lic || !data.isPrivateLoaded()) return html`<p class="muted lv-pop-none">${t("lv.pop.noRank")}</p>`;
  const m = store.get().method, f = await runnerFacts(lic, m);
  const list = [...f.out].sort((a, b) => (b.terrain === terrain) - (a.terrain === terrain));
  return list.length ? html`<div class="lv-pop-sub muted">${t("lv.pop.asOf", { cn: cnLabel(m), d: fmtDate(f.month) })}</div>
    ${list.map((d) => html`<div class="lv-pop-d${d.terrain === terrain ? " here" : ""}">
      <div class="lv-pop-dh"><span>${t(`terrain.${d.terrain}`)}</span><b>${d.cn != null ? fmt(d.cn) : html`<span class="muted">${t("rn.unranked")}</span>`}</b></div>
      ${d.cn != null ? html`<div>${t("lv.pop.rank", { r: ord(d.rank), n: fmt(d.n) })}${d.catRank ? html` · ${t("lv.pop.catRank", { r: ord(d.catRank), n: fmt(d.catN), cat: fmtCat(d.cat) })}` : ""}</div>` : ""}
      <div class="muted">${tn("lv.pop.races", d.pm.n)}${d.pm.n ? ` · ${t("lv.pop.pm", { p: pctN((100 * d.pm.pm) / d.pm.n) })}` : ""} · ${tn("lv.pop.pods", d.podiums)}${
        d.wins ? ` ${tn("lv.pop.wins", d.wins)}` : ""}</div></div>`)}`
    : html`<p class="muted lv-pop-none">${t("lv.pop.nothing")}</p>`;
}

/** Open the window for a runner: { lic, name, club, cat, terrain }. */
export async function openRunnerPop(main, x) {
  let dlg = main.querySelector("#rn-pop");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "rn-pop"; dlg.className = "lv-pop";
    dlg.innerHTML = `<div class="lv-pop-in"></div>`;
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-pop-close]")) dlg.close(); });
    main.append(dlg);
  }
  const head = html`<div class="lv-pop-h"><div><div class="lv-pop-n">${x.name}</div><div class="muted">${x.club || ""}${x.cat ? ` · ${fmtCat(x.cat)}` : ""}</div></div>
    <button type="button" class="lv-pop-x" data-pop-close aria-label="${t("lv.pop.close")}" title="${t("lv.pop.close")}">✕</button></div>`;
  const foot = html`<div class="lv-pop-f"><button type="button" class="btn btn-sm btn-primary" data-pop-close>${t("lv.pop.close")}</button></div>`;
  const want = Symbol("pop");
  dlg._want = want;
  dlg.querySelector(".lv-pop-in").innerHTML = html`${head}<p class="muted">${t("lv.loading")}</p>${foot}`;
  if (!dlg.open) dlg.showModal();
  const body = await factsHtml(x.lic, x.terrain);
  if (dlg._want === want) dlg.querySelector(".lv-pop-in").innerHTML = html`${head}${body}${foot}`;
}

/** Names marked data-runner-pop in `main` open the window. */
export function bindRunnerPop(main, terrainOf = () => null) {
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-runner-pop]");
    if (!b || e.target.closest("#rn-pop")) return;
    e.preventDefault();
    openRunnerPop(main, { lic: b.dataset.runnerPop, name: b.dataset.name || b.textContent.trim(), club: b.dataset.club || "",
      cat: b.dataset.cat || "", terrain: b.dataset.terrain || terrainOf() });
  });
}

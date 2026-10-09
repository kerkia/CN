// « Récemment »: the last 60 days' races and the results their organisers published (data/recent/, exported by O'CN
// without the CN, licences or scores). #/recemment — the list (discipline, region, search by race or runner, « Mes
// courses » from the name set in Réglages); #/recemment/<race>[/<doc>/<circuit>] — the results circuit by circuit;
// #/recemment/<race>/<doc>/<circuit>/<view>[/<runner>] — the split-time analyses (analysis.js).
import { t, fmtDay } from "./i18n.js";
import { settings, save, isMe, follows, toggleFollow, norm } from "./settings.js";
import { esc, clock, getData, segs } from "./util.js";
import * as an from "./analysis.js";

const SPECS = [["", "soon.all"], ["Forêt", "spec.forest"], ["Sprint", "spec.sprint"], ["VTT", "spec.mtb"], ["Ski", "spec.ski"]];
const SOURCE = { liveresultat: "liveresultat", winsplits: "WinSplits", heyries: "Orientation Data", helga: "Helga", site: "src.site", upload: "src.upload" };
const STATUS = { mp: "st.mp", dnf: "st.dnf", dsq: "st.dsq", ot: "st.ot", dns: "st.dns", nc: "st.nc" };
const nameKey = (s) => norm(s).split(" ").filter(Boolean).sort().join(" ");
const orgName = (o) => String(o || "").replace(/^\s*\w+\s*-\s*/, "");

export async function render(view, args) {
  const idx = await getData("recent/index.json");
  if (!idx) { view.innerHTML = `<header class="bar"><h1>${t("recent.title")}</h1></header><p class="muted pad">${t("data.none")}</p>`; return; }
  if (!args[0]) return list(view, idx);
  const race = await getData(`recent/${encodeURIComponent(args[0])}.json`);
  if (!race) { view.innerHTML = `<header class="bar"><a href="#/recemment" class="back">‹</a><h1>${t("recent.title")}</h1></header><p class="muted pad">${t("recent.gone")}</p>`; return; }
  if (args[3] && an.VIEWS.includes(args[3])) return analyse(view, race, Number(args[1]) || 0, Number(args[2]) || 0, args[3], args[4]);
  return results(view, race, args[1] != null ? Number(args[1]) : null, args[2] != null ? Number(args[2]) : null);
}

// ---- the races ---------------------------------------------------------------------------------------------------
async function list(view, idx) {
  const s = settings();
  let spec = s.recentSpec || "", region = s.recentRegion ?? (s.region || ""), q = "", mine = false, names = null;
  const me = s.first && s.last ? nameKey(`${s.first} ${s.last}`) : null;
  const regions = [...new Set(idx.races.map((r) => r.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  view.innerHTML = `<header class="bar"><h1>${t("recent.title")}</h1></header>
    <div class="pad"><input type="search" id="q" class="search" placeholder="${t("recent.search")}" autocomplete="off"></div>
    <div id="specs"></div>
    <div class="pad row2"><select id="region" class="select"><option value="">${t("soon.allRegions")}</option>
      ${regions.map((r) => `<option value="${esc(r)}" ${r === region ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
      ${me ? `<button class="chip" id="mine" aria-pressed="false">${t("recent.mine")}</button>` : ""}</div>
    <div id="list"></div>`;
  const need = async () => { if (!names) names = (await getData("recent/names.json")) || {}; return names; };
  async function draw() {
    view.querySelector("#specs").innerHTML = segs("spec", SPECS.map(([v, k]) => [v, t(k)]), spec);
    const n = norm(q);
    const byRunner = n.length >= 3 ? await need() : null;
    if (mine) await need();
    const runnerHit = (r) => byRunner && (byRunner[r.key] || []).some((k) => k.includes(n) || n.split(" ").every((w) => k.includes(w)));
    const kept = idx.races.filter((r) => (!spec || r.terrain === spec || (spec === "Forêt" && ["MD", "LD", "Nuit"].includes(r.epreuve) && !r.terrain))
      && (!region || r.region === region)
      && (!mine || (names[r.key] || []).includes(me))
      && (!n || norm(`${r.name} ${r.place || ""} ${r.org || ""}`).includes(n) || runnerHit(r)))
      .sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name, "fr"));
    const groups = new Map();
    for (const r of kept) (groups.get(r.date_iso) || groups.set(r.date_iso, []).get(r.date_iso)).push(r);
    view.querySelector("#list").innerHTML = kept.length ? [...groups].map(([d, rs]) => `<h2 class="sec">${fmtDay(d)}</h2>${rs.map((r) => {
      const has = r.docs > 0 && r.runners > 0;
      return `<${has ? `a href="#/recemment/${encodeURIComponent(r.key)}"` : "div"} class="item${has ? "" : " off"}"><div class="grow">
        <div class="name">${esc(r.name)}</div><div class="muted small">${esc([r.place, orgName(r.org)].filter(Boolean).join(" · "))}</div>
        <div class="tags">${has ? `<span class="tag ok">${t("recent.results")}</span>${r.splits ? `<span class="tag ok">${t("recent.splits")}</span>` : ""}`
          : `<span class="muted small">${t("recent.noResult")}</span>`}${runnerHit(r) ? `<span class="tag">${t("recent.runnerIn")}</span>` : ""}</div></div>
        ${has ? '<span class="chev" aria-hidden="true">›</span>' : ""}</${has ? "a" : "div"}>`;
    }).join("")}`).join("") : `<p class="muted pad">${t("recent.none")}</p>`;
  }
  view.querySelector("#q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  view.querySelector("#region").addEventListener("change", (e) => { region = e.target.value; save({ recentRegion: region }); draw(); });
  view.querySelector("#mine")?.addEventListener("click", (e) => { mine = !mine; e.target.classList.toggle("on", mine); e.target.setAttribute("aria-pressed", mine); draw(); });
  view.addEventListener("click", (e) => { const b = e.target.closest("[data-spec]"); if (b) { spec = b.dataset.spec; save({ recentSpec: spec }); draw(); } });
  draw();
}

// ---- one race: results circuit by circuit ----------------------------------------------------------------------------
// the document shown first: the one with you in it, else one with split times, else by circuit, else the biggest
const hasSplits = (k) => k.runners.some((r) => r.splits);
function firstDoc(docs) {
  const score = (d) => (d.classes.some((k) => k.runners.some((r) => isMe(r.name))) ? 1e6 : 0) + (d.classes.some(hasSplits) ? 1e5 : 0)
    + (d.by !== "category" ? 1e4 : 0) + d.classes.reduce((a, k) => a + k.runners.length, 0);
  return docs.reduce((best, d, i) => (score(d) > score(docs[best]) ? i : best), 0);
}

function results(view, race, di, ci) {
  const docs = race.docs;
  di = di != null && docs[di] ? di : firstDoc(docs);
  const doc = docs[di];
  if (!doc) { view.innerHTML = `<header class="bar"><a href="#/recemment" class="back">‹</a><h1>${esc(race.name)}</h1></header><p class="muted pad">${t("recent.noResult")}</p>`; return; }
  // the circuit shown first: yours, else the first one
  if (ci == null || !doc.classes[ci]) {
    ci = Math.max(0, doc.classes.findIndex((k) => k.runners.some((r) => isMe(r.name))));
  }
  const k = doc.classes[ci];
  const base = `#/recemment/${encodeURIComponent(race.key)}`;
  const srcLabel = (d) => (SOURCE[d.source]?.startsWith("src.") ? t(SOURCE[d.source]) : SOURCE[d.source] || d.source);
  const withSplits = hasSplits(k);
  // no splits here, but the same circuit has some in another document: there
  const other = withSplits ? null : docs.map((d, i) => [i, d.classes.findIndex((x) => x.name === k.name && hasSplits(x))]).find(([, j]) => j >= 0);
  view.innerHTML = `<header class="bar sticky"><a href="#/recemment" class="back" aria-label="${t("recent.title")}">‹</a>
      <div class="grow"><h1>${esc(race.name)}</h1><div class="muted small">${esc([fmtDay(race.date_iso), race.place, orgName(race.org)].filter(Boolean).join(" · "))}</div></div></header>
    ${docs.length > 1 ? `<div class="chips">${docs.map((d, i) => `<a class="chip${i === di ? " on" : ""}" href="${base}/${i}/0">${esc(srcLabel(d))}${d.by === "category" ? ` · ${t("recent.byCat")}` : ""}</a>`).join("")}</div>` : ""}
    <div class="chips" role="tablist">${doc.classes.map((x, i) => `<a role="tab" class="chip${i === ci ? " on" : ""}" href="${base}/${di}/${i}">${esc(x.name)}</a>`).join("")}</div>
    <div class="pad muted small">${esc([k.length_m ? `${(k.length_m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : "", k.climb_m ? `${k.climb_m} m D+` : "",
      k.controls ? t("recent.controls", { n: k.controls.length }) : "", t("live.runners", { n: k.runners.length })].filter(Boolean).join(" · "))}</div>
    ${withSplits ? `<div class="pad"><a class="btn" href="${base}/${di}/${ci}/parcours">${t("recent.analyse")} →</a></div>`
      : other ? `<div class="pad"><a class="btn" href="${base}/${other[0]}/${other[1]}/parcours">${t("recent.analyse")} →</a></div>` : ""}
    <div id="rows">${k.runners.map((r) => {
      const me = isMe(r.name), fol = follows(r.name, r.club);
      return `<div class="row${me ? " me" : ""}"><div class="pl">${r.place ?? ""}</div>
        <div class="who"><div class="name">${esc(r.name)}${me ? ` <span class="badge">${t("live.you")}</span>` : ""}</div>
          <div class="muted small">${esc([r.club, r.category].filter(Boolean).join(" · "))}</div></div>
        <div class="res">${r.status === "ok" ? `<div class="time">${clock(r.time_s)}</div>` : `<div class="muted small">${t(STATUS[r.status] || "st.nc")}</div>`}</div>
        <button class="star${fol ? " on" : ""}" data-n="${esc(r.name)}" data-c="${esc(r.club || "")}" aria-label="${fol ? t("live.unfollow") : t("live.follow")}" aria-pressed="${fol}">★</button></div>`;
    }).join("")}</div>
    <p class="muted small pad">${t("recent.source")} ${doc.url ? `<a href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.title || srcLabel(doc))} ↗</a>` : esc(srcLabel(doc))}</p>`;
  view.querySelector("#rows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-n]");
    if (!b) return;
    const on = toggleFollow(b.dataset.n, b.dataset.c);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  });
}

// ---- the analyses ---------------------------------------------------------------------------------------------------------
let chosen = null;                                      // the runners of « Écarts », for the visit
function analyse(view, race, di, ci, which, runner) {
  const doc = race.docs[di], k = doc?.classes[ci];
  if (!k) return results(view, race, 0, null);
  const base = `#/recemment/${encodeURIComponent(race.key)}/${di}/${ci}`;
  view.innerHTML = `<header class="bar sticky"><a href="${base}" class="back" aria-label="${esc(k.name)}">‹</a>
      <div class="grow"><h1>${esc(k.name)}</h1><div class="muted small">${esc(race.name)} · ${fmtDay(race.date_iso)}</div></div></header>
    <div id="an"></div>`;
  const box = view.querySelector("#an");
  const draw = () => an.render(box, an.compute(doc, k), which, {
    runner: runner && decodeURIComponent(runner), chosen,
    onRunner: (n) => { location.hash = `${base}/parcours/${encodeURIComponent(n)}`; },
    onChosen: (names) => { chosen = names; draw(); },
    redraw: () => draw(),
  });
  draw();
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) location.hash = `${base}/${b.dataset.view}`;
  });
}

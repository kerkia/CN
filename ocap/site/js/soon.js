// « Bientôt »: the coming competitions of FFCO's agenda (data/soon.json, exported by O'CN without anything of the CN
// nor any contact person), by date, then département number, then name. Filters: discipline, region (« Ma région »
// set in Réglages), a search. A race's sheet: its organiser, website, announcement, online registration (deadline and
// number registered), directions to its GPS point.
import { t, fmtDay, lang } from "./i18n.js";
import { settings, save, norm } from "./settings.js";
import { esc, getData, today, daysBetween, depOrder, segs } from "./util.js";

const SPECS = [["", "soon.all"], ["Pédestre", "spec.foot"], ["VTT", "spec.mtb"], ["Ski", "spec.ski"], ["Raid", "spec.raid"]];
const keyOf = (e) => `${e.date}-${norm(e.name).replace(/ /g, "-").slice(0, 40)}`;

export async function render(view, args) {
  const data = await getData("soon.json");
  if (!data) {
    view.innerHTML = `<header class="bar"><h1>${t("soon.title")}</h1></header><p class="muted pad">${t("data.none")}</p>`;
    return;
  }
  const events = data.events.filter((e) => e.date >= today())
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || depOrder(a.dep) - depOrder(b.dep) || a.name.localeCompare(b.name, "fr"));
  if (args[0]) return sheet(view, events.find((e) => keyOf(e) === args[0]), data);
  return list(view, events, data);
}

function list(view, events, data) {
  const s = settings();
  let spec = s.soonSpec || "", region = s.soonRegion ?? (s.region || ""), q = "";
  const regions = data.regions.map((r) => r.name);
  view.innerHTML = `<header class="bar"><h1>${t("soon.title")}</h1></header>
    <div class="pad"><input type="search" id="q" class="search" placeholder="${t("soon.search")}" autocomplete="off"></div>
    <div id="specs"></div>
    <div class="pad"><select id="region" class="select"><option value="">${t("soon.allRegions")}</option>
      ${regions.map((r) => `<option value="${esc(r)}" ${r === region ? "selected" : ""}>${esc(r)}${r === s.region ? ` · ${t("soon.mine")}` : ""}</option>`).join("")}</select></div>
    <div id="list"></div>`;
  function draw() {
    view.querySelector("#specs").innerHTML = segs("spec", SPECS.map(([v, k]) => [v, t(k)]), spec);
    const n = norm(q);
    const kept = events.filter((e) => (!spec || (spec === "Raid" ? /raid/i.test(e.spec || "") : e.spec === spec))
      && (!region || e.region === region) && (!n || norm(`${e.name} ${e.place || ""} ${e.org || ""} ${e.manif || ""}`).includes(n)));
    // by weekend: « Ce week-end », « Le week-end prochain », then each date
    const groups = new Map();
    for (const e of kept) {
      const g = weekLabel(e.date);
      (groups.get(g) || groups.set(g, []).get(g)).push(e);
    }
    view.querySelector("#list").innerHTML = kept.length ? [...groups].map(([g, es]) => `<h2 class="sec">${esc(g)}</h2>${es.map(row).join("")}`).join("")
      : `<p class="muted pad">${t("soon.none")}</p>`;
  }
  view.querySelector("#q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  view.querySelector("#region").addEventListener("change", (e) => { region = e.target.value; save({ soonRegion: region }); draw(); });
  view.addEventListener("click", (e) => {
    const b = e.target.closest("[data-spec]");
    if (b) { spec = b.dataset.spec; save({ soonSpec: spec }); draw(); }
  });
  draw();
}

function weekLabel(iso) {
  const d = new Date(`${iso}T12:00:00`), now = new Date(`${today()}T12:00:00`);
  const monday = (x) => { const y = new Date(x); y.setDate(y.getDate() - ((y.getDay() + 6) % 7)); return y.toISOString().slice(0, 10); };
  const w = daysBetween(monday(now), monday(d)) / 7;
  if (w === 0) return t("soon.thisWeek");
  if (w === 1) return t("soon.nextWeek");
  const mon = new Date(`${monday(d)}T12:00:00`), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (x, o) => x.toLocaleDateString(lang() === "fr" ? "fr-FR" : "en-GB", o);
  return mon.getMonth() === sun.getMonth() ? `${f(mon, { day: "numeric" })} – ${f(sun, { day: "numeric", month: "long" })}`
    : `${f(mon, { day: "numeric", month: "short" })} – ${f(sun, { day: "numeric", month: "short" })}`;
}

// closed, or its deadline gone (the agenda is read daily: « closed » may lag a day)
const regClosed = (r) => r.closed || (r.close && r.close < today());

function badge(e) {
  if (e.cancelled) return `<span class="tag bad">${t("soon.cancelled")}</span>`;
  const r = e.reg;
  if (!r) return "";
  if (regClosed(r)) return `<span class="tag">${t("soon.regClosed")}</span>`;
  const left = r.close ? daysBetween(today(), r.close) : null;
  return left != null && left <= 8 ? `<span class="tag warn">${left === 0 ? t("soon.regToday") : t("soon.regIn", { n: left })}</span>` : "";
}

function row(e) {
  const d = new Date(`${e.date}T12:00:00`), loc = lang() === "fr" ? "fr-FR" : "en-GB";
  return `<a class="item${e.cancelled ? " off" : ""}" href="#/bientot/${encodeURIComponent(keyOf(e))}">
    <div class="date"><span>${esc(d.toLocaleDateString(loc, { weekday: "short" }))}</span><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(loc, { month: "short" }))}</span></div>
    <div class="grow"><div class="name">${esc(e.name)}</div>
      <div class="muted small">${esc([e.place, e.dep && `(${e.dep})`].filter(Boolean).join(" "))}</div>
      <div class="tags">${e.epr ? `<span class="tag">${esc(e.epr)}</span>` : ""}${e.spec && e.spec !== "Pédestre" ? `<span class="tag">${esc(e.spec)}</span>` : ""}${badge(e)}</div></div>
    <span class="chev" aria-hidden="true">›</span></a>`;
}

function sheet(view, e, data) {
  if (!e) { view.innerHTML = `<header class="bar"><a href="#/bientot" class="back">‹</a><h1>${t("soon.title")}</h1></header><p class="muted pad">${t("soon.gone")}</p>`; return; }
  const dept = e.dep ? `${e.dep} · ${data.depts[e.dep] || ""}` : "";
  const link = (url, label, sub = "") => (url ? `<a class="item" href="${esc(url)}" target="_blank" rel="noopener"><div class="grow"><div class="name">${label}</div>
    ${sub ? `<div class="muted small">${sub}</div>` : ""}</div><span class="chev" aria-hidden="true">↗</span></a>` : "");
  const r = e.reg;
  const maps = e.gps ? `https://www.google.com/maps/search/?api=1&query=${e.gps[0]},${e.gps[1]}` : null;
  view.innerHTML = `<header class="bar sticky"><a href="#/bientot" class="back" aria-label="${t("soon.title")}">‹</a>
      <div class="grow"><h1>${esc(e.name)}</h1><div class="muted small">${fmtDay(e.date)}</div></div></header>
    <section class="card">
      ${badge(e) ? `<div class="tags" style="margin-bottom:8px">${badge(e)}</div>` : ""}
      <dl class="facts">
        <dt>${t("soon.where")}</dt><dd>${esc(e.place || "")}${dept ? `<div class="muted small">${esc(dept)}${e.region ? ` · ${esc(e.region)}` : ""}</div>` : ""}</dd>
        <dt>${t("soon.what")}</dt><dd>${esc([e.manif, e.spec].filter(Boolean).join(" · "))}${e.groupe ? `<div class="muted small">${esc(e.groupe)}</div>` : ""}</dd>
        <dt>${t("soon.org")}</dt><dd>${esc((e.org || "").replace(/^\s*\w+\s*-\s*/, ""))}</dd>
        ${r ? `<dt>${t("soon.reg")}</dt><dd>${regClosed(r) ? t("soon.regClosed") : r.close ? t("soon.regUntil", { d: fmtDay(r.close) }) : t("soon.regOpen")}
          ${r.count != null ? `<div class="muted small">${t("soon.registered", { n: r.count })}</div>` : ""}</dd>` : ""}
      </dl>
    </section>
    <div class="links">
      ${r?.url && !regClosed(r) ? link(r.url, t("soon.register"), t("soon.regSite")) : ""}
      ${link(e.invitation, t("soon.announce"), "PDF")}
      ${link(e.site, t("soon.site"), esc(String(e.site || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")))}
      ${link(maps, t("soon.directions"), e.gps ? `${e.gps[0].toFixed(4)}, ${e.gps[1].toFixed(4)}` : "")}
    </div>`;
}

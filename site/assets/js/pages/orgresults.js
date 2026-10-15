// « Organisation › Résultats » (#/orga-resultats, owner 2026-10-15): the competitions of the last 60 days organised by
// one's club (all of them for an administrator), each with what « Résultats » shows of it, and a way to deposit its
// results — and split times, if any — as its organiser: the file goes through « Déposer » (#/deposer?course=…&orga=1),
// the server checks the account belongs to the organising club (functions/api/upload.js), and the race is then no
// longer looked for on the club's site or the platforms (ffco_scraper/prov/sources/upload.py): its organiser's file is
// used as it is. An organiser is a member of the race's organising club, from the account's latest race.

import { html, $, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { getProv } from "./provisional.js";

const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const SOURCE = { upload: "dépôt", site: "site du club", winsplits: "WinSplits", heyries: "Orientation Data", helga: "Helga", liveresultat: "liveresultat" };

export async function render(main) {
  const me = auth.session(), club = auth.myClub();
  const today = new Date().toISOString().slice(0, 10);
  const idx = await getProv("index.json");
  const all = (idx?.races || []).filter((r) => !r.soon && r.date_iso <= today)
    .sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name, "fr"));
  const mine = me?.admin ? all : all.filter((r) => club && orgCode(r.org) === club);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("or.title")}</h1><p class="lede">${t("or.lede")}</p></div></div>
    ${me?.admin ? html`<div class="filters"><label class="field"><span>${t("sh.org.filter")}</span><input id="or-filter" placeholder="${t("sh.org.filter.ph")}" style="width:240px"></label></div>` : ""}
    <section class="card"><div class="table-wrap" id="or-list"></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("or.hint")}</p>`;
  const draw = (q = "") => {
    const list = q ? mine.filter((r) => norm(`${r.name} ${r.org || ""} ${r.place || ""}`).includes(norm(q))) : mine;
    $("#or-list").innerHTML = list.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("sh.org.col.org")}</th>
        <th>${t("or.col.now")}</th><th></th></tr></thead>
      <tbody>${list.map((r) => html`<tr><td class="num">${fmtDate(r.date_iso, "short")}</td>
        <td>${r.docs ? html`<a href="#/resultats?course=${encodeURIComponent(r.key)}">${r.name}</a>` : r.name}${r.place ? html` <span class="muted">· ${r.place}</span>` : ""}</td>
        <td class="muted">${r.org || "—"}</td>
        <td>${r.docs ? html`${t("or.now", { n: r.runners || 0 })}${r.splits ? ` · ${t("or.splits")}` : ""} <span class="muted">(${(r.sources || []).map((s) => SOURCE[s] || s).join(", ")})</span>` : html`<span class="muted">${t("or.nothing")}</span>`}</td>
        <td class="r"><a class="btn btn-sm btn-primary" href="#/deposer?course=${encodeURIComponent(r.key)}&orga=1">${t("or.deposit")}</a></td></tr>`)}</tbody></table>`
      : html`<div class="empty">${club || me?.admin ? t("or.none", { club: club || "—" }) : t("sh.org.noclub")}</div>`;
  };
  draw();
  $("#or-filter")?.addEventListener("input", (e) => draw(e.target.value));
  return { title: t("or.title") };
}

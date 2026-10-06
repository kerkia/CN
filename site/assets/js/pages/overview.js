// Home: the login page. Logged out, it is the only page there is: a short
// presentation, the login form, and the public headline figures. Logged in,
// it greets the runner and points to their page.

import { html, $, $$, fmt, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import * as auth from "../auth.js";
import { columnChart, terrainColor } from "../charts.js";
import { TERRAINS } from "../store.js";
import { chartCard, bindChartCard, legend, tile, seg } from "../ui.js";
import { link, replaceQuery, signedIn, SITE } from "../app.js";


export async function render(main, { query }) {
  const meta = data.meta();
  const me = auth.session();
  let measure = ["runners", "comps", "results"].includes(query.measure) ? query.measure : "runners";
  const seasons = Object.keys(meta.overview).sort();

  main.innerHTML = html`
    <section class="card login-hero">
      <div class="login-intro">
        <h1>${SITE}</h1>
        <p class="lede">${t("auth.lede")}</p>
        <ul class="login-points">
          <li>${t("auth.point1")}</li><li>${t("auth.point2")}</li><li>${t("auth.point3")}</li>
        </ul>
      </div>
      <div class="login-box">
        ${me ? html`
          <h2>${t("auth.hello")} ${displayName(me.nom).split(" ")[0]}</h2>
          <p class="soft">${t("auth.connectedAs")} ${displayName(me.nom)} · ${t("rn.licence")} ${me.lic}</p>
          <div class="stack" style="gap:8px;margin-top:14px">
            <a class="btn btn-primary" href="${link.runner(me.lic)}">${t("auth.myPage")}</a>
          </div>` : html`
          <h2>${t("auth.title")}</h2>
          <form id="acct-form" class="stack" style="gap:12px;margin-top:10px" autocomplete="on">
            <label class="field"><span>${t("ac.email")}</span>
              <input type="email" id="acct-email" name="email" autocomplete="username" required></label>
            <label class="field"><span>${t("ac.password")}</span>
              <input type="password" id="acct-pw" name="password" autocomplete="current-password" required></label>
            <div class="notice" id="acct-error" hidden></div>
            <button class="btn btn-primary" type="submit" id="acct-btn">${t("ac.login")}</button>
            <p class="links"><a href="#/compte/inscription">${t("ac.register")}</a><a href="#/compte/mot-de-passe">${t("ac.forgot")}</a></p>
          </form>`}
      </div>
    </section>
    <div class="tiles" style="margin:16px 0">
      ${tile(t("ov.seasons"), `${seasons[0]}–${seasons[seasons.length - 1]}`, `${fmt(seasons.length)} ${t("ov.seasonsN")}`)}
      ${tile(t("ov.runners"), fmt(meta.counts.runners), t("ov.runners.sub"))}
      ${tile(t("ov.comps"), fmt(meta.counts.competitions), `${fmt(meta.counts.circuits)} ${t("co.circuits")}`)}
      ${tile(t("ov.results"), fmt(meta.counts.results))}
    </div>
    <div>${chartCard({ id: "part", title: t("ov.participation"), hint: t("ov.participation.hint"), short: true,
      tools: html`<span id="measure-seg"></span>` })}</div>`;
  bindChartCard(main, "part");

  if (!me) {
    $("#acct-email").focus();
    const aform = $("#acct-form"), aerr = $("#acct-error"), abtn = $("#acct-btn");
    aform.addEventListener("submit", async (e) => {
      e.preventDefault();
      aerr.hidden = true;
      abtn.disabled = true;
      abtn.textContent = t("auth.checking");
      try {
        const s = await auth.accountLogin($("#acct-email").value.trim(), $("#acct-pw").value);
        await signedIn(s);
      } catch (x) {
        aerr.textContent = t(`ac.err.${x.code || "generic"}`);
        if (x.code === "unverified") aerr.insertAdjacentHTML("beforeend", ` <a href="#/compte/renvoyer">${t("ac.resend")}</a>`);
        aerr.hidden = false;
        abtn.disabled = false;
        abtn.textContent = t("ac.login");
      }
    });
  }

  function drawParticipation() {
    $("#measure-seg").innerHTML = seg("measure",
      [["runners", t("ov.runners")], ["comps", t("ov.comps")], ["results", t("ov.results")]], measure);
    $$('[data-seg="measure"]').forEach((b) => b.addEventListener("click", () => {
      measure = b.dataset.value;
      replaceQuery({ measure: measure === "runners" ? null : measure });
      drawParticipation();
    }));
    const i = { comps: 0, runners: 1, results: 2 }[measure];
    const series = TERRAINS.map((tr) => ({
      name: t(`terrain.${tr}`), color: terrainColor(tr), data: seasons.map((y) => meta.overview[y][tr]?.[i] ?? 0),
    }));
    $("#part-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
    columnChart($("#part"), { categories: seasons, series });
    $("#part-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th>
      ${TERRAINS.map((tr) => html`<th class="r">${t("ov.comps")} · ${t(`terrain.${tr}`)}</th><th class="r">${t("ov.runners")}</th><th class="r">${t("ov.results")}</th>`)}</tr></thead>
      <tbody>${[...seasons].reverse().map((y) => html`<tr><td>${y}</td>${TERRAINS.map((tr) =>
        (meta.overview[y][tr] || [null, null, null]).map((v) => html`<td class="r num">${fmt(v)}</td>`))}</tr>`)}</tbody></table>`;
  }
  drawParticipation();
  return { title: t("ov.title") };
}

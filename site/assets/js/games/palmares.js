// The games' palmarès (owner, 2026-11-10: every game of « Jeux » and « Apprendre »'s test): a signed-in account's finished runs
// kept on the server under its name (functions/api/games/scores.js), for each game and level its 20 best and everyone's 20 best;
// nothing kept for a visitor (nor in the browser: the engine's « Meilleur score » kept in localStorage is gone).

import { html, fmtDate, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";

/** A signed-in account, not a demo one (the server refuses those). */
export const signedIn = () => !!auth.session()?.uid && !auth.session()?.demo;

/** A finished run of game `game`: {value, label, higher, extra}; sent when signed in (a refusal is left unsaid). */
export function record(game, { value, label, higher = true, extra = "" }) {
  if (!signedIn() || !game || !Number.isFinite(value)) return;
  fetch("/api/games/scores", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game, value, label, higher, extra }) }).catch(() => {});
}

/** One table of runs: rank, (name), result, details, day. */
function runsTable(runs, withName) {
  if (!runs.length) return html`<p class="muted">${t("g.palm.none")}</p>`;
  const extra = runs.some((r) => r.extra);
  return html`<div class="table-wrap"><table class="data compact g-palm-t"><thead><tr><th class="num">#</th>${withName ? html`<th>${t("g.palm.name")}</th>` : ""}
    <th>${t("g.palm.result")}</th>${extra ? html`<th>${t("g.palm.details")}</th>` : ""}<th>${t("g.palm.date")}</th></tr></thead>
    <tbody>${runs.map((r, i) => html`<tr class="${r.mine && withName ? "g-palm-me" : ""}"><td class="num">${i + 1}</td>${withName ? html`<td>${displayName(r.name)}</td>` : ""}
      <td><b>${r.label}</b></td>${extra ? html`<td>${r.extra}</td>` : ""}<td>${fmtDate(String(r.at).slice(0, 10))}</td></tr>`)}</tbody></table></div>`;
}

/** The palmarès of game `game` in a window over the page, `title` naming the game. */
export async function openPalmares(game, title = "") {
  const dlg = document.createElement("dialog");
  dlg.className = "g-palm";
  dlg.innerHTML = html`<div class="g-palm-head"><h2>${t("g.palm")}${title ? html` <span class="muted">· ${title}</span>` : ""}</h2>
    <button type="button" class="btn btn-sm" data-close>${t("g.palm.close")}</button></div>
    <div class="g-palm-body"><div class="boot"><div class="spinner"></div></div></div>`;
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) close(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.showModal();
  let data = null;
  try { const r = await fetch(`/api/games/scores?game=${encodeURIComponent(game)}`, { cache: "no-store" }); if (r.ok) data = await r.json(); } catch (e) { /* none */ }
  const body = dlg.querySelector(".g-palm-body");
  if (!body) return;
  body.innerHTML = data
    ? html`<p class="muted">${t("g.palm.hint")}</p><h3>${t("g.palm.mine")}</h3>${runsTable(data.mine || [], false)}<h3>${t("g.palm.all")}</h3>${runsTable(data.all || [], true)}`
    : html`<p class="muted">${t("g.palm.err")}</p>`;
}

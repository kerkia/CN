// Administration (the administrator only): every account, duplicates by licence flagged,
// disable / re-enable / delete. The server enforces the role; this page only reads and acts.

import { html, $, $$, normalise, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { tile } from "../ui.js";
import { link } from "../app.js";

export async function render(main) {
  const r = await fetch("api/admin/users", { credentials: "same-origin", cache: "no-store" });
  if (r.status === 401) { window.dispatchEvent(new Event("cnx:unauthorised")); return null; }
  if (!r.ok) {
    main.innerHTML = html`<div class="notice">${t("ad.forbidden")}</div>`;
    return { title: t("ad.title") };
  }
  let { users, duplicates, queued } = await r.json();
  let q = "", onlyDups = false;
  const dupSet = () => new Set(duplicates);

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ad.title")}</h1><p class="lede">${t("ad.lede")}</p></div></div>
    <div class="tiles tiles-compact" id="ad-tiles" style="margin-bottom:14px"></div>
    <div class="filters">
      <label class="field"><span>${t("ad.search")}</span><input type="search" id="ad-q" style="width:260px"></label>
      <label class="check" style="align-self:flex-end;height:34px;align-items:center"><input type="checkbox" id="ad-dups"><span>${t("ad.onlyDups")}</span></label>
    </div>
    <section class="card"><div class="table-wrap" id="ad-table"></div></section>`;

  const status = (u) => (u.status === "disabled" ? t("ad.st.disabled") : u.email_verified ? t("ad.st.active") : t("ad.st.unverified"));

  function draw() {
    const dups = dupSet();
    $("#ad-tiles").innerHTML = html`
      ${tile(t("ad.accounts"), fmt(users.length))}
      ${tile(t("ad.confirmed"), fmt(users.filter((u) => u.email_verified).length))}
      ${tile(t("ad.dups"), fmt(dups.size))}
      ${tile(t("ad.queue"), fmt(queued))}`;
    const qn = normalise(q);
    const rows = users.filter((u) => (!onlyDups || (dups.has(u.licence) && u.email_verified))
      && (!qn || normalise(`${u.email} ${u.first_name} ${u.last_name} ${u.licence}`).includes(qn)));
    $("#ad-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr>
      <th>${t("ad.col.email")}</th><th>${t("ad.col.name")}</th><th>${t("ad.col.lic")}</th><th>${t("ad.col.status")}</th>
      <th>${t("ad.col.created")}</th><th>${t("ad.col.login")}</th><th>${t("ad.col.notify")}</th><th>${t("ad.col.actions")}</th></tr></thead>
      <tbody>${rows.map((u) => html`<tr>
        <td>${u.email}</td>
        <td><a href="${link.runner(u.licence)}">${u.display_name}</a><div class="muted" style="font-size:12px">${u.first_name} ${u.last_name}</div></td>
        <td class="num">${u.licence}${dups.has(u.licence) && u.email_verified ? html` <span class="tag" style="color:var(--bad)">${t("ad.dup")}</span>` : ""}</td>
        <td>${status(u)}</td>
        <td class="num">${fmtDate(u.created_at.slice(0, 10), "short")}</td>
        <td class="num">${u.last_login ? fmtDate(u.last_login.slice(0, 10), "short") : "—"}</td>
        <td>${u.notify ? "✓" : ""}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn btn-sm" data-act="${u.status === "disabled" ? "enable" : "disable"}" data-id="${u.id}">${u.status === "disabled" ? t("ad.enable") : t("ad.disable")}</button>
          <button type="button" class="btn btn-sm" data-act="delete" data-id="${u.id}" style="color:var(--bad)">${t("ad.delete")}</button>
        </div></td></tr>`)}</tbody></table>` : html`<div class="empty">${t("ad.none")}</div>`;
    $$("[data-act]", $("#ad-table")).forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.act === "delete" && !confirm(t("ad.delete.confirm"))) return;
      b.disabled = true;
      const res = await auth.api("api/admin/user", { id: Number(b.dataset.id), action: b.dataset.act });
      if (!res.ok) { b.disabled = false; return; }
      const fresh = await (await fetch("api/admin/users", { credentials: "same-origin", cache: "no-store" })).json();
      ({ users, duplicates, queued } = fresh);
      draw();
    }));
  }
  $("#ad-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  $("#ad-dups").addEventListener("change", (e) => { onlyDups = e.target.checked; draw(); });
  draw();
  return { title: t("ad.title") };
}

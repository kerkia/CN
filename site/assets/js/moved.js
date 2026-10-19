// The move to ozimut.com (owner, 2026-10-19): a window shown once to each account that existed before the move, at its first
// visit after it, whatever the device — the site's new name and address, and what one may want to do (bookmarks,
// notifications per device, the home-screen icon, an AI key, the method's new name). « Compris » records it on the account
// (users.moved_notice, migration 0013, through /api/account/settings); accounts made later never see it. Texts: moved.*.

import { t } from "./i18n.js";
import * as auth from "./auth.js";
import { onOldAddress } from "./bridge.js";

let shown = false;

/** Shows the window when the signed-in account has not seen it yet. */
export async function maybe() {
  const me = auth.session();
  if (shown || !me?.movedNotice || me.demo || onOldAddress() || document.querySelector(".moved-modal")) return;
  shown = true;
  const items = ["bookmarks", "push", "home", "ia", "method", "mail"].map((k) => `<li>${t(`moved.${k}`)}</li>`).join("");
  const m = document.createElement("div");
  m.className = "tr-modal moved-modal";
  m.innerHTML = `<div class="tr-dialog" role="dialog" aria-modal="true" aria-labelledby="moved-title">
    <h2 id="moved-title">${t("moved.title")}</h2>
    <div class="tr-form"><p>${t("moved.lede")}</p><ul class="moved-list">${items}</ul></div>
    <div class="tr-dlg-btns"><button type="button" class="btn btn-primary" data-ok>${t("moved.ok")}</button></div></div>`;
  const done = async () => {
    m.remove();
    document.removeEventListener("keydown", onKey, true);
    const r = await auth.api("api/account/settings", { movedNoticeSeen: true });
    if (r.ok) await auth.refresh();
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); m.remove(); document.removeEventListener("keydown", onKey, true); } };
  m.querySelector("[data-ok]").addEventListener("click", done);
  m.querySelectorAll("a").forEach((a) => a.addEventListener("click", done));
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(m);
  m.querySelector("[data-ok]").focus();
}

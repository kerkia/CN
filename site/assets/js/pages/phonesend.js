// « Envoyer à votre ordinateur » (#/envoi/<id>.<key>; owner, 2026-11-03): the page a phone opens from the QR code a computer
// shows (phonelink.js). It photographs the map or picks a file (a trace, a photo, a map file) and sends it to /api/phone,
// whence the computer takes it. No account needed: the link's key is the permission. The photo is sent as it was taken —
// never reduced (a map photo is read at its own resolution).

import { html, raw, $, pct, fmt } from "../util.js";
import { t } from "../i18n.js";
import { bar, setBar } from "../waitbar.js";

const mb = (n) => fmt(n / 1024 / 1024, 1);

export async function render(main, { arg } = {}) {
  const [id, key] = String(arg || "").split(".");
  const card = (inner) => { main.innerHTML = html`<section class="card ph-page"><div class="card-body stack">${raw(inner)}</div></section>`; };
  const gone = () => card(html`<h1>${t("ph.p.title")}</h1><p class="notice">${t("ph.p.expired")}</p>`);
  let info = null;
  try {
    const r = await fetch(`/api/phone/${encodeURIComponent(id || "x")}`, { headers: { "X-Key": key || "" }, cache: "no-store" });
    if (r.ok) info = await r.json();
  } catch (e) { /* below */ }
  if (!info?.alive) { gone(); return { title: t("ph.p.title") }; }
  const kind = info.kind;

  card(html`<h1>${t("ph.p.title")}</h1>
    <p>${t(`ph.p.lede.${kind}`)}</p>
    <div class="ph-actions">
      ${kind !== "trace" ? html`<label class="btn btn-primary ph-big"><input type="file" id="ph-cam" accept="image/*" capture="environment" hidden>${t("ph.p.cam")}</label>` : ""}
      <label class="btn ${kind === "trace" ? "btn-primary " : ""}ph-big"><input type="file" id="ph-pick" hidden>${t(kind === "trace" ? "ph.p.file.trace" : "ph.p.file")}</label>
    </div>
    <p class="hint">${t(kind === "trace" ? "ph.p.traceTip" : "ph.p.tips")}</p>
    <div id="ph-out" aria-live="polite"></div>
    <p class="muted ph-note">${t("ph.p.private")}</p>`);

  const out = $("#ph-out");
  function send(file) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) { out.innerHTML = html`<p class="notice">${t("ph.p.tooLarge")}</p>`; return; }
    const shown = /^image\//.test(file.type) ? URL.createObjectURL(file) : "";
    out.innerHTML = html`<div class="ph-sending">${shown ? html`<img class="ph-thumb" src="${shown}" alt="">` : ""}
      <div><b>${file.name}</b> <span class="muted">${t("ph.p.size", { n: mb(file.size) })}</span>
      <div id="ph-prog">${raw(bar(0))} <span id="ph-pct">${t("ph.p.sending", { p: pct(0) })}</span></div></div></div>`;
    for (const b of main.querySelectorAll(".ph-big")) b.classList.add("disabled");
    const x = new XMLHttpRequest();
    x.open("PUT", `/api/phone/${id}/file`);
    x.setRequestHeader("X-Key", key);
    x.setRequestHeader("X-Name", encodeURIComponent(file.name || "photo.jpg"));
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      setBar($("#ph-prog progress", main), e.loaded / e.total);
      $("#ph-pct", main).textContent = t("ph.p.sending", { p: pct(e.loaded / e.total) });
    };
    const end = (msg, ok) => {
      for (const b of main.querySelectorAll(".ph-big")) b.classList.remove("disabled");
      $("#ph-prog", main).innerHTML = ok ? html`<p class="ph-ok">✓ ${msg}</p>` : html`<p class="notice">${msg}</p>`;
    };
    x.onload = () => {
      if (x.status === 200) end(t("ph.p.sent"), true);
      else if (x.status === 410) end(t("ph.p.expired"), false);
      else if (x.status === 413) end(t("ph.p.tooLarge"), false);
      else if (x.status === 429) end(t("ph.p.tooMany"), false);
      else end(t("ph.p.err"), false);
    };
    x.onerror = () => end(t("ph.p.err"), false);
    x.send(file);
  }
  for (const sel of ["#ph-cam", "#ph-pick"]) {
    $(sel, main)?.addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; send(f); });
  }
  return { title: t("ph.p.title") };
}

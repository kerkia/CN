// Contact: write to the administrator — bug reports, support requests, ideas, general feedback. A small rich-text
// editor (bold, italics, lists, links), pictures pasted or dropped straight into the text, and attached files.
// The message goes through /api/contact, which knows the administrator's address: the page never shows it.
// Pictures are reduced in the browser and travel as attachments, like the files (4 Mo in all).

import { html, raw, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { seg } from "../ui.js";

const CATEGORIES = ["bug", "aide", "idee", "avis"];
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_SIDE = 1600;                       // a pasted picture wider or taller than this is reduced

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);
const readAsDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});
/** A picture as a data URL, reduced to MAX_SIDE (JPEG for photos, PNG kept for screenshots that stay small). */
async function pictureUrl(file) {
  const url = await readAsDataUrl(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 600 * 1024) return url;
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const png = c.toDataURL("image/png");
  return png.length < 900 * 1024 ? png : c.toDataURL("image/jpeg", 0.85);
}
const dataBytes = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

export async function render(main, { query }) {
  const me = auth.session();
  let category = CATEGORIES.includes(query.type) ? query.type : "bug";
  const files = [];                          // [{ name, size, data (base64) }]

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ct.title")}</h1><p class="lede">${t("ct.lede")}</p></div></div>
    <div class="grid grid-main-side" style="align-items:start">
      <section class="card"><div class="card-body stack" style="gap:14px">
        <div class="field"><span>${t("ct.type")}</span><div id="ct-cat"></div></div>
        <label class="field"><span>${t("ct.subject")}</span>
          <input id="ct-subject" type="text" maxlength="150" placeholder="${t("ct.subject.ph")}"></label>
        <div class="field"><span>${t("ct.message")}</span>
          <div class="rte">
            <div class="rte-bar" role="toolbar" aria-label="${t("ct.toolbar")}">
              <button type="button" data-cmd="bold" title="${t("ct.bold")}"><b>G</b></button>
              <button type="button" data-cmd="italic" title="${t("ct.italic")}"><i>I</i></button>
              <button type="button" data-cmd="underline" title="${t("ct.underline")}"><u>S</u></button>
              <span class="rte-sep"></span>
              <button type="button" data-cmd="insertUnorderedList" title="${t("ct.ul")}">•&nbsp;≡</button>
              <button type="button" data-cmd="insertOrderedList" title="${t("ct.ol")}">1.&nbsp;≡</button>
              <button type="button" data-cmd="createLink" title="${t("ct.link")}">${t("ct.link.short")}</button>
              <span class="rte-sep"></span>
              <button type="button" data-cmd="removeFormat" title="${t("ct.clear")}">${t("ct.clear.short")}</button>
            </div>
            <div id="ct-editor" class="rte-body" contenteditable="true" role="textbox" aria-multiline="true"
              data-placeholder="${t("ct.message.ph")}"></div>
          </div>
          <span class="muted" style="font-size:12.5px">${t("ct.paste")}</span>
        </div>
        <div class="field"><span>${t("ct.files")}</span>
          <div class="row" style="gap:8px"><label class="btn btn-sm" for="ct-file">${t("ct.addFiles")}</label>
            <input id="ct-file" type="file" multiple hidden>
            <span class="muted" style="font-size:12.5px" id="ct-size"></span></div>
          <ul class="ct-files" id="ct-list"></ul>
        </div>
        <div class="notice" id="ct-error" hidden></div>
        <div class="row" style="gap:10px"><button class="btn btn-primary" type="button" id="ct-send">${t("ct.send")}</button>
          <span class="muted" style="font-size:12.5px">${t("ct.replyTo")} ${me?.email || ""}</span></div>
      </div></section>
      <section class="card"><div class="card-body prose" style="font-size:14px">
        <h2 style="font-size:16px;margin-top:0">${t("ct.side.title")}</h2>
        <ul>
          <li><b>${t("ct.cat.bug")}</b> — ${t("ct.side.bug")}</li>
          <li><b>${t("ct.cat.aide")}</b> — ${t("ct.side.aide")}</li>
          <li><b>${t("ct.cat.idee")}</b> — ${t("ct.side.idee")}</li>
          <li><b>${t("ct.cat.avis")}</b> — ${t("ct.side.avis")}</li>
        </ul>
        <p class="muted">${t("ct.side.note")}</p>
      </div></section>
    </div>`;

  const editor = $("#ct-editor"), err = $("#ct-error");
  const fail = (key) => { err.textContent = t(key); err.className = "notice"; err.hidden = false; };
  function drawCat() {
    $("#ct-cat").innerHTML = seg("ctcat", CATEGORIES.map((c) => [c, t(`ct.cat.${c}`)]), category);
    $$('[data-seg="ctcat"]').forEach((b) => b.addEventListener("click", () => { category = b.dataset.value; drawCat(); }));
  }
  drawCat();

  // ---- the editor --------------------------------------------------------------------------------
  $$("[data-cmd]").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));   // keep the selection
  $$("[data-cmd]").forEach((b) => b.addEventListener("click", () => {
    editor.focus();
    if (b.dataset.cmd === "createLink") {
      const url = prompt(t("ct.link.ask"), "https://");
      if (url && /^(https?:\/\/|mailto:)/i.test(url)) document.execCommand("createLink", false, url);
      return;
    }
    document.execCommand(b.dataset.cmd, false, null);
  }));
  const insertPictures = async (list) => {
    for (const f of list) {
      if (!f.type.startsWith("image/")) continue;
      const url = await pictureUrl(f);
      document.execCommand("insertHTML", false, `<img src="${url}" alt="">`);
    }
    drawSize();
  };
  editor.addEventListener("paste", (e) => {
    const pics = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (pics.length) { e.preventDefault(); insertPictures(pics); }
  });
  editor.addEventListener("drop", (e) => {
    const all = [...(e.dataTransfer?.files || [])];
    if (!all.length) return;
    e.preventDefault();
    insertPictures(all.filter((f) => f.type.startsWith("image/")));
    addFiles(all.filter((f) => !f.type.startsWith("image/")));
  });
  editor.addEventListener("input", drawSize);

  // ---- attachments ---------------------------------------------------------------------------------
  const pictureBytes = () => $$("img", editor).filter((i) => i.src.startsWith("data:")).reduce((n, i) => n + dataBytes(i.src), 0);
  const total = () => files.reduce((n, f) => n + f.size, 0) + pictureBytes();
  function drawSize() {
    $("#ct-size").textContent = `${t("ct.size")} ${kb(total())} / ${kb(MAX_BYTES)}`;
    $("#ct-size").style.color = total() > MAX_BYTES ? "var(--bad)" : "";
  }
  function drawFiles() {
    $("#ct-list").innerHTML = html`${files.map((f, i) => html`<li><span>${f.name}</span> <span class="muted">${kb(f.size)}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-rm="${i}" aria-label="${t("ct.remove")}">×</button></li>`)}`;
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { files.splice(Number(b.dataset.rm), 1); drawFiles(); }));
    drawSize();
  }
  async function addFiles(list) {
    for (const f of list) {
      if (files.length >= MAX_FILES) { fail("ct.err.count"); break; }
      const url = await readAsDataUrl(f);
      files.push({ name: f.name, size: f.size, data: url.slice(url.indexOf(",") + 1) });
    }
    drawFiles();
  }
  $("#ct-file").addEventListener("change", async (e) => { await addFiles([...e.target.files]); e.target.value = ""; });
  drawFiles();

  // ---- sending ------------------------------------------------------------------------------------------
  $("#ct-send").addEventListener("click", async () => {
    err.hidden = true;
    const subject = $("#ct-subject").value.trim();
    const text = editor.innerText.trim();
    if (!subject || !text) return fail("ct.err.fields");
    if (total() > MAX_BYTES) return fail("ct.err.size");
    // pictures in the text become numbered attachments, named where they stood
    const copy = editor.cloneNode(true), attachments = files.map((f) => ({ name: f.name, data: f.data }));
    let n = 0;
    $$("img", copy).forEach((img) => {
      const src = img.getAttribute("src") || "";
      const p = document.createElement("p");
      if (src.startsWith("data:")) {
        const ext = (src.match(/^data:image\/(\w+)/) || [, "png"])[1].replace("jpeg", "jpg");
        const name = `image-${++n}.${ext}`;
        attachments.push({ name, data: src.slice(src.indexOf(",") + 1) });
        p.textContent = `[${t("ct.picture")} ${n} : ${name}]`;
      } else {
        p.textContent = `[${t("ct.picture")} : ${src}]`;
      }
      img.replaceWith(p);
    });
    // the plain-text version: line breaks are only computed for what is laid out, so lay the copy out unseen
    copy.style.cssText = "position:absolute;left:-10000px;top:0;width:600px";
    document.body.append(copy);
    const plain = copy.innerText.trim();
    copy.remove();
    copy.removeAttribute("style");
    const body = { category, subject, html: copy.innerHTML, text: plain || text,
      from: query.from || "", browser: navigator.userAgent, attachments };
    const btn = $("#ct-send");
    btn.disabled = true; btn.textContent = t("ct.sending");
    const res = await auth.api("api/contact", body);
    btn.disabled = false; btn.textContent = t("ct.send");
    if (!res.ok) return fail(res.status === 429 ? "ct.err.rate" : res.status === 413 ? "ct.err.size" : "ct.err.send");
    files.length = 0; editor.innerHTML = ""; $("#ct-subject").value = ""; drawFiles();
    err.textContent = t("ct.sent"); err.className = "notice ok"; err.hidden = false;
  });
  return { title: t("ct.title") };
}

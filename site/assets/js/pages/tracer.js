// « Organisation › Tracer » (#/orga-tracer): course setting in the browser, as Purple Pen does it (owner, 2026-10-15) —
// the list of one's events (those one created or whose team one belongs to), a new event (a competition of one's club
// from the agenda, or a training) with its map (a PDF or an image), a Purple Pen file (.ppen) brought in with its map,
// and the editor (tracer/editor.js), which opens over the site in a window of its own (✕ closes it) or in a new tab
// (?fen=1). Courses stay secret: only the event's team opens it (functions/api/tracer).

import { html, $, fmtDate } from "../util.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { getProv } from "./provisional.js";
import * as S from "../tracer/store.js";
import * as M from "../tracer/model.js";
import { readPpen } from "../tracer/ppen.js";
import { openMap, isMapFile, mimeOf, imageDpi, isPdf } from "../tracer/mapsrc.js";

const today = () => new Date().toISOString().slice(0, 10);
const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };
let current = null;

export async function render(main, r) {
  main.innerHTML = html`
    <div class="page-head"><div><h1>Tracer</h1><p class="lede">Tracer les circuits d'une course ou d'un entraînement : postes, définitions, PDF à imprimer, fichiers pour le chronométrage. Ouvre et enregistre les fichiers Purple Pen.</p></div>
      <div class="tr-head-btns"><button type="button" class="btn btn-sm" id="tr-import">Importer un fichier Purple Pen…</button>
      <button type="button" class="btn btn-sm btn-primary" id="tr-new">Nouvel événement</button></div></div>
    <section class="card"><div class="table-wrap" id="tr-list"><div class="empty">Chargement…</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Les circuits restent secrets : seule l'équipe de l'événement l'ouvre (son créateur et les licenciés qu'il ajoute), pas les administrateurs du site.
      Le chiffrement (menu Événement) les rend illisibles même pour le serveur.</p>`;
  $("#tr-new").addEventListener("click", () => newEvent(main));
  $("#tr-import").addEventListener("click", () => importPpenEvent(main));
  await list();
  if (r.query.id) openEvent(r.query.id, { fen: r.query.fen === "1" });
  return { title: "Tracer", cleanup: () => { current?.close?.(); } };
}

async function list() {
  const box = $("#tr-list");
  let d;
  try { d = await S.api(""); } catch (e) { box.innerHTML = html`<div class="empty">Liste indisponible (${e.code || e.message}).</div>`; return; }
  current = { club: d.club };
  box.innerHTML = d.events.length ? html`<table class="data compact"><thead><tr><th>Date</th><th>Événement</th><th>Type</th><th>Créé par</th><th>Modifié</th></tr></thead><tbody>
    ${d.events.map((e) => html`<tr><td class="num">${fmtDate(e.date, "short")}</td><td><a href="#/orga-tracer?id=${e.id}" data-open="${e.id}">${e.title}</a>${e.encrypted ? " 🔒" : ""}</td>
      <td>${e.kind === "race" ? "Compétition" : "Entraînement"}</td><td>${e.mine ? "vous" : e.ownerName}</td><td class="num">${e.updated ? new Date(e.updated).toLocaleDateString("fr-FR") : ""}</td></tr>`)}</tbody></table>`
    : html`<div class="empty">Aucun événement pour l'instant : « Nouvel événement » pour commencer, ou importez un fichier Purple Pen.</div>`;
  box.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); history.replaceState(null, "", `#/orga-tracer?id=${a.dataset.open}`); openEvent(a.dataset.open); }));
}

// ---- a modal outside the editor (same look) -------------------------------------------------------------------------------
async function modal(opts) { return (await import("../tracer/dialogs.js")).modal(null, opts); }
const field = (label, input, hint = "") => `<label class="tr-field"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ""}</label>`;
const escA = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The competitions one's club organises: the agenda's coming ones and « Résultats »' recent ones. */
async function clubRaces() {
  const me = auth.session(), club = current?.club;
  const out = [];
  try {
    const ag = await data.agenda();
    for (const e of ag.events || []) if (e.kind === "c" && e.date >= today() && (me?.admin || orgCode(e.org) === club)) out.push({ key: `a${e.id}`, date: e.date, name: e.name, place: e.place, org: e.org, epr: e.epr || "", spec: e.spec || "" });
  } catch (e) { /* no agenda */ }
  try {
    const idx = await getProv("index.json");
    for (const x of idx?.races || []) if (x.date_iso < today() && (me?.admin || orgCode(x.org) === club) && !out.some((o) => o.key === x.key))
      out.push({ key: x.key, date: x.date_iso, name: x.name, place: x.place || "", org: x.org, epr: x.epreuve || "" });
  } catch (e) { /* no results */ }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function newEvent(main, preset = null) {
  const races = await clubRaces();
  const v = await modal({ title: preset ? "Événement pour le fichier Purple Pen" : "Nouvel événement", wide: true, ok: "Créer", body: `
    <div class="tr-checks"><label class="tr-check"><input type="radio" name="kind" value="race" ${races.length ? "checked" : "disabled"}> Une compétition de votre club</label>
    <label class="tr-check"><input type="radio" name="kind" value="training" ${races.length ? "" : "checked"}> Un entraînement</label></div>
    <div data-k="race">${field("Compétition", `<select name="race">${races.map((x) => `<option value="${x.key}">${escA(fmtDate(x.date, "short"))} — ${escA(x.name)}${x.place ? ` (${escA(x.place)})` : ""}</option>`).join("")}</select>`,
      races.length ? "Les compétitions à venir et des 60 derniers jours organisées par votre club." : "Aucune compétition de votre club dans l'agenda.")}</div>
    <div data-k="training" hidden>${field("Titre", `<input name="title" placeholder="Entraînement du mercredi" value="${escA(preset?.title || "")}">`)}${field("Date", `<input name="date" type="date" value="${today()}">`)}</div>
    ${preset ? "" : `${field("Carte (PDF ou image)", '<input type="file" name="map" accept=".pdf,image/*">', "Un PDF exporté d'OCAD ou d'OpenOrienteering Mapper garde la carte vectorielle à l'impression.")}
    <div class="tr-grid2">${field("Échelle de la carte (1:…)", '<input name="scale" value="10000" inputmode="numeric">')}
    ${field("Résolution de l'image (ppp)", '<input name="dpi" inputmode="numeric" placeholder="lue dans le fichier">', "Pour une image seulement.")}
    ${field("Norme de carte", '<select name="std"><option value="2017">Forêt (ISOM 2017)</option><option value="Spr2019">Sprint (ISSprOM 2019)</option></select>')}</div>`}`,
  onOpen: (f) => {
    const sync = () => { const k = f.elements.kind.value; f.querySelectorAll("[data-k]").forEach((d) => { d.hidden = d.dataset.k !== k; }); };
    f.querySelectorAll("input[name=kind]").forEach((x) => x.addEventListener("change", sync)); sync();
    f.elements.race?.addEventListener("change", () => { const r = races.find((x) => x.key === f.elements.race.value); if (r && /sprint/i.test(r.epr) && f.elements.std) { f.elements.std.value = "Spr2019"; f.elements.scale.value = "4000"; } });
    f.elements.map?.addEventListener("change", async () => {
      const file = f.elements.map.files[0];
      if (file && !isPdf(file.name, file.type)) { const dpi = imageDpi(await file.arrayBuffer()); if (dpi && !f.elements.dpi.value) f.elements.dpi.value = String(dpi); }
    });
  },
  validate: (o) => {
    if (o.kind === "race" && !o.race) return "Choisissez la compétition.";
    if (o.kind === "training" && (o.title || "").trim().length < 3) return "Un titre.";
    if (!preset) {
      if (!o.map?.length) return "Choisissez la carte.";
      if (!isMapFile(o.map[0])) return "Une carte en PDF ou en image (PNG, JPEG, GIF, BMP).";
      if (!(Number(o.scale) > 100)) return "L'échelle de la carte.";
      if (!isPdf(o.map[0].name, o.map[0].type) && o.dpi && !(Number(o.dpi) > 10)) return "La résolution de l'image.";
    }
    return null;
  } });
  if (!v) return null;
  const race = v.kind === "race" ? races.find((x) => x.key === v.race) : null;
  const body = race ? { kind: "race", race: race.key, title: race.name, date: race.date } : { kind: "training", title: v.title.trim(), date: v.date || today() };
  let id;
  try { id = (await S.api("", { method: "POST", body })).id; }
  catch (e) { (await import("../tracer/dialogs.js")).modal(null, { title: "Création impossible", body: `<p>${e.code === "not organiser" ? "Seuls les membres du club organisateur créent l'événement d'une compétition." : `Erreur : ${escA(e.code || e.message)}`}</p>`, cancel: null }); return null; }
  if (preset) return { id, title: body.title };
  const file = v.map[0], bytes = new Uint8Array(await file.arrayBuffer()), type = mimeOf(file.name, file.type);
  const src = await openMap(bytes, type, file.name, Number(v.dpi) || 0).catch(() => null);
  if (!src) { alertBox("La carte n'a pas pu être lue."); return null; }
  let dpi = src.dpi;
  if (src.kind === "bitmap" && !dpi) dpi = 300;
  const ev = M.newEvent({ title: body.title, standard: v.std, map: { kind: src.kind, file: file.name, scale: Number(v.scale), dpi: src.kind === "bitmap" ? dpi : 0,
    w: src.kind === "bitmap" ? (src.pxW * 25.4) / dpi : src.w, h: src.kind === "bitmap" ? (src.pxH * 25.4) / dpi : src.h } });
  if (v.std === "Spr2019") ev.appearance.itemScaling = "RelativeTo15000";
  await S.saveMap(id, bytes, type, null);
  await S.api(`/${id}`, { method: "PUT", body: { map: { name: file.name, type, size: bytes.length } } });
  await S.saveEvent(id, ev, null, 0);
  await list();
  history.replaceState(null, "", `#/orga-tracer?id=${id}`);
  openEvent(id);
  return id;
}

async function importPpenEvent(main) {
  const v = await modal({ title: "Importer un fichier Purple Pen", wide: true, ok: "Continuer", body: `
    <p>Le fichier .ppen et sa carte (le fichier qu'il nomme : un PDF ou une image ; une carte OCAD doit d'abord être exportée en PDF depuis OCAD).</p>
    ${field("Fichier Purple Pen (.ppen)", '<input type="file" name="ppen" accept=".ppen,.xml">')}${field("Carte", '<input type="file" name="map" accept=".pdf,image/*">')}
    <p class="tr-hint" id="tr-ppen-map"></p>`,
  onOpen: (f) => f.elements.ppen.addEventListener("change", async () => {
    try { const ev = readPpen(await f.elements.ppen.files[0].text()); f.querySelector("#tr-ppen-map").textContent = `Carte attendue : ${ev.map.file || "?"} (${ev.map.kind === "ocad" ? "OCAD : exportez-la en PDF" : ev.map.kind}, 1:${ev.map.scale}).`; }
    catch (e) { f.querySelector("#tr-ppen-map").textContent = "Ce fichier n'est pas lisible."; }
  }),
  validate: async (o) => {
    if (!o.ppen?.length) return "Choisissez le fichier .ppen.";
    if (!o.map?.length || !isMapFile(o.map[0])) return "Choisissez la carte (PDF ou image).";
    try { readPpen(await o.ppen[0].text()); } catch (e) { return "Ce fichier n'est pas un événement Purple Pen lisible."; }
    return null;
  } });
  if (!v) return;
  const ev = readPpen(await v.ppen[0].text());
  const file = v.map[0], bytes = new Uint8Array(await file.arrayBuffer()), type = mimeOf(file.name, file.type);
  const src = await openMap(bytes, type, file.name, ev.map.dpi || 0).catch(() => null);
  if (!src) { alertBox("La carte n'a pas pu être lue."); return; }
  const created = await newEvent(main, { title: ev.title });
  if (!created) return;
  if (src.kind === "bitmap") {
    const dpi = ev.map.kind === "bitmap" && ev.map.dpi ? ev.map.dpi : src.dpi || 300;
    Object.assign(ev.map, { kind: "bitmap", file: file.name, dpi, w: (src.pxW * 25.4) / dpi, h: (src.pxH * 25.4) / dpi });
  } else Object.assign(ev.map, { kind: "pdf", file: file.name, dpi: 0, w: src.w, h: src.h });
  if (!ev.title) ev.title = created.title;
  await S.saveMap(created.id, bytes, type, null);
  await S.api(`/${created.id}`, { method: "PUT", body: { map: { name: file.name, type, size: bytes.length } } });
  await S.saveEvent(created.id, ev, null, 0);
  await list();
  history.replaceState(null, "", `#/orga-tracer?id=${created.id}`);
  openEvent(created.id);
}
function alertBox(text) { modal({ title: "Tracer", body: `<p>${escA(text)}</p>`, cancel: null }); }

// ---- opening ----------------------------------------------------------------------------------------------------------------
async function openEvent(id, { fen = false } = {}) {
  const loading = document.createElement("div");
  loading.className = "tr-loading"; loading.innerHTML = '<div class="spinner"></div><p>Ouverture du Tracer…</p>';
  document.body.appendChild(loading);
  try {
    const info = await S.api(`/${id}`);
    let key = null;
    if (info.event.encrypted) {
      key = await S.keyFor(id);
      if (!key) {
        loading.remove();
        const v = await modal({ title: "Événement chiffré", ok: "Ouvrir", body: field("Phrase de passe de l'équipe", '<input name="p" type="password" autocomplete="current-password">'),
          validate: async (o) => ((await S.unlock(id, info.event.encrypted, o.p)) ? null : "Phrase de passe incorrecte.") });
        if (!v) { history.replaceState(null, "", "#/orga-tracer"); return; }
        key = await S.keyFor(id);
        document.body.appendChild(loading);
      }
    }
    const [evR, mapR] = await Promise.all([S.loadJson(id, "event", key), S.loadMap(id, key)]);
    const ev = evR?.data || M.newEvent({ title: info.event.title });
    const mapType = info.event.map?.type || mapR?.type || "";
    const mapSrc = mapR ? await openMap(mapR.bytes, mapType, info.event.map?.name || ev.map.file, ev.map.dpi).catch(() => null) : null;
    if (mapSrc && ev.map.kind === "bitmap" && ev.map.dpi) { mapSrc.dpi = ev.map.dpi; }
    loading.remove();
    const { openEditor } = await import("../tracer/editor.js");
    await openEditor({ meta: info.event, role: info.role, you: info.you, ev, version: evR?.version || 0, mapSrc, key, readOnly: info.role === "viewer",
      lockHolder: info.lock, onClose: () => {
        if (fen) { window.close(); setTimeout(() => { location.hash = "#/orga-tracer"; }, 200); return; }
        history.replaceState(null, "", "#/orga-tracer"); list();
      } });
  } catch (e) {
    loading.remove();
    alertBox(e.status === 403 ? "Vous ne faites pas partie de l'équipe de cet événement." : e.status === 404 ? "Événement introuvable." : `Ouverture impossible : ${e.code || e.message}`);
    history.replaceState(null, "", "#/orga-tracer");
  }
}

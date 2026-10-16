// « Organisation › Tracer » (#/orga-tracer): course setting in the browser, as Purple Pen does it (owner, 2026-10-15) —
// the list of one's events (those one created or whose team one belongs to), a new event (a competition of one's club
// from the agenda, or a training) with its map (an OCAD or Mapper file, a PDF or an image), a Purple Pen file (.ppen) brought in with its map,
// and the editor (tracer/editor.js), drawn in the page under the site's menus as the analyses are: « ← Événements » back to
// the list, « ⤢ » the whole window (Échap or « ⤡ » back), « ↗ » a tab of its own (?fen=1, whose « ✕ » closes it; fullwin.js).
// Courses stay secret: only the event's team opens it (functions/api/tracer).

import { html, raw, $, fmtDate } from "../util.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { getProv } from "./provisional.js";
import * as S from "../tracer/store.js";
import * as M from "../tracer/model.js";
import { readPpen } from "../tracer/ppen.js";
import { openMap, isMapFile, mimeOf, imageDpi, isPdf, isVectorMap, MAP_ACCEPT } from "../tracer/mapsrc.js";
import { geoFromWorld } from "../tracer/geo.js";
import { dropHtml, dropZone } from "../tracer/dialogs.js";
import { centreOnMap } from "../tracer/calage.js";
import * as OFF from "../tracer/offline.js";
import { bindFull, setFull, leaveFull, inOwnTab, buttons as fwButtons } from "../fullwin.js";

const today = () => new Date().toISOString().slice(0, 10);
// the beta notice (owner, 2026-10-16): shown when the tool is first opened, until it is acknowledged on this browser;
// a new BETA value shows it again
const BETA = "1", BETA_KEY = "ocn.tr.beta";
export const FEEDBACK = `#/contact?${new URLSearchParams({ type: "bug", sujet: "Tracé : ", from: "#/orga-tracer" })}`;
const listHash = () => (inOwnTab() ? "#/orga-tracer?fen=1" : "#/orga-tracer");
const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };
let current = null, pageMain = null, leaving = false;

export async function render(main, r) {
  pageMain = main; leaving = false;
  bindFull();
  if (inOwnTab()) setFull(true);                         // a tab opened alone by « ↗ »: the Tracer without the site's bar
  bindPageDrop(main);
  drawPage(main);
  betaNotice().then(() => { if (r.query.id && !leaving) openEvent(r.query.id); });
  return { title: "Tracer", cleanup: () => { leaving = true; window.__tracer?.close?.(); leaveFull(); } };
}
/** The beta notice, until acknowledged (« J'ai compris », or one of its links followed). */
async function betaNotice() {
  try { if (localStorage.getItem(BETA_KEY) === BETA) return; } catch (e) { /* no storage: shown each time */ }
  const ack = () => { try { localStorage.setItem(BETA_KEY, BETA); } catch (e) { /* this visit only */ } };
  const v = await modal({ title: "Le tracé, en version bêta", ok: "J'ai compris", cancel: null, body: `
    <p>Le tracé vient d'être réalisé et n'a encore été que peu testé. C'est une <b>version bêta</b> : essayez-le librement, et dites-nous ce que vous
      en pensez — chaque remarque et chaque bug signalé nous aident à l'améliorer.</p>
    <p>Pour l'instant, nous ne le conseillons pas encore pour préparer une vraie compétition, mais nous espérons qu'il le sera bientôt. En attendant, il
      convient très bien aux <b>cartes d'entraînement</b>.</p>
    <p>Un bug, une remarque ? <a href="${FEEDBACK}" data-beta-link>Nous écrire</a>. Pour apprendre à s'en servir : <a href="#/methodes?onglet=tracer" data-beta-link>le guide du tracé</a>.</p>`,
  onOpen: (f, done) => f.querySelectorAll("[data-beta-link]").forEach((a) => a.addEventListener("click", () => { ack(); done(true); })) });
  if (v) ack();
}
/** The list of one's events (the page as it opens, and after the editor closes). */
function drawPage(main) {
  main.innerHTML = html`
    <div class="page-head"><div><h1>Tracer <span class="beta-tag" title="Version bêta : peu testée encore">Bêta</span></h1><p class="lede">Tracer les circuits d'une course ou d'un entraînement : postes, définitions, PDF à imprimer, fichiers pour le chronométrage. Ouvre et enregistre les fichiers Purple Pen.</p></div>
      <div class="tr-head-btns"><button type="button" class="btn btn-sm" id="tr-import">Importer un fichier Purple Pen…</button>
      <button type="button" class="btn btn-sm btn-primary" id="tr-new">Nouvel événement</button>${inOwnTab() ? raw(`<span class="fw-btns">${fwButtons()}</span>`) : ""}</div></div>
    <p class="beta-note">Version bêta, encore peu testée : idéale pour les cartes d'entraînement, pas encore conseillée pour une compétition.
      Un bug, une remarque ? <a href="${FEEDBACK}">Nous écrire</a> · <a href="#/methodes?onglet=tracer">Le guide du tracé</a></p>
    <section class="card"><div class="table-wrap" id="tr-list"><div class="empty">Chargement…</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Les circuits restent secrets : seule l'équipe de l'événement l'ouvre (son créateur et les licenciés qu'il ajoute), pas les administrateurs du site.
      Le chiffrement (menu Événement) les rend illisibles même pour le serveur.</p>
    <p class="muted" style="font-size:12.5px;margin:6px 2px 0">Astuce : déposez un fichier .ppen et sa carte (PDF ou image) n'importe où sur cette page pour les importer, ou une carte seule pour un nouvel événement.</p>`;
  $("#tr-new").addEventListener("click", () => newEvent(main));
  $("#tr-import").addEventListener("click", () => importPpenEvent(main));
  list();
}

async function list() {
  const box = $("#tr-list");
  let d;
  try { d = await S.api(""); } catch (e) {
    // no network: the events kept on this device
    const kept = e.status ? [] : await OFF.keptEvents().catch(() => []);
    if (!kept.length) { box.innerHTML = html`<div class="empty">Liste indisponible (${e.code || e.message}).</div>`; return; }
    d = { events: kept.map((x) => ({ ...x, mine: false, offline: true })), club: current?.club };
  }
  current = { club: d.club };
  box.innerHTML = d.events.length ? html`<table class="data compact"><thead><tr><th>Date</th><th>Événement</th><th>Type</th><th>Créé par</th><th>Modifié</th></tr></thead><tbody>
    ${d.events.map((e) => html`<tr><td class="num">${fmtDate(e.date, "short")}</td><td><a href="#/orga-tracer?id=${e.id}" data-open="${e.id}">${e.title}</a>${e.encrypted ? " 🔒" : ""}</td>
      <td>${e.kind === "race" ? "Compétition" : "Entraînement"}${e.offline ? " · hors ligne" : ""}${e.pending ? " · modifications à envoyer" : ""}</td><td>${e.mine ? "vous" : e.ownerName}</td><td class="num">${e.updated ? new Date(e.updated).toLocaleDateString("fr-FR") : ""}</td></tr>`)}</tbody></table>`
    : html`<div class="empty">Aucun événement pour l'instant : « Nouvel événement » pour commencer, ou importez un fichier Purple Pen.</div>`;
  box.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); history.replaceState(null, "", `#/orga-tracer?id=${a.dataset.open}${inOwnTab() ? "&fen=1" : ""}`); openEvent(a.dataset.open); }));
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

// ---- what the event is: a competition of one's club, or a training ------------------------------------------------------------
function kindFields(races, title = "") {
  return `<div class="tr-checks"><label class="tr-check"><input type="radio" name="kind" value="race" ${races.length ? "checked" : "disabled"}> Une compétition de votre club</label>
    <label class="tr-check"><input type="radio" name="kind" value="training" ${races.length ? "" : "checked"}> Un entraînement</label></div>
    <div data-k="race">${field("Compétition", `<select name="race">${races.map((x) => `<option value="${x.key}">${escA(fmtDate(x.date, "short"))} — ${escA(x.name)}${x.place ? ` (${escA(x.place)})` : ""}</option>`).join("")}</select>`,
      races.length ? "Les compétitions à venir et des 60 derniers jours organisées par votre club." : "Aucune compétition de votre club dans l'agenda.")}</div>
    <div data-k="training" hidden>${field("Titre", `<input name="title" placeholder="Entraînement du mercredi" value="${escA(title)}">`)}${field("Date", `<input name="date" type="date" value="${today()}">`)}</div>`;
}
function bindKind(f, races) {
  const sync = () => { const k = f.elements.kind.value; f.querySelectorAll("[data-k]").forEach((d) => { d.hidden = d.dataset.k !== k; }); };
  f.querySelectorAll("input[name=kind]").forEach((x) => x.addEventListener("change", sync)); sync();
  f.elements.race?.addEventListener("change", () => { const r = races.find((x) => x.key === f.elements.race.value); if (r && /sprint/i.test(r.epr) && f.elements.std) { f.elements.std.value = "Spr2019"; f.elements.scale.value = "4000"; } });
}
const kindProblem = (o) => (o.kind === "race" && !o.race ? "Choisissez la compétition." : o.kind === "training" && (o.title || "").trim().length < 3 ? "Le titre de l'entraînement." : null);
async function createEvent(v, races) {
  const race = v.kind === "race" ? races.find((x) => x.key === v.race) : null;
  const body = race ? { kind: "race", race: race.key, title: race.name, date: race.date } : { kind: "training", title: v.title.trim(), date: v.date || today() };
  try { return { id: (await S.api("", { method: "POST", body })).id, title: body.title }; }
  catch (e) { alertBox(e.code === "not organiser" ? "Seuls les membres du club organisateur créent l'événement d'une compétition." : `Création impossible : ${e.code || e.message}`); return null; }
}
const isPpenFile = (f) => /\.(ppen|xml)$/i.test(f.name);
const fmtN = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
/** An OCAD or Mapper map opened as soon as it is chosen: its scale, size and georeference shown before the event is made. */
async function openVectorFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let err = null;
  const src = await openMap(bytes, mimeOf(file.name, file.type), file.name).catch((e) => { err = e; return null; });
  if (!src) return { err };
  src.bytes = bytes;
  src.geoInfo = await (await import("../tracer/vmap/georef.js")).geoFromVector(src.vmap, src).catch(() => null);
  return { src };
}
const vectorLabel = (src) => `${src.format === "oom" ? "OpenOrienteering Mapper" : `OCAD ${src.version}`}, 1:${fmtN(src.scale)}, ${fmtN(src.w)} × ${fmtN(src.h)} mm${src.geoInfo ? `, géoréférencée (${src.geoInfo.name})` : ""}`;
const baseName = (n) => String(n || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "").toLowerCase();

/** Files dropped anywhere on the list page: a .ppen (with or without its map) opens the import, a map alone a new event. */
function bindPageDrop(main) {
  main.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); main.classList.add("tr-page-over"); } });
  main.addEventListener("dragleave", (e) => { if (e.target === main) main.classList.remove("tr-page-over"); });
  main.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    main.classList.remove("tr-page-over");
    if (!files.length || document.querySelector(".tr-modal, .tr-app")) return;
    e.preventDefault();
    if (files.some(isPpenFile)) importPpenEvent(main, files); else newEvent(main, files);
  });
}

// ---- a new event: its map, dropped or chosen ----------------------------------------------------------------------------------
async function newEvent(main, files = null) {
  const races = await clubRaces();
  let mapFile = null, vec = null;
  const v = await modal({ title: "Nouvel événement", wide: true, ok: "Créer", body: `
    ${kindFields(races)}
    ${dropHtml("tr-new-drop", "Déposez ici la carte — OCAD (.ocd), OpenOrienteering Mapper (.omap, .xmap), un PDF ou une image (JPG, PNG, GIF, TIFF, BMP) —, ou cliquez pour la choisir", MAP_ACCEPT, false)}
    <p class="tr-hint" id="tr-new-map">Le fichier OCAD ou Mapper de la carte est le meilleur choix : nette à toutes les échelles, avec son violet, ses couches et son géoréférencement. Un PDF exporté d'OCAD ou de Mapper reste net aussi ; une image (même un scan ou une photo prise bien à plat) convient.</p>
    <div class="tr-grid2">${field("Échelle de la carte (1:…)", '<input name="scale" value="10000" inputmode="numeric">')}
    ${field("Résolution de l'image (ppp)", '<input name="dpi" inputmode="numeric" placeholder="lue dans le fichier">', "Pour une image seulement.")}
    ${field("Norme de carte", '<select name="std"><option value="2017">Forêt (ISOM 2017)</option><option value="Spr2019">Sprint (ISSprOM 2019)</option></select>')}</div>`,
  onOpen: (f, done) => {
    bindKind(f, races);
    const show = (html, bad = false) => { const p = f.querySelector("#tr-new-map"); p.innerHTML = html; p.classList.toggle("tr-bad", bad); };
    const take = async (list) => {
      if (list.some(isPpenFile)) { done(null); importPpenEvent(main, list); return; }        // a Purple Pen file: the import
      const file = list.find(isMapFile);
      if (!file) { show(`« ${escA(list[0].name)} » n'est pas une carte (OCAD, Mapper, PDF ou image).`, true); return; }
      mapFile = file; vec = null;
      if (isVectorMap(file.name)) {
        show(`Lecture de « ${escA(file.name)} »…`);
        const r = await openVectorFile(file);
        if (mapFile !== file) return;                        // another file chosen meanwhile
        if (!r.src) { mapFile = null; show(escA(mapError(r.err)), true); return; }
        vec = r.src;
        f.elements.scale.value = String(vec.scale);
        show(`✓ Carte « ${escA(file.name)} » (${escA(vectorLabel(vec))})`);
        return;
      }
      show(`✓ Carte « ${escA(file.name)} » (${isPdf(file.name, file.type) ? "PDF" : "image"}, ${(file.size / 1e6).toFixed(1).replace(".", ",")} Mo)`);
      if (!isPdf(file.name, file.type)) { const dpi = imageDpi(await file.arrayBuffer()); if (dpi && !f.elements.dpi.value) f.elements.dpi.value = String(dpi); }
    };
    dropZone(f.querySelector("#tr-new-drop"), take);
    if (files?.length) take(files);
  },
  validate: (o) => kindProblem(o) || (!mapFile ? "Déposez ou choisissez la carte." : isVectorMap(mapFile.name) && !vec ? "La carte est en cours de lecture." : !(Number(o.scale) > 100) ? "L'échelle de la carte."
    : !isPdf(mapFile.name, mapFile.type) && !vec && o.dpi && !(Number(o.dpi) > 10) ? "La résolution de l'image." : null) });
  if (!v) return null;
  const bytes = vec?.bytes || new Uint8Array(await mapFile.arrayBuffer()), type = mimeOf(mapFile.name, mapFile.type);
  let err = null;
  const src = vec || await openMap(bytes, type, mapFile.name, Number(v.dpi) || 0).catch((e) => { err = e; return null; });
  if (!src) { alertBox(mapError(err)); return null; }
  const created = await createEvent(v, races);
  if (!created) return null;
  const dpi = src.kind === "bitmap" ? src.dpi || 300 : 0;
  const ev = M.newEvent({ title: created.title, standard: v.std, map: { kind: src.kind === "vector" ? "ocad" : src.kind, file: mapFile.name, scale: Number(v.scale), dpi,
    w: src.kind === "bitmap" ? (src.pxW * 25.4) / dpi : src.w, h: src.kind === "bitmap" ? (src.pxH * 25.4) / dpi : src.h, ox: src.ox, oy: src.oy } });
  if (v.std === "Spr2019") ev.appearance.itemScaling = "RelativeTo15000";
  if (src.world) { const g = geoFromWorld(ev, src.world.wf, null, src.pxW, src.pxH, src.world.crs); if (g) ev.geo = g; }   // a GeoTIFF
  if (src.geoInfo) ev.geo = src.geoInfo.geo;                 // an OCAD or Mapper map's own
  await S.saveMap(created.id, bytes, type, null);
  await S.api(`/${created.id}`, { method: "PUT", body: { map: { name: mapFile.name, type, size: bytes.length } } });
  await S.saveEvent(created.id, ev, null, 0);
  await list();
  history.replaceState(null, "", `#/orga-tracer?id=${created.id}${inOwnTab() ? "&fen=1" : ""}`);
  openEvent(created.id);
  return created.id;
}

// ---- a Purple Pen event: the .ppen and its map, dropped together or one after the other ----------------------------------------
async function importPpenEvent(main, files = []) {
  const races = await clubRaces();
  const st = { ppen: null, ev: null, map: null, notes: [] };
  const v = await modal({ title: "Importer un fichier Purple Pen", wide: true, ok: "Importer", body: `
    <p>Le fichier <b>.ppen</b> et <b>sa carte</b> : déposez-les ensemble ici, l'un après l'autre, ou cliquez pour les choisir.
    La carte peut être un fichier OCAD (.ocd) ou OpenOrienteering Mapper (.omap, .xmap), un PDF ou une image (JPG, PNG, GIF, TIFF, BMP) : le fichier que nomme le .ppen,
    ou à défaut n'importe quel PDF ou image de la même carte (un scan ou une photo prise bien à plat conviennent) — vous calerez alors les postes sur la carte en deux clics.</p>
    ${dropHtml("tr-imp-drop", "Déposez ici le .ppen et la carte (OCAD, Mapper, PDF ou image), ou cliquez pour les choisir", `.ppen,.xml,${MAP_ACCEPT}`)}
    <ul class="tr-files" id="tr-imp-files"></ul>
    <h3>L'événement</h3>
    ${kindFields(races)}`,
  onOpen: (f) => {
    bindKind(f, races);
    const render = () => {
      const ev = st.ev, expected = ev?.map?.file || "", ocad = /\.(ocd|omap|xmap)$/i.test(expected) || ev?.map?.kind === "ocad";
      const lines = [];
      if (st.ppen && ev) {
        const nCtl = Object.values(ev.controls).filter((c) => c.kind === "normal").length;
        lines.push(`<li class="ok">✓ Fichier Purple Pen « ${escA(st.ppen.name)} » : ${escA(ev.title || "sans titre")}, ${Object.keys(ev.courses).length} circuit(s), ${nCtl} poste(s)${expected ? ` ; sa carte : « ${escA(expected)} » au 1:${ev.map.scale}` : ""}.</li>`);
      } else lines.push('<li class="todo">… Le fichier .ppen : pas encore choisi.</li>');
      if (st.map) {
        const vec = isVectorMap(st.map.name), same = !expected || baseName(expected) === baseName(st.map.name);
        lines.push(`<li class="ok">✓ Carte « ${escA(st.map.name)} » (${vec ? "OCAD ou Mapper" : isPdf(st.map.name, st.map.type) ? "PDF" : "image"}, ${(st.map.size / 1e6).toFixed(1).replace(".", ",")} Mo).</li>`);
        if (vec && ocad && !same) lines.push(`<li class="ok">Une autre version de la carte OCAD ou Mapper du .ppen (« ${escA(expected)} ») : les postes gardent leurs coordonnées sur la carte.</li>`);
        else if (!same || (vec && !ocad && ev)) lines.push(`<li class="warn">Ce n'est pas le fichier que nomme le .ppen (« ${escA(expected)} ») : après l'import, vous calerez les postes sur cette carte en deux clics (un poste, puis sa place sur la carte, deux fois).</li>`);
      } else lines.push(`<li class="todo">… La carte : pas encore choisie${ocad ? ` — le .ppen utilise une carte OCAD ou Mapper : déposez « ${escA(expected)} », ou à défaut un PDF ou une image de cette carte (un scan ou une photo prise bien à plat conviennent).` : expected ? ` — déposez « ${escA(expected)} », ou un PDF ou une image de la même carte.` : "."}</li>`);
      for (const n of st.notes) lines.push(`<li class="bad">${n}</li>`);
      f.querySelector("#tr-imp-files").innerHTML = lines.join("");
    };
    const take = async (list) => {
      st.notes = [];
      for (const file of list) {
        if (isPpenFile(file)) {
          try { st.ev = readPpen(await file.text()); st.ppen = file; if (f.elements.title && !f.elements.title.value) f.elements.title.value = st.ev.title || ""; }
          catch (e) { st.notes.push(`« ${escA(file.name)} » n'est pas un fichier Purple Pen lisible.`); }
        } else if (isMapFile(file)) st.map = file;
        else st.notes.push(`« ${escA(file.name)} » n'est ni un .ppen ni une carte (OCAD, Mapper, PDF ou image).`);
      }
      render();
    };
    dropZone(f.querySelector("#tr-imp-drop"), take);
    render();
    if (files?.length) take(files);
  },
  validate: (o) => (!st.ev ? "Il manque le fichier .ppen." : !st.map ? "Il manque la carte (OCAD, Mapper, PDF ou image)." : kindProblem(o)) });
  if (!v) return;
  const ev = st.ev, file = st.map, bytes = new Uint8Array(await file.arrayBuffer()), type = mimeOf(file.name, file.type);
  // another file than the .ppen's own (an OCAD map's PDF or image, a scan): the controls are aligned on it once opened; an OCAD or
  // Mapper map for a .ppen made on one keeps the controls' coordinates (Purple Pen keeps the map file's own millimetres)
  const vector = isVectorMap(file.name, bytes), ppenOcad = ev.map.kind === "ocad" || /\.(ocd|omap|xmap)$/i.test(ev.map.file || "");
  const differs = vector ? !ppenOcad : ppenOcad || (!!ev.map.file && baseName(ev.map.file) !== baseName(file.name));
  let err = null;
  const src = await openMap(bytes, type, file.name, ev.map.dpi || 0).catch((e) => { err = e; return null; });
  if (!src) { alertBox(mapError(err)); return; }
  const created = await createEvent(v, races);
  if (!created) return;
  if (src.kind === "bitmap") {
    const dpi = ev.map.kind === "bitmap" && ev.map.dpi ? ev.map.dpi : src.dpi || 300;
    Object.assign(ev.map, { kind: "bitmap", file: file.name, dpi, w: (src.pxW * 25.4) / dpi, h: (src.pxH * 25.4) / dpi });
  } else if (src.kind === "vector") {
    Object.assign(ev.map, { kind: "ocad", file: file.name, dpi: 0, w: src.w, h: src.h, ox: src.ox, oy: src.oy, scale: ev.map.scale || src.scale });
    if (!differs) M.transformAll(ev, [1, 0, 0, 1, -src.ox, -src.oy]);
    if (!ev.geo) { const g = await (await import("../tracer/vmap/georef.js")).geoFromVector(src.vmap, src).catch(() => null); if (g) ev.geo = g.geo; }
  } else Object.assign(ev.map, { kind: "pdf", file: file.name, dpi: 0, w: src.w, h: src.h });
  if (!ev.title) ev.title = created.title;
  if (src.world && !ev.geo) { const g = geoFromWorld(ev, src.world.wf, null, src.pxW, src.pxH, src.world.crs); if (g) ev.geo = g; }
  if (differs) centreOnMap(ev);                              // most controls off the sheet: a first guess, the course on the map's middle
  await S.saveMap(created.id, bytes, type, null);
  await S.api(`/${created.id}`, { method: "PUT", body: { map: { name: file.name, type, size: bytes.length } } });
  await S.saveEvent(created.id, ev, null, 0);
  await list();
  history.replaceState(null, "", `#/orga-tracer?id=${created.id}${inOwnTab() ? "&fen=1" : ""}`);
  openEvent(created.id, { align: differs });
}

const mapError = (e) => (e?.message && e.message !== "map" ? `La carte n'a pas pu être lue : ${e.message}` : "La carte n'a pas pu être lue.");
/** The event as kept on this device, opened without the network (offline.js); false when there is none. */
async function openLocal(id, onClose) {
  const card = (await OFF.keptEvents().catch(() => [])).find((x) => x.id === id);
  if (!card) return false;
  let key = card.encrypted ? await S.keyFor(id) : null;
  if (card.encrypted && !key) {
    const v = await modal({ title: "Événement chiffré", ok: "Ouvrir", body: field("Phrase de passe de l'équipe", '<input name="p" type="password" autocomplete="current-password">'),
      validate: async (o) => ((await S.unlock(id, card.encrypted, o.p)) ? null : "Phrase de passe incorrecte.") });
    if (!v) return true;
    key = await S.keyFor(id);
  }
  const rec = await OFF.localEvent(id, key);
  if (!rec || rec.locked) return false;
  const mapSrc = rec.map?.bytes ? await openMap(rec.map.bytes, rec.map.type || rec.meta.map?.type || "", rec.meta.map?.name || rec.ev.map.file, rec.ev.map.dpi, rec.ev.map.kind === "ocad" ? rec.ev.map : null).catch(() => null) : null;
  if (mapSrc && rec.ev.map.kind === "bitmap" && rec.ev.map.dpi) mapSrc.dpi = rec.ev.map.dpi;
  const { openEditor } = await import("../tracer/editor.js");
  if (leaving) return true;
  pageMain.innerHTML = "";
  await openEditor({ container: pageMain, meta: rec.meta, role: rec.role, you: rec.you, ev: rec.ev, version: rec.baseVersion, mapSrc, key, readOnly: rec.role === "viewer", offline: true, onClose });
  return true;
}
function alertBox(text) { modal({ title: "Tracer", body: `<p>${escA(text)}</p>`, cancel: null }); }

// ---- opening ----------------------------------------------------------------------------------------------------------------
async function openEvent(id, { align = false } = {}) {
  const loading = document.createElement("div");
  loading.className = "tr-loading"; loading.innerHTML = '<div class="spinner"></div><p>Ouverture de l\'événement…</p>';
  document.body.appendChild(loading);
  // closing the editor (« ← Événements »): back to the list, in this tab as in a tab of its own
  const onClose = () => {
    if (leaving) return;
    history.replaceState(null, "", listHash());
    drawPage(pageMain);
  };
  let info;
  try { info = await S.api(`/${id}`); }
  catch (e) {
    // no network: the copy kept on this device, if any (offline.js)
    if (!e.status) { loading.remove(); if (await openLocal(id, onClose)) return; }
    loading.remove();
    alertBox(e.status === 403 ? "Vous ne faites pas partie de l'équipe de cet événement." : e.status === 404 ? "Événement introuvable." : !e.status ? "Pas de réseau, et cet événement n'est pas gardé sur cet appareil (Fichier › Travailler hors ligne)." : `Ouverture impossible : ${e.code || e.message}`);
    history.replaceState(null, "", listHash());
    return;
  }
  try {
    let key = null;
    if (info.event.encrypted) {
      key = await S.keyFor(id);
      if (!key) {
        loading.remove();
        const v = await modal({ title: "Événement chiffré", ok: "Ouvrir", body: field("Phrase de passe de l'équipe", '<input name="p" type="password" autocomplete="current-password">'),
          validate: async (o) => ((await S.unlock(id, info.event.encrypted, o.p)) ? null : "Phrase de passe incorrecte.") });
        if (!v) { history.replaceState(null, "", listHash()); return; }
        key = await S.keyFor(id);
        document.body.appendChild(loading);
      }
    }
    const [evR, mapR] = await Promise.all([S.loadJson(id, "event", key), S.loadMap(id, key)]);
    let ev = evR?.data || M.newEvent({ title: info.event.title }), dirty = false;
    // changes made offline and not sent yet: sent now — or, if the team saved meanwhile, the user chooses
    const pend = await OFF.pendingOf(id, key).catch(() => null);
    if (pend) {
      if (pend.baseVersion === (evR?.version || 0)) { ev = pend.ev; dirty = true; }
      else {
        loading.remove();
        const v = await modal({ title: "Modifications faites hors ligne", ok: "Continuer", body: `<p>Des modifications faites sur cet appareil sans réseau (${new Date(pend.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}) n'ont pas été envoyées, et l'équipe a enregistré l'événement depuis.</p>
          <label class="tr-check"><input type="radio" name="w" value="mine" checked> Garder mes modifications (la version de l'équipe est gardée dans les versions)</label>
          <label class="tr-check"><input type="radio" name="w" value="team"> Prendre la version de l'équipe (mes modifications hors ligne sont abandonnées)</label>`, cancel: null });
        document.body.appendChild(loading);
        if (v?.w === "team") await OFF.clearPending(id);
        else { await S.saveVersion(id, ev, key, "Version de l'équipe, remplacée par des modifications faites hors ligne", "").catch(() => {}); ev = pend.ev; dirty = true; }
      }
    }
    const mapType = info.event.map?.type || mapR?.type || "";
    const mapSrc = mapR ? await openMap(mapR.bytes, mapType, info.event.map?.name || ev.map.file, ev.map.dpi, ev.map.kind === "ocad" ? ev.map : null).catch(() => null) : null;
    if (mapSrc && ev.map.kind === "bitmap" && ev.map.dpi) { mapSrc.dpi = ev.map.dpi; }
    loading.remove();
    const { openEditor } = await import("../tracer/editor.js");
    if (leaving) return;                                  // the user went to another page meanwhile
    pageMain.innerHTML = "";
    await openEditor({ container: pageMain, meta: info.event, role: info.role, you: info.you, ev, version: evR?.version || 0, mapSrc, key, readOnly: info.role === "viewer", align, dirty,
      lockHolder: info.lock, onClose });
  } catch (e) {
    loading.remove();
    alertBox(e.status === 403 ? "Vous ne faites pas partie de l'équipe de cet événement." : e.status === 404 ? "Événement introuvable." : `Ouverture impossible : ${e.code || e.message}`);
    history.replaceState(null, "", listHash());
  }
}

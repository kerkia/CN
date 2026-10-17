// « Organisation › Tracer » (#/orga-tracer): course setting in the browser, as Purple Pen does it (owner, 2026-10-15). The
// editor (tracer/editor.js) opens at once, empty, drawn in the page under the site's menus as the analyses are, and a start
// screen over it offers the three ways in (owner, 2026-10-17): a new event (a competition of one's club from the agenda, or a
// training) with its map (an OCAD or Mapper file, a PDF or an image); an event imported from an O'CN file (.ocnt, which holds
// its map) or a Purple Pen file (.ppen) with its map; or one of one's events (those one created or whose team one belongs
// to). « Événements » in the editor, and the Fichier menu, bring the start screen back. « ⤢ » the whole window (Échap or « ⤡ »
// back), « ↗ » a tab of its own (?fen=1; fullwin.js). A link naming an event (?id=) opens it straight away.
// Courses stay secret: only the event's team opens it (functions/api/tracer).

import { html, raw, fmtDate } from "../util.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { getProv } from "./provisional.js";
import * as S from "../tracer/store.js";
import * as M from "../tracer/model.js";
import { readPpen } from "../tracer/ppen.js";
import { readOcn, isOcnFile } from "../tracer/ocnfile.js";
import { openMap, isMapFile, mimeOf, imageDpi, isPdf, isVectorMap, MAP_ACCEPT } from "../tracer/mapsrc.js";
import { geoFromWorld } from "../tracer/geo.js";
import { dropHtml, dropZone } from "../tracer/dialogs.js";
import { centreOnMap } from "../tracer/calage.js";
import * as OFF from "../tracer/offline.js";
import { bindFull, setFull, leaveFull, inOwnTab } from "../fullwin.js";
import { betaNotice } from "../beta.js";

const today = () => new Date().toISOString().slice(0, 10);
const listHash = () => (inOwnTab() ? "#/orga-tracer?fen=1" : "#/orga-tracer");
const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };
let current = null, pageMain = null, leaving = false;

export async function render(main, r) {
  pageMain = main; leaving = false;
  bindFull();
  if (inOwnTab()) setFull(true);                         // a tab opened alone by « ↗ »: the Tracer without the site's bar
  // the editor at once, empty; the beta notice over it (beta.js; owner, 2026-10-16); then the event a link names, else the start screen
  const notice = betaNotice("tracer");
  await openBlank();
  notice.then(() => { if (leaving) return; if (r.query.id) openEvent(r.query.id); else startScreen(); });
  return { title: "Tracer", cleanup: () => { leaving = true; document.querySelector(".tr-start")?.remove(); window.__tracer?.close?.(); leaveFull(); } };
}

// ---- the editor: empty, or an event; switching closes the open one first (saved, its lock released) ---------------------------
let switching = false;
async function closeEditor() {
  const E = window.__tracer;
  if (!E) return;
  switching = true;
  try { await E.close(); } finally { switching = false; }
}
/** The editor closed by itself (« ↗ » moved the event to a tab of its own): the empty editor and the start screen here. */
function onClose() {
  if (leaving || switching) return;
  history.replaceState(null, "", listHash());
  openBlank().then(() => startScreen());
}
/** The start screen's choices, from the editor (« Événements », the Fichier menu, files dropped on an empty editor). */
function onStart(kind = "", files = null) {
  if (files?.length && (kind === "new" || kind === "import")) { choose(kind, files); return; }
  startScreen(kind);
}
async function openBlank() {
  const { openEditor } = await import("../tracer/editor.js");
  if (leaving) return;
  await closeEditor();
  if (leaving) return;
  pageMain.innerHTML = "";
  await openEditor({ container: pageMain, blank: true, meta: { id: null, title: "" }, role: "viewer", you: null, ev: M.newEvent({}), version: 0,
    mapSrc: null, onStart, onClose });
}
/** After a dialog given up: the start screen again when no event is open. */
const backToStart = () => { if (!leaving && window.__tracer?.blank && !document.querySelector(".tr-modal")) startScreen(); };
async function choose(kind, files = null) {
  closeStart();
  const id = kind === "new" ? await newEvent(pageMain, files) : await importEvent(pageMain, files || []);
  if (!id) backToStart();
}

/** One's events (those one created or whose team one belongs to); without network, those kept on this device. */
async function loadEvents() {
  try { const d = await S.api(""); current = { club: d.club }; return d.events; }
  catch (e) {
    const kept = e.status ? [] : await OFF.keptEvents().catch(() => []);
    if (!kept.length) throw e;
    return kept.map((x) => ({ ...x, mine: false, offline: true }));
  }
}

// ---- the start screen: over the editor, the three ways in, each saying what it does and what it needs ------------------------------
function closeStart() {
  const el = document.querySelector(".tr-start");
  if (el) { el._off?.(); el.remove(); }
}
function startScreen(focus = "") {
  const E = window.__tracer;
  if (!E || leaving) return;
  closeStart();
  const el = document.createElement("div");
  el.className = "tr-start";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "tr-start-h");
  const ico = (k) => `<span class="tr-start-ico" aria-hidden="true">${{ new: "＋", import: "⇩", open: "▤" }[k]}</span>`;
  el.innerHTML = html`<div class="tr-start-box">
    <div class="tr-start-head"><h2 id="tr-start-h">Que voulez-vous faire ?</h2>
      <button type="button" class="tr-start-x" data-start-close title="Fermer (Échap)" aria-label="Fermer">×</button></div>
    <div class="tr-start-cards">
      <section class="tr-start-card" data-k="new">
        <h3>${raw(ico("new"))}Nouvel événement</h3>
        <p>Tracer les circuits d'une compétition de votre club ou d'un entraînement, sur votre carte.</p>
        <p class="tr-start-need"><b>Il vous faut</b> la carte : un fichier OCAD (.ocd) ou OpenOrienteering Mapper (.omap, .xmap) de préférence, sinon un PDF ou une image (JPG, PNG, TIFF…).</p>
        <button type="button" class="btn btn-primary" data-start="new">Créer un événement…</button>
      </section>
      <section class="tr-start-card" data-k="import">
        <h3>${raw(ico("import"))}Importer un événement</h3>
        <p>Reprendre un événement préparé ailleurs : sur un autre compte, un autre club, ou dans Purple Pen.</p>
        <p class="tr-start-need"><b>Il vous faut</b> un fichier O'CN (.ocnt), qui contient déjà la carte, ou un fichier Purple Pen (.ppen) et le fichier de sa carte.</p>
        <button type="button" class="btn" data-start="import">Importer…</button>
      </section>
      <section class="tr-start-card tr-start-open" data-k="open">
        <h3>${raw(ico("open"))}Ouvrir un événement</h3>
        <p>Reprendre un de vos événements : ceux que vous avez créés et ceux dont l'équipe vous compte.</p>
        <div class="tr-start-list" id="tr-start-list"><div class="muted">Chargement…</div></div>
      </section>
    </div>
    <p class="tr-start-foot">Vous pouvez aussi déposer vos fichiers sur cette fenêtre : une carte seule pour un nouvel événement, un fichier .ocnt, ou un .ppen avec sa carte, pour un import.
      Les circuits restent secrets : seule l'équipe de l'événement l'ouvre (son créateur et les licenciés qu'il ajoute), pas les administrateurs du site.</p>
  </div>`;
  E.root.appendChild(el);
  el.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.start)));
  el.querySelector("[data-start-close]").addEventListener("click", closeStart);
  el.addEventListener("pointerdown", (e) => { if (e.target === el) closeStart(); });
  const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".tr-modal")) { e.stopPropagation(); e.preventDefault(); closeStart(); } };
  document.addEventListener("keydown", onKey, true);
  el._off = () => document.removeEventListener("keydown", onKey, true);
  // files dropped on it: a map alone, a new event; a .ocnt, or a .ppen with or without its map, an import
  el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); } });
  el.addEventListener("dragleave", (e) => { if (e.target === el) el.classList.remove("over"); });
  el.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    el.classList.remove("over");
    if (!files.length) return;
    e.preventDefault(); e.stopPropagation();
    choose(files.some((f) => isPpenFile(f) || isOcnFile(f)) ? "import" : "new", files);
  });
  if (focus) el.querySelector(`[data-k="${focus}"]`)?.classList.add("focus");
  (el.querySelector(`[data-k="${focus}"] button`) || el.querySelector("[data-start='new']"))?.focus({ preventScroll: true });
  fillOpenList(el);
}
async function fillOpenList(el) {
  const box = el.querySelector("#tr-start-list");
  let events;
  try { events = await loadEvents(); }
  catch (e) { box.innerHTML = html`<div class="tr-err">Liste indisponible (${e.code || e.message}).</div>`; return; }
  if (!document.contains(box)) return;
  const openId = window.__tracer?.blank ? null : window.__tracer?.meta?.id;
  box.innerHTML = events.length ? html`<ul>${events.map((e) => html`<li><button type="button" data-open="${e.id}" ${raw(e.id === openId ? 'aria-current="true"' : "")}>
      <span class="tr-start-t">${e.title}${e.encrypted ? " 🔒" : ""}</span>
      <span class="tr-start-m">${fmtDate(e.date, "short")} · ${e.kind === "race" ? "Compétition" : "Entraînement"}${e.mine ? "" : ` · ${e.ownerName || "équipe"}`}${e.offline ? " · hors ligne" : ""}${e.pending ? " · à envoyer" : ""}${e.id === openId ? " · ouvert" : ""}</span>
    </button></li>`)}</ul>`
    : html`<div class="muted">Aucun événement pour l'instant : créez-en un, ou importez un fichier.</div>`;
  box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    closeStart();
    if (b.dataset.open === openId) return;
    history.replaceState(null, "", `#/orga-tracer?id=${b.dataset.open}${inOwnTab() ? "&fen=1" : ""}`);
    openEvent(b.dataset.open);
  }));
}

// ---- a modal outside the editor (same look) -------------------------------------------------------------------------------
async function modal(opts) { return (await import("../tracer/dialogs.js")).modal(null, opts); }
const field = (label, input, hint = "") => `<label class="tr-field"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ""}</label>`;
const escA = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The competitions one's club organises: the agenda's coming ones and « Résultats »' recent ones. */
async function clubRaces() {
  if (!current) await loadEvents().catch(() => {});
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

// ---- a new event: its map, dropped or chosen ----------------------------------------------------------------------------------
async function newEvent(main, files = null) {
  const races = await clubRaces();
  let mapFile = null, vec = null, handed = false;
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
      if (list.some((x) => isPpenFile(x) || isOcnFile(x))) { handed = true; done(null); importEvent(main, list).then((id) => { if (!id) backToStart(); }); return; }   // the import
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
  if (!v) return handed ? "import" : null;               // a .ppen or .ocnt dropped here went on to the import
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
  history.replaceState(null, "", `#/orga-tracer?id=${created.id}${inOwnTab() ? "&fen=1" : ""}`);
  openEvent(created.id);
  return created.id;
}

// ---- an imported event: an O'CN file (.ocnt, which holds its map), or a Purple Pen file (.ppen) and its map, dropped together or one after the other
async function importEvent(main, files = []) {
  const races = await clubRaces();
  const st = { ppen: null, ocn: null, ev: null, map: null, mapFromOcn: false, notes: [] };
  const v = await modal({ title: "Importer un événement", wide: true, ok: "Importer", body: `
    <p>Un fichier <b>O'CN (.ocnt)</b>, qui contient tout l'événement et sa carte ; ou un fichier <b>Purple Pen (.ppen)</b> et <b>sa carte</b> : déposez-les ensemble ici,
    l'un après l'autre, ou cliquez pour les choisir. La carte d'un .ppen peut être un fichier OCAD (.ocd) ou OpenOrienteering Mapper (.omap, .xmap), un PDF ou une image
    (JPG, PNG, GIF, TIFF, BMP) : le fichier que nomme le .ppen, ou à défaut n'importe quel PDF ou image de la même carte (un scan ou une photo prise bien à plat
    conviennent) — vous calerez alors les postes sur la carte en deux clics.</p>
    ${dropHtml("tr-imp-drop", "Déposez ici le fichier .ocnt, ou le .ppen et sa carte (OCAD, Mapper, PDF ou image), ou cliquez pour les choisir", `.ocnt,.ppen,.xml,${MAP_ACCEPT}`)}
    <ul class="tr-files" id="tr-imp-files"></ul>
    <h3>L'événement</h3>
    ${kindFields(races)}`,
  onOpen: (f) => {
    bindKind(f, races);
    const render = () => {
      const ev = st.ev, expected = ev?.map?.file || "", ocad = /\.(ocd|omap|xmap)$/i.test(expected) || ev?.map?.kind === "ocad";
      const lines = [];
      if (st.ocn && ev) {
        const nCtl = Object.values(ev.controls).filter((c) => c.kind === "normal").length;
        lines.push(`<li class="ok">✓ Fichier O'CN « ${escA(st.ocn.name)} » : ${escA(ev.title || "sans titre")}, ${Object.keys(ev.courses).length} circuit(s), ${nCtl} poste(s)${expected ? ` ; sa carte : « ${escA(expected)} » au 1:${ev.map.scale}` : ""}${st.mapFromOcn ? ", comprise dans le fichier" : ""}.</li>`);
      } else if (st.ppen && ev) {
        const nCtl = Object.values(ev.controls).filter((c) => c.kind === "normal").length;
        lines.push(`<li class="ok">✓ Fichier Purple Pen « ${escA(st.ppen.name)} » : ${escA(ev.title || "sans titre")}, ${Object.keys(ev.courses).length} circuit(s), ${nCtl} poste(s)${expected ? ` ; sa carte : « ${escA(expected)} » au 1:${ev.map.scale}` : ""}.</li>`);
      } else lines.push('<li class="todo">… Le fichier .ocnt ou .ppen : pas encore choisi.</li>');
      if (st.map && st.mapFromOcn) { /* the .ocnt's own map: said on its line */ } else if (st.map) {
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
        if (isOcnFile(file)) {
          try {
            const r = await readOcn(await file.arrayBuffer());
            st.ev = r.ev; st.ocn = file; st.ppen = null;
            if (r.map) { st.map = new File([r.map.bytes], r.map.name, { type: r.map.type || mimeOf(r.map.name, "") }); st.mapFromOcn = true; }
            if (f.elements.title && !f.elements.title.value) f.elements.title.value = st.ev.title || "";
          } catch (e) { st.notes.push(`« ${escA(file.name)} » : ${escA(e.message)}.`); }
        } else if (isPpenFile(file)) {
          try { st.ev = readPpen(await file.text()); st.ppen = file; st.ocn = null; if (st.mapFromOcn) { st.map = null; st.mapFromOcn = false; } if (f.elements.title && !f.elements.title.value) f.elements.title.value = st.ev.title || ""; }
          catch (e) { st.notes.push(`« ${escA(file.name)} » n'est pas un fichier Purple Pen lisible.`); }
        } else if (isMapFile(file)) { st.map = file; st.mapFromOcn = false; }
        else st.notes.push(`« ${escA(file.name)} » n'est ni un fichier .ocnt ou .ppen, ni une carte (OCAD, Mapper, PDF ou image).`);
      }
      render();
    };
    dropZone(f.querySelector("#tr-imp-drop"), take);
    render();
    if (files?.length) take(files);
  },
  validate: (o) => (!st.ev ? "Il manque le fichier .ocnt ou .ppen." : !st.map ? "Il manque la carte (OCAD, Mapper, PDF ou image)." : kindProblem(o)) });
  if (!v) return null;
  const ev = st.ev, file = st.map, bytes = new Uint8Array(await file.arrayBuffer()), type = mimeOf(file.name, file.type);
  // an O'CN file on its own map (inside it, or the same file): the event as it was, in its own frame — nothing to align
  if (st.ocn && (st.mapFromOcn || baseName(file.name) === baseName(ev.map.file))) {
    let err0 = null;
    const src = await openMap(bytes, type, file.name, ev.map.dpi || 0, ev.map.kind === "ocad" ? ev.map : null).catch((e) => { err0 = e; return null; });
    if (!src) { alertBox(mapError(err0)); return null; }
    const created = await createEvent(v, races);
    if (!created) return null;
    ev.map.file = file.name;
    if (src.kind === "vector" && ev.map.kind === "ocad") { ev.map.w = src.w; ev.map.h = src.h; }
    if (!ev.title) ev.title = created.title;
    await S.saveMap(created.id, bytes, type, null);
    await S.api(`/${created.id}`, { method: "PUT", body: { map: { name: file.name, type, size: bytes.length } } });
    await S.saveEvent(created.id, ev, null, 0);
    history.replaceState(null, "", `#/orga-tracer?id=${created.id}${inOwnTab() ? "&fen=1" : ""}`);
    openEvent(created.id);
    return created.id;
  }
  // another file than the .ppen's own (an OCAD map's PDF or image, a scan): the controls are aligned on it once opened; an OCAD or
  // Mapper map for a .ppen made on one keeps the controls' coordinates (Purple Pen keeps the map file's own millimetres)
  const vector = isVectorMap(file.name, bytes), ppenOcad = ev.map.kind === "ocad" || /\.(ocd|omap|xmap)$/i.test(ev.map.file || "");
  // an O'CN file on another map than its own: aligned like a .ppen on another map (its coordinates are its own frame's)
  const differs = st.ocn ? true : vector ? !ppenOcad : ppenOcad || (!!ev.map.file && baseName(ev.map.file) !== baseName(file.name));
  let err = null;
  const src = await openMap(bytes, type, file.name, ev.map.dpi || 0).catch((e) => { err = e; return null; });
  if (!src) { alertBox(mapError(err)); return null; }
  const created = await createEvent(v, races);
  if (!created) return null;
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
  history.replaceState(null, "", `#/orga-tracer?id=${created.id}${inOwnTab() ? "&fen=1" : ""}`);
  openEvent(created.id, { align: differs });
  return created.id;
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
  await closeEditor();
  pageMain.innerHTML = "";
  await openEditor({ container: pageMain, meta: rec.meta, role: rec.role, you: rec.you, ev: rec.ev, version: rec.baseVersion, mapSrc, key, readOnly: rec.role === "viewer", offline: true, onClose, onStart });
  return true;
}
function alertBox(text) { return modal({ title: "Tracer", body: `<p>${escA(text)}</p>`, cancel: null }); }

// ---- opening ----------------------------------------------------------------------------------------------------------------
async function openEvent(id, { align = false } = {}) {
  const loading = document.createElement("div");
  loading.className = "tr-loading"; loading.innerHTML = '<div class="spinner"></div><p>Ouverture de l\'événement…</p>';
  document.body.appendChild(loading);
  let info;
  try { info = await S.api(`/${id}`); }
  catch (e) {
    // no network: the copy kept on this device, if any (offline.js)
    if (!e.status) { loading.remove(); if (await openLocal(id, onClose)) return; }
    loading.remove();
    history.replaceState(null, "", listHash());
    await alertBox(e.status === 403 ? "Vous ne faites pas partie de l'équipe de cet événement." : e.status === 404 ? "Événement introuvable." : !e.status ? "Pas de réseau, et cet événement n'est pas gardé sur cet appareil (Fichier › Travailler hors ligne)." : `Ouverture impossible : ${e.code || e.message}`);
    backToStart();
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
        if (!v) { history.replaceState(null, "", listHash()); backToStart(); return; }
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
    await closeEditor();
    if (leaving) return;
    pageMain.innerHTML = "";
    await openEditor({ container: pageMain, meta: info.event, role: info.role, you: info.you, ev, version: evR?.version || 0, mapSrc, key, readOnly: info.role === "viewer", align, dirty,
      lockHolder: info.lock, onClose, onStart });
  } catch (e) {
    loading.remove();
    history.replaceState(null, "", listHash());
    await alertBox(e.status === 403 ? "Vous ne faites pas partie de l'équipe de cet événement." : e.status === 404 ? "Événement introuvable." : `Ouverture impossible : ${e.code || e.message}`);
    backToStart();
  }
}

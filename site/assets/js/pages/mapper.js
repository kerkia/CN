// « Orga › Cartographier » (#/orga-carto; owner, 2026-11-06): drawing and updating orienteering maps in the browser, as OCAD
// and OpenOrienteering Mapper do, with the Tracer's ribbon. The page opens on one's maps (those one created or whose team one
// joined) and three ways in: a new map (sprint or forest, its place, the IOF's symbol set, open data to start from), a map file
// (OCAD 6-2018, Mapper, Ozimut's .ozmap) imported, or one of one's maps. A link naming a map (?id=) opens it; with ?invite= the
// account joins its team first. The editor is mapper/editor.js; the document mapper/doc.js (docs/mapper/model.md).

import { html, raw } from "../util.js";
import * as S from "../mapper/store.js";
import { bindFull, leaveFull, inOwnTab, setFull } from "../fullwin.js";
import { betaNotice } from "../beta.js";
import { t, tn, locale } from "../mapper/lang.js";

let pageMain = null, leaving = false, reopening = false;
const when = (s) => (s ? new Date(s).toLocaleDateString(locale(), { dateStyle: "medium" }) : "");

export async function render(main, r) {
  pageMain = main; leaving = false;
  bindFull();
  if (inOwnTab()) setFull(true);
  await betaNotice("mapper");
  if (leaving) return {};
  if (r.query.id && r.query.invite) { try { await S.join(r.query.id, r.query.invite); } catch (e) { toastErr(e); } history.replaceState(null, "", `#/orga-carto?id=${r.query.id}`); }
  if (r.query.id) await openMap(r.query.id); else await start();
  return { title: t("map.page.title"), cleanup: () => { leaving = true; window.__mapper?.close?.(); leaveFull(); } };
}
function toastErr(e) { const p = document.createElement("p"); p.className = "mp-err"; p.textContent = e?.message || String(e); pageMain?.prepend(p); }

// ---- the start page --------------------------------------------------------------------------------------------------------------
async function start(focus = "") {
  await window.__mapper?.close?.();
  if (leaving) return;
  history.replaceState(null, "", inOwnTab() ? "#/orga-carto?fen=1" : "#/orga-carto");
  pageMain.innerHTML = html`<section class="mp-start">
    <div class="page-head"><h1>${t("map.page.title")}</h1><p class="lede">${t("map.page.lede")}</p></div>
    <div class="mp-start-cards">
      <section class="card mp-card" data-k="new"><h2>${t("map.start.new")}</h2><p>${t("map.start.newDesc")}</p><button type="button" class="btn btn-primary" data-start="new">${t("map.start.newBtn")}</button></section>
      <section class="card mp-card" data-k="import"><h2>${t("map.start.import")}</h2><p>${t("map.start.importDesc")}</p>
        <div class="tr-drop mp-drop" id="mp-drop" tabindex="0" role="button">${t("map.start.drop")}</div><input type="file" id="mp-file" accept=".ocd,.omap,.xmap,.ozmap" hidden></section>
      <section class="card mp-card mp-mine" data-k="open"><h2>${t("map.start.mine")}</h2><div id="mp-list"><p class="muted">${t("map.start.loading")}</p></div></section>
    </div></section>`;
  const drop = pageMain.querySelector("#mp-drop"), input = pageMain.querySelector("#mp-file");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
  input.addEventListener("change", () => { if (input.files[0]) importFile(input.files[0]); });
  for (const ev of ["dragover", "dragenter"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
  pageMain.querySelector("[data-start=new]").addEventListener("click", () => newMap());
  if (focus === "new") newMap();
  if (focus === "import") input.click();
  let maps = [];
  try { maps = (await S.list()).maps; }
  catch (e) { const F = await import("../mapper/field.js"); maps = await F.keptMaps().catch(() => []); }
  const box = pageMain.querySelector("#mp-list");
  if (!box) return;
  box.innerHTML = maps.length ? html`<ul class="mp-maps">${maps.map((m) => html`<li><button type="button" data-open="${m.id}"><b>${m.title}</b>
      <small>${[m.scale ? `1:${new Intl.NumberFormat(locale()).format(m.scale)}` : "", m.standard, m.objects ? tn("map.start.objects", m.objects) : "", m.mine === false ? t("map.start.shared", { name: m.ownerName || "" }) : "", m.offline ? t("map.start.offline") : "", when(m.updated)].filter(Boolean).join(" · ")}</small></button>
      ${m.mine ? raw(`<button type="button" class="tr-icon" data-del="${m.id}" title="${t("map.start.delete")}" aria-label="${t("map.start.delete")}">✕</button>`) : ""}</li>`)}</ul>`
    : html`<p class="muted">${t("map.start.none")}</p>`;
  box.addEventListener("click", async (e) => {
    const o = e.target.closest("[data-open]"); if (o) { history.pushState(null, "", `#/orga-carto?id=${o.dataset.open}`); openMap(o.dataset.open); return; }
    const d = e.target.closest("[data-del]");
    if (d) {
      const { modal } = await import("../tracer/dialogs.js");
      const ok = await modal(null, { title: t("map.start.delete"), body: `<p>${t("map.start.deleteQ")}</p>`, ok: t("map.start.delete") });
      if (ok) { await S.remove(d.dataset.del); d.closest("li").remove(); }
    }
  });
}

// ---- a new map ------------------------------------------------------------------------------------------------------------------
async function newMap() {
  const { modal, field } = await import("../tracer/dialogs.js");
  const v = await modal(null, { title: t("map.new.title"), wide: true, body: `
    ${field(t("map.new.name"), `<input name="title" required maxlength="140">`)}
    <fieldset class="mp-choice"><legend>${t("map.new.kind")}</legend>
      <label><input type="radio" name="kind" value="sprint" required> ${t("map.new.sprint")}</label>
      <label><input type="radio" name="kind" value="forest" required> ${t("map.new.forest")}</label></fieldset>
    ${field(t("map.new.place"), `<input name="place" placeholder="48.3512, -1.2038">`, t("map.new.placeHint"))}
    <p><button type="button" class="btn btn-sm" data-here>${t("map.new.here")}</button></p>
    ${field(t("map.new.size"), `<select name="size"><option value="0.5">0,5 km</option><option value="1" selected>1 km</option><option value="2">2 km</option><option value="3">3 km</option></select>`)}
    <fieldset class="mp-choice"><legend>${t("map.new.data")}</legend>
      <label><input type="checkbox" name="osm" checked> ${t("map.new.osm")}</label>
      <label><input type="checkbox" name="dem" checked> ${t("map.new.dem")}</label>
      <label><input type="checkbox" name="lidar"> ${t("map.new.lidar")}</label></fieldset>`,
    onOpen: (form) => form.querySelector("[data-here]").addEventListener("click", () => navigator.geolocation?.getCurrentPosition((p) => { form.place.value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; }, () => {}, { enableHighAccuracy: true, timeout: 15000 })),
    validate: (x) => (!x.kind ? t("map.new.needKind") : x.place && !parsePlace(x.place) ? t("map.new.badPlace") : null) });
  if (!v) return;
  const sprint = v.kind === "sprint", scale = sprint ? 4000 : 10000, standard = sprint ? "ISSprOM2019-2" : "ISOM2017-2";
  const L = await import("../mapper/layout.js"), D = await import("../mapper/doc.js");
  const set = await L.loadSet(sprint ? "issprom2019-2" : "isom2017-2");
  const doc = D.blank({ title: v.title, scale, standard, colors: set.colors, symbols: L.scaled(set, scale).map((s) => ({ ...s, set: sprint ? "issprom2019-2" : "isom2017-2" })) });
  const place = parsePlace(v.place);
  if (place) doc.realWorld = await realWorldAt(place, scale);
  const { id } = await S.create({ title: v.title, scale, standard, place: place ? { lat: place[0], lon: place[1] } : null });
  history.pushState(null, "", `#/orga-carto?id=${id}`);
  const E = await openEditor(id, { doc, version: 0, isNew: true });
  if (place && E) {
    const half = (Number(v.size) * 1e6) / scale / 2;                 // the square's half side, map mm
    E.dataArea = [-half, -half, half, half];
    E.live.transact("", () => E.live.setDocField("printArea", [-half, -half, half, half]));
    E.view.fit(E.dataArea);
    for (const [k, act] of [["dem", "data-contours"], ["osm", "data-osm"], ["lidar", "data-lidar"]]) if (v[k]) await E.act(act);
  }
}
const parsePlace = (s) => { const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(String(s || "")); if (!m) return null; const la = Number(m[1].replace(",", ".")), lo = Number(m[2].replace(",", ".")); return Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null; };
/** The map's grid at a place: Lambert 93 in metropolitan France, else the place's UTM zone; the map's origin at the place. */
async function realWorldAt([lat, lon], scale) {
  const F = await import("../mapper/data/frame.js");
  const inFrance = lat > 41 && lat < 51.2 && lon > -5.5 && lon < 9.8;
  if (inFrance) { const [x, y] = F.toL93(lat, lon); return { x, y, angle: 0, grid: 0, paperGrid: 0, on: true, zone: 0, epsg: 2154, gridScale: 1 }; }
  const zone = Math.floor((lon + 180) / 6) + 1, epsg = (lat >= 0 ? 32600 : 32700) + zone;
  const p4 = await F.proj4lib();
  const [x, y] = p4("WGS84", `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m`, [lon, lat]);
  void scale;
  return { x, y, angle: 0, grid: 0, paperGrid: 0, on: true, zone: 0, epsg, gridScale: 1 };
}

// ---- a file imported -------------------------------------------------------------------------------------------------------------
async function importFile(file) {
  const IO = await import("../mapper/io.js");
  let got;
  try { got = await IO.openBytes(await file.arrayBuffer(), file.name); }
  catch (e) { toastErr(e); return; }
  const { doc, source, files } = got;
  if (!doc.title) doc.title = file.name.replace(/\.[^.]+$/, "");
  const { id } = await S.create({ title: doc.title, scale: doc.scale, standard: doc.standard || "" });
  if (source) { await S.saveSource(id, source); await S.setCard(id, { source: { name: file.name, kind: "ocad", version: doc.ocad?.version || 0 } }); }
  for (const [sha, f] of Object.entries(files || {})) await S.saveFile(id, f.bytes, f.type || "application/octet-stream").catch(() => {});
  history.pushState(null, "", `#/orga-carto?id=${id}`);
  const E = await openEditor(id, { doc, version: 0, source, isNew: true });
  if (E && doc.omap?.losses?.length) IO.sayLosses(E, doc.omap.losses);
}

// ---- opening a map ---------------------------------------------------------------------------------------------------------------
async function openMap(id) {
  let card, doc, version, source = null;
  try {
    card = await S.card(id);
    ({ doc, version } = await S.loadDoc(id));
    if (card.map.source) source = await S.loadSource(id);
    // changes made on this device without the network, newer than the server's
    const F = await import("../mapper/field.js");
    const pend = await F.pendingOf(id);
    if (pend && pend.base === version) { doc = pend.doc; await F.clearPending(id); }
  } catch (e) {
    // without the network: this device's copy
    const F = await import("../mapper/field.js");
    const kept = await F.keptMap(id);
    if (!kept) { toastErr(e); await start(); return; }
    const pend = await F.pendingOf(id);
    card = { map: kept.card?.map || kept.card, role: kept.role }; doc = pend?.doc || kept.doc; version = pend?.base ?? kept.version; source = kept.source;
    return openEditor(id, { doc, version, source, card, role: kept.role, files: kept.files, offline: true });
  }
  if (!doc) { toastErr(new Error(t("map.page.empty"))); await start(); return; }
  return openEditor(id, { doc, version, source, card });
}
async function openEditor(id, { doc, version, source = null, card = null, role = null, files = {}, isNew = false }) {
  if (leaving) return null;
  const { openEditor: open } = await import("../mapper/editor.js");
  await window.__mapper?.close?.();
  pageMain.innerHTML = "";
  const c = card || (await S.card(id).catch(() => null));
  return open({ container: pageMain, id, card: c?.map || null, role: role || c?.role || "owner", doc, version, source, files, isNew,
    onClose: () => { if (!leaving && !reopening && !document.querySelector(".mp-app")) start(); },
    onStart: async (kind, arg) => {
      if (kind === "reopen") {
        // a version restored, or the teammate's save kept after a conflict: the editor opened again on it
        reopening = true;
        try { await window.__mapper?.close?.(); const c2 = await S.card(arg.id); await openEditor(arg.id, { doc: arg.doc, version: c2.map.version, source, isNew: !!arg.restored }); }
        finally { reopening = false; }
        return;
      }
      start(kind);
    } });
}

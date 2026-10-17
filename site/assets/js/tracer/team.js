// The team's tools in the Tracer: comments pinned on the map (a remark of the controller on control 43, the setter's answer,
// marked done), and the field mode — on a phone in the forest, the map with one's GPS position (once the map is
// georeferenced), the nearest control, and each control's state as the team goes round: set, checked, collected. Field
// states recorded without a network wait in this browser and go when it returns. Both are kept beside the event
// (/api/tracer/<id>/comments and /field), encrypted with it when the team chose so.

import * as M from "./model.js";
import * as S from "./store.js";
import * as G from "./geo.js";
import { modal, field } from "./dialogs.js";
import { ctrlName } from "./reports.js";
import * as IDB from "./idb.js";
import { where } from "./ribbon-data.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const when = (t) => new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const me = (E) => E.you?.name || "Moi";
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- comments ----------------------------------------------------------------------------------------------------------------
async function loadComments(E) {
  const r = await S.loadJson(E.meta.id, "comments", E.key).catch(() => null);
  return r?.data?.items ? r.data : { items: [] };
}
/** Save after merging with what the others saved meanwhile (by comment id; replies and the done mark are kept). */
async function saveComments(E, mutate) {
  const cur = await loadComments(E);
  mutate(cur);
  await S.saveJson(E.meta.id, "comments", cur, E.key);
  E.commentsData = cur;
  E.redraw();
  return cur;
}
function commentsOverlay(E) {
  if (E.commentsOverlay) return;
  E.commentsOverlay = (g, T) => {
    if (!E.opts.showComments) return;
    const items = (E.commentsData?.items || []).filter((c) => !c.done);
    items.forEach((c) => {
      const p = c.pt || (c.control && E.ev.controls[c.control] ? [E.ev.controls[c.control].x, E.ev.controls[c.control].y] : null);
      if (!p) return;
      const [x, y] = T(...p), n = E.commentsData.items.indexOf(c) + 1;
      g.save();
      g.fillStyle = "#f59e0b"; g.strokeStyle = "#7c2d12"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y - 10); g.arc(x, y - 16, 9, Math.PI * 0.72, Math.PI * 2.28); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = "#111"; g.font = "bold 10px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), x, y - 16);
      g.restore();
    });
  };
  E.overlays.push(E.commentsOverlay);
}
export async function comments(E, focus = null) {
  commentsOverlay(E);
  E.opts.showComments = true;
  E.status("Commentaires…", "busy");
  let data;
  try { data = await loadComments(E); } catch (err) { E.status("Prêt", "ok"); E.toast("Commentaires indisponibles."); return; }
  E.commentsData = data; E.redraw(); E.status("Prêt", "ok");
  const sel = E.sel?.control ? E.sel.control : null;
  const open = data.items.filter((c) => !c.done).length;
  const item = (c, i) => `<li class="tr-cmt ${c.done ? "done" : ""}" data-id="${c.id}">
    <div><b>${i + 1}.</b> ${c.control ? `<span class="tr-tag">poste ${esc(ctrlName(E.ev, c.control))}</span> ` : ""}${c.course && E.ev.courses[c.course] ? `<span class="tr-tag">${esc(E.ev.courses[c.course].name)}</span> ` : ""}
    <small>${esc(c.by)}, ${when(c.at)}</small></div><p>${esc(c.text)}</p>
    ${(c.replies || []).map((r) => `<p class="tr-reply"><small>${esc(r.by)}, ${when(r.at)}</small><br>${esc(r.text)}</p>`).join("")}
    <div class="tr-cmt-btns">${c.pt || c.control ? '<button type="button" class="btn btn-sm" data-go>Voir</button>' : ""}
    <button type="button" class="btn btn-sm" data-reply>Répondre</button>
    <button type="button" class="btn btn-sm" data-done>${c.done ? "Rouvrir" : "Fait"}</button></div></li>`;
  const v = await modal(E, { title: `Commentaires de l'équipe (${open} ouvert${open > 1 ? "s" : ""})`, wide: true, ok: "Ajouter", cancel: "Fermer", body: `
    <ol class="tr-cmts">${data.items.map(item).join("") || "<li><small>Aucun commentaire pour l'instant.</small></li>"}</ol>
    <h3>Nouveau commentaire</h3>
    ${field("Texte", '<textarea name="text" rows="3" maxlength="2000"></textarea>')}
    <label class="tr-check"><input type="radio" name="where" value="none" ${sel ? "" : "checked"}> Sans lieu</label>
    ${sel ? `<label class="tr-check"><input type="radio" name="where" value="control" checked> Sur le poste choisi (${esc(ctrlName(E.ev, sel))})</label>` : ""}
    <label class="tr-check"><input type="radio" name="where" value="pin"> Épingler à un endroit de la carte (cliquer ensuite)</label>
    ${E.cd.course ? `<label class="tr-check"><input type="checkbox" name="course" checked> Seulement pour le circuit ${esc(E.course().name)}</label>` : ""}
    <label class="tr-check"><input type="checkbox" name="show" ${E.opts.showComments ? "checked" : ""}> Montrer les commentaires ouverts sur la carte</label>`,
  validate: (o) => (o.text.trim() ? null : "Le texte du commentaire."),
  onOpen: (f, done) => {
    f.elements.show.addEventListener("change", () => { E.opts.showComments = f.elements.show.checked; E.redraw(); });
    f.querySelectorAll(".tr-cmt").forEach((li) => {
      const id = li.dataset.id, c = data.items.find((x) => x.id === id);
      li.querySelector("[data-go]")?.addEventListener("click", () => {
        done(null);
        const p = c.pt || [E.ev.controls[c.control].x, E.ev.controls[c.control].y];
        if (c.course && E.ev.courses[c.course] && E.cd.course !== c.course) E.setCourse(c.course);
        if (c.control && E.ev.controls[c.control]) E.select({ kind: "control", control: c.control, cc: 0 });
        const W = E.canvas.clientWidth, H = E.canvas.clientHeight, k = Math.max(E.view.k, 6);
        E.view = { k, ox: W / 2 - p[0] * k, oy: H / 2 + p[1] * k }; E.redraw();
      });
      li.querySelector("[data-reply]").addEventListener("click", async () => {
        done(null);
        const r = await modal(E, { title: `Répondre au commentaire ${data.items.indexOf(c) + 1}`, body: `<p><small>${esc(c.by)}</small> : ${esc(c.text)}</p>${field("Réponse", '<textarea name="t" rows="3" maxlength="2000"></textarea>')}`,
          validate: (o) => (o.t.trim() ? null : "Le texte de la réponse.") });
        if (r) await saveComments(E, (d) => { const x = d.items.find((y) => y.id === id); if (x) (x.replies ||= []).push({ at: Date.now(), by: me(E), text: r.t.trim() }); });
        comments(E);
      });
      li.querySelector("[data-done]").addEventListener("click", async () => {
        done(null);
        await saveComments(E, (d) => { const x = d.items.find((y) => y.id === id); if (x) { x.done = !x.done; x.doneBy = me(E); x.doneAt = Date.now(); } });
        comments(E);
      });
    });
  } });
  if (!v) return;
  const c = { id: uid(), at: Date.now(), by: me(E), lic: E.you?.lic || "", text: v.text.trim(), replies: [] };
  if (v.course && E.cd.course) c.course = E.cd.course;
  if (v.where === "control" && sel) c.control = sel;
  if (v.where === "pin") {
    E.help("Cliquez sur la carte l'endroit du commentaire (Échap pour annuler).");
    E.pickOnce = async (p) => { c.pt = [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; await saveComments(E, (d) => d.items.push(c)); E.toast("Commentaire épinglé."); };
    return;
  }
  await saveComments(E, (d) => d.items.push(c));
  E.toast("Commentaire ajouté.");
}

// ---- field mode ----------------------------------------------------------------------------------------------------------------
const STATES = [["set", "Posé", "#2563eb"], ["checked", "Vérifié", "#16a34a"], ["collected", "Ramassé", "#6b7280"], ["problem", "Problème", "#dc2626"]];
const stateOf = (k) => STATES.find((s) => s[0] === k);
const queueKey = (E) => `ocn.tr.field.${E.meta.id}`;
const readQueue = (E) => { try { return JSON.parse(localStorage.getItem(queueKey(E)) || "[]"); } catch (e) { return []; } };
const writeQueue = (E, q) => { try { if (q.length) localStorage.setItem(queueKey(E), JSON.stringify(q)); else localStorage.removeItem(queueKey(E)); } catch (e) { /* this visit only */ } };

async function loadField(E) {
  const r = await S.loadJson(E.meta.id, "field", E.key);
  return r?.data?.controls ? r.data : { controls: {}, log: [] };
}
/** Send the waiting changes: merged into the server's copy (the latest change of each control wins). */
async function sync(E) {
  const q = readQueue(E);
  if (!q.length || E.fieldSyncing) return;
  E.fieldSyncing = true;
  try {
    // the photos taken offline go first (kept in this browser until sent)
    for (const u of q) if (u.photo) {
      const bytes = await IDB.get("photos", u.photo);
      if (bytes) { await S.savePhoto(E.meta.id, u.photo, bytes, E.key); await IDB.del("photos", u.photo); }
    }
    const cur = await loadField(E);
    for (const u of q) {
      const old = cur.controls[u.control] || {};
      if (u.photo) { if (!(old.photos || []).some((x) => x.pid === u.photo)) cur.controls[u.control] = { ...old, photos: [...(old.photos || []), { pid: u.photo, at: u.at, by: u.by }] }; }
      else if (!old.at || old.at <= u.at) cur.controls[u.control] = { ...old, state: u.state, at: u.at, by: u.by, note: u.note || "", gps: u.gps || null };
      cur.log.push(u);
    }
    cur.log = cur.log.slice(-2000);
    await S.saveJson(E.meta.id, "field", cur, E.key);
    writeQueue(E, readQueue(E).filter((u) => !q.some((x) => x.uid === u.uid)));
    E.fieldData = cur;
  } catch (err) { /* offline: kept for later */ } finally { E.fieldSyncing = false; renderField(E); E.redraw(); }
}
function mark(E, controlId, state, note = "") {
  const gps = E.gps ? [Number(E.gps.lat.toFixed(6)), Number(E.gps.lon.toFixed(6)), Math.round(E.gps.acc)] : null;
  const u = { uid: uid(), control: controlId, state, at: Date.now(), by: me(E), note, gps };
  writeQueue(E, [...readQueue(E), u]);
  E.fieldData ||= { controls: {}, log: [] };
  E.fieldData.controls[controlId] = { ...(E.fieldData.controls[controlId] || {}), state, at: u.at, by: u.by, note, gps };
  renderField(E); E.redraw();
  sync(E);
}
function fieldOverlay(E) {
  if (E.fieldOverlay) return;
  E.fieldOverlay = (g, T, k) => {
    if (!E.fieldOn) return;
    const r = M.controlRadius(E.ev) * M.objRatio(E.ev, E.course()?.printScale || E.ev.allControls.printScale) * k;
    for (const [id, st] of Object.entries(E.fieldData?.controls || {})) {
      const c = E.ev.controls[id], s = stateOf(st.state);
      if (!c || !s) continue;
      const [x, y] = T(c.x, c.y);
      g.save(); g.strokeStyle = s[2]; g.lineWidth = 4; g.globalAlpha = 0.85;
      g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke(); g.restore();
    }
    if (E.gps && G.hasGeo(E.ev)) {
      const [mx, my] = G.toMm(E.ev, E.gps.lat, E.gps.lon), [x, y] = T(mx, my);
      const accPx = (E.gps.acc / (E.ev.map.scale / 1000)) * k;
      g.save();
      g.fillStyle = "rgba(37,99,235,.15)"; g.beginPath(); g.arc(x, y, Math.max(8, accPx), 0, Math.PI * 2); g.fill();
      g.fillStyle = "#2563eb"; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      if (Number.isFinite(E.gps.heading)) { const a = (E.gps.heading * Math.PI) / 180; g.beginPath(); g.moveTo(x + Math.sin(a) * 16, y - Math.cos(a) * 16); g.lineTo(x + Math.sin(a + 2.6) * 8, y - Math.cos(a + 2.6) * 8); g.lineTo(x + Math.sin(a - 2.6) * 8, y - Math.cos(a - 2.6) * 8); g.closePath(); g.fill(); }
      g.restore();
    }
  };
  E.overlays.push(E.fieldOverlay);
}
/** The control the buttons act on: the one chosen on the map, else the nearest to the GPS position. */
function target(E) {
  if (E.sel?.control && E.ev.controls[E.sel.control]) return { id: E.sel.control, d: E.gps && G.hasGeo(E.ev) ? distTo(E, E.sel.control) : null, chosen: true };
  if (!E.gps || !G.hasGeo(E.ev)) return null;
  const ids = E.cd.course ? [...new Set(M.ccIds(E.ev, E.cd).map((cc) => E.ev.courseControls[cc].control))] : Object.keys(E.ev.controls).map(Number);
  let best = null;
  for (const id of ids) { const d = distTo(E, id); if (!best || d < best.d) best = { id, d }; }
  return best;
}
function distTo(E, id) {
  const c = E.ev.controls[id], [mx, my] = G.toMm(E.ev, E.gps.lat, E.gps.lon);
  return M.mmToM(E.ev, Math.hypot(c.x - mx, c.y - my));
}
function bearing(E, id) {
  const c = E.ev.controls[id], [lat, lon] = G.toLatLon(E.ev, c.x, c.y);
  const p = Math.PI / 180, y = Math.sin((lon - E.gps.lon) * p) * Math.cos(lat * p);
  const x = Math.cos(E.gps.lat * p) * Math.sin(lat * p) - Math.sin(E.gps.lat * p) * Math.cos(lat * p) * Math.cos((lon - E.gps.lon) * p);
  return ((Math.atan2(y, x) / p) + 360) % 360;
}
function renderField(E) {
  const box = E.fieldBox;
  if (!box) return;
  const t = target(E), q = readQueue(E).length;
  const counts = Object.fromEntries(STATES.map(([k]) => [k, 0]));
  for (const st of Object.values(E.fieldData?.controls || {})) if (counts[st.state] != null) counts[st.state]++;
  const total = Object.values(E.ev.controls).filter((c) => c.kind === "normal").length;
  const st = t ? E.fieldData?.controls?.[t.id] : null;
  const gpsLine = !G.hasGeo(E.ev) ? `Carte non géoréférencée : pas de position GPS (${where("georef")}).`
    : !E.gps ? (E.gpsError || "Recherche de la position…") : `Position à ± ${Math.round(E.gps.acc)} m.`;
  box.innerHTML = `<div class="tr-field-head"><b>Mode terrain</b> <small>${esc(gpsLine)}</small>
      <button type="button" class="tr-icon" data-f="close" title="Quitter le mode terrain" aria-label="Quitter">✕</button></div>
    ${t ? `<div class="tr-field-target"><span class="tr-field-code">${esc(ctrlName(E.ev, t.id))}</span>
      ${t.d != null ? `<span>${Math.round(t.d)} m · ${Math.round(bearing(E, t.id))}°</span>` : ""}${t.chosen ? " <small>(choisi sur la carte)</small>" : " <small>(le plus proche)</small>"}
      ${st?.state ? `<small>${esc(stateOf(st.state)?.[1] || "")} par ${esc(st.by)}, ${when(st.at)}${st.note ? ` — ${esc(st.note)}` : ""}</small>` : "<small>Pas encore d'état.</small>"}
      ${st?.photos?.length ? `<small>${st.photos.length} photo${st.photos.length > 1 ? "s" : ""}</small>` : ""}</div>
      <div class="tr-field-btns">${STATES.map(([k, label, col]) => `<button type="button" class="btn" data-f="${k}" style="border-color:${col}">${label}</button>`).join("")}</div>`
    : '<p class="tr-hint">Touchez un poste sur la carte.</p>'}
    <div class="tr-field-foot"><small>${STATES.map(([k, label]) => `${label} ${counts[k]}`).join(" · ")} sur ${total} postes${q ? ` · ${q} en attente de réseau` : ""}</small>
      ${G.hasGeo(E.ev) && E.gps ? '<button type="button" class="btn btn-sm" data-f="me">Centrer sur moi</button>' : ""}
      ${t ? '<button type="button" class="btn btn-sm" data-f="photo">Photo</button>' : ""}
      <button type="button" class="btn btn-sm" data-f="list">Liste</button></div>`;
}
export async function fieldMode(E) {
  if (E.fieldOn) { stopField(E); return; }
  fieldOverlay(E);
  E.fieldOn = true;
  try { E.fieldData = await loadField(E); } catch (err) { E.fieldData = E.fieldData || { controls: {}, log: [] }; }
  for (const u of readQueue(E)) {
    const old = E.fieldData.controls[u.control] || {};
    E.fieldData.controls[u.control] = u.photo ? { ...old, photos: [...(old.photos || []), { pid: u.photo, at: u.at, by: u.by }] } : { ...old, state: u.state, at: u.at, by: u.by, note: u.note || "", gps: u.gps };
  }
  const box = document.createElement("div");
  box.className = "tr-field";
  E.root.appendChild(box);
  E.fieldBox = box;
  E.root.classList.add("tr-fieldmode");
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    const f = b.dataset.f;
    if (f === "close") { stopField(E); return; }
    if (f === "me" && E.gps) { const [mx, my] = G.toMm(E.ev, E.gps.lat, E.gps.lon), W = E.canvas.clientWidth, H = E.canvas.clientHeight, k = Math.max(E.view.k, 5); E.view = { k, ox: W / 2 - mx * k, oy: H / 2 + my * k }; E.redraw(); return; }
    if (f === "list") { fieldList(E); return; }
    if (f === "photo") { takePhoto(E); return; }
    const t = target(E); if (!t) return;
    let note = "";
    // set or checked far from where the map puts the control: said before it is noted (a wrong control, or the map)
    if ((f === "set" || f === "checked") && E.gps && G.hasGeo(E.ev)) {
      const d = distTo(E, t.id), sprint = E.ev.appearance.mapStandard === "Spr2019" || E.ev.map.scale <= 5000;
      const lim = Math.max(sprint ? 12 : 25, 1.5 * E.gps.acc);
      if (d > lim) {
        const v = await modal(E, { title: `Poste ${ctrlName(E.ev, t.id)} : ${Math.round(d)} m de la carte`, ok: f === "set" ? "Noter « posé » quand même" : "Noter « vérifié » quand même",
          body: `<p>Le téléphone est à <b>${Math.round(d)} m</b> de l'emplacement du poste sur la carte (GPS ± ${Math.round(E.gps.acc)} m).</p>
          <p>Vérifiez que c'est le bon poste et le bon objet ; sous les arbres, le GPS peut aussi s'écarter.</p>${field("Note (facultatif)", '<input name="n" maxlength="300">')}` });
        if (!v) return;
        note = [`à ${Math.round(d)} m de la carte`, v.n.trim()].filter(Boolean).join(" ; ");
      }
    }
    if (f === "problem") { const v = await modal(E, { title: `Problème au poste ${ctrlName(E.ev, t.id)}`, body: field("Ce qui ne va pas", '<input name="n" maxlength="300" placeholder="Boîtier manquant, balise abîmée…">') }); if (!v) return; note = v.n.trim(); }
    mark(E, t.id, f, note);
    E.toast(`${ctrlName(E.ev, t.id)} : ${stateOf(f)[1].toLowerCase()}${readQueue(E).length ? " (envoi dès que le réseau revient)" : ""}.`);
  });
  if (G.hasGeo(E.ev) && navigator.geolocation) {
    E.gpsWatch = navigator.geolocation.watchPosition((p) => {
      E.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, at: p.timestamp };
      E.gpsError = null; renderField(E); E.redraw();
    }, (err) => { E.gpsError = err.code === 1 ? "Position refusée : autorisez la localisation pour ce site." : "Position indisponible."; renderField(E); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  E.onlineSync = () => sync(E);
  window.addEventListener("online", E.onlineSync);
  E.fieldTimer = setInterval(() => sync(E), 30000);
  E.fieldSelHook = () => renderField(E);
  E.canvas.addEventListener("pointerup", E.fieldSelHook);
  E.closeHooks.push(() => stopField(E));
  renderField(E); E.redraw(); sync(E);
}
function stopField(E) {
  if (!E.fieldOn) return;
  E.fieldOn = false;
  if (E.gpsWatch != null) navigator.geolocation.clearWatch(E.gpsWatch);
  E.gpsWatch = null; E.gps = null;
  window.removeEventListener("online", E.onlineSync);
  clearInterval(E.fieldTimer);
  E.canvas.removeEventListener("pointerup", E.fieldSelHook);
  E.fieldBox?.remove(); E.fieldBox = null;
  E.root.classList.remove("tr-fieldmode");
  E.redraw();
}
async function fieldList(E) {
  const ids = Object.keys(E.ev.controls).map(Number).filter((id) => E.ev.controls[id].kind === "normal").sort((a, b) => M.compareControls(E.ev, a, b));
  const fd = E.fieldData?.controls || {};
  const gpsOff = (id) => {
    const st = fd[id];
    if (!st?.gps || !G.hasGeo(E.ev)) return "";
    const [mx, my] = G.toMm(E.ev, st.gps[0], st.gps[1]), c = E.ev.controls[id];
    return `${Math.round(M.mmToM(E.ev, Math.hypot(c.x - mx, c.y - my)))} m`;
  };
  await modal(E, { title: "États des postes", wide: true, ok: null, cancel: "Fermer", body: `<div class="table-wrap"><table class="tr-table"><thead><tr><th>Poste</th><th>État</th><th>Par</th><th>Quand</th><th>Note</th><th class="r">GPS / carte</th><th>Photos</th></tr></thead><tbody>
    ${ids.map((id) => { const st = fd[id], s = st?.state ? stateOf(st.state) : null; return `<tr><td>${esc(ctrlName(E.ev, id))}</td><td>${s ? `<span style="color:${s[2]}">●</span> ${s[1]}` : "—"}</td><td>${esc(st?.by || "")}</td><td>${st?.at ? when(st.at) : ""}</td><td>${esc(st?.note || "")}</td><td class="r">${gpsOff(id)}</td>
      <td>${(st?.photos || []).map((ph) => `<button type="button" class="tr-thumb" data-pid="${esc(ph.pid)}" title="${esc(ph.by)}, ${when(ph.at)}"><img alt="Photo du poste ${esc(ctrlName(E.ev, id))}"></button>`).join("")}</td></tr>`; }).join("")}
    </tbody></table></div><p class="tr-hint">« GPS / carte » : l'écart entre la position du téléphone quand l'état a été noté et le poste sur la carte (un grand écart peut signaler un poste mal placé, ou un GPS imprécis sous les arbres).</p>`,
  onOpen: (f) => {
    for (const b of f.querySelectorAll(".tr-thumb")) {
      photoUrl(E, b.dataset.pid).then((u) => { if (u) b.querySelector("img").src = u; });
      b.addEventListener("click", async () => { const u = await photoUrl(E, b.dataset.pid); if (u) window.open(u, "_blank"); });
    }
  } });
}

// ---- photos ------------------------------------------------------------------------------------------------------------------
const PHOTO_URLS = new Map();
/** A photo's address in this page: from this browser when still waiting for the network, else from the server. */
async function photoUrl(E, pid) {
  if (PHOTO_URLS.has(pid)) return PHOTO_URLS.get(pid);
  let blob = null;
  const local = await IDB.get("photos", pid);
  if (local) blob = new Blob([local], { type: "image/jpeg" });
  else blob = await S.loadPhoto(E.meta.id, pid, E.key).catch(() => null);
  const u = blob ? URL.createObjectURL(blob) : null;
  if (u) PHOTO_URLS.set(pid, u);
  return u;
}
/** The phone's camera (or a file): the photo shrunk to 1600 px, kept here, then sent with the control's next sync. */
function takePhoto(E) {
  const t = target(E);
  if (!t) { E.toast("Touchez d'abord un poste."); return; }
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.capture = "environment";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const img = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82))).arrayBuffer());
      const pid = `${String(t.id).replace(/[^a-z0-9]/gi, "").toLowerCase()}-${uid()}`;
      await IDB.put("photos", pid, bytes);
      const u = { uid: uid(), control: t.id, photo: pid, at: Date.now(), by: me(E) };
      writeQueue(E, [...readQueue(E), u]);
      const old = E.fieldData.controls[t.id] || {};
      E.fieldData.controls[t.id] = { ...old, photos: [...(old.photos || []), { pid, at: u.at, by: u.by }] };
      renderField(E);
      E.toast(`Photo du poste ${ctrlName(E.ev, t.id)} gardée${navigator.onLine ? "" : " (envoi dès que le réseau revient)"}.`);
      sync(E);
    } catch (err) { E.toast("Cette photo n'a pas pu être lue."); }
  });
  input.click();
}

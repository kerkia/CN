// The Tracer's tools that use the race's data or another service:
//  - competitor loads from FFCO's registration counts per circuit (the agenda's reg.circuits);
//  - the climb of each course from IGN's elevations (Géoplateforme, RGE ALTI) along its legs as drawn;
//  - winning times estimated from O'CN's results: the winners' pace on recent races of the same discipline and format,
//    against their CN, gives a course's time for the expected winner's level, and the length for a target time;
//  - the pick-up plan: when each control may be collected (the last start of each course using it and a slow runner's
//    pace), in that order, with the controls nearby;
//  - the review after the race, from the published split times (« Résultats »): per leg, the best and median times, the
//    share of runners who made a mistake (lost ≥ 20 % and ≥ 10 s against their own pace, as « Temps intermédiaires »),
//    and the mispunches per control;
//  - the publication of the courses to « Analyse multi » (after the race: the courses stay secret before).

import * as M from "./model.js";
import * as S from "./store.js";
import * as G from "./geo.js";
import { modal, field, num, download, fileName } from "./dialogs.js";
import { ctrlName, csv } from "./reports.js";
import { where } from "./ribbon-data.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const mmss = (s) => { if (!Number.isFinite(s)) return ""; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const hhmm = (s) => { if (!Number.isFinite(s)) return ""; const m = Math.round(s / 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(circuit|parcours)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const getData = async (path) => { const r = await fetch(`data/${path}`, { credentials: "same-origin", cache: "no-store" }); return r.ok ? r.json().catch(() => null) : null; };
const courseList = (ev) => M.courseIds(ev, false).filter((id) => ev.courses[id].kind !== "score");

/** The race of the event: its agenda entry and its « Résultats » entry, when they exist. */
async function raceInfo(E) {
  const key = E.meta?.race || "";
  const out = { key, agenda: null, prov: null, provKey: null };
  if (!key) return out;
  const [ag, idx] = await Promise.all([getData("agenda.json"), getData("prov/index.json")]);
  const agId = key.startsWith("a") ? Number(key.slice(1)) : null;
  const p = (idx?.races || []).find((r) => r.key === key || (agId && r.agenda_id === agId));
  if (p) { out.prov = p; out.provKey = p.key; }
  const id = agId || p?.agenda_id;
  if (id) out.agenda = (ag?.events || []).find((e) => e.id === id) || null;
  return out;
}
/** A course of the event for a circuit's name (« A », « Circuit A », « A - Jaune »…). */
function matchCourse(ev, name, ids = courseList(ev)) {
  const n = norm(name);
  if (!n) return 0;
  let id = ids.find((c) => norm(ev.courses[c].name) === n);
  if (id) return id;
  id = ids.find((c) => { const m = norm(ev.courses[c].name); return m && (n.split(" ")[0] === m.split(" ")[0]) && m.split(" ")[0].length <= 3; });
  return id || 0;
}

// ---- loads from the registrations ---------------------------------------------------------------------------------------------
/** { courseId: registrants } from FFCO's registration list (races of the next three weeks), or null. */
export async function registrationLoads(E) {
  const r = await raceInfo(E);
  const circuits = r.agenda?.reg?.circuits;
  if (!circuits?.length) { E.toast(r.agenda ? "FFCO ne donne pas encore d'inscrits par circuit pour cette course (lus dans les trois semaines avant)." : "Cet événement n'est pas lié à une course de l'agenda."); return null; }
  const out = {}, missed = [], classes = {};
  for (const [name, n, cats] of circuits) {
    const id = matchCourse(E.ev, name, M.courseIds(E.ev));
    if (!id) { missed.push(`${name} (${n})`); continue; }
    out[id] = (out[id] || 0) + n;
    // the registration's categories (« D20/35, H40/45 ») become the course's classes when it has none yet
    if (cats && !E.ev.courses[id].secondary) classes[id] = String(cats).replace(/\s+/g, " ").trim().slice(0, 200);
  }
  if (Object.keys(classes).length) E.change((x) => { for (const [id, t] of Object.entries(classes)) if (x.courses[id] && !x.courses[id].secondary) x.courses[id].secondary = t; }, "Catégories d'après l'inscription FFCO");
  E.toast(`${Object.keys(out).length} circuit(s) remplis d'après ${circuits.length} circuit(s) de l'inscription FFCO${Object.keys(classes).length ? `, catégories reportées sur ${Object.keys(classes).length}` : ""}${missed.length ? ` ; sans circuit correspondant : ${missed.join(", ")}` : ""}.`, 8000);
  return out;
}

// ---- climb from IGN -----------------------------------------------------------------------------------------------------------
const IGN = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json";
/** Elevations every ~step metres along a polyline of [lat, lon]: IGN's profile (simple mode), in one or more requests. */
async function profile(latlon, lengthM, step = 10) {
  const n = Math.max(2, Math.min(4000, Math.round(lengthM / step) + 1));
  const u = new URLSearchParams({ lon: latlon.map((p) => p[1].toFixed(6)).join("|"), lat: latlon.map((p) => p[0].toFixed(6)).join("|"),
    resource: "ign_rge_alti_wld", delimiter: "|", indent: "false", measures: "false", zonly: "false", profile_mode: "simple", sampling: String(n) });
  const r = await fetch(`${IGN}?${u}`);
  if (!r.ok) throw new Error(`IGN ${r.status}`);
  const j = await r.json();
  return (j.elevations || []).map((e) => (typeof e === "number" ? e : e.z)).filter((z) => Number.isFinite(z) && z > -1000);
}
/** Climb of a profile: the rises, after a light smoothing that removes the model's noise (a 3-point median then mean). */
function rises(z) {
  const m = z.map((_, i) => { const w = z.slice(Math.max(0, i - 1), i + 2).slice().sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
  const s = m.map((_, i) => { const w = m.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, b) => a + b, 0) / w.length; });
  let up = 0, down = 0;
  for (let i = 1; i < s.length; i++) { const d = s[i] - s[i - 1]; if (d > 0) up += d; else down -= d; }
  return { up, down, min: Math.min(...s), max: Math.max(...s), z: s };
}
/** The legs of a designator as one polyline of map mm (controls and bends). */
function coursePolyline(ev, cd) {
  const ids = M.ccIds(ev, cd), pts = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = ev.courseControls[ids[i]].control, b = ev.courseControls[ids[i + 1]].control;
    const leg = M.legRoutePoints(ev, a, b);             // the drawn route when there is one
    pts.push(...(pts.length ? leg.slice(1) : leg));
  }
  return pts;
}
export async function climb(E) {
  const ev = E.ev;
  if (!G.hasGeo(ev)) { E.toast(`Géoréférencez d'abord la carte (${where("georef")}) : il faut savoir où est le terrain.`); return; }
  const ids = courseList(ev);
  if (!ids.length) { E.toast("Aucun circuit en ligne."); return; }
  const rows = [], profiles = [];
  E.status("Altitudes de l'IGN…", "busy");
  try {
    for (const id of ids) {
      const des = M.hasVariations(ev, id) ? M.allVariations(ev, id).map((x) => ({ cd: M.cdCourse(id, -1, x.path), code: x.code })) : [{ cd: M.cdCourse(id), code: "" }];
      let best = null;
      for (const d of des.slice(0, 12)) {
        const pts = coursePolyline(ev, d.cd);
        if (pts.length < 2) continue;
        const len = M.mmToM(ev, M.pathLength(pts));
        const z = await profile(pts.map((p) => G.toLatLon(ev, p[0], p[1])), len);
        if (z.length < 2) continue;
        const r = { ...rises(z), len, code: d.code };
        if (!best || r.up > best.up) best = r;
      }
      if (!best) continue;
      rows.push({ id, ...best });
      profiles.push({ id, ...best });
    }
  } catch (err) {
    E.status("Prêt", "ok");
    E.toast(`Le service d'altitude de l'IGN ne répond pas (${err.message}). Réessayez plus tard.`, 7000);
    return;
  }
  E.status("Prêt", "ok");
  if (!rows.length) { E.toast("Aucun circuit à mesurer (il faut au moins deux postes)."); return; }
  const spark = (r) => {
    const W = 220, H = 40, n = r.z.length, lo = r.min, hi = Math.max(r.max, lo + 1);
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.2" points="${r.z.map((z, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - 2 - ((z - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`).join(" ")}"/></svg>`;
  };
  const v = await modal(E, { title: "Dénivelée des circuits (IGN)", wide: true, ok: "Reporter dans les circuits", body: `
    <p>Les altitudes du modèle numérique de terrain de l'IGN (RGE ALTI, au mètre en France), tous les 10 m le long des interpostes : <b>l'itinéraire tracé</b> quand il y en a un
    (outil Itinéraire), sinon la ligne droite et ses coudes. Le règlement compte la dénivelée de l'itinéraire le plus raisonnable : tracez-le sur les interpostes où il s'écarte de la ligne droite. Arrondi à 5 m.</p>
    <div class="table-wrap"><table class="tr-table"><thead><tr><th></th><th>Circuit</th><th class="r">Longueur</th><th class="r">Montée</th><th class="r">Descente</th><th class="r">m/km</th><th>Profil</th><th class="r">Actuelle</th><th class="r">À reporter</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><input type="checkbox" name="u${r.id}" checked aria-label="Reporter"></td><td>${esc(ev.courses[r.id].name)}${r.code ? ` <small>(variante ${esc(r.code)}, la plus montante)</small>` : ""}</td>
      <td class="r">${nf(r.len / 1000, 1)} km</td><td class="r">${Math.round(r.up)} m</td><td class="r">${Math.round(r.down)} m</td><td class="r">${nf(r.up / (r.len / 1000))}</td><td>${spark(r)}</td>
      <td class="r">${ev.courses[r.id].climb >= 0 ? `${ev.courses[r.id].climb} m` : "—"}</td><td class="r"><input name="c${r.id}" value="${Math.round(r.up / 5) * 5}" size="5" inputmode="numeric"> m</td></tr>`).join("")}</tbody></table></div>
    <p class="tr-hint">Altitudes : IGN, Géoplateforme (data.geopf.fr) ; seuls les points des circuits sont envoyés, sans nom ni code.</p>` });
  if (!v) return;
  E.change((x) => { for (const r of rows) if (v[`u${r.id}`]) { const c = Math.round(num(v[`c${r.id}`])); if (c >= 0) x.courses[r.id].climb = c; } }, "Dénivelée (IGN)");
}

// ---- winning times -----------------------------------------------------------------------------------------------------------
const FORMATS = [["LD", "Longue distance"], ["MD", "Moyenne distance"], ["Sprint", "Sprint"], ["Nuit", "Nuit"]];
const CACHE = new Map();
/** The winners of recent circuits of a discipline and format: [{ km, s (seconds), cn (official CN J-15), cat }]. */
async function winners(format) {
  if (CACHE.has(format)) return CACHE.get(format);
  const comps = await getData("competitions.json");
  if (!comps) return [];
  const col = Object.fromEntries(comps.cols.map((c, i) => [c, i]));
  const terrain = format === "Sprint" ? "Spr" : "For";
  const cutoff = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
  const ids = Object.entries(comps.rows).filter(([, r]) => r[col.terrain] === terrain && r[col.epreuve] === format && r[col.date] >= cutoff && r[col.n] >= 40)
    .sort((a, b) => b[1][col.date].localeCompare(a[1][col.date])).slice(0, 90).map(([id]) => id);
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const files = await Promise.all(ids.slice(i, i + 10).map((id) => getData(`c/${id}.json`)));
    for (const f of files) for (const c of f?.circuits || []) {
      const w = c.rows?.[0];
      if (!c.dist || !w || w[1] !== 1 || w[3] !== "ok" || !(w[2] > 0) || c.rows.length < 5) continue;
      const pace = w[2] / c.dist;
      if (pace < 150 || pace > 1500) continue;                       // a length or a time misread
      out.push({ km: c.dist, s: w[2], cn: Number(w[7]) || null, cat: w[4] || "" });
    }
  }
  CACHE.set(format, out);
  return out;
}
/** ln(pace) = a + b ln(CN), least squares; and the median winner CN per category. */
function paceModel(data) {
  const pts = data.filter((d) => d.cn > 500);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const d of pts) { const x = Math.log(d.cn), y = Math.log(d.s / d.km); sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = pts.length, b = n > 10 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0, a = n ? (sy - b * sx) / n : Math.log(400);
  const res = pts.map((d) => Math.log(d.s / d.km) - (a + b * Math.log(d.cn))).sort((x, y) => x - y);
  const spread = res.length > 10 ? [Math.exp(res[Math.floor(res.length * 0.25)]), Math.exp(res[Math.floor(res.length * 0.75)])] : [0.85, 1.15];
  const byCat = new Map();
  for (const d of pts) { if (!byCat.has(d.cat)) byCat.set(d.cat, []); byCat.get(d.cat).push(d.cn); }
  const catCn = new Map([...byCat].filter(([, v]) => v.length >= 3).map(([k, v]) => { v.sort((x, y) => x - y); return [k, v[Math.floor(v.length / 2)]]; }));
  return { pace: (cn) => Math.exp(a + b * Math.log(cn)), spread, n, catCn };
}
/**
 * The climb's effect on the winners' time: FFCO's results give no climb, the organisers' files often do (« Résultats »). On
 * those circuits, the winner's time against the pace the CN model expects for their level, regressed on the climb per km:
 * ln(time / expected) = a + b (m/km − mean). b is applied to a course's own climb; without 20 such circuits, nothing.
 */
async function climbEffect(format, model) {
  const idx = await getData("prov/index.json");
  if (!idx || !model.n) return { n: 0 };
  const forest = (r) => r.terrain === "Forêt" || r.terrain === "For";
  const pick = (strict) => (idx.races || []).filter((r) => r.docs && !r.soon && (format === "Sprint" ? r.terrain === "Sprint" || r.terrain === "Spr" : forest(r) && (!strict || (r.epreuve || "") === format)));
  let races = pick(true);
  if (races.length < 15 && format !== "Sprint") races = pick(false);
  const pts = new Map();
  for (let i = 0; i < Math.min(races.length, 90); i += 10) {
    const files = await Promise.all(races.slice(i, i + 10).map((r) => getData(`prov/${r.key}.json`)));
    files.forEach((f, j) => {
      for (const doc of f?.docs || []) for (const k of doc.classes || []) {
        if (!(k.length_m > 500) || !(k.climb_m >= 0)) continue;
        const w = (k.runners || []).find((x) => x.place === 1 && x.status === "ok" && x.time_s > 0), cn = w?.cnj15?.official;
        if (!(cn > 500)) continue;
        const L = k.length_m / 1000, h = k.climb_m / L;
        if (h > 150) continue;
        pts.set(`${races[i + j].key}|${k.length_m}|${k.climb_m}|${w.time_s}`, { h, r: Math.log(w.time_s / (model.pace(cn) * L)) });
      }
    });
  }
  const v = [...pts.values()];
  if (v.length < 20) return { n: v.length };
  const hm = v.reduce((a, x) => a + x.h, 0) / v.length, rm = v.reduce((a, x) => a + x.r, 0) / v.length;
  let sxy = 0, sxx = 0;
  for (const x of v) { sxy += (x.h - hm) * (x.r - rm); sxx += (x.h - hm) ** 2; }
  const raw = sxx ? sxy / sxx : 0;
  const se = sxx ? Math.sqrt(v.reduce((a, x) => a + (x.r - rm - raw * (x.h - hm)) ** 2, 0) / Math.max(1, v.length - 2) / sxx) : Infinity;
  // shrunk toward the km-effort rule (100 m of climb = 1 km: 10 m/km more = +10 %), each by its precision: a noisy fit
  // (few circuits, climbs alike) stays near the rule, a sharp one moves away from it
  const b0 = Math.log(1.1) / 10, s0 = 0.004;
  const b = Math.max(0, (raw / se ** 2 + b0 / s0 ** 2) / (1 / se ** 2 + 1 / s0 ** 2));
  return { n: v.length, b, hm, raw, se };
}
export async function winningTimes(E) {
  const ev = E.ev, ids = courseList(ev);
  if (!ids.length) { E.toast("Aucun circuit en ligne."); return; }
  const info = await raceInfo(E).catch(() => ({}));
  let format = info.agenda?.epr || info.prov?.epreuve || (ev.appearance.mapStandard === "Spr2019" ? "Sprint" : "MD");
  if (!FORMATS.some((f) => f[0] === format)) format = "MD";
  E.status("Résultats des courses récentes…", "busy");
  let model = paceModel(await winners(format));
  let climbFit = await climbEffect(format, model).catch(() => ({ n: 0 }));
  E.status("Prêt", "ok");
  // a course's time: the pace for the CN over its length, corrected by its climb per km against the reference circuits'
  const climbK = (id, L) => { const H = ev.courses[id].climb; return climbFit.b && H >= 0 && L > 0 ? Math.exp(climbFit.b * (H / L - climbFit.hm)) : 1; };
  const lengthFor = (id, t, p) => { let L = t / p; for (let i = 0; i < 20; i++) L = t / (p * climbK(id, L)); return L; };
  const guessCn = (c) => {
    const cats = String(c.secondary || c.name || "").toUpperCase().match(/[HD]\s?\d{2}[A-Z]?/g) || [];
    const vals = cats.map((x) => model.catCn.get(x.replace(/\s/g, "")) || model.catCn.get(x.replace(/\s/g, "").slice(0, 3))).filter(Boolean);
    return vals.length ? Math.max(...vals) : null;
  };
  const len = (id) => { const v = M.view(ev, M.cdCourse(id), { specials: false, descriptions: false }); return v.totalMax / 1000; };
  const row = (id) => {
    const c = ev.courses[id], cn = guessCn(c);
    return `<tr data-id="${id}"><td>${esc(c.name)}</td><td class="r">${nf(len(id), 1)} km</td><td class="r">${c.climb >= 0 ? `${c.climb} m` : "—"}</td>
      <td><input name="cn${id}" value="${cn ? Math.round(cn / 50) * 50 : ""}" size="5" inputmode="numeric" placeholder="CN"></td><td class="r" data-est></td>
      <td><input name="t${id}" size="4" inputmode="numeric" placeholder="min"></td><td class="r" data-len></td></tr>`;
  };
  await modal(E, { title: "Temps estimés du vainqueur", wide: true, ok: null, cancel: "Fermer", body: `
    <div class="tr-row">${field("Format", `<select name="fmt">${FORMATS.map(([k, l]) => `<option value="${k}" ${k === format ? "selected" : ""}>${l}</option>`).join("")}</select>`)}</div>
    <p class="tr-hint" id="tr-wt-info"></p>
    <div class="table-wrap"><table class="tr-table"><thead><tr><th>Circuit</th><th class="r">Longueur</th><th class="r">Dénivelée</th><th>CN du vainqueur attendu</th><th class="r">Temps estimé</th><th>Temps visé</th><th class="r">Longueur pour ce temps</th></tr></thead>
    <tbody>${ids.map(row).join("")}</tbody></table></div>
    <p class="tr-hint">L'allure des vainqueurs des circuits ${format === "Sprint" ? "de sprint" : "en forêt"} des deux dernières saisons (résultats FFCO, une centaine de courses de 40 coureurs ou plus), selon leur CN officiel 15 jours avant.
    La dénivelée vient en plus, mesurée sur les circuits dont les organisateurs l'ont publiée (« Résultats ») ; la difficulté propre au terrain n'entre pas dans le calcul : la fourchette donne la moitié des courses de référence.
    Le CN proposé est le CN médian des vainqueurs des catégories du circuit (ses « classes » dans les propriétés du circuit).</p>`,
  onOpen: (f) => {
    const upd = () => {
      f.querySelector("#tr-wt-info").textContent = !model.n ? "Pas de course de référence pour ce format."
        : `${model.n} vainqueurs de référence. ${climbFit.b ? `Dénivelée : chaque 10 m par km au-dessus de la moyenne (${nf(climbFit.hm)} m/km) ajoute ${nf((Math.exp(climbFit.b * 10) - 1) * 100, 1)} % au temps — la règle du kilomètre-effort (100 m de montée = 1 km, +10 %) ajustée sur ${climbFit.n} circuits dont la dénivelée est publiée (seuls : ${nf((Math.exp(climbFit.raw * 10) - 1) * 100, 1)} %).`
          : `Dénivelée non prise en compte (${climbFit.n} circuit${climbFit.n > 1 ? "s" : ""} avec dénivelée publiée : trop peu).`}`;
      for (const tr of f.querySelectorAll("tr[data-id]")) {
        const id = Number(tr.dataset.id), cn = num(f.elements[`cn${id}`].value), t = num(f.elements[`t${id}`].value), L = len(id);
        const p = cn > 500 && model.n ? model.pace(cn) : null, est = p ? p * L * climbK(id, L) : null;
        tr.querySelector("[data-est]").textContent = est ? `${mmss(est)} (${mmss(est * model.spread[0])} à ${mmss(est * model.spread[1])})` : "";
        tr.querySelector("[data-len]").textContent = p && t > 0 ? `${nf(lengthFor(id, t * 60, p), 1)} km` : "";
      }
    };
    f.addEventListener("input", upd);
    f.elements.fmt.addEventListener("change", async () => { E.status("Résultats des courses récentes…", "busy"); model = paceModel(await winners(f.elements.fmt.value)); climbFit = await climbEffect(f.elements.fmt.value, model).catch(() => ({ n: 0 })); E.status("Prêt", "ok"); upd(); });
    upd();
  } });
}

// ---- pick-up plan --------------------------------------------------------------------------------------------------------------
/** Last start (seconds after midnight) per course, from the race's start lists when « Résultats » has one. */
async function lastStarts(E) {
  const info = await raceInfo(E).catch(() => ({}));
  if (!info.provKey) return {};
  const race = await getData(`prov/${info.provKey}.json`);
  const out = {};
  for (const d of race?.docs || []) {
    if (d.kind !== "startlist" && !(d.classes || []).some((k) => (k.runners || []).some((r) => r.start_s))) continue;
    for (const k of d.classes || []) {
      let id = matchCourse(E.ev, k.circuit || k.name);
      if (!id) for (const c of courseList(E.ev)) if (String(E.ev.courses[c].secondary || "").toUpperCase().split(/[\s,;|]+/).includes(String(k.name).toUpperCase())) id = c;
      if (!id) continue;
      for (const r of k.runners || []) if (r.start_s > 0 && r.status !== "dns") out[id] = Math.max(out[id] || 0, r.start_s);
    }
  }
  return out;
}
export async function pickup(E) {
  const ev = E.ev, ids = courseList(ev);
  if (!ids.length) { E.toast("Aucun circuit en ligne."); return; }
  const starts = await lastStarts(E);
  const sprint = ev.appearance.mapStandard === "Spr2019" || ev.map.scale <= 5000;
  const v = await modal(E, { title: "Plan de ramassage", wide: true, ok: "Calculer", body: `
    <p>Un poste peut être ramassé quand le dernier coureur de chaque circuit qui y passe l'a passé : son départ, plus la distance jusqu'au poste à l'allure d'un coureur lent.</p>
    <table class="tr-table"><thead><tr><th>Circuit</th><th>Dernier départ</th></tr></thead><tbody>
    ${ids.map((id) => `<tr><td>${esc(ev.courses[id].name)}</td><td><input name="s${id}" value="${starts[id] ? hhmm(starts[id]) : ""}" size="6" placeholder="hh:mm"></td></tr>`).join("")}</tbody></table>
    ${Object.keys(starts).length ? '<p class="tr-hint">Derniers départs lus dans la liste de départ publiée (« Résultats »).</p>' : ""}
    <div class="tr-grid2">${field("Allure d'un coureur lent (min/km, en ligne droite)", `<input name="pace" value="${sprint ? 9 : 15}" inputmode="decimal">`)}
    ${field("Marge (minutes)", '<input name="margin" value="15" inputmode="numeric">')}
    ${field("Ramasser au plus tôt à (heure de fermeture, facultatif)", '<input name="close" placeholder="hh:mm">')}
    ${field("Nombre de ramasseurs", '<input name="n" value="2" inputmode="numeric">')}</div>`,
  validate: (o) => (ids.every((id) => !/^\d{1,2}[:h]\d{2}$/.test(o[`s${id}`].trim())) ? "Le dernier départ d'un circuit au moins (hh:mm)." : !(num(o.pace) > 0) ? "Une allure." : null) });
  if (!v) return;
  const t = (s) => { const m = /^(\d{1,2})[:h](\d{2})$/.exec(String(s).trim()); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
  const pace = num(v.pace) * 60, margin = (num(v.margin) || 0) * 60, close = t(v.close);
  const when = new Map(), courses = new Map();
  for (const id of ids) {
    const s0 = t(v[`s${id}`]);
    if (s0 == null) continue;
    const des = M.hasVariations(ev, id) ? M.allVariations(ev, id).map((x) => M.cdCourse(id, -1, x.path)) : [M.cdCourse(id)];
    for (const cd of des) {
      let dist = 0, prev = null;
      for (const cc of M.ccIds(ev, cd)) {
        const c = ev.courseControls[cc].control;
        if (prev) dist += M.legLengthM(ev, prev, c);
        prev = c;
        if (ev.controls[c].kind !== "normal") continue;
        const at = s0 + (dist / 1000) * pace + margin;
        when.set(c, Math.max(when.get(c) || 0, at));
        if (!courses.has(c)) courses.set(c, new Set());
        courses.get(c).add(ev.courses[id].name);
      }
    }
  }
  if (!when.size) { E.toast("Aucun poste à ramasser."); return; }
  // sectors: the controls split among the collectors by place (k-means from the farthest controls), then in each sector
  // the next control is the one reached earliest (walking from the last, or waiting until it may be collected)
  const n = Math.max(1, Math.min(when.size, Math.round(num(v.n)) || 1));
  const finish = Object.values(ev.controls).find((c) => c.kind === "finish") || Object.values(ev.controls).find((c) => c.kind === "start");
  const all = [...when.keys()], P = (c) => [ev.controls[c].x, ev.controls[c].y];
  const centres = [P(all[0])];
  while (centres.length < n) centres.push(P(all.reduce((b, c) => (Math.min(...centres.map((q) => M.dist(P(c), q))) > Math.min(...centres.map((q) => M.dist(P(b), q))) ? c : b), all[0])));
  let group = new Map();
  for (let it = 0; it < 20; it++) {
    group = new Map(all.map((c) => [c, centres.reduce((bi, q, i) => (M.dist(P(c), q) < M.dist(P(c), centres[bi]) ? i : bi), 0)]));
    centres.forEach((_, i) => { const m = all.filter((c) => group.get(c) === i); if (m.length) centres[i] = [m.reduce((a, c) => a + P(c)[0], 0) / m.length, m.reduce((a, c) => a + P(c)[1], 0) / m.length]; });
  }
  const walk = sprint ? 6 * 60 : 10 * 60;                                       // s per km between controls
  const route = [], free = [];
  for (let k = 0; k < n; k++) {
    const left = new Set(all.filter((c) => group.get(c) === k)), r = [];
    let at = finish ? [finish.x, finish.y] : null, t0 = 0;
    while (left.size) {
      let best = null;
      for (const c of left) {
        const d = at ? M.mmToM(ev, M.dist(at, P(c))) : 0, arrive = Math.max(t0 + (d / 1000) * walk, when.get(c), close || 0);
        if (!best || arrive < best.arrive - 1 || (Math.abs(arrive - best.arrive) <= 1 && d < best.d)) best = { c, arrive, d };
      }
      r.push(best); t0 = best.arrive; at = P(best.c); left.delete(best.c);
    }
    if (finish && at) t0 += (M.mmToM(ev, M.dist(at, [finish.x, finish.y])) / 1000) * walk;
    route.push(r); free.push(t0);
  }
  const rep = { title: "Plan de ramassage", intro: `Allure des derniers coureurs ${nf(num(v.pace), 1)} min/km, marge ${nf(margin / 60)} min ; ramasseurs à ${sprint ? 10 : 6} km/h en ligne droite depuis l'arrivée.`,
    sections: route.map((r, k) => ({ title: `Ramasseur ${k + 1} (${r.length} postes, retour vers ${hhmm(free[k])})`, head: ["Ordre", "Poste", "Ramassable à", "Arrivée prévue", "Depuis le précédent", "Circuits"], align: "rlrrrl",
      rows: r.map((x, i) => [String(i + 1), ctrlName(ev, x.c), hhmm(when.get(x.c)), hhmm(x.arrive), `${Math.round(x.d)} m`, [...courses.get(x.c)].join(", ")]) })) };
  await showRep(E, rep, "ramassage");
}

// ---- after the race --------------------------------------------------------------------------------------------------------------
export async function afterRace(E) {
  const ev = E.ev;
  const info = await raceInfo(E).catch(() => ({}));
  E.status("Temps intermédiaires et traces…", "busy");
  const race = info.provKey ? await getData(`prov/${info.provKey}.json`) : null;
  const docs = (race?.docs || []).filter((d) => (d.classes || []).some((k) => k.controls?.length && (k.runners || []).some((r) => r.splits)));
  const doc = docs[0] || null;
  const classes = doc ? (doc.by === "category" && doc.circuits?.length ? doc.circuits : doc.classes).filter((k) => k.controls?.length) : [];
  const sections = [], intro = [];
  if (doc) intro.push(`Temps intermédiaires : ${doc.title || doc.source} (« Résultats »). Une erreur : au moins 20 % et 10 s perdus sur l'interposte par rapport à l'allure du coureur sur sa course.`);
  for (const k of classes) {
    // the course: same codes in the same order, else the name
    const codes = k.controls.map(String);
    let id = courseList(ev).find((c) => { const seq = M.ccIds(ev, M.cdCourse(c)).map((cc) => ev.controls[ev.courseControls[cc].control]).filter((x) => x.kind === "normal").map((x) => String(x.code)); return seq.length === codes.length && seq.every((x, i) => x === codes[i]); });
    if (!id) id = matchCourse(ev, k.name);
    const runners = (k.runners || []).filter((r) => r.splits && ["ok", "mp"].includes(r.status) && r.time_s > 0);
    if (runners.length < 3) continue;
    const n = codes.length + 1;
    const legs = runners.map((r) => { const cum = [...r.splits.slice(0, codes.length), r.status === "ok" ? r.time_s : null]; return cum.map((t, j) => (t != null && (j === 0 || cum[j - 1] != null) ? t - (j ? cum[j - 1] : 0) : null)); });
    const best = Array.from({ length: n }, (_, j) => Math.min(...legs.map((l) => l[j]).filter((x) => x > 0)));
    const perf = legs.map((l) => { const q = l.map((x, j) => (x > 0 && best[j] > 0 ? x / best[j] : null)).filter(Boolean).sort((a, b) => a - b); return q.length ? q[Math.floor(q.length / 2)] : null; });
    const rows = [];
    for (let j = 0; j < n; j++) {
      const ts = legs.map((l) => l[j]).filter((x) => x > 0).sort((a, b) => a - b);
      let mist = 0, cnt = 0, lost = [];
      legs.forEach((l, i) => { if (!(l[j] > 0) || !perf[i]) return; cnt++; const exp = best[j] * perf[i], loss = l[j] - exp; if (loss >= 10 && loss >= 0.2 * exp) { mist++; lost.push(loss); } });
      const missing = runners.filter((r) => j < codes.length && r.splits[j] == null).length;
      const from = j ? codes[j - 1] : "Départ", to = j < codes.length ? codes[j] : "Arrivée";
      const c1 = j ? M.findCode(ev, from) : Object.keys(ev.controls).map(Number).find((x) => ev.controls[x].kind === "start");
      const c2 = j < codes.length ? M.findCode(ev, to) : Object.keys(ev.controls).map(Number).find((x) => ev.controls[x].kind === "finish");
      const L = c1 && c2 ? M.legLengthM(ev, c1, c2) : null;
      rows.push([`${j + 1}`, `${from}–${to}`, L ? `${Math.round(L)} m` : "", mmss(best[j]), mmss(ts[Math.floor(ts.length / 2)]), L && best[j] > 0 ? `${nf(best[j] / 60 / (L / 1000), 1)}` : "",
        cnt ? `${Math.round((100 * mist) / cnt)} %` : "", lost.length ? mmss(lost.sort((a, b) => a - b)[Math.floor(lost.length / 2)]) : "", missing ? String(missing) : ""]);
    }
    sections.push({ title: `${k.name}${id ? ` → ${ev.courses[id].name}` : " (pas de circuit correspondant dans l'événement)"} : ${runners.length} coureurs`,
      head: ["Interposte", "Postes", "Longueur", "Meilleur", "Médian", "min/km (meilleur)", "Erreurs", "Perte médiane", "Postes manquants"], align: "rlrrrrrrr", rows });
  }
  // the routes taken, from the GPS traces shared on the analysis published from this event (routes.js)
  try {
    const R = await import("./routes.js"), routes = await R.routesByLeg(E);
    if (routes?.length) {
      const { rows, meta } = R.routeRows(routes);
      if (rows.length) {
        sections.push({ title: "Itinéraires (traces GPS de l'analyse multi)", head: ["Circuit", "Interposte", "Traces", "Itinéraires", "Groupes (temps médian ; ★ le plus rapide)"], align: "llrrl", rows,
          rowAction: { label: "Voir", fn: (i) => R.showLeg(E, routes, meta[i].course, meta[i].leg) } });
        intro.push("Itinéraires : les traces partagées sur l'analyse multi, coupées aux passages des postes et groupées quand elles restent à quelques dizaines de mètres l'une de l'autre. « Voir » les dessine sur la carte.");
      }
    }
  } catch (err) { console.error(err); }
  E.status("Prêt", "ok");
  if (!sections.length) {
    E.toast(info.provKey || E.meta?.published ? "Pas encore de temps intermédiaires publiés ni de traces partagées pour cette course." : "Pas de résultats pour cet événement dans « Résultats » (il doit être lié à la course), ni d'analyse multi publiée.", 7000);
    return;
  }
  intro.push("À lire avec le terrain : un interposte où beaucoup se trompent peut signaler un poste ambigu, une erreur de carte, ou simplement un choix difficile voulu ; des postes manquants nombreux au même poste, un boîtier ou une balise à vérifier.");
  await showRep(E, { title: "Bilan après la course", intro: intro.join("\n"), sections }, "bilan");
}

async function showRep(E, rep, slug) {
  const html = `${rep.intro ? rep.intro.split("\n").map((t) => `<p class="tr-hint">${esc(t)}</p>`).join("") : ""}${rep.sections.map((s, si) => `<h3>${esc(s.title)}</h3>
    <div class="table-wrap"><table class="tr-table"><thead><tr>${s.head.map((h, i) => `<th class="${s.align[i] === "r" ? "r" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${s.rows.map((r, ri) => `<tr>${r.map((c, i) => `<td class="${s.align[i] === "r" ? "r" : ""}">${esc(c)}</td>`).join("")}${s.rowAction ? `<td><button type="button" class="btn btn-sm" data-row="${si}:${ri}">${esc(s.rowAction.label)}</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`).join("")}`;
  await modal(E, { title: rep.title, wide: true, ok: null, cancel: "Fermer", body: `<div class="tr-report">${html}</div>`, extra: '<button type="button" class="btn" data-csv>CSV</button>',
    onOpen: (f, done) => {
      f.querySelector("[data-csv]").addEventListener("click", () => download(`${fileName(E.ev.title)} - ${slug}.csv`, csv(rep), "text/csv;charset=utf-8"));
      f.querySelectorAll("[data-row]").forEach((b) => b.addEventListener("click", () => { const [si, ri] = b.dataset.row.split(":").map(Number); done(null); rep.sections[si].rowAction.fn(ri); }));
    } });
}

// ---- the courses to « Résultats » ---------------------------------------------------------------------------------------------
/** The courses (IOF XML CourseData) sent to « Résultats » as an organisers' upload of kind « courses » (functions/api/upload.js,
 *  prov/parsers/coursedata.py): the race's results lists get each circuit's length, climb and controls when the organisers'
 *  files lack them. From the race day only (the courses are secret before), by the organising club. */
export async function sendCourses(E) {
  const ev = E.ev, today = new Date().toISOString().slice(0, 10);
  if (E.meta.kind !== "race" || !E.meta.race) { E.toast("Cet événement n'est pas lié à une compétition : rien à envoyer à « Résultats »."); return; }
  if (E.meta.date && E.meta.date > today) { E.toast(`Les circuits restent secrets jusqu'à la course (${E.meta.date}) : envoyez-les le jour même ou après.`, 6000); return; }
  const ids = courseList(ev);
  const v = await modal(E, { title: "Envoyer les circuits à « Résultats »", wide: true, ok: "Envoyer", body: `
    <p>Les circuits (au format IOF XML) complètent les résultats publiés de la course : la longueur, la dénivelée et les postes de chaque circuit
    quand les fichiers de résultats ne les donnent pas. Ils sont rapprochés des circuits des résultats par leur nom, ou par leurs postes.</p>
    <p class="tr-hint">${ids.length} circuit(s) : ${ids.map((id) => esc(ev.courses[id].name)).join(", ")}. Un nouvel envoi remplace le précédent.</p>
    <label class="tr-check"><input type="checkbox" name="consent"> Je suis de l'organisation et j'accepte que ces circuits soient publiés avec les résultats</label>`,
  validate: (o) => (o.consent ? null : "Cochez l'accord de publication.") });
  if (!v) return;
  const { iofXmlText } = await import("./exports.js");
  const xml = iofXmlText(ev, 3), name = `${fileName(ev.title)} - circuits.xml`;
  E.status("Envoi…", "busy");
  try {
    const r = await fetch("api/upload", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/xml", "X-Upload": encodeURIComponent(JSON.stringify({ kind: "courses", race: E.meta.race, filename: name, consent: true })) },
      body: new Blob([xml], { type: "application/xml" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `http ${r.status}`), { code: j.error });
    E.status("Prêt", "ok");
    E.toast(j.soon === false ? "Circuits envoyés : ils seront pris en compte au prochain passage de la collecte des résultats." : "Circuits envoyés : « Résultats » les prend en compte dans quelques minutes.", 7000);
  } catch (err) {
    E.status("Échec", "err");
    const why = { "not organiser": "seuls les membres du club organisateur envoient les circuits", race: "course inconnue", "unknown race": "course inconnue", "too big": "fichier trop gros", consent: "accord manquant" }[err.code] || err.message;
    E.toast(`Envoi impossible : ${why}.`, 7000);
  }
}

// ---- publication to « Analyse multi » ---------------------------------------------------------------------------------------------
/** Each course (each variation of a forked one, up to 12 in all) as a circuit of an « Analyse multi »: its map with the course
 *  printed on it, the controls' positions on that image, the georeference — after the race only. */
export async function publish(E) {
  const ev = E.ev;
  if (!G.hasGeo(ev)) { E.toast(`Géoréférencez d'abord la carte (${where("georef")}) : l'analyse pose les traces GPS sur la carte.`); return; }
  const today = new Date().toISOString().slice(0, 10), isRace = E.meta.kind === "race";
  if (isRace && E.meta.date && E.meta.date > today) { E.toast(`Les circuits restent secrets jusqu'à la course (${E.meta.date}) : publiez-les après.`, 6000); return; }
  const info = isRace ? await raceInfo(E).catch(() => ({})) : {};
  if (isRace && !info.provKey) { E.toast("La course n'apparaît pas encore dans « Résultats » : la publication sera possible quand elle y sera."); return; }
  const des = [];
  for (const id of M.courseIds(ev, false)) {
    if (M.hasVariations(ev, id)) for (const x of M.allVariations(ev, id)) des.push({ cd: M.cdCourse(id, -1, x.path), name: `${ev.courses[id].name} ${x.code}`, id });
    else des.push({ cd: M.cdCourse(id), name: ev.courses[id].name, id });
  }
  const provRace = info.provKey ? await getData(`prov/${info.provKey}.json`) : null;
  const circuitNames = [...new Set((provRace?.docs || []).filter((d) => d.by !== "category").flatMap((d) => (d.classes || []).map((k) => k.name)))];
  const v = await modal(E, { title: "Publier vers l'analyse multi", wide: true, ok: "Publier", body: `
    <p>Chaque circuit coché devient un circuit de l'${isRace ? "analyse de la compétition" : "analyse d'entraînement"} : sa carte avec le circuit imprimé, ses postes, son calage. Les coureurs y déposent ensuite leur trace GPS.</p>
    <table class="tr-table"><thead><tr><th></th><th>Circuit</th>${circuitNames.length ? "<th>Circuit des résultats</th>" : ""}</tr></thead><tbody>
    ${des.map((d, i) => `<tr><td><input type="checkbox" name="p${i}" ${i < 12 ? "checked" : ""}></td><td>${esc(d.name)}</td>
      ${circuitNames.length ? `<td><select name="k${i}"><option value="">—</option>${circuitNames.map((n) => `<option ${norm(n) === norm(d.name) || norm(n).split(" ")[0] === norm(d.name).split(" ")[0] ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></td>` : ""}</tr>`).join("")}</tbody></table>
    ${isRace ? "" : `${field("Qui la voit", '<select name="vis"><option value="club">Mon club</option><option value="public">Tous les comptes</option><option value="password">Avec un mot de passe</option></select>')}${field("Mot de passe (si choisi)", '<input name="pw" type="password" autocomplete="new-password">')}`}
    ${field("Résolution de l'image (points par pouce sur le papier)", '<input name="dpi" value="150" inputmode="numeric">', "150 suffit à l'écran ; 12 circuits au plus.")}`,
  validate: (o) => { const n = des.filter((_, i) => o[`p${i}`]).length; return !n ? "Cochez un circuit." : n > 12 ? "12 circuits au plus." : o.vis === "password" && (o.pw || "").length < 4 ? "Un mot de passe de 4 caractères au moins." : null; } });
  if (!v) return;
  const pick = des.map((d, i) => ({ ...d, i })).filter((d) => v[`p${d.i}`]);
  const call = async (path, opts = {}) => {
    const h = { ...(opts.headers || {}) };
    let body = opts.body;
    if (body && !(body instanceof Blob)) { body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
    const r = await fetch(`api/analyses${path}`, { method: opts.method || "GET", headers: h, body, credentials: "same-origin" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(j?.error || `http ${r.status}`); e.code = j?.error; throw e; }
    return j;
  };
  try {
    E.status("Création de l'analyse…", "busy");
    const created = await call("", { method: "POST", body: isRace ? { kind: "race", race: info.provKey, title: E.meta.title, date: E.meta.date || today, vis: "public" }
      : { kind: "club", title: E.meta.title, date: E.meta.date || today, vis: v.vis, password: v.vis === "password" ? v.pw : undefined } });
    const aid = created.id;
    const cur = await call(`/${aid}`);
    const courses = (cur.analysis?.courses || []).filter((c) => !pick.some((_, j) => c.n === j));
    const { courseImage } = await import("./exports.js");
    const dpi = Math.max(72, Math.min(300, Math.round(num(v.dpi)) || 150));
    for (let j = 0; j < pick.length; j++) {
      const d = pick[j];
      E.status(`Circuit ${j + 1}/${pick.length} : ${d.name}…`, "busy");
      const { canvas, box, pxPerMm: k } = await courseImage(E, d.cd, dpi, { withMap: true });
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await call(`/${aid}/map/${j}`, { method: "PUT", body: blob, headers: { "Content-Type": "image/png" } });
      const g = ev.geo, geo = { a: g.a * k, b: g.b * k, c: (g.c - box[0]) * k, d: -g.d * k, e: -g.e * k, f: (box[3] - g.f) * k };
      const r = M.controlRadius(ev) * M.objRatio(ev, ev.courses[d.id].printScale) * k;
      const controls = M.ccIds(ev, d.cd).map((cc) => ev.controls[ev.courseControls[cc].control]).filter((c) => ["start", "normal", "finish"].includes(c.kind))
        .map((c) => ({ kind: c.kind === "normal" ? "control" : c.kind, code: c.code || "", x: Math.round((c.x - box[0]) * k * 10) / 10, y: Math.round((box[3] - c.y) * k * 10) / 10 }));
      courses.push({ n: j, name: d.name.slice(0, 60), circuit: v[`k${d.i}`] || "", r: Math.round(r * 10) / 10, map: { w: canvas.width, h: canvas.height, type: "image/png", v: Date.now() }, geo, controls });
    }
    await call(`/${aid}`, { method: "PUT", body: { courses: courses.sort((a, b) => a.n - b.n) } });
    // the event's card remembers its analysis: « Bilan après la course » reads its shared traces
    try { const r = await S.api(`/${E.meta.id}`, { method: "PUT", body: { published: { analysis: aid } } }); if (r?.event) E.meta = r.event; } catch (e) { /* the review will not find it */ }
    E.status("Prêt", "ok");
    const link = isRace ? `#/orga-competitions?id=${aid}` : `#/orga-entrainements?id=${aid}`;
    await modal(E, { title: "Publié", ok: null, cancel: "Fermer", body: `<p>${pick.length} circuit(s) publiés${created.existing ? " dans l'analyse déjà ouverte pour cette course" : ""}.</p><p><a href="${link}" target="_blank" rel="noopener">Ouvrir l'analyse multi</a></p>` });
  } catch (err) {
    E.status("Échec", "err");
    const why = { "not organiser": "seuls les membres du club organisateur publient l'analyse d'une compétition", race: "la course n'est pas dans « Résultats »", courses: "un circuit n'a pas pu être enregistré", rate: "trop d'envois aujourd'hui" }[err.code] || err.message;
    E.toast(`Publication impossible : ${why}.`, 7000);
  }
}

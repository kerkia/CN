// The Tracer's reports (menu Rapports): Purple Pen's five — course summary, leg lengths, cross-reference, competitor load,
// event audit (Reports.cs) — with the same rows and rules, shown as tables in a dialog and saved as CSV. The event audit
// adds O'CN's checks after Purple Pen's: controls too close for the discipline (IOF: 30 m, 15 m in sprint; closer than
// 60 m / 30 m only on clearly different features), controls in out-of-bounds or dangerous areas, legs across them or across
// an uncrossable boundary, legs passing through another control's circle, dog-legs, very short legs, codes below 31 or
// readable upside down as another code.

import * as M from "./model.js";
import { inPoly } from "./layout.js";
import { modal, download, fileName, saveFiles } from "./dialogs.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const km = (a, b) => (Math.abs(a - b) < 50 ? `${nf(a / 1000, 1)} km` : `${nf(a / 1000, 1)}–${nf(b / 1000, 1)} km`);
const range = (a, b) => (a === b ? String(a) : `${a}–${b}`);
const climbText = (c) => (c >= 0 ? `${Math.round(c / 5) * 5} m` : "");
const KIND_NAME = { start: "Départ", finish: "Arrivée", crossing: "Passage obligatoire", "map-exchange": "Échange de carte", "map-issue": "Remise de carte" };
/** A control's name as Purple Pen's NameStyle.Medium: the code, or the kind. */
export const ctrlName = (ev, id) => { const c = ev.controls[id]; return !c ? "?" : c.kind === "normal" ? c.code : KIND_NAME[c.kind] || c.kind; };
const sortedCourses = (ev) => M.courseIds(ev, false);
const designators = (ev, id) => (M.hasVariations(ev, id) ? M.allVariations(ev, id).map((x) => ({ cd: M.cdCourse(id, -1, x.path), code: x.code })) : [{ cd: M.cdCourse(id), code: "" }]);
const isSprint = (ev) => ev.appearance?.mapStandard === "Spr2019" || ev.map.scale <= 5000;

// ---- the reports, as data: { title, intro?, sections: [{ title?, text?, head, align, rows, foot? }] } ----------------------
export function courseSummary(ev) {
  const rows = [];
  for (const id of sortedCourses(ev)) {
    for (const d of [{ cd: M.cdCourse(id), code: "" }, ...(M.hasVariations(ev, id) ? designators(ev, id) : [])]) {
      const v = M.view(ev, d.cd, { specials: false, descriptions: false }), c = ev.courses[id], score = v.kind === "score";
      rows.push([d.code ? `    ${d.code}` : c.name, range(v.minNormal, v.maxNormal), score ? "" : km(v.totalMin, v.totalMax), score ? "" : climbText(c.climb),
        d.code ? "" : c.load >= 0 ? String(c.load) : "", d.code ? "" : `1:${nf(c.printScale || ev.map.scale)}`]);
    }
  }
  return { title: "Résumé des circuits", sections: [{ head: ["Circuit", "Postes", "Longueur", "Dénivelée", "Charge", "Impression"], align: "lrrrrr", rows }] };
}
export function legLengths(ev) {
  const sections = [];
  for (const id of sortedCourses(ev)) {
    const v = M.view(ev, M.cdCourse(id), { specials: false, descriptions: false });
    if (v.kind === "score") continue;
    const c = ev.courses[id], rows = [];
    let n = 1, total = 0;
    v.controls.forEach((cv, ci) => {
      if (!cv.legTo) return;
      cv.legTo.forEach((_, li) => {
        if (ev.controls[cv.control].kind === "crossing" && cv.legTo.length <= 1) return;
        // through crossing points with a single way on (Reports.WriteLegLengthRow)
        let i = ci, l = li, dist = 0, next, flagged = 0;
        for (;;) {
          const x = v.controls[i];
          next = x.legTo[l]; dist += x.legLen[l];
          if (next >= 0) { const a = x.control, b = v.controls[next].control, f = M.legFlagging(ev, a, b); if (f !== "none") flagged += f === "all" ? x.legLen[l] : M.flaggedLengthM(ev, a, b); }
          if (next < 0) break;
          const nx = v.controls[next];
          if (ev.controls[nx.control].kind !== "crossing" || !nx.legTo || nx.legTo.length !== 1) break;
          i = next; l = 0;
        }
        if (dist > 0 && next >= 0) {
          rows.push([v.kind === "normal" ? String(n) : "", `${ctrlName(ev, cv.control)}–${ctrlName(ev, v.controls[next].control)}`, `${Math.round(dist)} m`, flagged > 0 ? `${Math.round(flagged)} m` : ""]);
          total += dist; n++;
        }
      });
    });
    sections.push({ title: `${c.name} : ${range(v.minNormal, v.maxNormal)} poste${v.maxNormal > 1 ? "s" : ""}, ${km(v.totalMin, v.totalMax)}${c.climb >= 0 ? `, ${climbText(c.climb)}` : ""}`,
      head: ["Interposte", "Postes", "Longueur", "Balisé"], align: "llrr", rows, foot: n > 1 ? ["Moyenne", "", `${Math.round(total / (n - 1))} m`, ""] : null });
  }
  return { title: "Longueurs des interpostes", sections };
}
export function crossRef(ev) {
  const courses = sortedCourses(ev);
  const ctrls = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal").sort((a, b) => M.compareCodes(ev.controls[a].code, ev.controls[b].code));
  const cell = new Map();
  courses.forEach((cid, col) => {
    for (const d of designators(ev, cid)) for (const cv of M.view(ev, d.cd, { specials: false, descriptions: false }).controls) {
      const k = `${cv.control}:${col}`;
      if (!cell.has(k)) cell.set(k, new Set());
      cell.get(k).add(cv.ordinal);
    }
  });
  const str = (s) => (!s ? "" : [...s].sort((a, b) => a - b).map((i) => (i < 0 ? "*" : String(i))).join(","));
  const rows = ctrls.map((id) => [ev.controls[id].code, ...courses.map((_, col) => str(cell.get(`${id}:${col}`))), String(courses.filter((_, col) => cell.has(`${id}:${col}`)).length)]);
  return { title: "Références croisées", intro: "Le numéro du poste dans chaque circuit (* : circuit au score sans numéro).",
    sections: [{ head: ["Poste", ...courses.map((c) => ev.courses[c].name), "Circuits"], align: `l${"r".repeat(courses.length + 1)}`, rows, rule3: true }] };
}
/** Visits of a control: a butterfly's twice (QueryEvent.GetControlVisitLoad). */
function visitLoad(ev, id) {
  let any = false, total = 0;
  for (const c of M.coursesUsing(ev, id, false)) {
    const load = ev.courses[c].load;
    if (load == null || load < 0) continue;
    any = true;
    let f = 0;
    if (M.hasVariations(ev, c)) {
      const vars = M.allVariations(ev, c);
      for (const x of vars) f += M.ccIds(ev, M.cdCourse(c, -1, x.path)).filter((cc) => ev.courseControls[cc].control === id).length / vars.length;
    } else f = M.ccIds(ev, M.cdCourse(c)).filter((cc) => ev.courseControls[cc].control === id).length;
    total += Math.ceil(f * load);
  }
  return any ? total : -1;
}
export function loadReport(ev) {
  const courses = sortedCourses(ev), intro = [];
  if (!courses.every((c) => ev.courses[c].load >= 0)) intro.push("Attention : la charge n'est pas renseignée pour tous les circuits (Événement › Charge des concurrents) ; les totaux en tiennent compte.");
  if (courses.some((c) => M.hasVariations(ev, c))) intro.push("Note : pour les circuits à variantes, la charge d'un poste est la part des variantes qui y passent.");
  const infos = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal").map((id) => ({
    id, name: ctrlName(ev, id), n: M.coursesUsing(ev, id, false).length, load: M.controlLoad(ev, id), visits: visitLoad(ev, id) }));
  infos.sort((a, b) => b.load - a.load || b.visits - a.visits || b.n - a.n || M.compareCodes(a.name, b.name) || a.id - b.id);
  const multi = infos.some((x) => x.visits > x.load);
  if (multi) intro.push("Note : des circuits passent plusieurs fois au même poste (papillons) ; la colonne Passages les compte.");
  const legs = new Map();
  for (const cid of Object.keys(ev.courses).map(Number)) for (const l of M.enumLegs(ev, M.cdCourse(cid))) {
    const a = ev.courseControls[l.cc1].control, b = ev.courseControls[l.cc2].control, k = `${a}:${b}`;
    if (!legs.has(k)) legs.set(k, { text: `${ctrlName(ev, a)}–${ctrlName(ev, b)}`, n: M.coursesUsingLeg(ev, a, b, false).length, load: M.legLoad(ev, a, b) });
  }
  const legRows = [...legs.values()].filter((x) => x.n > 1).sort((a, b) => b.load - a.load || b.n - a.n || a.text.localeCompare(b.text));
  return { title: "Charge des postes et des interpostes", intro: intro.join("\n"), sections: [
    { title: "Circuits", head: ["Circuit", "Charge"], align: "lr", rows: courses.map((c) => [ev.courses[c].name, ev.courses[c].load >= 0 ? String(ev.courses[c].load) : ""]) },
    { title: "Postes", head: multi ? ["Poste", "Circuits", "Charge", "Passages"] : ["Poste", "Circuits", "Charge"], align: multi ? "lrrr" : "lrr",
      rows: infos.map((x) => [x.name, String(x.n), x.load >= 0 ? String(x.load) : "", ...(multi ? [x.visits >= 0 ? String(x.visits) : ""] : [])]) },
    { title: "Interpostes", text: "Seuls les interpostes de plus d'un circuit.", head: ["Interposte", "Circuits", "Charge"], align: "lrr", rows: legRows.map((x) => [x.text, String(x.n), x.load >= 0 ? String(x.load) : ""]) }] };
}

// ---- event audit ----------------------------------------------------------------------------------------------------------
const segX = (p1, p2, q1, q2) => {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};
const segDist = (p, a, b) => M.nearest([a, b], p).d;
/** Upside-down reading of a code (SI cards are punched any way round): 6↔9, 0 1 8 stay, others unreadable. */
const flipCode = (code) => { const m = { 0: "0", 1: "1", 6: "9", 8: "8", 9: "6" }; if (!/^\d+$/.test(code)) return null; let s = ""; for (const ch of [...code].reverse()) { if (!(ch in m)) return null; s += m[ch]; } return s.replace(/^0+/, ""); };

export function audit(ev) {
  const sections = [], courses = sortedCourses(ev);
  const name = (c) => ev.courses[c].name;
  // Purple Pen: missing items in courses
  const missing = [], checkLoad = courses.some((c) => ev.courses[c].load >= 0);
  for (const c of courses) {
    const ids = M.ccIds(ev, M.cdCourse(c)), kinds = ids.map((id) => M.kindOfCC(ev, id));
    if (ev.courses[c].kind === "score") { if (!kinds.includes("start")) missing.push([name(c), "Départ", "Le circuit au score n'a pas de départ."]); }
    else {
      if (!kinds.includes("start")) missing.push([name(c), "Départ", "Le circuit n'a pas de départ."]);
      if (!kinds.includes("finish")) missing.push([name(c), "Arrivée", "Le circuit n'a pas d'arrivée."]);
      if (!(ev.courses[c].climb >= 0)) missing.push([name(c), "Dénivelée", "La dénivelée n'est pas renseignée (Rapports › Dénivelée (IGN) la calcule)."]);
    }
    if (checkLoad && !(ev.courses[c].load >= 0)) missing.push([name(c), "Charge", "La charge n'est pas renseignée."]);
  }
  if (missing.length) sections.push({ title: "Éléments manquants", head: ["Circuit", "Élément", "Raison"], align: "lll", rows: missing });
  // Purple Pen: repeated controls
  const rep = [];
  for (const c of courses) for (const d of designators(ev, c)) {
    const ctl = M.ccIds(ev, d.cd).map((id) => ev.courseControls[id].control), score = ev.courses[c].kind === "score";
    ctl.forEach((x, i) => {
      const dup = score ? ctl.indexOf(x) < i : i > 0 && ctl[i - 1] === x;
      if (dup && !rep.some((r) => r.c === c && r.x === x)) rep.push({ c, x, score });
    });
  }
  if (rep.length) sections.push({ title: "Postes répétés", head: ["Circuit", "Poste", "Problème"], align: "lll",
    rows: rep.map((r) => [name(r.c), ctrlName(ev, r.x), r.score ? "Deux fois dans le circuit au score." : "Deux fois de suite."]) });
  // Purple Pen: close-together controls (100 m), with the discipline's IOF limits (O'CN)
  const sprint = isSprint(ev), minD = sprint ? 15 : 30, sameD = sprint ? 30 : 60;
  const normal = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal");
  const near = [];
  for (const a of normal) for (const b of normal) {
    if (b <= a) continue;
    const d = M.mmToM(ev, M.dist([ev.controls[a].x, ev.controls[a].y], [ev.controls[b].x, ev.controls[b].y]));
    if (d >= 100.4999) continue;
    const sa = ev.controls[a].symbols?.[1] || null, sb = ev.controls[b].symbols?.[1] || null, same = !!(sa && sb && sa === sb);
    const codes = [ev.controls[a].code, ev.controls[b].code].sort(M.compareCodes);
    near.push({ d, row: [codes.join(", "), `${Math.round(d)} m`, same ? "oui" : "non", d < minD ? `Trop près : ${minD} m au moins (IOF${sprint ? ", sprint" : ""}).` : d < sameD && same ? `À moins de ${sameD} m sur le même objet : les distinguer (IOF).` : ""] });
  }
  near.sort((x, y) => x.d - y.d);
  if (near.length) sections.push({ title: "Postes proches", text: `Les paires de postes à moins de 100 m. Règles IOF${sprint ? " (sprint)" : ""} : ${minD} m au moins entre deux postes ; à moins de ${sameD} m, des objets clairement différents sur le terrain et sur la carte.`,
    head: ["Postes", "Distance", "Même symbole (colonne D)", "Règle"], align: "lrll", rows: near.map((x) => x.row) });
  // Purple Pen: legs run both ways
  const fwd = new Map();
  for (const c of courses) {
    if (ev.courses[c].kind === "score") continue;
    for (const l of M.enumLegs(ev, M.cdCourse(c))) {
      const k = `${ev.courseControls[l.cc1].control}:${ev.courseControls[l.cc2].control}`;
      if (!fwd.has(k)) fwd.set(k, []);
      if (!fwd.get(k).includes(c)) fwd.get(k).push(c);
    }
  }
  const both = [], seen = new Set();
  for (const [k, cs] of fwd) {
    const [a, b] = k.split(":").map(Number), back = fwd.get(`${b}:${a}`);
    if (!back || seen.has(`${b}:${a}`) || a === b) continue;
    seen.add(k);
    both.push([`${ctrlName(ev, a)} → ${ctrlName(ev, b)}`, cs.map(name).join(", ")], [`${ctrlName(ev, b)} → ${ctrlName(ev, a)}`, back.map(name).join(", ")]);
  }
  if (both.length) sections.push({ title: "Interpostes courus dans les deux sens", head: ["Interposte", "Circuits"], align: "ll", rows: both });
  // Purple Pen: unused controls
  const unused = M.unusedControls(ev, false).sort((a, b) => M.compareControls(ev, a, b));
  if (unused.length) sections.push({ title: "Postes inutilisés", text: "Ces postes ne servent dans aucun circuit (Événement › Supprimer les postes inutilisés).", head: ["Poste", "Position (mm)"], align: "ll",
    rows: unused.map((id) => [ctrlName(ev, id), `(${Math.round(ev.controls[id].x)}, ${Math.round(ev.controls[id].y)})`]) });
  // Purple Pen: missing description boxes
  const boxes = [];
  for (const id of Object.keys(ev.controls).map(Number).sort((a, b) => M.compareControls(ev, a, b))) {
    if (unused.includes(id)) continue;
    const c = ev.controls[id];
    if (c.kind !== "normal" && c.kind !== "start") continue;
    const s = c.symbols || [];
    if (c.kind === "start" && !s.some(Boolean)) continue;
    if (!s[1]) boxes.push([ctrlName(ev, id), "D", "La colonne D (l'objet) est vide."]);
    else if ((s[3] === "10.1" || s[3] === "10.2") && !s[2]) boxes.push([ctrlName(ev, id), "E", "Un croisement ou une jonction demande un second objet en colonne E."]);
    else if (s[4] === "11.15" && !s[2]) boxes.push([ctrlName(ev, id), "E", "« Entre » demande un second objet en colonne E."]);
  }
  if (boxes.length) sections.push({ title: "Définitions incomplètes", head: ["Poste", "Colonne", "Raison"], align: "lll", rows: boxes });
  // Purple Pen: missing punch patterns (only when some control has one)
  const punched = normal.filter((id) => !unused.includes(id));
  if (punched.some((id) => /1/.test(ev.controls[id].punch?.dots || ""))) {
    const rows = punched.filter((id) => !/1/.test(ev.controls[id].punch?.dots || "")).sort((a, b) => M.compareControls(ev, a, b)).map((id) => [ctrlName(ev, id), "Pas de motif de poinçon."]);
    if (rows.length) sections.push({ title: "Poinçons manquants", head: ["Poste", "Raison"], align: "ll", rows });
  }
  // Purple Pen: missing scores
  const scores = [];
  for (const c of courses) {
    if (ev.courses[c].kind !== "score") continue;
    const here = [];
    let any = false;
    for (const id of M.ccIds(ev, M.cdCourse(c))) {
      const cc = ev.courseControls[id];
      if (ev.controls[cc.control].kind !== "normal") continue;
      if (!(cc.points > 0)) here.push([name(c), ctrlName(ev, cc.control), "Pas de points."]); else any = true;
    }
    if (any) scores.push(...here);
  }
  if (scores.length) sections.push({ title: "Points manquants", head: ["Circuit", "Poste", "Raison"], align: "lll", rows: scores });

  // ---- O'CN's further checks ----
  const more = [];
  const areas = Object.values(ev.specials).filter((s) => ["out-of-bounds", "dangerous-area"].includes(s.kind) && s.pts?.length >= 3);
  const bounds = Object.values(ev.specials).filter((s) => s.kind === "boundary" && s.pts?.length >= 2);
  const forbid = Object.values(ev.specials).filter((s) => s.kind === "forbidden-route" && s.pts?.length);
  const areaName = (s) => (s.kind === "out-of-bounds" ? "une zone interdite" : "une zone dangereuse");
  for (const id of normal) {
    if (unused.includes(id)) continue;
    const c = ev.controls[id];
    for (const s of areas) if (inPoly(s.pts, [c.x, c.y])) more.push(["", ctrlName(ev, id), `Le poste est dans ${areaName(s)}.`]);
    const code = c.code;
    if (/^\d+$/.test(code) && Number(code) < 31) more.push(["", code, "Code inférieur à 31 : réservé aux fonctions des boîtiers électroniques (effacer, vérifier, départ…)."]);
    const flip = flipCode(code);
    if (flip && flip !== code && normal.some((o) => o !== id && ev.controls[o].code === flip) && M.compareCodes(code, flip) < 0) more.push(["", `${code}, ${flip}`, "Ces codes se lisent l'un pour l'autre à l'envers."]);
  }
  const R = M.controlRadius(ev) * M.objRatio(ev, ev.allControls.printScale);
  for (const c of courses) {
    if (ev.courses[c].kind === "score") continue;
    const legsDone = new Set();
    for (const d of designators(ev, c)) {
      const ids = M.ccIds(ev, d.cd), ctl = ids.map((id) => ev.courseControls[id].control);
      const tag = name(c);
      for (let i = 0; i + 1 < ctl.length; i++) {
        const a = ctl[i], b = ctl[i + 1], key = `${a}:${b}`;
        if (legsDone.has(key)) continue;
        legsDone.add(key);
        const pts = M.legPoints(ev, a, b), legName = `${ctrlName(ev, a)}–${ctrlName(ev, b)}`, flag = M.legFlagging(ev, a, b);
        const len = M.legLengthM(ev, a, b);
        if (ev.controls[a].kind === "normal" && ev.controls[b].kind === "normal" && len < (sprint ? 30 : 60)) more.push([tag, legName, `Interposte très court (${Math.round(len)} m).`]);
        for (let k = 0; k + 1 < pts.length; k++) {
          for (const s of areas) {
            const poly = [...s.pts, s.pts[0]];
            if (flag !== "all" && poly.some((q, j) => j + 1 < poly.length && segX(pts[k], pts[k + 1], q, poly[j + 1]))) { more.push([tag, legName, `La ligne droite de l'interposte traverse ${areaName(s)}.`]); break; }
          }
          for (const s of bounds) if (s.pts.some((q, j) => j + 1 < s.pts.length && segX(pts[k], pts[k + 1], q, s.pts[j + 1]))) { more.push([tag, legName, "La ligne droite de l'interposte traverse une limite infranchissable."]); break; }
          for (const s of forbid) if (segDist(s.pts[0], pts[k], pts[k + 1]) < R * 0.6) { more.push([tag, legName, "L'interposte passe sur un passage interdit."]); break; }
        }
        // through another control of the course
        for (const o of new Set(ctl)) {
          if (o === a || o === b || ev.controls[o].kind !== "normal") continue;
          const p = [ev.controls[o].x, ev.controls[o].y];
          if (M.nearest(pts, p).d < R) { more.push([tag, legName, `L'interposte passe dans le cercle du poste ${ctrlName(ev, o)}.`]); }
        }
      }
      // dog-legs: the way out within 20° of the way in, at a normal control
      for (let i = 1; i + 1 < ctl.length; i++) {
        const b = ctl[i];
        if (ev.controls[b].kind !== "normal" || ctl.indexOf(b) !== ctl.lastIndexOf(b) || legsDone.has(`dog:${b}`)) continue;
        const pin = M.legPoints(ev, ctl[i - 1], b), pout = M.legPoints(ev, b, ctl[i + 1]);
        const u = pin[pin.length - 2], w = pout[1], c0 = [ev.controls[b].x, ev.controls[b].y];
        const a1 = Math.atan2(u[1] - c0[1], u[0] - c0[0]), a2 = Math.atan2(w[1] - c0[1], w[0] - c0[0]);
        let diff = Math.abs(a1 - a2) * 180 / Math.PI; if (diff > 180) diff = 360 - diff;
        if (diff < 20) legsDone.add(`dog:${b}`);
        if (diff < 20) more.push([tag, ctrlName(ev, b), `Aller-retour au poste (${Math.round(diff)}° entre l'arrivée et le départ) : les coureurs qui en repartent montrent le poste à ceux qui arrivent.`]);
      }
    }
  }
  if (more.length) sections.push({ title: "Autres vérifications (O'CN)", text: "Des contrôles au-delà de ceux de Purple Pen : à juger sur le terrain, certains sont voulus.", head: ["Circuit", "Objet", "Remarque"], align: "lll", rows: more });
  return { title: "Contrôle de l'événement", intro: sections.length ? "" : "Aucun problème trouvé.", sections };
}

// ---- display and CSV ----------------------------------------------------------------------------------------------------------
function html(rep) {
  return `${rep.intro ? rep.intro.split("\n").map((t) => `<p class="tr-hint">${esc(t)}</p>`).join("") : ""}${rep.sections.map((s) => `
    ${s.title ? `<h3>${esc(s.title)}</h3>` : ""}${s.text ? `<p class="tr-hint">${esc(s.text)}</p>` : ""}
    <div class="table-wrap"><table class="tr-table"><thead><tr>${s.head.map((h, i) => `<th class="${s.align[i] === "r" ? "r" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${s.rows.map((r, ri) => `<tr${s.rule3 && ri % 3 === 2 ? ' class="tr-rule"' : ""}>${r.map((c, i) => `<td class="${s.align[i] === "r" ? "r" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${s.head.length}"><small>Rien.</small></td></tr>`}
    ${s.foot ? `<tr class="tr-sum">${s.foot.map((c, i) => `<td class="${s.align[i] === "r" ? "r" : ""}">${esc(c)}</td>`).join("")}</tr>` : ""}</tbody></table></div>`).join("")}`;
}
const cq = (v) => { const s = String(v ?? "").trim(); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV for French spreadsheets: « ; » between columns, UTF-8 with its mark. */
export function csv(rep) {
  const lines = [cq(rep.title), ...(rep.intro ? rep.intro.split("\n").map(cq) : [])];
  for (const s of rep.sections) {
    lines.push("");
    if (s.title) lines.push(cq(s.title));
    lines.push(s.head.map(cq).join(";"));
    for (const r of s.rows) lines.push(r.map(cq).join(";"));
    if (s.foot) lines.push(s.foot.map(cq).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
async function show(E, rep, slug) {
  await modal(E, { title: `${rep.title} — ${E.ev.title.replace(/\|/g, " ")}`, wide: true, ok: null, cancel: "Fermer",
    body: `<div class="tr-report">${html(rep)}</div>`,
    extra: `<button type="button" class="btn" data-csv>CSV</button><button type="button" class="btn" data-print>Imprimer</button>`,
    onOpen: (f) => {
      f.querySelector("[data-csv]").addEventListener("click", () => download(`${fileName(E.ev.title)} - ${slug}.csv`, csv(rep), "text/csv;charset=utf-8"));
      f.querySelector("[data-print]").addEventListener("click", () => printReport(rep, E.ev.title));
    } });
}
function printReport(rep, title) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(rep.title)}</title><style>body{font:12px system-ui,sans-serif;margin:16mm}table{border-collapse:collapse;margin-bottom:12px}
    th,td{border-bottom:1px solid #ccc;padding:3px 8px;text-align:left}td.r,th.r{text-align:right}h1{font-size:18px}h3{font-size:14px;margin:16px 0 6px}.tr-rule td{border-bottom:2px solid #555}</style>
    <h1>${esc(rep.title)} — ${esc(title.replace(/\|/g, " "))}</h1>${html(rep)}`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 200);
}
export const summary = (E) => show(E, courseSummary(E.ev), "résumé");
export const legLengthsReport = (E) => show(E, legLengths(E.ev), "interpostes");
export const crossRefReport = (E) => show(E, crossRef(E.ev), "références croisées");
export const loadReportDialog = (E) => show(E, loadReport(E.ev), "charge");
export const auditReport = (E) => show(E, audit(E.ev), "contrôle");
/** Every report, one CSV file each, in a zip. */
export async function csvAll(E) {
  const { zip } = await import("./pdf.js");
  const ev = E.ev, enc = new TextEncoder();
  const files = { "resume.csv": courseSummary(ev), "interpostes.csv": legLengths(ev), "references-croisees.csv": crossRef(ev), "charge.csv": loadReport(ev), "controle.csv": audit(ev) };
  const out = {};
  for (const [n, rep] of Object.entries(files)) out[n] = enc.encode(csv(rep));
  await saveFiles(E, out, `${fileName(ev.title)} - rapports.zip`);
}

// Relay variations: Purple Pen's fair, reproducible assignment of a course's variations to the teams' legs
// (RelayVariations.cs; BSD licence, assets/tracer/LICENSE-PurplePen.txt) — every team runs the same set of legs, the
// branches spread evenly over the teams and legs, fixed branches honoured — with .NET's seeded random generator so that
// the same settings give Purple Pen's own teams.

import * as M from "./model.js";
import { t, tn } from "./lang.js";

/** .NET's seeded System.Random (Knuth's subtractive generator), as Purple Pen draws with it. */
class DotNetRandom {
  constructor(seed) {
    const MBIG = 2147483647, MSEED = 161803398;
    this.s = new Array(56).fill(0);
    const sub = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = MSEED - sub, mk = 1;
    this.s[55] = mj;
    for (let i = 1; i < 55; i++) { const ii = (21 * i) % 55; this.s[ii] = mk; mk = mj - mk; if (mk < 0) mk += MBIG; mj = this.s[ii]; }
    for (let k = 1; k < 5; k++) for (let i = 1; i < 56; i++) { this.s[i] -= this.s[1 + ((i + 30) % 55)]; if (this.s[i] < 0) this.s[i] += MBIG; }
    this.inext = 0; this.inextp = 21; this.MBIG = MBIG;
  }
  sample() {
    let a = this.inext + 1, b = this.inextp + 1;
    if (a >= 56) a = 1; if (b >= 56) b = 1;
    let r = this.s[a] - this.s[b];
    if (r === this.MBIG) r--;
    if (r < 0) r += this.MBIG;
    this.s[a] = r; this.inext = a; this.inextp = b;
    return r * (1 / this.MBIG);
  }
  next(n) { return Math.floor(this.sample() * n); }
}
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The relay assignment of a course: { teams: [{ team, legs: [variation codes] }], warnings, paths, error }. */
export function relayPlan(ev, courseId, settings = null) {
  const course = ev.courses[courseId];
  const st = settings || course.relay || { first: 1, teams: 0, legs: 1, branches: {} };
  const numberLegs = Math.max(1, st.legs | 0), numberTeams = Math.max(0, st.teams | 0), first = st.first || 1;
  const letters = M.variantLetters(ev, courseId);
  const allForks = [];
  // ---- the forks (FindForksToJoin)
  const forksTo = (begin, join) => {
    let id = begin, firstFork = null, last = null, guard = 0;
    while (id && id !== join && guard++ < 10000) {
      const cc = ev.courseControls[id];
      if (cc.split) {
        const f = { loop: !!cc.loop, code: ev.controls[cc.control]?.code || "", kind: ev.controls[cc.control]?.kind || "", numBranches: cc.loop ? cc.splitCCs.length - 1 : cc.splitCCs.length, codes: [], subForks: [], next: null,
          numLegsHere: 0, numNonFixed: 0, fixedLegs: null, fixedBranches: null };
        if (!firstFork) firstFork = last = f; else { last.next = f; last = f; }
        allForks.push(f);
        cc.splitCCs.forEach((s, i) => {
          if (cc.loop && i === 0) return;
          f.codes.push(letters.get(s));
          f.subForks.push(forksTo(ev.courseControls[s].next, cc.splitEnd));
        });
        id = cc.loop ? cc.next : cc.splitEnd;
      } else id = cc.next;
    }
    return firstFork;
  };
  const firstFork = forksTo(course.first, 0);
  if (!firstFork) return { teams: [], warnings: [], error: "novariation" };
  const fixed = validateFixed(st.branches || {}, firstFork, numberLegs);
  const warnings = [];
  // ---- scan (ScanFork): legs at each fork, warnings, number of paths
  const scan = (f, legsHere, paths) => {
    if (!f) return paths;
    f.numLegsHere = legsHere;
    if (f.loop) {
      let ways = paths;
      for (const sub of f.subForks) ways *= scan(sub, legsHere, 1);
      ways *= fact(f.numBranches);
      return scan(f.next, legsHere, ways);
    }
    let unfixedLegs = legsHere;
    f.numNonFixed = f.numBranches;
    const nonFixedCodes = f.codes.slice();
    f.codes.forEach((code, i) => {
      if (!fixed[code]) return;
      nonFixedCodes.splice(nonFixedCodes.indexOf(code), 1);
      f.fixedBranches = f.fixedBranches || new Array(f.numBranches).fill(false);
      f.fixedBranches[i] = true;
      f.fixedLegs = f.fixedLegs || new Array(numberLegs).fill(-1);
      for (const leg of fixed[code]) if (leg >= 0 && leg < numberLegs) { f.fixedLegs[leg] = i; unfixedLegs--; }
      f.numNonFixed--;
    });
    let more = 0, per = 0;
    if (f.numNonFixed) { more = unfixedLegs % f.numNonFixed; per = Math.floor(unfixedLegs / f.numNonFixed); }
    if (more) warnings.push({ control: f.code, kind: f.kind, more: nonFixedCodes.slice(0, more), less: nonFixedCodes.slice(more), nMore: per + 1, nLess: per });
    let ways = 0;
    f.codes.forEach((code, i) => {
      let legs;
      if (f.fixedBranches?.[i]) legs = fixed[code].length;
      else { legs = per; if (nonFixedCodes.indexOf(code) < more) legs++; }
      ways += scan(f.subForks[i], legs, paths);
    });
    return scan(f.next, legsHere, ways);
  };
  const totalPaths = scan(firstFork, numberLegs, 1);
  const minUnique = (f, leg, smallest) => {
    if (!f) return smallest;
    if (f.loop) {
      let ways = smallest;
      for (const sub of f.subForks) ways *= minUnique(sub, leg, 1);
      return minUnique(f.next, leg, ways * fact(f.numBranches));
    }
    if (f.fixedLegs && f.fixedLegs[leg] >= 0) return minUnique(f.next, leg, minUnique(f.subForks[f.fixedLegs[leg]], leg, smallest));
    let m = Infinity;
    f.subForks.forEach((sub, i) => { if (!f.fixedBranches || !f.fixedBranches[i]) m = Math.min(m, minUnique(sub, leg, smallest)); });
    return minUnique(f.next, leg, m * f.numNonFixed);
  };
  const minPaths = Array.from({ length: numberLegs }, (_, leg) => minUnique(firstFork, leg, 1));
  // ---- the teams
  const rnd = new DotNetRandom(8713527);
  const results = [];
  const newTeam = () => ({ forks: new Map(allForks.map((f) => [f, []])), total: 0 });
  const legEqForFork = (f, a, la, b, lb) => eqArr(a.forks.get(f)[la], b.forks.get(f)[lb]);
  const legEquals = (a, la, b, lb) => allForks.every((f) => legEqForFork(f, a, la, b, lb));
  const teamEquals = (a, b) => allForks.every((f) => { const x = a.forks.get(f), y = b.forks.get(f); return x.length === y.length && x.every((v, i) => eqArr(v, y[i])); });
  const possibleBranches = (f) => {
    const out = [];
    let br = 0;
    for (let i = 0; i < f.numLegsHere; i++) {
      if (f.fixedLegs && f.fixedLegs[i] >= 0) continue;
      while (f.fixedBranches && f.fixedBranches[br]) br = (br + 1) % f.numBranches;
      out.push(br);
      br = (br + 1) % f.numBranches;
    }
    return out;
  };
  const randomLoop = (n) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i >= 1; i--) { const j = rnd.next(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const validLoop = (loop, f, leg, team) => {
    const legsF = team.forks.get(f);
    if (leg < f.numBranches) for (let o = 0; o < leg; o++) if (legsF[o].length && legsF[o][0] === loop[0]) return false;
    const maxDups = Math.floor(leg / fact(f.numBranches));
    return legsF.filter((b) => eqArr(b, loop)).length <= maxDups;
  };
  const addFork = (f, leg, team) => {
    if (!f) return;
    if (f.loop) {
      let loop, count = 0;
      do { loop = randomLoop(f.numBranches); count++; } while (count < 200 && !validLoop(loop, f, leg, team));
      team.forks.get(f).push(loop);
      for (const sub of f.subForks) addFork(sub, leg, team);
    } else {
      let sel;
      if (f.fixedLegs && f.fixedLegs[leg] >= 0) sel = f.fixedLegs[leg];
      else {
        const pb = possibleBranches(f), legsF = team.forks.get(f);
        for (let i = 0; i < leg; i++) if ((!f.fixedLegs || f.fixedLegs[i] < 0) && legsF[i].length) { const k = pb.indexOf(legsF[i][0]); if (k >= 0) pb.splice(k, 1); }
        sel = pb[rnd.next(pb.length)];
      }
      team.forks.get(f).push([sel]);
      addFork(f.subForks[sel], leg, team);
    }
    addFork(f.next, leg, team);
  };
  const scoreLeg = (leg, team) => {
    let score = 0, firstF = true;
    for (const f of allForks) {
      if (f.fixedLegs && f.fixedLegs[leg] >= 0) continue;
      const allowed = Math.floor(1.17 * (results.length / f.numNonFixed));
      let similar = 0;
      for (const r of results) if (legEqForFork(f, r, leg, team, leg)) similar++;
      let pen = Math.max(0, similar - allowed);
      if (firstF) pen *= 3;
      if (leg === 0) pen *= 3;
      score += pen; firstF = false;
    }
    let allowedDup = Math.floor(results.length / minPaths[leg]);
    if (allowedDup >= 1) allowedDup += Math.ceil(allowedDup / 3);
    let dups = 0;
    for (const r of results) if (legEquals(r, leg, team, leg)) dups++;
    score += 10 * Math.max(0, dups - allowedDup);
    if (numberLegs <= minPaths[leg]) for (let o = 0; o < leg; o++) if (legEquals(team, leg, team, o)) score += 100;
    return score;
  };
  const addLeg = (leg, team) => {
    let minScore = Infinity;
    for (let count = 0; ; count++) {
      addFork(firstFork, leg, team);
      for (const f of allForks) if (team.forks.get(f).length === leg) team.forks.get(f).push([]);
      const score = scoreLeg(leg, team);
      if (score === 0) return score;
      if (score <= minScore && count > 20) return score;
      if (score <= Math.floor((minScore * 4) / 3) && count > 50) return score;
      if (score <= minScore * 2 && count > 75) return score;
      if (count > 100) return score;
      minScore = Math.min(minScore, score);
      for (const f of allForks) team.forks.get(f).pop();
    }
  };
  const potential = () => { const t = newTeam(); for (let leg = 0; leg < numberLegs; leg++) t.total += addLeg(leg, t); return t; };
  const generate = () => {
    let minDup = Infinity, minTotal = Infinity, best = null;
    for (let i = 0; i < 100; i++) {
      const t = potential();
      const dups = results.filter((r) => teamEquals(r, t)).length;
      if (dups < minDup) { minDup = dups; minTotal = t.total; best = t; }
      else if (dups === minDup && t.total <= minTotal) { if (t.total === minTotal && i >= 10) return t; minTotal = t.total; best = t; }
      if (dups === 0 && t.total === 0) return t;
      if (dups === 0 && i > 25) break;
    }
    return best;
  };
  for (let i = 0; i < numberTeams; i++) results.push(generate());
  const codeFor = (team, leg) => {
    let s = "";
    const walk = (f) => { if (!f) return; for (const b of team.forks.get(f)[leg]) { s += f.codes[b]; walk(f.subForks[b]); } walk(f.next); };
    walk(firstFork);
    return s;
  };
  const vars = new Map(M.allVariations(ev, courseId).map((v) => [v.code, v.path]));
  return { teams: results.map((t, i) => ({ team: first + i, legs: Array.from({ length: numberLegs }, (_, l) => codeFor(t, l)) })), warnings, totalPaths, paths: vars,
    fixedChoices: allForks.filter((f) => !f.loop).map((f) => f.codes) };
}
/** Fixed branches kept when consistent (RelayVariations.ValidateFixedBranches, without the messages). */
function validateFixed(branches, firstFork, numberLegs) {
  const out = {};
  const walk = (f, reaching) => {
    if (!f) return;
    if (f.loop) { for (const sub of f.subForks) walk(sub, reaching); walk(f.next, reaching); return; }
    const codeForLeg = new Array(numberLegs).fill(null);
    for (const code of f.codes) for (const leg of branches[code] || []) if (leg >= 0 && leg < numberLegs && !codeForLeg[leg] && reaching[leg]) codeForLeg[leg] = code;
    const allLegs = reaching.every((r, leg) => !r || codeForLeg[leg]), allBranches = f.codes.every((c) => branches[c]?.length);
    if (!(allBranches && !allLegs)) codeForLeg.forEach((c, leg) => { if (reaching[leg] && c) (out[c] ||= []).push(leg); });
    f.subForks.forEach((sub, i) => {
      const code = f.codes[i], r = reaching.slice();
      if (out[code]) for (let l = 0; l < r.length; l++) r[l] = r[l] && out[code].includes(l);
      else for (const other of f.codes) if (other !== code && out[other]) for (let l = 0; l < r.length; l++) r[l] = r[l] && !out[other].includes(l);
      walk(sub, r);
    });
    walk(f.next, reaching);
  };
  walk(firstFork, new Array(numberLegs).fill(true));
  return out;
}
/** Every team's legs with their variation: [{ team, leg (1-based), code, path }]. */
export function teamVariations(ev, courseId) {
  const plan = relayPlan(ev, courseId);
  return plan.teams.flatMap((t) => t.legs.map((code, i) => ({ team: t.team, leg: i + 1, code, path: plan.paths.get(code) || [] })));
}
export const relayAssignments = (ev, courseId) => relayPlan(ev, courseId).teams;

/** Course › Relay team variations. */
export async function relayDialog(E) {
  const { modal, field, num, download, fileName } = await import("./dialogs.js");
  const ev = E.ev, id = E.cd.course, c = ev.courses[id];
  if (!M.hasVariations(ev, id)) { E.toast(t("trc.rel.noVariation")); return; }
  const st = { first: 1, teams: 0, legs: 1, branches: {}, ...(c.relay || {}) };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const at = (w) => (w.control ? t("trc.rel.atControl", { code: esc(w.control) }) : w.kind === "start" ? t("trc.rel.atStart") : w.kind === "map-exchange" ? t("trc.rel.atExchange")
    : w.kind === "map-issue" ? t("trc.rel.atIssue") : t("trc.rel.atControl", { code: "" }));
  const render = (box, s) => {
    const plan = relayPlan(ev, id, s);
    box.innerHTML = `${plan.warnings.map((w) => `<p class="tr-hint">${t("trc.rel.branchWarn", { where: at(w), more: w.more.join(", "), nMore: w.nMore, less: w.less.join(", "), nLess: w.nLess })}</p>`).join("")}
      <p class="tr-hint">${tn("trc.rel.paths", plan.totalPaths)}</p>
      <div class="tr-report"><table class="tr-table"><thead><tr><th>${esc(t("trc.rel.team"))}</th>${Array.from({ length: s.legs }, (_, i) => `<th>${esc(t("trc.rel.legN", { n: i + 1 }))}</th>`).join("")}</tr></thead>
      <tbody>${plan.teams.map((t) => `<tr><td class="r">${t.team}</td>${t.legs.map((l) => `<td>${esc(l)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return plan;
  };
  let plan;
  const v = await modal(E, { title: t("trc.rel.title", { name: c.name }), wide: true, ok: E.readOnly ? null : t("trc.rel.save"), cancel: t("trc.rel.close"), body: `
    <div class="tr-grid2">${field(t("trc.rel.teams"), `<input name="teams" value="${st.teams}" inputmode="numeric">`)}${field(t("trc.rel.legs"), `<input name="legs" value="${st.legs}" inputmode="numeric">`)}
    ${field(t("trc.rel.first"), `<input name="first" value="${st.first}" inputmode="numeric">`)}
    ${field(t("trc.rel.fixed"), `<input name="fixed" value="${esc(Object.entries(st.branches).flatMap(([b, legs]) => legs.map((l) => `${b}:${l + 1}`)).join(" "))}">`, t("trc.rel.fixedHint"))}</div>
    <label class="tr-check"><input type="checkbox" name="hide" ${c.hideVariations ? "checked" : ""}> ${esc(t("trc.rel.hide"))}</label>
    <p><button type="button" class="btn btn-sm" id="tr-relay-go">${esc(t("trc.rel.assign"))}</button> <button type="button" class="btn btn-sm" id="tr-relay-csv">CSV</button>
    <button type="button" class="btn btn-sm" id="tr-relay-xml">${esc(t("trc.rel.xml"))}</button></p><div id="tr-relay"></div>
    <p class="tr-hint">${esc(t("trc.rel.hint"))}</p>`,
  onOpen: (f) => {
    const read = () => {
      const branches = {};
      for (const tok of f.elements.fixed.value.trim().split(/[\s,;]+/).filter(Boolean)) { const m = /^([A-Za-z]):(\d+)$/.exec(tok); if (m) (branches[m[1].toUpperCase()] ||= []).push(Number(m[2]) - 1); }
      return { teams: Math.max(0, Math.round(num(f.elements.teams.value)) || 0), legs: Math.max(1, Math.round(num(f.elements.legs.value)) || 1), first: Math.max(1, Math.round(num(f.elements.first.value)) || 1), branches };
    };
    const go = () => { plan = render(f.querySelector("#tr-relay"), read()); };
    const csvFile = `${t("trc.rel.csvFile", { name: fileName(c.name) })}.csv`, xmlFile = `${t("trc.rel.xmlFile", { name: fileName(c.name) })}.xml`;
    f.querySelector("#tr-relay-go").addEventListener("click", go);
    f.querySelector("#tr-relay-csv").addEventListener("click", () => { go(); const s = read(); download(csvFile, `Team,${Array.from({ length: s.legs }, (_, i) => `Leg ${i + 1}`).join(",")}\r\n${plan.teams.map((t) => `${t.team},${t.legs.join(",")}`).join("\r\n")}\r\n`, "text/csv"); });
    f.querySelector("#tr-relay-xml").addEventListener("click", async () => { go(); const { iofXmlText } = await import("./exports.js"); const saved = ev.courses[id].relay; ev.courses[id].relay = read(); const t = iofXmlText(ev, 3); ev.courses[id].relay = saved; download(xmlFile, t, "application/xml"); });
    if (st.teams > 0) go();
  } });
  if (!v) return;
  const branches = {};
  for (const tok of v.fixed.trim().split(/[\s,;]+/).filter(Boolean)) { const m = /^([A-Za-z]):(\d+)$/.exec(tok); if (m) (branches[m[1].toUpperCase()] ||= []).push(Number(m[2]) - 1); }
  E.change((x) => { x.courses[id].relay = { teams: Math.max(0, Math.round(num(v.teams)) || 0), legs: Math.max(1, Math.round(num(v.legs)) || 1), first: Math.max(1, Math.round(num(v.first)) || 1), branches }; x.courses[id].hideVariations = v.hide; }, t("trc.rel.undo"));
}

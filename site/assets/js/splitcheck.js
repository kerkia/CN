// The split times' own consistency (an idea seen in MeOSDjango, written here afresh): what a results file's split times
// say about the timing itself, for its organiser before publishing (« Déposer ») and for anyone reading the splits
// (« Temps intermédiaires »). Pure: a class of a parsed document in (prov/model.py's shape), the findings out.
// - a leg run in negative time (a split earlier than the one before it, or the finish before the last control) at the same
//   control for 2 runners or more: that control's unit (or the one before it) was probably not set to the right time;
// - such a leg alone at its control: the runner's card was probably not cleared (an old punch read with the new ones);
// - a finisher (status « ok ») without a control that the others of the course punched: punched before their start, a
//   punch the timing software filtered out;
// - a control whose time is the same as another control of the same code for (nearly) every runner: the source matched
//   the punches by code and gave both passages one time — the file's fault, not the race's; that control is left out of
//   the checks above.
// Positions: 0 … n − 1 the course's controls, n the finish.
import { t } from "./i18n.js";
import { fmt } from "./util.js";

const MIN_SHARED = 2;           // runners with a negative leg at one control: its unit, not their cards

/** The findings of one class: { issues: [{ kind, pos, runners, other? }], marks: Map(runner → Map(pos → kind)) }.
 * kind: "unit" (negative legs shared at pos), "card" (one runner's negative leg), "finish" (one runner's finish before
 * their last control), "early" (an attested control missing, pos the first of `positions`), "dup" (pos repeats `other`). */
export function checkClass(k) {
  const rs = (k?.runners || []).filter((r) => r.splits);
  const n = k?.controls?.length || Math.max(0, ...rs.map((r) => r.splits.length));
  const issues = [], marks = new Map();
  if (!rs.length || !n) return { issues, marks };
  const cums = new Map(rs.map((r) => [r, [...Array.from({ length: n }, (_, i) => r.splits[i] ?? null), r.time_s ?? null]]));
  const mark = (r, pos, kind) => { if (!marks.has(r)) marks.set(r, new Map()); marks.get(r).set(pos, kind); };

  // the same code twice with the same time for nearly everyone: one of the two is the source's guess
  const skip = new Set();
  const codes = k.controls || [];
  for (let p = 0; p < codes.length; p++) {
    for (let q = p + 1; q < codes.length; q++) {
      if (codes[p] !== codes[q]) continue;
      const both = rs.map((r) => cums.get(r)).filter((c) => c[p] != null && c[q] != null);
      if (both.length < 2 || both.filter((c) => c[p] === c[q]).length < (2 * both.length) / 3) continue;
      // the wrong one breaks the order: the earlier control holding the later passage's time comes after its next one
      const nextOf = (c, i) => c.slice(i + 1).find((v) => v != null);
      const pWrong = both.filter((c) => { const nx = nextOf(c, p); return nx != null && c[p] > nx; }).length >= both.length / 2;
      const pos = pWrong ? p : q;
      skip.add(pos);
      issues.push({ kind: "dup", pos, other: pWrong ? q : p, runners: [] });
      rs.forEach((r) => { const c = cums.get(r); if (c[p] != null && c[p] === c[q]) mark(r, pos, "dup"); });
    }
  }

  // negative legs, control by control
  const neg = new Map();          // pos → [runner]
  for (const r of rs) {
    const c = cums.get(r);
    let prev = 0;                   // the start
    for (let i = 0; i <= n; i++) {
      if (skip.has(i) || c[i] == null) continue;
      if (c[i] < prev) { if (!neg.has(i)) neg.set(i, []); neg.get(i).push(r); }
      prev = c[i];
    }
  }
  for (const [pos, who] of [...neg].sort((a, b) => a[0] - b[0])) {
    if (who.length >= MIN_SHARED) {
      issues.push({ kind: "unit", pos, runners: who });
      who.forEach((r) => mark(r, pos, "unit"));
    } else {
      issues.push({ kind: pos === n ? "finish" : "card", pos, runners: who });
      mark(who[0], pos, pos === n ? "finish" : "card");
    }
  }

  // a finisher without a control the course's runners punched (at least 2 of them, and half)
  const attested = Array.from({ length: n }, (_, i) => {
    const got = rs.filter((r) => cums.get(r)[i] != null).length;
    return !skip.has(i) && got >= MIN_SHARED && got >= rs.length / 2;
  });
  for (const r of rs) {
    if (r.status !== "ok") continue;
    const c = cums.get(r);
    const missing = attested.map((a, i) => (a && c[i] == null ? i : -1)).filter((i) => i >= 0);
    if (!missing.length) continue;
    issues.push({ kind: "early", pos: missing[0], positions: missing, runners: [r] });
    missing.forEach((i) => mark(r, i, "early"));
  }
  return { issues, marks };
}

/** Every class of a document with findings: [{ k, issues, marks }]. */
export function checkDoc(doc) {
  return (doc?.classes || []).map((k) => ({ k, ...checkClass(k) })).filter((x) => x.issues.length);
}

// ---- words ----------------------------------------------------------------------------------------------------------
const posName = (k, pos) => {
  const n = k.controls?.length ?? Math.max(0, ...k.runners.map((r) => r.splits?.length || 0));
  return pos >= n ? t("spl.finish") : k.controls?.[pos] ? t("chk.ctl", { i: pos + 1, code: k.controls[pos] }) : t("chk.ctlN", { i: pos + 1 });
};

/** One finding in a sentence (the runners apart). */
export function issueText(k, x) {
  const where = posName(k, x.pos);
  if (x.kind === "unit") return t(where === t("spl.finish") ? "chk.unitFinish" : "chk.unit", { where, n: fmt(x.runners.length) });
  if (x.kind === "card") return t("chk.card", { where });
  if (x.kind === "finish") return t("chk.finish");
  if (x.kind === "early") return t(x.positions.length > 1 ? "chk.early.other" : "chk.early.one", { where: x.positions.map((p) => posName(k, p)).join(", ") });
  return t("chk.dup", { where, other: posName(k, x.other) });
}

/** A cell's mark in words (its title). */
export const markText = (kind) => t(`chk.mark.${kind}`);

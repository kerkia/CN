// A start list's draw checked, and the start's O Checklist file (« Organisation › Horaires », 2026-10-22; ideas of MeOSDjango's
// draw checker and « Vérifie moi » export, nothing of its code). Both take a start list as localstart.js reads it — or a
// published one of « Résultats » (no card numbers there) — { by, classes: [{ name, runners: [{ name, club, club_code,
// category, start_s, card, bib }] }], nostart }.

const clubKey = (r) => r.club_code || String(r.club || "").trim().toLowerCase() || null;
const byStart = (a, b) => (a.start_s ?? 1e9) - (b.start_s ?? 1e9) || String(a.name).localeCompare(String(b.name));

/** The checks: { warn: [{ code, items }], info: [{ code, items }], flags: Map(runner -> [code]) }. An item names its class
 * (`cls`), the runners concerned and what the check found (`s` a start, `cats` [{ cat, n blocks }], `step` and `holes` in
 * seconds). */
export function check(d) {
  const warn = [], info = [], flags = new Map();
  const flag = (r, code) => { const f = flags.get(r) || []; if (!f.includes(code)) f.push(code); flags.set(r, f); };
  const add = (list, code, items) => { if (items.length) list.push({ code, items }); };
  const timed = d.classes.map((k) => ({ k, rs: k.runners.filter((r) => r.start_s != null).sort(byStart) }));

  // two runners of a club one after the other on a circuit (on a category when the list has no circuits)
  const club = [];
  for (const { k, rs } of timed) {
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1], b = rs[i], c = clubKey(a);
      if (c && c === clubKey(b)) { club.push({ cls: k.name, s: a.start_s, runners: [a, b], club: a.club_code || a.club }); flag(a, "club"); flag(b, "club"); }
    }
  }
  add(warn, "club", club);

  // two runners in the same start minute on a circuit
  const minute = [];
  for (const { k, rs } of timed) {
    const by = new Map();
    for (const r of rs) { const m = Math.floor(r.start_s / 60); by.set(m, [...(by.get(m) || []), r]); }
    for (const [m, rr] of by) if (rr.length > 1) { minute.push({ cls: k.name, s: m * 60, runners: rr }); rr.forEach((r) => flag(r, "minute")); }
  }
  add(warn, "minute", minute);

  // a category's starts in several blocks on its circuit, another category's in between (lists by circuit only)
  const blocks = [];
  if (d.by !== "category") {
    for (const { k, rs } of timed) {
      const seq = rs.filter((r) => r.category);
      const runs = new Map();
      seq.forEach((r, i) => { if (i === 0 || seq[i - 1].category !== r.category) runs.set(r.category, (runs.get(r.category) || 0) + 1); });
      const split = [...runs].filter(([, n]) => n > 1);
      if (split.length) blocks.push({ cls: k.name, cats: split.map(([cat, n]) => ({ cat, n })), runners: seq.filter((r) => runs.get(r.category) > 1) });
    }
  }
  add(warn, "blocks", blocks);

  // what is missing: a start time, a card number (when the file gives them), a circuit
  const noStart = [...d.classes.flatMap((k) => k.runners.filter((r) => r.start_s == null).map((r) => ({ cls: k.name, runners: [r] }))),
    ...(d.nostart || []).map((r) => ({ cls: r.cls, runners: [r] }))];
  noStart.forEach((x) => x.runners.forEach((r) => flag(r, "nostart")));
  add(warn, "nostart", noStart);
  const all = d.classes.flatMap((k) => k.runners.map((r) => ({ cls: k.name, r })));
  if (all.some((x) => x.r.card)) {
    const noCard = all.filter((x) => !x.r.card).map((x) => ({ cls: x.cls, runners: [x.r] }));
    noCard.forEach((x) => flag(x.runners[0], "nocard"));
    add(warn, "nocard", noCard);
  }
  const noClass = all.filter((x) => x.cls === "?").map((x) => ({ cls: x.cls, runners: [x.r] }));
  noClass.forEach((x) => flag(x.runners[0], "noclass"));
  add(warn, "noclass", noClass);

  // the interval (the commonest gap between two starts) and the gaps beyond it, for information: a draw leaves vacant places
  const gaps = [], uneven = [];
  for (const { k, rs } of timed) {
    const times = [...new Set(rs.map((r) => r.start_s))];
    if (times.length < 4) continue;
    const steps = times.slice(1).map((s, i) => s - times[i]);
    const count = new Map();
    for (const x of steps) count.set(x, (count.get(x) || 0) + 1);
    const step = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const holes = steps.map((x, i) => ({ s: times[i], gap: x })).filter((x) => x.gap > step);
    if (holes.length) gaps.push({ cls: k.name, step, holes, runners: [] });
    const odd = steps.filter((x) => x < step || x % step).length;
    if (odd) uneven.push({ cls: k.name, step, n: odd, runners: [] });
  }
  add(info, "uneven", uneven);
  add(info, "gaps", gaps);
  return { warn, info, flags };
}

// ---- O Checklist (Stigning; « Vérifie moi »): the starters ticked off at the start -------------------------------------
// Its CSV (stigning.se/startclock/template.html, checked 2026-10-22): UTF-8, commas, one runner a line, Name, Club, Class,
// Bib, StartTime (hh:mm:ss), Card, StartName — empty fields keep their commas, a field with a comma or a quote is quoted —;
// no header, a line starting with « // » being a comment. Sorted by start time.
const field = (v) => { const s = String(v ?? "").replace(/[\r\n]+/g, " ").trim(); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const hms = (s) => (s == null ? "" : [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":"));

/** The file's text. `cls` "category" names a runner's class by their category when known (else the list's class), "list"
 * by the list's class (the circuit); `starts` maps a list's class to its start's name; `club(r)` writes a club. */
export function oChecklist(d, { cls = "category", starts = {}, club = (r) => r.club || "" } = {}) {
  const rows = [...d.classes.flatMap((k) => k.runners.map((r) => ({ r, k: k.name }))), ...(d.nostart || []).map((r) => ({ r, k: r.cls }))]
    .sort((a, b) => byStart(a.r, b.r) || a.k.localeCompare(b.k));
  const lines = rows.map(({ r, k }) => [r.name, club(r), (cls === "category" && r.category) || k, r.bib, hms(r.start_s), r.card, starts[k]]
    .map(field).join(","));
  return ["// Name,Club,Class,Bib,StartTime,Card,StartName", ...lines].join("\n") + "\n";
}

/** The file saved (UTF-8 without a byte-order mark: the app would read it as part of the first name). */
export function saveOChecklist(name, text) {
  const slug = String(name || "depart").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = `ochecklist-${slug || "depart"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

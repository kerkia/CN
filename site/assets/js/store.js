// Global, persisted UI state shared by every page.

// Every method, in display order: the retained pair (fair3 / top6w3, 2026-10-13: cubic mean, geometric circuit value)
// before the linear ones, studied for reference. Everyone sees the official method and the Top; the others are analysis
// methods, shown only to the accounts with the "Analyse" right (admin page, administrators included): the linear Top
// and the « Fit » methods.
export const METHODS = ["official", "top6w3", "top6w", "fair3", "fair"];
const ANALYSIS = ["top6w", "fair3", "fair"];
const RENAMED = { top6w2: "top6w3", fair2: "fair3" };     // the quadratic pair, replaced on 2026-10-13
let analyst = false;
/** The methods this visitor may see and pick. */
export const available = () => METHODS.filter((m) => analyst || !ANALYSIS.includes(m));
// Disciplines offered by the site-wide selector: forest, sprint, mountain bike, ski.
export const TERRAINS = ["For", "Spr", "VTT", "Ski"];
export const MAX_COMPARE = 8;

const KEY = "cnx.state";
// One method at a time for the whole site (owner, 2026-10-12: several at once confused most users), chosen at the right
// of the header's second row; « methods » stays as the one-element list the pages read.
const defaults = {
  method: "official",
  methods: ["official"],
  terrain: "For",
  compare: [],            // [{lic, slot}] — slot is a fixed colour index 0..7
  clubs: [],              // [{code, slot}] — clubs being compared, same slot rule
  pageSize: 50,           // ranking list: 25 | 50 | 100 | "all"
  lastRunner: null,       // the current runner: last one opened, centred on or added anywhere
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!TERRAINS.includes(s.terrain)) delete s.terrain;
    // (a selection of several methods, saved before 2026-10-12, gives way to the default)
    if (RENAMED[s.method]) s.method = RENAMED[s.method];
    if (!METHODS.includes(s.method)) s.method = defaults.method;
    s.methods = [s.method];
    delete s.mv;
    return { ...defaults, ...s };
  } catch (e) {
    return { ...defaults };
  }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
export const get = () => state;
/** Re-read after another tab changed the saved state. */
export function reload() {
  state = load();
  listeners.forEach((fn) => fn(state));
}
export function set(patch) {
  state = { ...state, ...patch };
  save();
  listeners.forEach((fn) => fn(state));
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether this visitor may see the analysis methods; the method chosen must be one they may see. */
export function setAnalyst(flag) {
  analyst = !!flag;
  if (!available().includes(state.method)) set({ method: defaults.method, methods: [defaults.method] });
}

// the method shown before the last switch (this visit only): the runner's chart draws it as a faint grey line
let previous = null;
export const prevMethod = () => previous;
/** The site's method; `quiet`: from a link (?m=), not a switch, so no previous method to show. */
export function setMethod(m, { quiet = false } = {}) {
  m = RENAMED[m] || m;                                     // an old link (?m=top6w2)
  if (!available().includes(m) || m === state.method) return;
  previous = quiet ? null : state.method;
  set({ method: m, methods: [m] });
}
export const toggleMethod = (m) => setMethod(m);

// ---- comparison set -------------------------------------------------------
// Colour follows the runner, not their position: a runner keeps its slot until
// removed, and a newcomer takes the lowest free slot. Removing someone must
// never repaint the others.
export const inCompare = (lic) => state.compare.some((c) => c.lic === lic);
export const slotOf = (lic) => state.compare.find((c) => c.lic === lic)?.slot;
export function addCompare(lic) {
  if (inCompare(lic)) return true;
  if (state.compare.length >= MAX_COMPARE) return false;
  const used = new Set(state.compare.map((c) => c.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  // the runner just picked becomes the current one for pages with no selection of their own
  set({ compare: [...state.compare, { lic, slot }], lastRunner: lic });
  return true;
}
export function removeCompare(lic) {
  set({ compare: state.compare.filter((c) => c.lic !== lic) });
}
export function toggleCompare(lic) {
  return inCompare(lic) ? (removeCompare(lic), true) : addCompare(lic);
}
export function setCompare(lics) {
  const kept = state.compare.filter((c) => lics.includes(c.lic));
  const used = new Set(kept.map((c) => c.slot));
  const out = [...kept];
  for (const lic of lics) {
    if (out.length >= MAX_COMPARE) break;
    if (out.some((c) => c.lic === lic)) continue;
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    out.push({ lic, slot });
  }
  set({ compare: out });
}

// ---- club comparison: same fixed-slot rule, keyed by 4-digit club code -----
export const MAX_CLUBS = 8;
export const inClubs = (code) => state.clubs.some((c) => c.code === code);
export function addClub(code) {
  if (inClubs(code)) return true;
  if (state.clubs.length >= MAX_CLUBS) return false;
  const used = new Set(state.clubs.map((c) => c.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  set({ clubs: [...state.clubs, { code, slot }] });
  return true;
}
export function removeClub(code) {
  set({ clubs: state.clubs.filter((c) => c.code !== code) });
}
export function toggleClub(code) {
  return inClubs(code) ? (removeClub(code), true) : addClub(code);
}
export function setClubs(codes) {
  const kept = state.clubs.filter((c) => codes.includes(c.code));
  const used = new Set(kept.map((c) => c.slot));
  const out = [...kept];
  for (const code of codes) {
    if (out.length >= MAX_CLUBS) break;
    if (out.some((c) => c.code === code)) continue;
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    out.push({ code, slot });
  }
  set({ clubs: out });
}

// Global, persisted UI state shared by every page.

export const METHODS = ["official", "fair", "top6w"];
// Disciplines offered by the site-wide selector. Ski-O and VTT-O will join forest and sprint.
export const TERRAINS = ["For", "Spr"];
export const MAX_COMPARE = 8;

const KEY = "cnx.state";
const defaults = {
  methods: ["official", "fair", "top6w"],
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
    if (Array.isArray(s.methods)) {             // the 2026 method was replaced by the Fair one
      s.methods = [...new Set(s.methods.map((m) => (m === "v2026" ? "fair" : m)))].filter((m) => METHODS.includes(m));
      if (!s.methods.length) delete s.methods;
    }
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

export function toggleMethod(m) {
  const cur = new Set(state.methods);
  if (cur.has(m)) {
    if (cur.size === 1) return;          // keep at least one method visible
    cur.delete(m);
  } else {
    cur.add(m);
  }
  set({ methods: METHODS.filter((x) => cur.has(x)) });
}

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

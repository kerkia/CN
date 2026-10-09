// What the user sets, on this phone only (localStorage): language, their name, the runners and races they follow.
const KEY = "ocap.settings";
const DEFAULTS = { lang: "auto", first: "", last: "", follow: [], comps: [], opened: [], cls: {} };
let cache = null;

export function settings() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { cache = { ...DEFAULTS }; }
  return cache;
}
export function save(patch) {
  cache = { ...settings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* private mode: kept for this visit */ }
  return cache;
}

// names compared without case, accents or punctuation; « DUPONT Marie » and « Marie Dupont » are the same runner
export const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameKey = (s) => norm(s).split(" ").filter(Boolean).sort().join(" ");

export function isMe(name) {
  const s = settings();
  return !!(s.first && s.last) && nameKey(name) === nameKey(`${s.first} ${s.last}`);
}
export const runnerKey = (name, club) => `${nameKey(name)}|${norm(club)}`;
export const follows = (name, club) => settings().follow.some((f) => f.k === runnerKey(name, club));
export function toggleFollow(name, club) {
  const k = runnerKey(name, club), f = settings().follow;
  save({ follow: f.some((x) => x.k === k) ? f.filter((x) => x.k !== k) : [...f, { k, name, club }] });
  return follows(name, club);
}
/** Races opened lately, newest first (the list shows them on top). */
export function opened(comp) {
  const o = settings().opened.filter((x) => x.id !== comp.id);
  save({ opened: [comp, ...o].slice(0, 8) });
}

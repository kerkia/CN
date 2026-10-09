// Small helpers the pages share.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Seconds -> « 41:30 », « 1:02:03 »; null -> «  ». */
export function clock(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}
export const signed = (s) => (s == null ? "" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);

/** A data file of the site, kept for the visit (the files change at most hourly). */
const memo = new Map();
export function getData(path) {
  if (!memo.has(path)) {
    memo.set(path, fetch(`data/${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => { memo.delete(path); return null; }));
  }
  return memo.get(path);
}

export const today = () => new Date().toLocaleDateString("sv-SE");
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3);

/** A day's races by département number (2A and 2B after 20, overseas after 95; none last). */
export const depOrder = (d) => (!d ? 1e6 : /^2A$/i.test(d) ? 20.1 : /^2B$/i.test(d) ? 20.2 : parseFloat(d) || 9e5);

/** The shared shape of a « tabs » choice: [[value, label]…] -> buttons with data-v. */
export const segs = (name, items, on) => `<div class="chips inline" role="tablist">${items.map(([v, l]) =>
  `<button role="tab" class="chip${v === on ? " on" : ""}" aria-selected="${v === on}" data-${name}="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;

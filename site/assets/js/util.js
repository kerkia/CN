// Shared helpers.

import { lang, locale } from "./i18n.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => (v == null ? "" : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

// Trusted markup marker for the html`` template below.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s == null ? "" : String(s));

/**
 * Tagged template that escapes every interpolation unless wrapped in raw().
 * Names, clubs and titles come from scraped pages, so nothing reaches
 * innerHTML without going through here.
 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    out += render(vals[i]) + strings[i + 1];
  }
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v == null || v === false) return "";
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : esc(content);
  return el;
}

// ---- numbers & dates ------------------------------------------------------
// numbers and dates in the interface's language (i18n.locale: fr-FR or en-GB)
export const fmt = (n, digits = 0) =>
  n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString(locale(), {
    maximumFractionDigits: digits, minimumFractionDigits: digits,
  });
/** An ordinal: 1er, 2e, 3e… in French; 1st, 2nd, 3rd, 4th… in English. */
const EN_ORD = new Intl.PluralRules("en-GB", { type: "ordinal" });
const EN_SUFFIX = { one: "st", two: "nd", few: "rd", other: "th" };
export const ord = (n) => (n == null ? "—" : lang() === "en" ? `${fmt(n)}${EN_SUFFIX[EN_ORD.select(n)]}` : n === 1 ? "1er" : `${fmt(n)}e`);
/** "1 victoire" / "3 victoires": the plural from 2 up in French, for anything but 1 in English (0 races). */
export const plural = (n, one, many) => `${fmt(n)} ${(lang() === "en" ? Math.abs(n) !== 1 : Math.abs(n) >= 2) ? many : one}`;
/** An FFCO class as shown: « H21 », « D16 » in French; « M21 », « W16 » in English (owner, 2026-10-17). */
export const fmtCat = (c) => (c && lang() === "en" ? String(c).replace(/^([HD])(?=\d|$|\s)/, (m) => (m === "H" ? "M" : "W")) : c ?? "");
/** The sex letter of a class as shown: H / D in French, M / W in English. */
export const fmtSex = (x) => (lang() === "en" ? { H: "M", D: "W" }[x] || x : x);
export const fmtSigned =(n) => (n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n)));
export const pct = (x, digits = 0) => (x == null ? "—" : fmt(100 * x, digits) + " %");

export function fmtDate(iso, style = "medium") {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const opts = style === "month"
    ? { month: "long", year: "numeric" }
    : style === "short"
      ? { day: "2-digit", month: "2-digit", year: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString(locale(), opts);
}
export function fmtTime(s) {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
export const isoDay = (d) => d.toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ---- stats ----------------------------------------------------------------
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function summary(values) {
  const v = values.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const top20 = v.slice(-Math.max(1, Math.round(0.2 * v.length)));
  return {
    n: v.length, mean: mean(v), median: quantile(v, 0.5),
    p10: quantile(v, 0.1), p90: quantile(v, 0.9),
    top20: mean(top20), max: v[v.length - 1], min: v[0],
  };
}

// ---- misc -----------------------------------------------------------------
export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function initials(name) {
  const parts = (name || "").split(/\s+/).filter(Boolean);
  const last = parts.find((p) => p === p.toUpperCase()) || parts[0] || "";
  const first = parts.find((p) => p !== p.toUpperCase()) || parts[1] || "";
  return ((first[0] || "") + (last[0] || "")).toUpperCase();
}
/** "DUPONT Marie" -> "Marie Dupont" for display. */
export function displayName(nom) {
  if (!nom) return "";
  const parts = nom.split(/\s+/);
  const upper = parts.filter((p) => p.length > 1 && p === p.toUpperCase());
  const rest = parts.filter((p) => !(p.length > 1 && p === p.toUpperCase()));
  if (!upper.length || !rest.length) return nom;
  const cap = (w) => w.toLowerCase().replace(/(^|[-' ])\p{L}/gu, (c) => c.toUpperCase());
  return `${rest.join(" ")} ${upper.map(cap).join(" ")}`;
}
/** "DUPONT Marie" -> { first: "Marie", last: "Dupont" }: the header shows them on two lines. */
export function nameParts(nom) {
  const parts = (nom || "").split(/\s+/).filter(Boolean);
  const isLast = (p) => p.length > 1 && p === p.toUpperCase();
  const cap = (w) => w.toLowerCase().replace(/(^|[-' ])\p{L}/gu, (c) => c.toUpperCase());
  const last = parts.filter(isLast), first = parts.filter((p) => !isLast(p));
  return last.length && first.length ? { first: first.join(" "), last: last.map(cap).join(" ") } : { first: nom || "", last: "" };
}
export function downloadCsv(filename, header, rows) {
  // the separator spreadsheets expect in the interface's language: « ; » in French (decimal comma), « , » in English
  const sep = lang() === "en" ? "," : ";";
  const q = (v) => {
    const s = v == null ? "" : String(v);
    return s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(q).join(sep)).join("\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function normalise(s) {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

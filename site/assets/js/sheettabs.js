// A Google Sheet of start times (« Orga › Horaires »: a start list's deposit, a booking's import; 2026-11-03): every tab
// with something in it (functions/api/sheet.js &all=1 — Balise 77's file had a tab per three circuits, and its address
// named one), each read on its own by localstart.js (a tab's columns name its own circuits), the circuits put together,
// and written back as one CSV of our own layout, which the browser's reader and the server's (prov/parsers/startlist.py)
// both read: Heure;Nom;Club;Circuit;Puce.

import { parse } from "./localstart.js";

const enc = new TextEncoder();
const two = (n) => String(n).padStart(2, "0");
export const hms = (s) => `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(Math.round(s % 60))}`;
const field = (v) => { const s = String(v ?? "").replace(/[\r\n]+/g, " ").trim(); return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Classes [{ name, runners: [{ name, club, start_s, card }] }] as our CSV (a runner a line, by start time). */
export function toCsv(classes) {
  const rows = classes.flatMap((k) => k.runners.filter((r) => r.start_s != null).map((r) => [r.start_s, r.name, r.club || "", k.name, r.card || ""]))
    .sort((a, b) => a[0] - b[0] || String(a[3]).localeCompare(String(b[3])));
  // i18n-ignore-next 1 (the file's own headings, read by both readers whatever the site's language)
  return ["Heure;Nom;Club;Circuit;Puce", ...rows.map(([s, ...rest]) => [hms(s), ...rest].map(field).join(";"))].join("\r\n") + "\r\n";
}

/** The parses of several tabs as one: the classes of the same name merged, the first date and title kept. */
export function merge(reads) {
  const ok = reads.filter(Boolean);
  if (!ok.length) return null;
  const classes = new Map();
  for (const d of ok) for (const k of d.classes) {
    if (classes.has(k.name)) classes.get(k.name).runners.push(...k.runners);
    else classes.set(k.name, { ...k, runners: [...k.runners] });
  }
  return { ...ok[0], by: ok.every((d) => d.by === "category") ? "category" : "circuit", classes: [...classes.values()],
    nostart: ok.flatMap((d) => d.nostart || []), date: ok.find((d) => d.date)?.date || null };
}

/** A Google Sheets address -> { read, csv: bytes } (every tab), or { error } (functions/api/sheet.js's codes). */
export async function sheetTabs(url) {
  const r = await fetch(`api/sheet?all=1&url=${encodeURIComponent(url)}`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
  if (!r?.ok) {
    const j = r ? await r.json().catch(() => ({})) : {};
    return { error: j.error || "fail" };
  }
  let read;
  if ((r.headers.get("content-type") || "").includes("json")) {
    const { tabs = [] } = await r.json();
    read = merge(await Promise.all(tabs.map((x) => parse(enc.encode(x.csv), "sheet.csv").catch(() => null))));
  } else {
    read = await parse(new Uint8Array(await r.arrayBuffer()), "sheet.csv").catch(() => null);
  }
  if (!read || !read.classes.length) return { error: "read" };
  return { read, csv: enc.encode(toCsv(read.classes)) };
}

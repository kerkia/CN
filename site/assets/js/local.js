// The results file being analysed on « Déposer » before anyone chooses to publish it: read in the browser
// (localparse.js), kept in sessionStorage — so it survives moving between pages and a reload, and is gone when the
// tab is closed or the account logs out — and never sent until « Publier ». The file itself (to publish it) is kept
// in memory only: after a reload it must be chosen again to be sent.

const KEY = "ocn.local";
export const LOCAL = "fichier";              // the race key the pages use for it (#/temps-inter?course=fichier)
let memory = null;                           // the same record, when sessionStorage refuses it (too big, private mode)
let fileObj = null;                          // the File, for « Publier »

/** { name, size, at, docs, pdf, unread, kept } or null. */
export function get() {
  if (memory) return memory;
  try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}

/** Keeps a file just read; returns whether it will survive a reload (sessionStorage accepted it). */
export function set(file, read) {
  fileObj = file;
  const rec = { name: file.name, size: file.size, at: Date.now(), ...read };
  memory = null;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(rec));
    return true;
  } catch (e) {
    memory = rec;
    return false;
  }
}

export function clear() {
  memory = null;
  fileObj = null;
  try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ }
}

/** The file to publish, if it is still in memory and is the one analysed. */
export const file = () => {
  const r = get();
  return fileObj && r && fileObj.name === r.name && fileObj.size === r.size ? fileObj : null;
};
/** The same file chosen again after a reload. */
export function attach(f) {
  const r = get();
  if (r && f.name === r.name && f.size === r.size) { fileObj = f; return true; }
  return false;
}

/** The file as a race of « Récemment » (the shape the split-times page reads), or null. */
export function race() {
  const r = get();
  if (!r?.docs?.length) return null;
  const d = r.docs[0];
  return { key: LOCAL, name: d.title || r.name, date_iso: r.docs.map((x) => x.date).find(Boolean) || null, local: true,
    splits: r.docs.some((x) => x.classes.some((k) => k.runners.some((p) => p.splits))), docs: r.docs };
}

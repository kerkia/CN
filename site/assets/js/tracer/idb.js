// The Tracer's storage in this browser (IndexedDB « ocn-tracer »): field photos waiting for the network, and the events and
// maps kept for working offline (offline.js). Values are kept as they are given (encrypted events stay encrypted).

const NAME = "ocn-tracer", STORES = ["photos", "events", "maps", "pending"];
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
};
export const get = (store, key) => tx(store, "readonly", (s) => s.get(key)).catch(() => undefined);
export const put = (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key));
export const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key)).catch(() => {});
export const keys = (store) => tx(store, "readonly", (s) => s.getAllKeys()).catch(() => []);

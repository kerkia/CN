// Cartographier's storage (/api/mapper, functions/api/mapper/[[path]].js) and its file (.ozmap). The document travels as
// gzip-compressed JSON (map.json, docs/mapper/model.md); the OCAD file it came from as it was (an OCAD export carries what was
// not changed through); backgrounds and images once each, by their SHA-256. Saves name the version they were made on (409 when
// a teammate saved since). The .ozmap is a zip: map.json, source.ocd, files/<sha>.

import { FFLATE } from "../vendor.js";
import { t } from "./lang.js";

export const EXT = ".ozmap", FORMAT = "ozimut-map", VERSION = 1;
export const isOzmap = (f) => /\.ozmap$/i.test(f?.name || "");

export async function api(path, { method = "GET", body, type, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) { payload = body; h["Content-Type"] = type || body.type || "application/octet-stream"; }
  else if (body != null) { payload = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const r = await fetch(`api/mapper${path}`, { method, headers: h, body: payload, credentials: "same-origin" });
  if (raw && r.ok) return r;
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json().catch(() => null) : r.ok ? await r.arrayBuffer() : null;
  if (!r.ok) { const e = new Error(data?.error || `http ${r.status}`); e.status = r.status; e.code = data?.error; e.data = data; throw e; }
  return data;
}

// ---- compression and hashing --------------------------------------------------------------------------------------------
export async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function gunzip(bytes) {
  const a = new Uint8Array(bytes);
  if (!(a[0] === 0x1f && a[1] === 0x8b)) return new TextDecoder().decode(a);
  const s = new Blob([a]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}
export async function sha256(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- a map on the server --------------------------------------------------------------------------------------------------
export const list = () => api("");
export const create = (card) => api("", { method: "POST", body: card });
export const card = (id) => api(`/${id}`);
export const setCard = (id, patch) => api(`/${id}`, { method: "PUT", body: patch });
export const remove = (id) => api(`/${id}`, { method: "DELETE" });
export async function loadDoc(id) {
  const r = await api(`/${id}/doc`, { raw: true }).catch((e) => { if (e.status === 404) return null; throw e; });
  if (!r) return { doc: null, version: 0 };
  const text = await gunzip(await r.arrayBuffer());
  return { doc: JSON.parse(text), version: Number(r.headers.get("X-Version") || 0) };
}
/** Save the document; `base` the version it was opened or last saved at. Returns the new version (throws 409 on a conflict). */
export async function saveDoc(id, json, base, objects) {
  const body = await gzip(JSON.stringify(json));
  const r = await api(`/${id}/doc`, { method: "PUT", body, type: "application/gzip", headers: { "X-Base-Version": String(base ?? -1), "X-Objects": String(objects ?? 0) } });
  return r.version;
}
export async function loadSource(id) {
  const r = await api(`/${id}/source`, { raw: true }).catch((e) => { if (e.status === 404) return null; throw e; });
  return r ? new Uint8Array(await r.arrayBuffer()) : null;
}
export const saveSource = (id, bytes) => api(`/${id}/source`, { method: "PUT", body: bytes, type: "application/octet-stream" });
const fileCache = new Map();
export async function loadFile(id, sha) {
  if (!fileCache.has(sha)) fileCache.set(sha, api(`/${id}/files/${sha}`, { raw: true }).then(async (r) => ({ bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" })));
  return fileCache.get(sha);
}
/** Keep a file on the server (once): returns its SHA-256. */
export async function saveFile(id, bytes, type = "application/octet-stream") {
  const sha = await sha256(bytes);
  fileCache.set(sha, Promise.resolve({ bytes, type }));
  await api(`/${id}/files/${sha}`, { method: "PUT", body: bytes, type });
  return sha;
}
export const versions = (id) => api(`/${id}/versions`);
export async function saveVersion(id, json, note = "") {
  const body = await gzip(JSON.stringify(json));
  return api(`/${id}/versions`, { method: "POST", body, type: "application/gzip", headers: { "X-Note": encodeURIComponent(note) } });
}
export async function loadVersion(id, n) {
  const r = await api(`/${id}/versions/${n}`, { raw: true });
  return JSON.parse(await gunzip(await r.arrayBuffer()));
}
/** Several mappers at once (collab.js): one's presence, pointer and sector; the others' in return, and the map's version. */
export const presence = (id, { sector = null, at = null } = {}) => api(`/${id}/presence`, { method: "POST", body: { sector, at } });
export const leave = (id) => api(`/${id}/presence`, { method: "DELETE" });
export const invites = (id) => api(`/${id}/invites`);
export const invite = (id, role, days) => api(`/${id}/invites`, { method: "POST", body: { role, days } });
export const revoke = (id, n) => api(`/${id}/invites?n=${n}`, { method: "DELETE" });
export const join = (id, token) => api(`/${id}/join`, { method: "POST", body: { token } });
export async function comments(id) { const d = await api(`/${id}/comments`); return Array.isArray(d) ? d : d?.list || []; }
export const saveComments = (id, list) => api(`/${id}/comments`, { method: "PUT", body: { list } });
export const savePhoto = (id, pid, blob) => api(`/${id}/photo/${pid}`, { method: "PUT", body: blob, type: "image/jpeg" });
export const photoUrl = (id, pid) => `api/mapper/${id}/photo/${pid}`;

// ---- the .ozmap file ------------------------------------------------------------------------------------------------------
function script(src) {
  if (window.fflate) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("fflate")); document.head.appendChild(s); });
}
/** The .ozmap's bytes: the document, the OCAD source, the files ({ sha: { bytes } }). */
export async function writeOzmap(json, { source = null, files = {} } = {}) {
  await script(FFLATE);
  const enc = new TextEncoder(), entries = { "map.json": enc.encode(JSON.stringify({ ...json, format: FORMAT, version: VERSION, saved: new Date().toISOString(), app: "Ozimut — https://ozimut.com" })) };
  if (source) entries["source.ocd"] = [source, { level: 0 }];
  for (const [sha, f] of Object.entries(files)) entries[`files/${sha}`] = [f.bytes, { level: 0 }];
  return window.fflate.zipSync(entries, { level: 6 });
}
/** { doc, source, files } from a .ozmap's bytes. */
export async function readOzmap(bytes) {
  await script(FFLATE);
  const z = window.fflate.unzipSync(new Uint8Array(bytes));
  if (!z["map.json"]) throw new Error(t("map.file.notOzmap"));
  const doc = JSON.parse(new TextDecoder().decode(z["map.json"]));
  if (doc.format !== FORMAT) throw new Error(t("map.file.notOzmap"));
  if (doc.version > VERSION) throw new Error(t("map.file.newer"));
  const files = {};
  for (const [k, v] of Object.entries(z)) if (k.startsWith("files/")) files[k.slice(6)] = { bytes: v };
  return { doc, source: z["source.ocd"] || null, files };
}

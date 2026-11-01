// « Nutrition »: what the reader's page (pages/nutrition.js) and the authors' (pages/nutritionwrite.js) share — the server's
// list, a theme's name in the reader's language, the reading time, the dates, an image sent to the server.

import { fmtDate } from "../util.js";
import { t, tn, lang, LANGS } from "../i18n.js";

export const API = "api/nutrition";

/** GET or send JSON to /api/nutrition… -> { ok, status, data }. */
export async function call(path, { method = "GET", body } = {}) {
  try {
    const r = await fetch(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

/** A theme's name in the reader's language, else in the first language it has. */
export const catName = (c) => (c ? c.names?.[lang()] || LANGS.map((l) => c.names?.[l]).find(Boolean) || "?" : "");
/** About 200 words a minute, one at least. */
export const readingTime = (words) => tn("nut.minutes", Math.max(1, Math.round((words || 0) / 200)));
export const dayOf = (iso) => (iso ? iso.slice(0, 10) : "");
export const fmtDay = (iso) => (iso ? fmtDate(dayOf(iso)) : "—");
/** Published and its day come: what readers see. */
export const isLive = (p) => p.status === "published" && p.published && p.published <= new Date().toISOString();
export const langName = (l) => t(`nut.lang.${l}`);

/** A photo made reasonable before it is sent (1800 px at most, JPEG, or PNG/GIF kept), then its address on the server. */
export async function uploadImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("type");
  let blob = file;
  if (file.type !== "image/gif") {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      if (k < 1 || file.size > 1.5e6) {
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        const type = file.type === "image/png" && file.size < 2e6 ? "image/png" : "image/jpeg";
        blob = await new Promise((res) => c.toBlob(res, type, 0.86)) || file;
      }
    } catch (e) { /* sent as it is */ }
  }
  const r = await fetch(`${API}/img`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type }, body: blob });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.url) throw new Error(d?.error || "upload");
  return d.url;
}

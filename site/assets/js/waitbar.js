// waitbar.js — a wait shown (owner, 2026-11-01: « wherever requests to IGN, OpenStreetMap or running karttapullautin may take time, progress
// bars or hourglasses »): the browser's own <progress>, its value the share done, no value while the share is unknown — the
// browsers then animate it, the hourglass. Used by the generated maps, the 3D views' relief, the Tracer's busy states.

const clamp = (f) => Math.max(0, Math.min(1, f));

/** The bar's HTML: frac in [0, 1], or null for a wait of unknown length. */
export const bar = (frac = null, cls = "") => `<progress class="wait-bar${cls ? ` ${cls}` : ""}" max="1"${frac == null ? "" : ` value="${clamp(frac).toFixed(3)}"`}></progress>`;

/** A bar already drawn, set to frac (null: unknown). */
export function setBar(el, frac = null) {
  if (!el) return;
  if (frac == null) el.removeAttribute("value"); else el.value = clamp(frac);
}

/** Seconds as « m:ss » (an elapsed wait). */
export const elapsed = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Full window for the pages built around a map — the analyses' playback (« Analyse solo », « Analyse multi ») — as the
// Tracer opens (owner, 2026-10-15: the room for the map, without the site's menus stacked above it). « ⤢ » hides the site's
// bar and footer and lets the page fill the window (Échap or « ⤡ » brings them back); « ↗ » opens the same page alone in a
// new tab (?fen=1), whose « ✕ » closes that tab. The tab is opened by script, without « noopener », so it starts with a copy
// of this tab's session storage: « Analyse solo » finds its files there as after a reload.

const CLS = "full-win";
export const inOwnTab = () => /[?&]fen=1(?:&|$)/.test(location.hash);
export const isFull = () => document.body.classList.contains(CLS);

const look = () => { const own = inOwnTab(), on = isFull(); return { on, text: own && on ? "✕" : on ? "⤡" : "⤢",
  title: own && on ? "Fermer cet onglet" : on ? "Quitter le plein écran (Échap)" : "Plein écran : la carte occupe toute la fenêtre" }; };
function label() {
  const l = look();
  for (const b of document.querySelectorAll('[data-fw="toggle"]')) { b.setAttribute("aria-pressed", String(l.on)); b.textContent = l.text; b.title = l.title; }
}
export function setFull(on) {
  document.body.classList.toggle(CLS, !!on);
  label();
  window.dispatchEvent(new Event("resize"));             // the pages fit their height to the window on resize
}
/** Leaving the page: the site's bar comes back. */
export function leaveFull() { if (isFull()) setFull(false); }
export function newTab() {
  const h = location.hash || "#/";
  const url = `${location.href.replace(/#.*$/, "")}${/[?&]fen=1/.test(h) ? h : `${h}${h.includes("?") ? "&" : "?"}fen=1`}`;
  window.open(url, "_blank");
}
/** The two buttons, as HTML (pages pass it through raw()). */
export const buttons = () => { const l = look(); return `<button type="button" class="btn btn-sm fw-btn" data-fw="toggle" aria-pressed="${l.on}" title="${l.title}">${l.text}</button>${inOwnTab() ? "" : '<button type="button" class="btn btn-sm fw-btn" data-fw="tab" title="Ouvrir dans un nouvel onglet">↗</button>'}`; };

let bound = false;
/** Once per visit: the buttons' clicks (wherever a page draws them) and Échap. */
export function bindFull() {
  label();
  if (bound) return;
  bound = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-fw]");
    if (!b) return;
    if (b.dataset.fw === "tab") { newTab(); return; }
    if (isFull() && inOwnTab()) { window.close(); setTimeout(() => setFull(false), 300); return; }   // a tab not opened by script stays
    setFull(!isFull());
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isFull() || inOwnTab()) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable], .modal, dialog")) return;
    setFull(false);
  });
}

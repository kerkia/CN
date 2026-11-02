// « Mesurer » on the analyses' maps (owner, 2026-11-02, after RouteGadget): clicks on the map lay a line, its length in metres
// shown at its end — the whole line and its last segment. The page gives the metres between two pixels of its map (its
// calibration, else its georeference) and draws the line in its own drawing pass. On while its button is pressed; the button
// again, or Escape, ends it and clears the line.

import { fmt } from "../util.js";

/**
 * button: the toggle; metres(a, b): the metres between two map pixels [x, y], null when the map has no scale; redraw(): the
 * page draws again. -> { on, click(x, y), paint(g, lw), stop() }.
 */
export function measureTool(button, { metres, redraw, onToggle = null, out = null }) {
  const st = { on: false, pts: [] };
  const set = (on) => {
    st.on = on; st.pts = [];
    if (out) { out.hidden = !on; out.textContent = ""; }
    button.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("measuring", on);
    onToggle?.(on); redraw();
  };
  button.addEventListener("click", () => set(!st.on));
  const onKey = (e) => { if (st.on && e.key === "Escape") { e.stopPropagation(); set(false); } };
  document.addEventListener("keydown", onKey, true);
  const len = (a, b) => metres(a, b) ?? 0;
  const show = (m) => (m < 1000 ? `${fmt(Math.round(m))} m` : `${fmt(m / 1000, 2)} km`);
  return {
    get on() { return st.on; },
    click(x, y) { if (!st.on) return false; st.pts.push([x, y]); redraw(); return true; },
    stop() { if (st.on) set(false); },
    destroy() { document.removeEventListener("keydown", onKey, true); document.body.classList.remove("measuring"); },
    /** The line and its length, on the map's drawing context (lw(px): a width in screen pixels). */
    paint(g, lw) {
      if (!st.on || !st.pts.length) return;
      const P = st.pts;
      g.save(); g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha = 1;
      g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = "#ffffff"; g.lineWidth = lw(5); g.stroke();
      g.setLineDash([lw(8), lw(5)]); g.strokeStyle = "#0b3d91"; g.lineWidth = lw(2.5); g.stroke(); g.setLineDash([]);
      for (const [x, y] of P) { g.beginPath(); g.arc(x, y, lw(4), 0, Math.PI * 2); g.fillStyle = "#0b3d91"; g.fill(); }
      let total = 0;
      for (let i = 1; i < P.length; i++) total += len(P[i - 1], P[i]);
      const last = P.length > 1 ? len(P[P.length - 2], P[P.length - 1]) : 0;
      const label = P.length < 2 ? "" : P.length > 2 ? `${show(total)} (${show(last)})` : show(total);
      if (out) out.textContent = label;
      if (label) {
        const [x, y] = P[P.length - 1];
        g.font = `600 ${lw(13)}px system-ui, sans-serif`; g.textBaseline = "bottom";
        g.strokeStyle = "#ffffff"; g.lineWidth = lw(4); g.strokeText(label, x + lw(8), y - lw(6));
        g.fillStyle = "#0b3d91"; g.fillText(label, x + lw(8), y - lw(6));
      }
      g.restore();
    },
  };
}

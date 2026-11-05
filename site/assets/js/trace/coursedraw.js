// A circuit drawn over a map (the replays of « Analyse de carte » and « Analyse solo », the organisers' editor): the start's
// triangle, the controls' circles with their numbers, the finish's double circle and the legs between them, in the course's purple.

const COURSE = "#a626a4";

/** controls [{ x, y, kind: "start" | "control" | "finish" }] in the map's pixels; r a circle's radius (px); lw(px) a line width at
 *  the view's scale; first: the controls before the part drawn (a leg's numbers); lines: the legs (none on a score course). */
export function drawCourse(g, controls, r, lw, alpha = 0.85, first = 0, lines = true) {
  if (!controls?.length) return;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = COURSE; g.fillStyle = COURSE; g.lineWidth = lw(2);
  const R = (p) => (p.kind === "finish" ? r * 1.3 : r);
  for (let i = 1; lines && i < controls.length; i++) {           // a score course: no legs drawn
    const a = controls[i - 1], b = controls[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < R(a) + R(b) + 2) continue;
    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    g.beginPath(); g.moveTo(a.x + ux * R(a), a.y + uy * R(a)); g.lineTo(b.x - ux * R(b), b.y - uy * R(b)); g.stroke();
  }
  let n = first;                                         // the controls before the part drawn (a leg)
  g.font = `600 ${lw(14)}px system-ui, sans-serif`; g.textBaseline = "middle";
  for (const p of controls) {
    if (p.kind === "start") {
      g.beginPath(); for (let m = 0; m < 3; m++) { const a = -Math.PI / 2 + (m * 2 * Math.PI) / 3; const x = p.x + r * 1.1 * Math.cos(a), y = p.y + r * 1.1 * Math.sin(a); if (m) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.stroke();
    } else {
      g.beginPath(); g.arc(p.x, p.y, r, 0, 2 * Math.PI); g.stroke();
      if (p.kind === "finish") { g.beginPath(); g.arc(p.x, p.y, r * 1.3, 0, 2 * Math.PI); g.stroke(); }
      else { n++; g.fillText(String(n), p.x + r + lw(3), p.y - r * 0.6); }
    }
  }
  g.restore();
}

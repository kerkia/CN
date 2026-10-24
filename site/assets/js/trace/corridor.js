// Corridor and compass exercises (« Analyse multi » for a training event, after 2DRerun's): the organiser draws a
// corridor — a line and a width — on the whole course or on one leg, or declares a leg a compass leg (its corridor is the
// straight line between its two controls). Each runner's route is then scored:
// - the share of the route inside the corridor (by distance: each step counts by its length, inside when its middle is
//   within half the width of the line), the time spent outside, the largest and the mean deviation from the line;
// - for a compass leg, also the bearing error: the angle between the leg's line and the runner's direction from its
//   start to where they had covered half of it (positive: to the right of the bearing).
// The deviations are computed once per route; a change of width only recounts them (live).

/** Distance from (x, y) to the polyline L ([[x, y]…]). */
function toLine(x, y, L) {
  let best = Infinity;
  for (let i = 1; i < L.length; i++) {
    const [ax, ay] = L[i - 1], [bx, by] = L[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - ax - u * dx, y - ay - u * dy);
    if (d < best) best = d;
  }
  return best;
}

/** A route ({ xs, ys, ts }, metres and seconds) against a line (metres): each point's deviation, ready to score. */
export function deviations(route, line) {
  const n = route.xs.length, dev = new Float64Array(n);
  for (let i = 0; i < n; i++) dev[i] = toLine(route.xs[i], route.ys[i], line);
  return { route, dev };
}

/** The score of a route within a corridor of width w (m): { inside (0-1), outS, maxDev, meanDev }. */
export function corridorScore({ route, dev }, w) {
  const { xs, ys, ts } = route, half = w / 2;
  let len = 0, inLen = 0, outS = 0, maxDev = 0, sum = 0, dur = 0;
  for (let i = 1; i < xs.length; i++) {
    const L = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]), dt = ts[i] - ts[i - 1], mid = (dev[i] + dev[i - 1]) / 2;
    len += L; dur += dt; sum += mid * dt;
    if (mid <= half) inLen += L; else outS += dt;
  }
  for (const d of dev) if (d > maxDev) maxDev = d;
  return { inside: len ? inLen / len : null, outS, maxDev, meanDev: dur ? sum / dur : null };
}

/** The bearing error (degrees, positive to the right) of a route on the leg a -> b ([x, y], metres, y down). */
export function bearingError(route, a, b) {
  const { xs, ys } = route, ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy);
  if (!L) return null;
  for (let i = 0; i < xs.length; i++) {
    const px = xs[i] - a[0], py = ys[i] - a[1];
    if ((px * ux + py * uy) / L >= L / 2) return (Math.atan2(ux * py - uy * px, ux * px + uy * py) * 180) / Math.PI;
  }
  return null;
}

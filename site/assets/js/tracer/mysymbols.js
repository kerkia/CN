// Symbols of one's own for the description sheets (the advanced level; owner, 2026-10-24, after Condes's user-defined symbols):
// an SVG drawing (paths, circles, rectangles, lines, polygons) becomes a symbol of the event (ev.symbols), in the column chosen,
// with a name and the words its text descriptions use. Stored in Purple Pen's own shape (symbols.js: strokes and fills of
// Bézier curves in -100…100, y up), so it is drawn, printed and chosen in the description pane like any other symbol.

import { t } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const COLUMNS = ["C", "D", "E", "F", "G", "H"];

// ---- an SVG read into subpaths of cubic Bézier curves (straight lines as degenerate curves) -----------------------------------
function pathData(d) {
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const subs = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, cur = null, lastC = null;
  const n = () => parseFloat(toks[i++]);
  const line = (x2, y2) => { cur.c.push([x, y, x2, y2, x2, y2]); x = x2; y = y2; lastC = null; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "M") { const nx = n() + ox, ny = n() + oy; cur = { start: [nx, ny], c: [], closed: false }; subs.push(cur); x = sx = nx; y = sy = ny; cmd = rel ? "l" : "L"; lastC = null; }
    else if (C === "L") line(n() + ox, n() + oy);
    else if (C === "H") line(n() + ox, y);
    else if (C === "V") line(x, n() + oy);
    else if (C === "C") { const a = [n() + ox, n() + oy, n() + ox, n() + oy, n() + ox, n() + oy]; cur.c.push(a); lastC = [a[2], a[3]]; x = a[4]; y = a[5]; }
    else if (C === "S") { const r = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]; const a = [r[0], r[1], n() + ox, n() + oy, n() + ox, n() + oy]; cur.c.push(a); lastC = [a[2], a[3]]; x = a[4]; y = a[5]; }
    else if (C === "Q" || C === "T") {
      const q = C === "Q" ? [n() + ox, n() + oy] : lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y], e = [n() + ox, n() + oy];
      cur.c.push([x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]]); lastC = q; x = e[0]; y = e[1];
    } else if (C === "A") {
      // an elliptical arc: drawn as straight pieces along it (enough for a symbol's size)
      const rx = Math.abs(n()), ry = Math.abs(n()), rot = n() * Math.PI / 180, large = n(), sweep = n(), ex = n() + ox, ey = n() + oy;
      for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey)) line(p[0], p[1]);
    } else if (C === "Z") { if (cur) { if (x !== sx || y !== sy) line(sx, sy); cur.closed = true; } x = sx; y = sy; }
    else i++;
  }
  return subs.filter((s) => s.c.length);
}
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  const c = Math.cos(phi), s = Math.sin(phi), dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = c * dx + s * dy, yp = -s * dx + c * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den)), cxp = co * (rx * yp) / ry, cyp = co * -(ry * xp) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12))), out = [];
  for (let k = 1; k <= steps; k++) { const a = t1 + (dt * k) / steps; out.push([cx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, cy + rx * Math.cos(a) * s + ry * Math.sin(a) * c]); }
  return out;
}
const ellipse = (cx, cy, rx, ry) => `M${cx + rx},${cy}A${rx},${ry} 0 1 1 ${cx - rx},${cy}A${rx},${ry} 0 1 1 ${cx + rx},${cy}Z`;
/** An SVG text read as a symbol's strokes: { g } in -100…100 (y up), or throws. */
export function svgToSymbol(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error(t("trc.sym.notSvg"));
  const shapes = [];
  const style = (el) => {
    const css = Object.fromEntries((el.getAttribute("style") || "").split(";").map((x) => x.split(":").map((y) => y.trim())).filter((p) => p.length === 2));
    const get = (k) => { for (let e = el; e && e.getAttribute; e = e.parentNode) { const v = e.getAttribute(k) ?? (e === el ? css[k] : null); if (v != null) return v; } return null; };
    const fill = get("fill"), stroke = get("stroke");
    return { fill: fill == null ? true : fill !== "none" && fill !== "transparent", stroke: !!stroke && stroke !== "none", width: parseFloat(get("stroke-width") || "1") };
  };
  for (const el of doc.querySelectorAll("path, circle, ellipse, rect, line, polyline, polygon")) {
    const a = (k) => parseFloat(el.getAttribute(k) || "0");
    let d;
    switch (el.localName) {
      case "path": d = el.getAttribute("d"); break;
      case "circle": d = ellipse(a("cx"), a("cy"), a("r"), a("r")); break;
      case "ellipse": d = ellipse(a("cx"), a("cy"), a("rx"), a("ry")); break;
      case "rect": d = `M${a("x")},${a("y")}h${a("width")}v${a("height")}h${-a("width")}Z`; break;
      case "line": d = `M${a("x1")},${a("y1")}L${a("x2")},${a("y2")}`; break;
      default: { const p = (el.getAttribute("points") || "").trim(); d = `M${p.replace(/\s+/g, " ").replace(/^([^ ]+ [^ ]+|[^ ]+,[^ ]+)/, "$1 L")}${el.localName === "polygon" ? "Z" : ""}`; }
    }
    for (const sub of pathData(d)) shapes.push({ ...sub, ...style(el) });
  }
  if (!shapes.length) throw new Error(t("trc.sym.empty"));
  // fitted in the symbol's box: the drawing's extent to 160 units of 200, centred, y up
  const xs = [], ys = [];
  for (const s of shapes) { xs.push(s.start[0]); ys.push(s.start[1]); for (const c of s.c) for (let k = 0; k < 6; k += 2) { xs.push(c[k]); ys.push(c[k + 1]); } }
  const [l, r, b, tp] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = 160 / Math.max(r - l, tp - b, 1e-6), cx = (l + r) / 2, cy = (b + tp) / 2;
  const P = (x, y) => [Math.round((x - cx) * k * 10) / 10, Math.round(-(y - cy) * k * 10) / 10];
  const g = [];
  for (const s of shapes) {
    const pts = [...P(...s.start)];
    for (const c of s.c) pts.push(...P(c[0], c[1]), ...P(c[2], c[3]), ...P(c[4], c[5]));
    if (s.fill && s.closed) g.push(["fb", pts]);
    if (s.stroke || !s.fill || !s.closed) g.push(["b", Math.max(4, Math.min(30, s.width * k)), "r", pts]);
  }
  return { g };
}

/** « Mes symboles »: the event's own symbols, each from an SVG file, with its column, name and text. */
export async function mySymbolsDialog(E) {
  const { modal, sel } = await import("./dialogs.js");
  const { symbolPaths } = await import("./symbols.js");
  const list = Object.entries(E.ev.symbols || {}).map(([id, s]) => ({ id: Number(id), ...JSON.parse(JSON.stringify(s)) }));
  const preview = (s) => {
    const paths = symbolPaths({ ...s, k: s.k }, 2, 2, 36, 36);
    return `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">${paths.map((p) => `<path d="${p.d.map((c) => c.join(" ")).join(" ")}" ${p.fill ? 'fill="currentColor"' : `fill="none" stroke="currentColor" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"`}/>`).join("")}</svg>`;
  };
  const lang = E.ev.lang || "fr";
  const draw = (box) => {
    box.innerHTML = list.length ? `<table class="tr-table"><thead><tr><th></th><th>${esc(t("trc.sym.column"))}</th><th>${esc(t("trc.sym.name"))}</th><th>${esc(t("trc.sym.textual"))}</th><th></th></tr></thead><tbody>
      ${list.map((s, i) => `<tr><td>${preview(s)}</td><td>${sel(`k${i}`, COLUMNS.map((c) => [c, c]), s.k)}</td><td><input name="n${i}" value="${esc(s.n?.[lang] || s.n?.en || "")}" size="14"></td>
        <td><input name="t${i}" value="${esc(s.t?.[lang]?.[0]?.t || "")}" size="18"></td><td><button type="button" class="btn btn-sm" data-del="${i}" aria-label="${esc(t("trc.sym.remove"))}">✕</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="tr-hint">${esc(t("trc.sym.none"))}</p>`;
  };
  const v = await modal(E, { title: t("trc.sym.title"), wide: true, ok: t("trc.sym.save"), body: `<p>${esc(t("trc.sym.intro"))}</p><div id="tr-sym"></div>
    <p><button type="button" class="btn btn-sm" id="tr-sym-add">${esc(t("trc.sym.add"))}</button></p><input type="file" id="tr-sym-file" accept=".svg,image/svg+xml" hidden>`,
  onOpen: (f) => {
    const box = f.querySelector("#tr-sym"), file = f.querySelector("#tr-sym-file");
    const keep = () => list.forEach((s, i) => { if (f.elements[`k${i}`]) { s.k = f.elements[`k${i}`].value; s.n = { ...(s.n || {}), [lang]: f.elements[`n${i}`].value }; s.t = { ...(s.t || {}), [lang]: [{ t: f.elements[`t${i}`].value }] }; } });
    draw(box);
    box.addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { keep(); list.splice(Number(d.dataset.del), 1); draw(box); } });
    f.querySelector("#tr-sym-add").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const fl = file.files[0]; file.value = "";
      if (!fl) return;
      try { keep(); const s = svgToSymbol(await fl.text()); const name = fl.name.replace(/\.svg$/i, ""); list.push({ id: 0, k: "D", n: { [lang]: name }, t: { [lang]: [{ t: name }] }, g: s.g }); draw(box); }
      catch (e) { E.toast(e.message); }
    });
    f.addEventListener("submit", keep, true);
  } });
  if (!v) return;
  E.change((x) => {
    const old = x.symbols || {};
    x.symbols = {};
    let next = Math.max(0, ...Object.keys(old).map(Number));
    for (const s of list) { const id = s.id || ++next; const { id: _drop, ...rest } = s; void _drop; x.symbols[id] = rest; }
    // a symbol taken away leaves the boxes that used it empty
    for (const c of Object.values(x.controls)) {
      c.symbols = c.symbols.map((s) => (s && s.startsWith("x:") && !x.symbols[s.slice(2)] ? null : s));
      for (const [k, s] of Object.entries(c.dual || {})) if (s?.startsWith("x:") && !x.symbols[s.slice(2)]) delete c.dual[k];
    }
  }, t("trc.sym.undo"));
}

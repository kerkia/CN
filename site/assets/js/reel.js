// The login page's presentation, on wide screens: a reel of short slides that follow one another like a film — each
// a small drawn view of one of the site's analyses (made-up figures, names blurred: the login page is public) and a
// line or two saying what it is for. Story-like progress bars on top (click one to jump), ‹ › and pause, ←/→/space
// when the reel has the focus; it stops while the pointer is over it, and does not run by itself for visitors who
// ask for less motion.

import { esc, fmt } from "./util.js";
import { t } from "./i18n.js";

const W = 560, H = 300;

// ---- made-up data, the same at each visit -------------------------------------------------------------------
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const FIRST = ["Camille", "Lucas", "Léa", "Hugo", "Manon", "Louis", "Chloé", "Jules", "Inès", "Arthur", "Zoé", "Paul"];
const LAST = ["MOREL", "GARNIER", "LEFORT", "ROUSSEL", "BRUNET", "PERRIN", "CHEVALIER", "FAURE", "MARCHAND", "BLANC"];
const CLUBS = ["CO Vallée", "Orient'Express", "ASO Forêts", "Balise 21", "Raid & CO", "Les Lynx", "Azimut Club"];
const name = (i) => `${FIRST[(i * 5) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;

// ---- drawing helpers ------------------------------------------------------------------------------------------
const d = (s) => `style="--d:${s}s"`;                                    // an element's animation delay
const blur = (x, y, text, extra = "") => `<text class="rv-blur" x="${x}" y="${y}" ${extra}>${esc(text)}</text>`;
const label = (x, y, text, extra = "") => `<text class="rv-lab" x="${x}" y="${y}" ${extra}>${esc(text)}</text>`;
function smooth(pts) {                       // a smooth path through the points (cubic segments, gentle tangents)
  let s = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const [xa, ya] = pts[i - 2] || pts[i - 1], [xb, yb] = pts[i + 1] || pts[i];
    const c1 = [x0 + (x1 - xa) / 6, y0 + (y1 - ya) / 6], c2 = [x1 - (xb - x0) / 6, y1 - (yb - y0) / 6];
    s += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return s;
}
const grid = (ys, x0 = 40, x1 = W - 20) => ys.map((y) => `<line class="rv-grid" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/>`).join("");
const svg = (body, extra = "") => `<svg viewBox="0 0 ${W} ${H}" ${extra} aria-hidden="true" focusable="false">${body}</svg>`;
const chip = (x, y, color, text) => `<g class="rv-fade" ${d(0.2)}><circle cx="${x}" cy="${y - 4}" r="5" fill="${color}"/>${label(x + 10, y, text)}</g>`;

// ---- the slides' views -----------------------------------------------------------------------------------------
// 1. two methods: the official CN and « Top », month after month
function vMethods() {
  const r = rng(11), n = 37, off = [], top = [];
  let o = 2760, p = 2880;
  for (let i = 0; i < n; i++) {
    if (r() < 0.5) o += (r() - 0.4) * 90;
    p += (r() - 0.36) * 42;
    off.push(o); top.push(p);
  }
  const lo = Math.min(...off, ...top) - 60, hi = Math.max(...off, ...top) + 60;
  const X = (i) => 40 + (i / (n - 1)) * (W - 110), Y = (v) => 262 - ((v - lo) / (hi - lo)) * 200;
  const step = off.map((v, i) => `${i ? "H" : "M"}${X(i).toFixed(1)} ${i ? "" : Y(v).toFixed(1)}${i ? `V${Y(v).toFixed(1)}` : ""}`).join(" ");
  const seasons = [0, 12, 24, 36].map((i, k) => label(X(i), 290, String(2023 + k), `text-anchor="middle"`)).join("");
  return svg(`${grid([62, 112, 162, 212, 262])}${seasons}
    <path class="rv-line rv-draw" pathLength="1" d="${step}" stroke="var(--ink-3)" stroke-width="2.2"/>
    <path class="rv-line rv-draw" pathLength="1" d="${smooth(top.map((v, i) => [X(i), Y(v)]))}" stroke="var(--s1)" stroke-width="3.2" ${d(0.25)}/>
    <g class="rv-pop" ${d(1.4)}><circle cx="${X(n - 1)}" cy="${Y(off[n - 1])}" r="5" fill="var(--ink-3)"/>
      ${label(X(n - 1) + 9, Y(off[n - 1]) + 4, fmt(Math.round(off[n - 1])), `class="rv-lab rv-num"`)}</g>
    <g class="rv-pop" ${d(1.6)}><circle cx="${X(n - 1)}" cy="${Y(top[n - 1])}" r="6" fill="var(--s1)"/>
      ${label(X(n - 1) + 9, Y(top[n - 1]) + 4, fmt(Math.round(top[n - 1])), `class="rv-lab rv-num rv-strong"`)}</g>
    ${chip(46, 30, "var(--ink-3)", t("reel.off"))}${chip(140, 30, "var(--s1)", t("reel.top"))}`);
}

// 2. the calculation laid open: the race scores, the best ones kept, the CN they make
function vCalc() {
  const r = rng(5), scores = Array.from({ length: 11 }, () => 2500 + Math.round(r() * 1000));
  const kept = new Set([...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, 7));
  const cn = Math.round([...kept].reduce((s, i) => s + scores[i], 0) / kept.size);
  const X = (i) => 52 + i * 44, Y = (v) => 262 - ((v - 2000) / 1700) * 180;
  const bars = scores.map((v, i) => `<g><rect class="rv-grow-y ${kept.has(i) ? "rv-kept" : "rv-left"}" x="${X(i)}" y="${Y(v)}" width="30"
      height="${262 - Y(v)}" rx="4" ${d(0.05 * i)}/><text class="rv-in ${kept.has(i) ? "rv-in-kept" : ""} rv-fade" x="${X(i) + 15}"
      y="${Y(v) + 15}" text-anchor="middle" ${d(0.4 + 0.05 * i)}>${fmt(v)}</text></g>`).join("");
  return svg(`${grid([262])}${bars}
    <path class="rv-line rv-draw" pathLength="1" d="M44 ${Y(cn)} H${W - 24}" stroke="var(--s2)" stroke-width="2.5" stroke-dasharray="1" ${d(1.1)}/>
    <g class="rv-pop" ${d(1.5)}><rect x="${W - 150}" y="14" width="126" height="26" rx="13" fill="var(--s2)"/>
      <text class="rv-badge" x="${W - 87}" y="32" text-anchor="middle">${esc(t("reel.cn"))} ${fmt(cn)}</text></g>
    ${label(52, 290, t("reel.calc.axis"))}`);
}

// 3. a ranking, the visitor's row picked out
function vRanking() {
  const rows = [3720, 3655, 3601, 3548, 3502, 3467];
  const dl = [2, -1, 0, 3, -2, 1];
  const hdr = `${label(40, 30, t("reel.rk.rank"), `class="rv-lab rv-head"`)}${label(92, 30, t("reel.rk.runner"), `class="rv-lab rv-head"`)}
    ${label(262, 30, t("reel.rk.club"), `class="rv-lab rv-head"`)}${label(372, 30, t("reel.cn"), `class="rv-lab rv-head"`)}`;
  const body = rows.map((v, i) => {
    const y = 50 + i * 40, me = i === 3;
    return `<g class="rv-slide-in" ${d(0.08 * i)}>${me ? `<rect class="rv-me" x="28" y="${y}" width="${W - 48}" height="34" rx="8"/>` : ""}
      <text class="rv-lab rv-num rv-strong" x="44" y="${y + 22}">${i + 18}</text>
      ${blur(92, y + 22, name(i + 2))}${me ? `<text class="rv-tag" x="262" y="${y + 22}">${esc(t("reel.you"))}</text>` : blur(262, y + 22, CLUBS[i % CLUBS.length])}
      <rect class="rv-grow-x rv-bar" x="372" y="${y + 10}" width="${(v - 3380) / 4.2}" height="14" rx="4" ${d(0.3 + 0.08 * i)}/>
      <text class="rv-lab rv-num" x="458" y="${y + 22}">${fmt(v)}</text>
      <text class="rv-lab rv-num ${dl[i] > 0 ? "rv-up" : dl[i] < 0 ? "rv-down" : ""}" x="${W - 26}" y="${y + 22}" text-anchor="end">${dl[i] > 0 ? "▲" + dl[i] : dl[i] < 0 ? "▼" + -dl[i] : "="}</text>
</g>`;
  }).join("");
  return svg(hdr + body);
}

// 4. several runners' CN over three seasons, side by side
function vCompare() {
  const r = rng(23), n = 30, cols = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s7)"];
  const series = cols.map((_, k) => {
    let v = 2900 + k * 90 - (k === 2 ? 320 : 0);
    return Array.from({ length: n }, () => (v += (r() - (k === 2 ? 0.25 : 0.47)) * 70));
  });
  const all = series.flat(), lo = Math.min(...all) - 40, hi = Math.max(...all) + 40;
  const X = (i) => 40 + (i / (n - 1)) * (W - 70), Y = (v) => 268 - ((v - lo) / (hi - lo)) * 200;
  const lines = series.map((s, k) => `<path class="rv-line rv-draw" pathLength="1" d="${smooth(s.map((v, i) => [X(i), Y(v)]))}"
      stroke="${cols[k]}" stroke-width="${k === 2 ? 3.4 : 2.2}" ${d(0.15 * k)}/>`).join("");
  const legend = cols.map((c, k) => `<g class="rv-fade" ${d(0.2 + 0.1 * k)}><circle cx="${48 + k * 128}" cy="26" r="5" fill="${c}"/>
      ${blur(58 + k * 128, 30, name(k + 6).split(" ")[0] + " " + name(k + 6).split(" ")[1].slice(0, 5))}</g>`).join("");
  return svg(`${grid([68, 118, 168, 218, 268])}${legend}${lines}`);
}

// 5. clubs side by side
function vClubs() {
  const vals = [412, 377, 341, 296, 258, 221, 187].map((v) => Math.round(v * 0.82));
  return svg(vals.map((v, i) => {
    const y = 22 + i * 39, me = i === 2;
    return `<g>${blur(36, y + 19, CLUBS[(i + 2) % CLUBS.length])}
      <rect class="rv-grow-x ${me ? "rv-kept" : "rv-bar"}" x="176" y="${y + 5}" width="${v * 0.82}" height="20" rx="5" ${d(0.07 * i)}/>
      <text class="rv-lab rv-num" x="${176 + v * 0.82 + 8}" y="${y + 20}">${fmt(v)}</text>
      ${me ? `<text class="rv-tag" x="${W - 24}" y="${y + 20}" text-anchor="end">${esc(t("reel.yourclub"))}</text>` : ""}</g>`;
  }).join(""));
}

// 6. an age pyramid: women on the left, men on the right
function vPyramid() {
  const bands = ["10-14", "15-19", "20-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75+"];
  const f = [34, 27, 12, 18, 31, 36, 29, 17, 6], m = [41, 33, 17, 24, 38, 45, 40, 26, 10];
  const cx = W / 2, sc = 4.3;
  const rows = bands.map((b, i) => {
    const y = 268 - (i + 1) * 27;
    return `<rect class="rv-grow-x rv-from-right" x="${cx - 26 - f[i] * sc}" y="${y}" width="${f[i] * sc}" height="21" rx="4" fill="var(--s5)" ${d(0.05 * i)}/>
      <rect class="rv-grow-x" x="${cx + 26}" y="${y}" width="${m[i] * sc}" height="21" rx="4" fill="var(--s1)" ${d(0.05 * i)}/>
      ${label(cx, y + 15, b, `text-anchor="middle" class="rv-lab rv-small"`)}`;
  }).join("");
  return svg(`${rows}${label(cx - 40, 290, t("reel.women"), `text-anchor="end" class="rv-lab rv-strong"`)}
    ${label(cx + 40, 290, t("reel.men"), `class="rv-lab rv-strong"`)}`);
}

// 7. the map of France by region (the outlines come from the site's own map file, loaded when needed)
function vMap() {
  const ramp = [1, 2, 3, 4, 5].map((q, i) => `<rect x="${W - 150 + i * 24}" y="268" width="24" height="10" fill="var(--q${q})"/>`).join("");
  return svg(`<g class="rv-map" data-map></g><g class="rv-fade" ${d(0.6)}>${ramp}
    ${label(W - 150, 292, t("reel.map.lo"), `class="rv-lab rv-small"`)}${label(W - 30, 292, t("reel.map.hi"), `text-anchor="end" class="rv-lab rv-small"`)}</g>`);
}
let mapPaths = null;
async function drawMap(g) {
  if (!mapPaths) {
    mapPaths = fetch(new URL("../geo/regions.json", import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((gj) => {
      if (!gj) return [];
      const k = Math.cos((46.5 * Math.PI) / 180), lon0 = -5.3, lat1 = 51.2, s = 26;
      const P = ([lon, lat]) => `${(70 + (lon - lon0) * k * s).toFixed(1)} ${(14 + (lat1 - lat) * s).toFixed(1)}`;
      return gj.features.map((ft) => {
        const polys = ft.geometry.type === "Polygon" ? [ft.geometry.coordinates] : ft.geometry.coordinates;
        return polys.map((rings) => rings.map((ring) => `M${ring.filter((_, i) => i % 2 === 0 || i === ring.length - 1).map(P).join("L")}Z`).join("")).join("");
      });
    }).catch(() => []);
  }
  const paths = await mapPaths;
  const q = [4, 3, 3, 2, 3, 4, 3, 5, 3, 4, 5, 3, 2];
  g.innerHTML = paths.map((p, i) => `<path class="rv-region rv-fade" d="${p}" fill="var(--q${q[i % q.length]})" ${d(0.04 * i)}/>`).join("") +
    `<g class="rv-pop" ${d(0.9)}><circle class="rv-pulse" cx="214" cy="118" r="7"/></g>`;
}

// 8. season after season: races per season, by specialité
function vSeasons() {
  const r = rng(3), cols = ["var(--s6)", "var(--s7)", "var(--s4)", "var(--s1)"], n = 15;
  const X = (i) => 46 + i * 33.5;
  const bars = Array.from({ length: n }, (_, i) => {
    const v = [70 + i * 4 + r() * 18, 12 + i * 3.2 + r() * 8, 14 + r() * 10, 2 + r() * 3];
    if (i === 8) v.forEach((_, k) => (v[k] *= 0.45));                        // the 2020 season
    let y = 262;
    return v.map((h, k) => {
      y -= h * 0.85;
      return `<rect class="rv-grow-y" x="${X(i)}" y="${y.toFixed(1)}" width="24" height="${(h * 0.85).toFixed(1)}" fill="${cols[k]}" ${d(0.04 * i)}/>`;
    }).join("");
  }).join("");
  const years = [0, 4, 8, 12, 14].map((i) => label(X(i) + 12, 288, String(2012 + i), `text-anchor="middle" class="rv-lab rv-small"`)).join("");
  const legend = ["For", "Spr", "VTT", "Ski"].map((x, k) => chip(52 + k * 96, 26, cols[k], t(`terrain.${x}`))).join("");
  return svg(`${grid([262])}${bars}${years}${legend}`);
}

// 9. the network of runners who meet on the same circuits
function vNetwork() {
  const r = rng(17), centers = [[150, 130], [330, 190], [440, 90]], nodes = [];
  centers.forEach(([cx, cy], c) => {
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2, rad = 18 + r() * 62;
      nodes.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad * 0.8, c });
    }
  });
  const me = 4;
  const edges = [];
  nodes.forEach((a, i) => nodes.forEach((b, j) => {
    if (j <= i) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if ((a.c === b.c && dist < 62) || (a.c !== b.c && dist < 105 && r() < 0.25)) edges.push([i, j]);
  }));
  const cols = ["var(--s1)", "var(--s3)", "var(--s2)"];
  return svg(`${edges.map(([i, j], k) => `<line class="${i === me || j === me ? "rv-edge-me" : "rv-edge"} rv-fade" x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}"
      x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}" ${d(0.3 + (k % 20) * 0.03)}/>`).join("")}
    ${nodes.map((n, i) => `<circle class="rv-pop" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${i === me ? 9 : 5 + (i % 3)}"
      fill="${cols[n.c]}" ${i === me ? `stroke="var(--surface)" stroke-width="3"` : ""} ${d(0.02 * i)}/>`).join("")}
    <g class="rv-pop" ${d(1.2)}><text class="rv-tag" x="${nodes[me].x + 14}" y="${nodes[me].y - 10}">${esc(t("reel.you"))}</text></g>`);
}

// 10. the agenda: the races coming, and the registrations closing
function vAgenda() {
  const items = [["SAM", "18", "OCT", "For", t("reel.ag.1"), null], ["DIM", "19", "OCT", "Spr", t("reel.ag.2"), t("reel.ag.close")],
    ["SAM", "25", "OCT", "VTT", t("reel.ag.3"), null], ["DIM", "02", "NOV", "For", t("reel.ag.4"), null]];
  return svg(items.map(([wd, dd, mm, ter, title, close], i) => {
    const y = 14 + i * 70;
    return `<g class="rv-slide-in" ${d(0.12 * i)}><rect class="rv-card" x="24" y="${y}" width="${W - 48}" height="60" rx="10"/>
      <rect x="36" y="${y + 9}" width="52" height="42" rx="8" class="rv-date"/>
      <text class="rv-lab rv-small" x="62" y="${y + 22}" text-anchor="middle">${wd} ${mm}</text>
      <text class="rv-lab rv-big" x="62" y="${y + 45}" text-anchor="middle">${dd}</text>
      <text class="rv-lab rv-strong" x="104" y="${y + 27}">${esc(title)}</text>
      <rect x="104" y="${y + 35}" width="64" height="18" rx="9" class="rv-ter-${ter.toLowerCase()}"/>
      <text class="rv-lab rv-small" x="136" y="${y + 48}" text-anchor="middle">${esc(t(`terrain.${ter}`))}</text>
      ${close ? `<g class="rv-pop" ${d(0.9)}><rect x="${W - 196}" y="${y + 18}" width="160" height="24" rx="12" class="rv-warn"/>
        <text class="rv-warn-t" x="${W - 116}" y="${y + 34}" text-anchor="middle">${esc(close)}</text></g>` : ""}</g>`;
  }).join(""));
}

// 11. the recent races: the organisers' results, at once
function vRecent() {
  const items = [[t("reel.rc.1"), t("reel.rc.ago1"), "248", "+38"], [t("reel.rc.2"), t("reel.rc.ago2"), "131", "+12"],
    [t("reel.rc.3"), t("reel.rc.ago3"), "406", "−9"]];
  const src = [t("reel.rc.src1"), t("reel.rc.src2"), t("reel.rc.src3")];
  return svg(items.map(([title, ago, n, delta], i) => {
    const y = 16 + i * 92;
    return `<g class="rv-slide-in" ${d(0.15 * i)}><rect class="rv-card" x="24" y="${y}" width="${W - 48}" height="80" rx="10"/>
      <text class="rv-lab rv-strong" x="42" y="${y + 28}">${esc(title)}</text>
      <text class="rv-lab rv-small" x="${W - 42}" y="${y + 28}" text-anchor="end">${esc(ago)}</text>
      <rect x="42" y="${y + 44}" width="${src[i].length * 6.6 + 20}" height="22" rx="11" class="rv-pill"/>
      <text class="rv-lab rv-small" x="${52}" y="${y + 59}">${esc(src[i])}</text>
      <text class="rv-lab rv-small" x="${src[i].length * 6.6 + 76}" y="${y + 59}">${n} ${esc(t("reel.rc.runners"))}</text>
      <g class="rv-pop" ${d(0.6 + 0.15 * i)}><rect x="${W - 168}" y="${y + 42}" width="126" height="26" rx="13" class="${delta.startsWith("+") ? "rv-good" : "rv-bad"}"/>
        <text class="rv-badge" x="${W - 105}" y="${y + 60}" text-anchor="middle">${esc(t("reel.rc.prov"))} ${delta}</text></g></g>`;
  }).join(""));
}

// 12. split times: leg by leg, the best legs and the time lost
function vTable() {
  const r = rng(29), ctrl = 8, runners = 6;
  const legs = Array.from({ length: runners }, (_, i) => Array.from({ length: ctrl }, (_, k) => 40 + Math.round(r() * 50 + i * 4 + (i === 3 && k === 4 ? 70 : 0))));
  const best = Array.from({ length: ctrl }, (_, k) => Math.min(...legs.map((l) => l[k])));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const cw = 46, x0 = 160;
  const head = Array.from({ length: ctrl }, (_, k) => label(x0 + k * cw + cw / 2, 26, String(k + 1), `text-anchor="middle" class="rv-lab rv-head"`)).join("");
  const rows = legs.map((l, i) => {
    const y = 40 + i * 40;
    const cells = l.map((v, k) => {
      const lost = v - best[k], cls = v === best[k] ? "rv-cell-best" : lost > 38 ? "rv-cell-lost" : "";
      return `<g class="rv-fade" ${d(0.1 + 0.07 * k)}>${cls ? `<rect class="${cls}" x="${x0 + k * cw + 3}" y="${y + 4}" width="${cw - 6}" height="30" rx="5"/>` : ""}
        <text class="rv-lab rv-num rv-small" x="${x0 + k * cw + cw / 2}" y="${y + 18}" text-anchor="middle">${mmss(v)}</text>
        <text class="rv-lab rv-tiny" x="${x0 + k * cw + cw / 2}" y="${y + 30}" text-anchor="middle">${lost ? "+" + lost : "1er"}</text></g>`;
    }).join("");
    return `${label(30, y + 24, String(i + 1), `class="rv-lab rv-strong"`)}${blur(52, y + 24, name(i + 4).split(" ")[1])}${cells}`;
  }).join("");
  return svg(`${label(52, 26, t("reel.tb.runner"), `class="rv-lab rv-head"`)}${head}${rows}`);
}

// 13. the gaps to a reference, control after control — where the race was won and lost
function vGaps() {
  const r = rng(41), n = 12, cols = ["var(--s3)", "var(--s7)", "var(--s4)", "var(--s5)"];
  const series = cols.map((_, k) => {
    let v = 0;
    return Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : (v += r() * 18 + k * 6)));
  });
  let v = 0;
  const me = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : (v += i === 7 ? 160 : r() * 10)));
  const X = (i) => 44 + (i / n) * (W - 80), Y = (s) => 62 + s * 0.62;
  const lines = series.map((s, k) => `<path class="rv-line rv-draw" pathLength="1" d="${s.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(y).toFixed(1)}`).join("")}"
      stroke="${cols[k]}" stroke-width="2" opacity=".75" ${d(0.1 * k)}/>`).join("");
  const mine = `<path class="rv-line rv-draw" pathLength="1" d="${me.map((y, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(y).toFixed(1)}`).join("")}" stroke="var(--s8)" stroke-width="3.4" ${d(0.4)}/>`;
  const ticks = Array.from({ length: n }, (_, i) => label(X(i + 1), 292, String(i + 1), `text-anchor="middle" class="rv-lab rv-small"`)).join("");
  const refs = [t("reel.gp.r1"), t("reel.gp.r2"), t("reel.gp.r3")];
  let x = 44;
  const seg = refs.map((s, i) => {
    const w = s.length * 6.4 + 22, g = `<rect x="${x}" y="12" width="${w}" height="24" rx="12" class="${i ? "rv-pill" : "rv-pill-on"}"/>
      <text class="rv-lab rv-small ${i ? "" : "rv-on"}" x="${x + w / 2}" y="28" text-anchor="middle">${esc(s)}</text>`;
    x += w + 6;
    return g;
  }).join("");
  return svg(`<line class="rv-grid" x1="44" x2="${W - 36}" y1="${Y(0)}" y2="${Y(0)}"/>${seg}${ticks}${lines}${mine}
    <g class="rv-pop" ${d(1.5)}><rect x="${X(7) + 10}" y="${Y(me[7]) - 34}" width="134" height="24" rx="12" class="rv-bad"/>
      <text class="rv-badge" x="${X(7) + 77}" y="${Y(me[7]) - 17}" text-anchor="middle">${esc(t("reel.gp.lost"))}</text></g>`);
}

// 14. packs: the punch times show who ran together, control after control
function vGroups() {
  const r = rng(53), rows = 7, ctrl = 10;
  const X = (s) => 110 + s * 0.36, rowY = (i) => 34 + i * 36;
  const starts = [0, 60, 120, 150, 210, 270, 300];
  const pts = starts.map((s0, i) => {
    let s = s0;
    return Array.from({ length: ctrl }, (_, k) => {
      s += 90 + r() * 30;
      if ([1, 2, 3].includes(i) && k >= 3 && k <= 7) s = 420 + (k - 3) * 112 + (i - 2) * 6 + (i === 1 ? 70 : 0) + 120;
      return s;
    });
  });
  const pack = [3, 4, 5, 6, 7].map((k, j) => {
    const xs = [1, 2, 3].map((i) => X(pts[i][k]));
    return `<rect class="rv-pack rv-fade" x="${Math.min(...xs) - 9}" y="${rowY(1) - 12}" width="${Math.max(...xs) - Math.min(...xs) + 18}" height="${rowY(3) - rowY(1) + 24}" rx="9" ${d(0.9 + 0.08 * j)}/>`;
  }).join("");
  const lines = pts.map((p, i) => `${blur(24, rowY(i) + 5, name(i + 1).split(" ")[1])}
    <line class="rv-grid" x1="110" x2="${W - 16}" y1="${rowY(i)}" y2="${rowY(i)}"/>
    ${p.filter((s) => X(s) < W - 16).map((s, k) => `<circle class="rv-pop" cx="${X(s).toFixed(1)}" cy="${rowY(i)}" r="5" fill="${[1, 2, 3].includes(i) ? "var(--s2)" : "var(--ink-3)"}" ${d(0.04 * k + 0.02 * i)}/>`).join("")}`).join("");
  return svg(`${pack}${lines}<g class="rv-pop" ${d(1.4)}><rect x="${W - 210}" y="270" width="190" height="24" rx="12" class="rv-pill-on"/>
    <text class="rv-lab rv-small rv-on" x="${W - 115}" y="286" text-anchor="middle">${esc(t("reel.gr.pack"))}</text></g>`);
}

// 15. the invitation
function vJoin() {
  return svg(`<g class="rv-pop"><text class="rv-logo" x="${W / 2}" y="118" text-anchor="middle">O'CN</text></g>
    ${["For", "Spr", "VTT", "Ski"].map((x, k) => `<g class="rv-pop" ${d(0.3 + 0.1 * k)}><rect x="${W / 2 - 196 + k * 100}" y="148" width="92" height="28" rx="14" class="rv-ter-${x.toLowerCase()}"/>
      <text class="rv-lab rv-strong" x="${W / 2 - 150 + k * 100}" y="167" text-anchor="middle">${esc(t(`terrain.${x}`))}</text></g>`).join("")}`);
}

const SLIDES = [["methods", vMethods], ["calc", vCalc], ["ranking", vRanking], ["compare", vCompare], ["clubs", vClubs],
  ["pyramid", vPyramid], ["map", vMap], ["seasons", vSeasons], ["network", vNetwork], ["agenda", vAgenda],
  ["recent", vRecent], ["table", vTable], ["gaps", vGaps], ["groups", vGroups], ["join", vJoin]];

// ---- the reel ------------------------------------------------------------------------------------------------
export function reelHtml() {
  return `<div class="reel" tabindex="0" role="region" aria-roledescription="carrousel" aria-label="${esc(t("reel.label"))}">
    <div class="reel-bars">${SLIDES.map(([k], i) => `<button type="button" class="reel-bar" data-go="${i}" aria-label="${esc(t(`reel.${k}.k`))}"><i></i></button>`).join("")}</div>
    <div class="reel-track">${SLIDES.map(([k, view], i) => `<figure class="reel-slide${i ? "" : " is-on"}" data-i="${i}" aria-hidden="${i ? "true" : "false"}">
      <div class="reel-vis">${view()}${k === "join" ? `<a class="btn btn-primary reel-cta" href="#/compte/inscription">${esc(t("ac.register"))}</a>` : ""}</div>
      <figcaption><span class="reel-k">${esc(t(`reel.${k}.k`))}</span><strong>${esc(t(`reel.${k}.t`))}</strong><span>${esc(t(`reel.${k}.x`))}</span></figcaption></figure>`).join("")}</div>
    <div class="reel-nav"><button type="button" class="reel-btn" data-step="-1" aria-label="${esc(t("reel.prev"))}">‹</button>
      <button type="button" class="reel-btn reel-play" aria-label="${esc(t("reel.pause"))}">❚❚</button>
      <button type="button" class="reel-btn" data-step="1" aria-label="${esc(t("reel.next"))}">›</button>
      <span class="reel-count"></span></div></div>`;
}

export function mountReel(box) {
  const el = box.querySelector(".reel");
  if (!el) return;
  const slides = [...el.querySelectorAll(".reel-slide")], bars = [...el.querySelectorAll(".reel-bar")];
  const playBtn = el.querySelector(".reel-play"), count = el.querySelector(".reel-count");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = matchMedia("(min-width: 861px)");
  let i = 0, userPaused = calm, hover = false;
  // the clock: the time left on the current slide, counted only while it plays (the bar's fill just shows it)
  let left = 0, since = 0, timer = 0;

  // a slide's time on screen: a brisk 2 s, like a film (the owner's choice); pause or ‹ › to read at leisure
  const dur = () => 2000;
  const paused = () => userPaused || hover || document.hidden || !wide.matches;
  function sync() {
    const p = paused();
    clearTimeout(timer);
    if (since) left -= performance.now() - since;
    since = 0;
    if (!el.isConnected) return;
    if (!p && !calm) {
      since = performance.now();
      timer = setTimeout(() => show(i + 1), Math.max(0, left));
    }
    el.classList.toggle("is-paused", p);
    playBtn.textContent = userPaused ? "▶" : "❚❚";
    playBtn.setAttribute("aria-label", t(userPaused ? "reel.play" : "reel.pause"));
    bars.forEach((b) => (b.firstElementChild.style.animationPlayState = p ? "paused" : "running"));
  }
  function show(k) {
    i = (k + slides.length) % slides.length;
    slides.forEach((s, j) => {
      s.classList.toggle("is-on", j === i);
      s.setAttribute("aria-hidden", j === i ? "false" : "true");
    });
    // the bars: done, running, to come (restarting the running one's fill)
    bars.forEach((b, j) => {
      const fill = b.firstElementChild;
      b.classList.toggle("is-done", j < i);
      b.classList.toggle("is-now", j === i);
      fill.style.animation = "none";
      if (j === i) {
        void fill.offsetWidth;
        fill.style.animation = calm ? "none" : `reelFill ${dur(i)}ms linear forwards`;
      }
    });
    // the slide's own drawing replays each time it comes
    const on = slides[i];
    on.classList.remove("is-anim");
    void on.offsetWidth;
    on.classList.add("is-anim");
    on.style.setProperty("--dur", `${dur(i)}ms`);
    const m = on.querySelector("[data-map]");
    if (m && !m.childElementCount) drawMap(m);
    count.textContent = `${i + 1} / ${slides.length}`;
    left = dur(i);
    since = 0;
    sync();
  }
  el.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]"), step = e.target.closest("[data-step]");
    if (go) show(+go.dataset.go);
    else if (step) show(i + +step.dataset.step);
    else if (e.target.closest(".reel-play")) { userPaused = !userPaused; sync(); }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(i + 1);
    else if (e.key === "ArrowLeft") show(i - 1);
    else if (e.key === " " && e.target === el) { userPaused = !userPaused; sync(); }
    else return;
    e.preventDefault();
  });
  el.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hover = true; sync(); } });
  el.addEventListener("pointerleave", () => { hover = false; sync(); });
  document.addEventListener("visibilitychange", sync);
  wide.addEventListener("change", sync);
  show(0);
}

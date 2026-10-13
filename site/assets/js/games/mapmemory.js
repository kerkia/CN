// « Mémoire de carte » (ski-O): a network of tracks, a start and a control. Remember the way, then choose the
// right track at each junction without the map. A look back at the map costs 30 s.

import { html, $ } from "../util.js";
import { t } from "../i18n.js";
import { makeCanvas, canvasPoint } from "./quiz.js";
import { int, range, shuffle, rng } from "./rng.js";
import { COL } from "./mapgen.js";

const W = 600;
/** The network: nodes on a jittered grid, curved edges between neighbours, the largest connected part kept. */
function network(seed, n) {
  const r = rng(seed);
  const step = W / n, nodes = [], at = {};
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = nodes.length;
    at[`${i},${j}`] = k;
    nodes.push({ x: (i + 0.5) * step + range(r, -0.25, 0.25) * step, y: (j + 0.5) * step + range(r, -0.25, 0.25) * step, edges: [] });
  }
  const edges = [];
  const link = (a, b) => {
    if (a == null || b == null) return;
    const A = nodes[a], B = nodes[b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
    const off = range(r, -0.3, 0.3) * d;
    const e = { a, b, cx: mx - (dy / d) * off, cy: my + (dx / d) * off, len: d * (1 + 0.4 * (off / d) ** 2) };
    edges.push(e); A.edges.push(e); B.edges.push(e);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = at[`${i},${j}`];
    if (i + 1 < n && r() < 0.72) link(k, at[`${i + 1},${j}`]);
    if (j + 1 < n && r() < 0.72) link(k, at[`${i},${j + 1}`]);
    if (i + 1 < n && j + 1 < n && r() < 0.2) link(k, at[`${i + 1},${j + 1}`]);
    if (i > 0 && j + 1 < n && r() < 0.2) link(k, at[`${i - 1},${j + 1}`]);
  }
  // the largest connected part
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1, bestSize = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s]; comp[s] = s; let size = 0;
    while (stack.length) { const k = stack.pop(); size++; for (const e of nodes[k].edges) { const o = e.a === k ? e.b : e.a; if (comp[o] < 0) { comp[o] = s; stack.push(o); } } }
    if (size > bestSize) { bestSize = size; best = s; }
  }
  return { nodes, edges, alive: (k) => comp[k] === best, r };
}

/** The shortest way between two nodes: the list of edges, or null. */
function shortest(net, a, b) {
  const D = new Map([[a, 0]]), P = new Map(), todo = [a], seen = new Set();
  while (todo.length) {
    todo.sort((x, y) => D.get(x) - D.get(y));
    const k = todo.shift();
    if (seen.has(k)) continue;
    seen.add(k);
    if (k === b) break;
    for (const e of net.nodes[k].edges) {
      const o = e.a === k ? e.b : e.a, nd = D.get(k) + e.len;
      if (!(D.has(o)) || nd < D.get(o)) { D.set(o, nd); P.set(o, e); todo.push(o); }
    }
  }
  if (!P.has(b)) return null;
  const out = [];
  for (let k = b; k !== a; ) { const e = P.get(k); out.push(e); k = e.a === k ? e.b : e.a; }
  return out.reverse();
}

function drawNet(ctx, net, view, { w, h, only = null, faint = false } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  ctx.strokeStyle = faint ? "#bbb" : "#222"; ctx.lineWidth = 2.2; ctx.setLineDash([9, 5]); ctx.lineCap = "round";
  for (const e of net.edges) {
    if (!net.alive(e.a) || (only && !only.includes(e))) continue;
    const A = net.nodes[e.a], B = net.nodes[e.b];
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(e.cx, e.cy, B.x, B.y); ctx.stroke();
  }
  ctx.restore();
}
function mark(ctx, net, view, start, finish, { w, h }) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  ctx.strokeStyle = COL.course; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.9;
  const S = net.nodes[start], F = net.nodes[finish], R = 11;
  ctx.beginPath(); for (let k = 0; k < 3; k++) { const th = -Math.PI / 2 + (k * 2 * Math.PI) / 3; ctx.lineTo(S.x + R * 1.2 * Math.cos(th), S.y + R * 1.2 * Math.sin(th)); } ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.arc(F.x, F.y, R, 0, 7); ctx.stroke();
  ctx.restore();
}

export function spec(level = "easy") {
  const n = level === "easy" ? 5 : level === "hard" ? 8 : 6;
  return {
    key: `mapmemory-${level}`, count: 5, scoring: "time",
    intro: t("g.memory.rules"),
    make(i, r) {
      let net, start, finish, way;
      for (;;) {
        net = network(int(r, 0, 2 ** 31), n);
        const alive = net.nodes.map((_, k) => k).filter((k) => net.alive(k));
        if (alive.length < n * n * 0.6) continue;
        const [a, b] = shuffle(r, alive);
        way = shortest(net, a, b);
        const junctions = way ? way.slice(0, -1).map((e, k) => { const nxt = way[k + 1]; const node = e.a === nxt.a || e.a === nxt.b ? e.a : e.b; return net.nodes[node].edges.length; }).filter((d) => d >= 3).length : 0;
        if (way && way.length >= 3 && way.length <= (level === "hard" ? 9 : 6) && junctions >= 2) { start = a; finish = b; break; }
      }
      return {
        answer: null,
        render(stage, api) {
          const PX = 460, view = { x: 0, y: 0, scale: PX / W }, o = { w: PX, h: PX };
          let looks = 0, at = start, pos = 0, done = false;
          const [c, ctx] = makeCanvas(PX, PX, PX);
          stage.append(c);
          const bar = document.createElement("div"); bar.className = "row g-tools";
          stage.append(bar);
          const showMap = (full) => {
            drawNet(ctx, net, view, o);
            mark(ctx, net, view, start, finish, o);
            bar.innerHTML = full ? html`<span class="muted">${t("g.memory.look")}</span><span class="spacer"></span><button class="btn btn-primary btn-sm" type="button" id="g-go">${t("g.memory.go")}</button>` : "";
            $("#g-go", bar)?.addEventListener("click", () => junction());
          };
          // the junction: the node at the centre, its tracks going out, north up; tap the one to take
          let targets = [];
          const junction = () => {
            if (done) return;
            // follow the track through the nodes with no choice
            while (at !== finish && net.nodes[at].edges.length <= 2) { const e = way[pos]; at = e.a === at ? e.b : e.a; pos++; }
            if (at === finish) { done = true; api.done({ ok: true, choice: t("g.memory.found"), extraMs: looks * 30000 }); return; }
            const node = net.nodes[at];
            const size = 220, v = { x: node.x - size / 2, y: node.y - size / 2, scale: PX / size };
            drawNet(ctx, net, v, { ...o, only: node.edges });
            ctx.save(); ctx.scale(v.scale, v.scale); ctx.translate(-v.x, -v.y);
            ctx.fillStyle = COL.course; ctx.beginPath(); ctx.arc(node.x, node.y, 4, 0, 7); ctx.fill();
            // a button on each track, a little way out
            targets = node.edges.map((e) => {
              const B = net.nodes[e.a === at ? e.b : e.a];
              const tt = 0.3, x = (1 - tt) ** 2 * node.x + 2 * (1 - tt) * tt * e.cx + tt * tt * B.x, y = (1 - tt) ** 2 * node.y + 2 * (1 - tt) * tt * e.cy + tt * tt * B.y;
              ctx.fillStyle = "rgba(176,0,200,.85)"; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
              return { e, x, y };
            });
            ctx.restore();
            bar.innerHTML = html`<span class="muted">${t("g.memory.choose")}</span><span class="spacer"></span><button class="btn btn-sm" type="button" id="g-look">${t("g.memory.lookAgain")}</button>`;
            $("#g-look", bar).addEventListener("click", () => { looks++; showMap(true); });
          };
          c.addEventListener("pointerdown", (e) => {
            if (done || !targets.length) return;
            const node = net.nodes[at], size = 220, v = { x: node.x - size / 2, y: node.y - size / 2, scale: PX / size };
            const [px, py] = canvasPoint(c, e), mx = v.x + px / v.scale, my = v.y + py / v.scale;
            const hit = targets.find((tg) => Math.hypot(tg.x - mx, tg.y - my) < 16);
            if (!hit) return;
            targets = [];
            if (hit.e === way[pos]) { at = hit.e.a === at ? hit.e.b : hit.e.a; pos++; junction(); }
            else { done = true; this._wrong = { node: at, edge: hit.e }; api.done({ ok: false, choice: t("g.memory.lost"), extraMs: looks * 30000 }); }
          });
          this._draw = () => {
            drawNet(ctx, net, view, { ...o, faint: true });
            ctx.save(); ctx.scale(view.scale, view.scale);
            ctx.strokeStyle = "#1a5cff"; ctx.lineWidth = 3.5; ctx.setLineDash([]); ctx.globalAlpha = 0.8;
            for (const e of way) { const A = net.nodes[e.a], B = net.nodes[e.b]; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(e.cx, e.cy, B.x, B.y); ctx.stroke(); }
            if (this._wrong) { const e = this._wrong.edge, A = net.nodes[e.a], B = net.nodes[e.b]; ctx.strokeStyle = "#d32f2f"; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(e.cx, e.cy, B.x, B.y); ctx.stroke(); }
            ctx.restore();
            mark(ctx, net, view, start, finish, o);
            bar.innerHTML = "";
          };
          showMap(true);
        },
        solution() { this._draw?.(); },
      };
    },
  };
}

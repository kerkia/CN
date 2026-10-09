// The split-time analyses of one circuit, for a phone — the computations of O'CN's « Temps intermédiaires »
// (site/assets/js/pages/splits.js: keep the two in step), shown in six views:
// - Parcours: one runner leg by leg (you by default, from your name in Réglages): time, rank, time lost, mistakes;
// - Tableau: every runner's legs (rank, best in green, mistakes in red), scrolling sideways;
// - Écarts: the gap to the best cumulative time at each control, for a few runners (you, those you follow, the podium);
// - Inter-postes: each leg's best and median times, how many made a mistake there and the time lost;
// - Groupes: who ran with whom (left a control and reached the next one within 10 s of each other), from start times;
// - Bilan: one line per runner.
// Time lost on a leg: the runner's leg time less the best leg time × the median of their leg/best ratios (their usual
// pace). A mistake: lost ≥ N % of the leg (and 10 s at least; 20 % by default), or lost ≥ N s — set in Tableau.
import { t } from "./i18n.js";
import { settings, save, isMe, follows } from "./settings.js";
import { esc, clock, signed, segs } from "./util.js";

export const VIEWS = ["parcours", "tableau", "ecarts", "postes", "groupes", "bilan"];
const TOL = 10;
const COLORS = ["#e4572e", "#2a78d6", "#1baf7a", "#a66d00", "#8a4fd0", "#d4537e", "#4a8f8a"];
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const rankOf = (vals, v) => (v == null ? null : 1 + vals.filter((x) => x != null && x < v).length);

/** Everything the views need, for circuit k of document doc. */
export function compute(doc, k) {
  const s = settings(), mode = s.errMode === "s" ? "s" : "pct", val = Number(s.errVal) > 0 ? Number(s.errVal) : 20;
  const n = k.controls?.length || Math.max(0, ...k.runners.map((r) => r.splits?.length || 0));
  const R = k.runners.filter((r) => r.splits).map((r) => {
    const cum = [...r.splits.slice(0, n), r.status === "ok" ? r.time_s : null];
    const legs = cum.map((c, i) => (c != null && (i === 0 || cum[i - 1] != null) ? c - (i ? cum[i - 1] : 0) : null));
    return { r, cum, legs };
  });
  const L = n + 1;
  const best = Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x.legs[i]).filter((v) => v != null && v > 0)));
  const bestCum = Array.from({ length: L }, (_, i) => Math.min(...R.map((x) => x.cum[i]).filter((v) => v != null)));
  for (const x of R) {
    x.ratios = x.legs.map((v, i) => (v != null && isFinite(best[i]) ? v / best[i] : null));
    x.ratio = median(x.ratios);
    x.lost = x.legs.map((v, i) => (v != null && x.ratio && isFinite(best[i]) ? Math.max(0, v - best[i] * x.ratio) : null));
    x.lostTotal = x.lost.reduce((a, v) => a + (v || 0), 0);
    x.mistake = x.legs.map((v, i) => x.lost[i] != null && v > 0 && (mode === "s" ? x.lost[i] >= val : x.lost[i] >= (val / 100) * v && x.lost[i] >= 10));
    x.legRank = x.legs.map((v, i) => rankOf(R.map((y) => y.legs[i]), v));
    x.cumRank = x.cum.map((v, i) => rankOf(R.map((y) => y.cum[i]), v));
    x.won = x.legRank.filter((r) => r === 1).length;
  }
  R.sort((a, b) => (a.r.place ?? 1e4) - (b.r.place ?? 1e4) || (a.r.time_s ?? 1e9) - (b.r.time_s ?? 1e9));
  const label = (i) => `${i === 0 ? t("an.start") : i}–${i === n ? t("an.finish") : i + 1}`;
  return { doc, k, n, L, R, best, bestCum, label, mode, val };
}

/** The runner a view starts on: you, else someone you follow, else the winner. */
function defaultRunner(R) {
  return R.find((x) => isMe(x.r.name)) || R.find((x) => follows(x.r.name, x.r.club)) || R[0];
}

export function render(box, c, view, opts = {}) {
  const head = segs("view", VIEWS.filter((v) => v !== "groupes" || c.R.some((x) => x.r.start_s != null)).map((v) => [v, t(`an.${v}`)]), view);
  box.innerHTML = `${head}<div id="an-body"></div>`;
  const body = box.querySelector("#an-body");
  ({ parcours, tableau, ecarts, postes, groupes, bilan })[view](body, c, opts);
}

const nameCell = (x) => `${esc(x.r.name)}${isMe(x.r.name) ? ` <span class="badge">${t("live.you")}</span>` : ""}`;

// ---- Parcours ------------------------------------------------------------------------------------------------------
function parcours(body, c, opts) {
  const pick = c.R.find((x) => x.r.name === opts.runner) || defaultRunner(c.R);
  if (!pick) { body.innerHTML = `<p class="muted pad">${t("an.none")}</p>`; return; }
  const winner = c.R.find((x) => x.r.place === 1);
  const clean = pick.cum[c.n] != null ? pick.cum[c.n] - pick.lostTotal : null;
  const cleanRank = clean != null ? 1 + c.R.filter((y) => y !== pick && y.cum[c.n] != null && y.cum[c.n] < clean).length : null;
  const errs = pick.mistake.filter(Boolean).length;
  const maxLost = Math.max(1, ...pick.lost.map((v) => v || 0));
  body.innerHTML = `<div class="pad"><select id="an-runner" class="select">${c.R.map((x) => `<option value="${esc(x.r.name)}" ${x === pick ? "selected" : ""}>
      ${x.r.place ? `${x.r.place}. ` : ""}${esc(x.r.name)}</option>`).join("")}</select></div>
    <section class="card stats">
      <div><b>${pick.r.place ?? "—"}</b><span>${t("an.place")}</span></div>
      <div><b>${clock(pick.cum[c.n]) || "—"}</b><span>${winner && winner !== pick && pick.cum[c.n] != null ? signed(pick.cum[c.n] - winner.cum[c.n]) : t("an.time")}</span></div>
      <div><b class="${errs ? "bad" : ""}">${errs}</b><span>${t("an.mistakes")}</span></div>
      <div><b>${clock(pick.lostTotal)}</b><span>${t("an.lost")}</span></div>
    </section>
    ${clean != null ? `<p class="muted small pad">${t("an.clean", { t: clock(clean), r: cleanRank })}</p>` : ""}
    <div class="legs">${pick.legs.map((v, i) => {
      const moved = i > 0 && pick.cumRank[i] != null && pick.cumRank[i - 1] != null ? pick.cumRank[i - 1] - pick.cumRank[i] : 0;
      return `<div class="leg${pick.mistake[i] ? " err" : ""}${pick.legRank[i] === 1 ? " top" : ""}">
        <div class="lg">${esc(c.label(i))}</div>
        <div class="grow"><div><b>${clock(v) || "—"}</b> <span class="muted">${pick.legRank[i] ? `${pick.legRank[i]}${t("an.th")}` : ""}</span>
          ${pick.lost[i] >= 1 ? `<span class="lostv">${signed(pick.lost[i])}</span>` : ""}</div>
          ${pick.lost[i] >= 1 ? `<div class="lbar"><i style="width:${Math.round((100 * pick.lost[i]) / maxLost)}%"></i></div>` : ""}</div>
        <div class="cumr"><div>${clock(pick.cum[i]) || ""}</div><div class="muted small">${pick.cumRank[i] ? `${pick.cumRank[i]}${t("an.th")}` : ""}
          ${moved > 0 ? `<span class="up">▲${moved}</span>` : moved < 0 ? `<span class="down">▼${-moved}</span>` : ""}</div></div></div>`;
    }).join("")}</div>
    <p class="muted small pad">${t("an.lostDef")}</p>`;
  body.querySelector("#an-runner").addEventListener("change", (e) => opts.onRunner?.(e.target.value));
}

// ---- Tableau ----------------------------------------------------------------------------------------------------------
function tableau(body, c, opts) {
  body.innerHTML = `<div class="pad rule"><span class="muted small">${t("an.rule")}</span>
      <select id="an-mode" class="select sm"><option value="pct" ${c.mode === "pct" ? "selected" : ""}>${t("an.rule.pct")}</option>
        <option value="s" ${c.mode === "s" ? "selected" : ""}>${t("an.rule.s")}</option></select>
      <input id="an-val" type="number" min="1" step="1" value="${c.val}" class="num-in"><span class="muted small">${c.mode === "pct" ? "%" : "s"}</span></div>
    <div class="scroll"><table class="grid"><thead><tr><th class="sticky">${t("an.runner")}</th>
      ${Array.from({ length: c.L }, (_, i) => `<th>${esc(c.label(i))}</th>`).join("")}<th>${t("an.lost")}</th></tr></thead>
      <tbody>${c.R.map((x) => `<tr${isMe(x.r.name) ? ' class="me"' : ""}><th class="sticky"><span class="pl">${x.r.place ?? ""}</span>${nameCell(x)}
        <div class="muted small">${clock(x.cum[c.n])}</div></th>
        ${x.legs.map((v, i) => `<td class="${x.legRank[i] === 1 ? "top" : x.mistake[i] ? "err" : ""}">${clock(v) || "·"}<div class="muted small">${x.legRank[i] ?? ""}</div></td>`).join("")}
        <td>${clock(x.lostTotal)}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted small pad">${t("an.tableDef", { rule: c.mode === "s" ? t("an.rule.sDef", { n: c.val }) : t("an.rule.pctDef", { n: c.val }) })}</p>`;
  const apply = () => {
    const mode = body.querySelector("#an-mode").value, v = Number(body.querySelector("#an-val").value);
    save({ errMode: mode, errVal: v > 0 ? v : 20 });
    opts.redraw?.();
  };
  body.querySelector("#an-mode").addEventListener("change", (e) => { save({ errMode: e.target.value, errVal: 20 }); opts.redraw?.(); });
  body.querySelector("#an-val").addEventListener("change", apply);
}

// ---- Écarts -----------------------------------------------------------------------------------------------------------
function ecarts(body, c, opts) {
  const chosen = opts.chosen?.length ? c.R.filter((x) => opts.chosen.includes(x.r.name))
    : [...new Set([...c.R.filter((x) => isMe(x.r.name) || follows(x.r.name, x.r.club)), ...c.R.slice(0, 3)])].slice(0, 6);
  const W = 360, H = 220, padL = 40, padB = 22, padT = 8;
  const pts = chosen.map((x) => x.cum.map((v, i) => (v != null && isFinite(c.bestCum[i]) ? v - c.bestCum[i] : null)));
  const maxY = Math.max(30, ...pts.flat().filter((v) => v != null));
  const X = (i) => padL + (i / Math.max(1, c.n)) * (W - padL - 10), Y = (v) => padT + (v / maxY) * (H - padT - padB);
  const ticks = [0, maxY / 2, maxY].map((v) => `<text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${clock(v)}</text>
    <line x1="${padL}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/>`).join("");
  const xs = Array.from({ length: c.n + 1 }, (_, i) => (i % Math.ceil((c.n + 1) / 8) === 0 || i === c.n
    ? `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="ax">${i === c.n ? t("an.finishShort") : i + 1}</text>` : "")).join("");
  const lines = pts.map((p, j) => {
    let d = "", on = false;
    p.forEach((v, i) => { if (v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; on = true; });
    return `<path d="${d}" fill="none" stroke="${COLORS[j % COLORS.length]}" stroke-width="${isMe(chosen[j].r.name) ? 3 : 2}" stroke-linejoin="round"/>`;
  }).join("");
  body.innerHTML = `<p class="muted small pad">${t("an.gapsDef")}</p>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${t("an.ecarts")}">${ticks}${xs}${lines}</svg>
    <div class="pick">${c.R.map((x) => {
      const j = chosen.indexOf(x);
      return `<label class="pk"><input type="checkbox" data-n="${esc(x.r.name)}" ${j >= 0 ? "checked" : ""}>
        <i style="background:${j >= 0 ? COLORS[j % COLORS.length] : "transparent"}"></i>${x.r.place ? `${x.r.place}. ` : ""}${esc(x.r.name)}</label>`;
    }).join("")}</div>`;
  body.querySelector(".pick").addEventListener("change", () => {
    const names = [...body.querySelectorAll(".pick input:checked")].map((i) => i.dataset.n).slice(0, 7);
    opts.onChosen?.(names);
  });
}

// ---- Inter-postes -------------------------------------------------------------------------------------------------------
function postes(body, c) {
  const legs = Array.from({ length: c.L }, (_, i) => {
    const xs = c.R.filter((x) => x.legs[i] != null);
    const lead = xs.find((x) => x.legs[i] === c.best[i]);
    const errs = xs.filter((x) => x.mistake[i]);
    return { i, best: c.best[i], lead, med: median(xs.map((x) => x.legs[i])), errs: errs.length, of: xs.length,
      lost: xs.reduce((a, x) => a + (x.lost[i] || 0), 0) };
  });
  const worst = [...legs].sort((a, b) => b.lost - a.lost).slice(0, 3).map((l) => l.i);
  body.innerHTML = `<div class="legs">${legs.map((l) => `<div class="leg${worst.includes(l.i) ? " err" : ""}">
      <div class="lg">${esc(c.label(l.i))}${c.k.controls?.[l.i] ? `<div class="muted small">${esc(c.k.controls[l.i])}</div>` : ""}</div>
      <div class="grow"><div><b>${isFinite(l.best) ? clock(l.best) : "—"}</b> <span class="muted small">${l.lead ? esc(l.lead.r.name) : ""}</span></div>
        <div class="muted small">${t("an.median")} ${clock(l.med)} · ${t("an.errsOf", { n: l.errs, of: l.of })}</div></div>
      <div class="cumr"><div>${clock(l.lost)}</div><div class="muted small">${t("an.lostAll")}</div></div></div>`).join("")}</div>
    <p class="muted small pad">${t("an.postesDef")}</p>`;
}

// ---- Groupes ------------------------------------------------------------------------------------------------------------
function groupes(body, c) {
  // every leg from the 1st control on, by its pair of control codes, run by anyone of the document: who left and reached it
  const legKey = (kc, j) => (kc.controls ? `${kc.controls[j - 1]}>${kc.controls[j]}` : `${kc.name}:${j}`);
  const board = new Map();
  for (const kc of c.doc.classes) {
    const m = kc.controls?.length || Math.max(0, ...kc.runners.map((r) => r.splits?.length || 0));
    for (const r of kc.runners) {
      if (r.start_s == null || !r.splits) continue;
      const cum = [...r.splits.slice(0, m), r.status === "ok" ? r.time_s : null];
      for (let j = 1; j < m; j++) {
        if (cum[j - 1] == null || cum[j] == null) continue;
        const key = legKey(kc, j);
        (board.get(key) || board.set(key, []).get(key)).push({ r, cls: kc.name, dep: r.start_s + cum[j - 1], arr: r.start_s + cum[j] });
      }
    }
  }
  const rows = c.R.filter((x) => x.r.start_s != null).map((x) => {
    let all = 0, inGroup = 0, n = 0, of = 0;
    const withs = new Map();
    for (let j = 1; j < c.n; j++) {
      if (x.cum[j - 1] == null || x.cum[j] == null) continue;
      of++;
      const dep = x.r.start_s + x.cum[j - 1], arr = x.r.start_s + x.cum[j];
      const mates = (board.get(legKey(c.k, j)) || []).filter((o) => o.r !== x.r && Math.abs(o.dep - dep) <= TOL && Math.abs(o.arr - arr) <= TOL);
      all += x.legs[j];
      if (mates.length) {
        n++; inGroup += x.legs[j];
        for (const o of mates) {
          const id = `${o.r.name}|${o.cls}`;
          (withs.get(id) || withs.set(id, { o, legs: 0 }).get(id)).legs++;
        }
      }
    }
    return { x, n, of, pack: all ? (100 * inGroup) / all : 0, mates: [...withs.values()].sort((a, b) => b.legs - a.legs) };
  });
  body.innerHTML = `<p class="muted small pad">${t("an.groupsDef", { s: TOL })}</p>
    ${rows.map((g) => `<div class="item static${isMe(g.x.r.name) ? " me" : ""}"><div class="grow">
      <div class="name">${g.x.r.place ? `${g.x.r.place}. ` : ""}${nameCell(g.x)}</div>
      <div class="muted small">${g.n ? t("an.inGroup", { n: g.n, of: g.of, p: Math.round(g.pack) }) : t("an.alone")}</div>
      ${g.mates.length ? `<div class="small">${g.mates.slice(0, 3).map((m) => `${esc(m.o.r.name)}${m.o.cls !== c.k.name ? ` <span class="muted">(${esc(m.o.cls)})</span>` : ""} <span class="muted">× ${m.legs}</span>`).join(" · ")}</div>` : ""}
    </div></div>`).join("")}`;
}

// ---- Bilan ----------------------------------------------------------------------------------------------------------
function bilan(body, c) {
  body.innerHTML = `<div class="scroll"><table class="grid"><thead><tr><th class="sticky">${t("an.runner")}</th><th>${t("an.time")}</th>
      <th>${t("an.won")}</th><th>${t("an.avgRank")}</th><th>${t("an.mistakes")}</th><th>${t("an.lost")}</th><th>${t("an.pace")}</th></tr></thead>
    <tbody>${c.R.map((x) => {
      const ranks = x.legRank.filter((r) => r != null);
      return `<tr${isMe(x.r.name) ? ' class="me"' : ""}><th class="sticky"><span class="pl">${x.r.place ?? ""}</span>${nameCell(x)}</th>
        <td>${clock(x.cum[c.n]) || "—"}</td><td>${x.won}</td><td>${ranks.length ? (ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1) : "—"}</td>
        <td class="${x.mistake.some(Boolean) ? "err" : ""}">${x.mistake.filter(Boolean).length}</td><td>${clock(x.lostTotal)}</td>
        <td>${x.ratio ? `+${Math.round((x.ratio - 1) * 100)} %` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="muted small pad">${t("an.bilanDef")}</p>`;
}

// The games' common engine: a run of puzzles with a timer, answer buttons (or a puzzle that handles its own play),
// the solution shown after each answer, a scoring rule, a summary and the best score kept in the browser.
// Each game gives: key, count, make(i, r) → puzzle, scoring, and a few options. A puzzle: render(stage, api),
// options (labels), answer (a label, or the labels of a multi-select), solution(stage, choice), times (for the
// « added time » rule), text (a question), memorise (a first view to remember before the options show).

import { html, raw, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import { rng, newSeed } from "./rng.js";

const BEST = "ocn.games.best";
/** The best scores by game key: {value, label}. */
export function bests() { try { return JSON.parse(localStorage.getItem(BEST) || "{}"); } catch (e) { return {}; } }
function saveBest(key, value, label, higher) {
  const b = bests();
  if (!b[key] || (higher ? value > b[key].value : value < b[key].value)) { b[key] = { value, label, date: new Date().toISOString().slice(0, 10) }; try { localStorage.setItem(BEST, JSON.stringify(b)); } catch (e) {} }
  return b[key];
}

/** A canvas of w × h logical units that fits its container (at most maxCss px wide), crisp on dense screens. */
export function makeCanvas(w, h, maxCss = 600) {
  const c = document.createElement("canvas");
  c.className = "g-canvas";
  c.style.aspectRatio = `${w} / ${h}`;
  c.style.width = "100%"; c.style.maxWidth = `${maxCss}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  c._logical = [w, h];
  return [c, ctx];
}
/** The logical coordinates of a pointer event on such a canvas. */
export function canvasPoint(c, e) {
  const r = c.getBoundingClientRect(), [w, h] = c._logical;
  return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
}

const fmtS = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** The scoring rules: points(puzzle, correct, ms, choice) and total(results) → {value, label, higher}. */
const SCORING = {
  count: { points: (p, ok) => (ok ? 1 : 0), total: (R) => ({ value: sum(R.map((x) => x.points)) * 1e6 - sum(R.map((x) => x.ms)) / 1000, label: `${sum(R.map((x) => x.points))} / ${R.length} · ${fmtS(sum(R.map((x) => x.ms)))}`, higher: true }) },
  time60: { points: (p, ok, ms) => (ok ? Math.max(0, 60 - Math.round(ms / 1000)) : 0), total: (R) => ({ value: sum(R.map((x) => x.points)), label: `${sum(R.map((x) => x.points))} pts`, higher: true }) },
  quantised: { points: (p, ok, ms) => Math.max(0, (ok ? 100 : 50) - 5 * Math.floor(ms / 5000)), total: (R) => ({ value: sum(R.map((x) => x.points)), label: `${sum(R.map((x) => x.points))} pts`, higher: true }) },
  penalty: { points: (p, ok, ms) => Math.round(ms / 1000) + (ok ? 0 : 30), total: (R) => ({ value: sum(R.map((x) => x.points)), label: fmtS(1000 * sum(R.map((x) => x.points))), higher: false }) },
  added: { points: (p, ok, ms, choice) => Math.round(ms / 1000 + (p.times?.[p.options.indexOf(choice)] ?? 0)), total: (R) => ({ value: sum(R.map((x) => x.points)), label: fmtS(1000 * sum(R.map((x) => x.points))), higher: false }) },
  rapid: { points: (p, ok, ms) => (ok ? (ms > 30000 ? 0.5 : 1) : 0), total: (R) => ({ value: sum(R.map((x) => x.points)) * 1e6 - sum(R.map((x) => x.ms)) / 1000, label: `${sum(R.map((x) => x.points))} / ${R.length} · ${fmtS(sum(R.map((x) => x.ms)))}`, higher: true }) },
  time: { points: (p, ok, ms) => (ok ? Math.round(ms / 1000) : null), total: (R) => { const ok = R.filter((x) => x.ok); return { value: ok.length * 1e6 - sum(ok.map((x) => x.ms)) / 1000, label: `${ok.length} / ${R.length} · ${fmtS(sum(R.map((x) => x.ms)))}`, higher: true }; } },
};

/**
 * Runs a game in `root`. spec: {key, count, make, scoring, intro, multi, viewTime, chooseTime, memoriseLabel, seed}.
 * A puzzle's render(stage, api) draws it; an interactive puzzle calls api.done({ok, choice}) itself and has no options.
 */
export function runGame(root, spec) {
  let seed = spec.seed ?? newSeed();
  const S = SCORING[spec.scoring] || SCORING.count;
  const bestBox = () => { const b = bests()[spec.key]; return b ? html`<span class="g-best">${t("ui.colon", { a: t("g.best") })} <b>${b.label}</b></span>` : ""; };

  // The puzzles are made before the run (owner, 2026-10-31: some games took seconds, the page frozen, and on Edge without
  // its JIT — its « enhanced security » on a site it does not know — ten times longer: nothing seemed to happen). They are
  // made one at a time, the page drawn between two, from the rules' page on; a bar shows how far it is. The timer then only
  // counts the answer.
  let prep = null;                                   // {seed, puzzles, ready (promise), onStep}
  const prepare = (sd) => {
    if (prep?.seed === sd) return prep;
    const P = prep = { seed: sd, puzzles: [], onStep: null };
    P.ready = (async () => {
      const r = rng(sd);
      for (let i = 0; i < spec.count; i++) {
        // let the page draw (the bar, a click); wait while the game's tab is not shown
        await new Promise((res) => setTimeout(res, 0));
        while (prep === P && root.isConnected && !root.offsetParent) await new Promise((res) => setTimeout(res, 300));
        if (prep !== P || !root.isConnected) return null;
        let p = null;
        try { p = spec.make(i, r); } catch (e) { console.error(e); }
        P.puzzles.push(p);
        P.onStep?.(i + 1);
      }
      return P.puzzles;
    })();
    return P;
  };
  const prepBar = (P, cls = "") => html`<div class="g-prep ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${spec.count}" aria-valuenow="${P.puzzles.length}">
    <span>${t("g.prep")}</span><span class="g-bar"><i style="width: ${(100 * P.puzzles.length) / spec.count}%"></i></span>
    <span class="num g-prep-n">${P.puzzles.length} / ${spec.count}</span></div>`;
  const follow = (P, box) => {
    P.onStep = (n) => {
      const el = $(".g-prep", box);
      if (!el) return;
      el.setAttribute("aria-valuenow", n);
      $(".g-bar i", el).style.width = `${(100 * n) / spec.count}%`;
      $(".g-prep-n", el).textContent = `${n} / ${spec.count}`;
      if (n === spec.count && el.classList.contains("g-prep-quiet")) setTimeout(() => el.remove(), 400);   // the rules' page: ready
    };
  };

  const intro = () => {
    root.innerHTML = html`<div class="g-intro">
      <div class="g-rules">${raw(spec.intro)}</div>
      <div class="row"><button class="btn btn-primary" type="button" id="g-start">${t("g.start")}</button>${bestBox()}</div>
      <div class="g-prep-slot"></div>
    </div>`;
    $("#g-start", root).addEventListener("click", play);
    // the rules are read while the maps are made; the bar only when it takes a while
    const sd = seed;
    setTimeout(() => {
      if (seed !== sd || !root.isConnected || !$(".g-prep-slot", root)) return;
      const P = prepare(sd), slot = $(".g-prep-slot", root);
      setTimeout(() => { if (P.puzzles.length < spec.count && slot.isConnected) { slot.innerHTML = prepBar(P, "g-prep-quiet"); follow(P, slot); } }, 350);
    }, 250);
  };

  async function play() {
    const P = prepare(seed);
    if (P.puzzles.length < spec.count) {
      root.innerHTML = html`<div class="g-loading">${prepBar(P)}</div>`;
      follow(P, root);
    }
    const puzzles = await P.ready;
    if (!puzzles || prep !== P || !root.isConnected) return;
    prep = null;                                       // a puzzle is played once
    const results = [];
    let timer = null, cleanup = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; cleanup?.(); cleanup = null; };
    root._stop = stop;
    for (let i = 0; i < spec.count; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await one(i, puzzles[i], results, (fn) => { cleanup = fn; }, (tm) => { timer = tm; });
      if (!res) return;                                 // left the page
      results.push(res);
    }
    summary(results);
  }

  /** One puzzle: resolves to {ok, choice, ms, points, answer}; null if the root was emptied meanwhile. */
  function one(i, p, results, setCleanup, setTimer) {
    return new Promise((resolve) => {
      if (!p) { resolve({ ok: false, choice: "—", ms: 0, points: 0, answer: "?" }); return; }
      const soFar = results.length ? S.total(results).label : "";
      root.innerHTML = html`<div class="g-top">
        <span class="g-n">${t("g.puzzle")} <b>${i + 1}</b> / ${spec.count}</span>
        <span class="g-time num" id="g-time">0,0 s</span>
        <span class="g-score muted">${soFar}</span></div>
        ${p.text ? html`<p class="g-question" id="g-question">${p.text}</p>` : ""}
        <div class="g-stage" id="g-stage"></div>
        <div class="g-answers" id="g-answers"></div>
        <div class="g-result" id="g-result" hidden></div>`;
      const stage = $("#g-stage", root), answers = $("#g-answers", root), result = $("#g-result", root), timeEl = $("#g-time", root);
      let t0 = 0, ms = 0, finished = false, choice = null, picked = [];
      const left = () => !root.isConnected || !stage.isConnected;
      const tick = () => { if (left()) { stop(); resolve(null); return; } ms = performance.now() - t0; timeEl.textContent = (ms / 1000).toFixed(1).replace(".", ",") + " s"; };
      const startTimer = () => { t0 = performance.now(); const tm = setInterval(tick, 100); setTimer(tm); };
      const stop = () => { if (p._cleanup) { p._cleanup(); p._cleanup = null; } };
      const api = {
        done: ({ ok, choice: c, extraMs = 0 }) => finish(ok, c, extraMs),
        onCleanup: (fn) => { p._cleanup = fn; setCleanup(fn); },
        stage, root,
      };
      const finish = (ok, c, extraMs = 0) => {
        if (finished) return;
        finished = true;
        tick(); ms += extraMs;
        setTimer(null);
        const points = S.points(p, ok, ms, c);
        $$("button", answers).forEach((b) => { b.disabled = true; if (b.dataset.opt === String(c)) b.classList.add(ok ? "g-right" : "g-wrong"); if ([].concat(p.answer).includes(b.dataset.opt)) b.classList.add("g-right"); });
        try { p.solution?.(stage, c, ok); } catch (e) { console.error(e); }
        const answerLabel = [].concat(p.answer).map((a) => p.labels?.[a] || a).join(" + ");
        result.hidden = false;
        result.innerHTML = html`<span class="${ok ? "g-ok" : "g-ko"}">${ok ? t("g.right") : t("g.wrong")}</span>
          ${!ok && p.answer != null ? html`<span>${t("g.answerWas")} <b>${answerLabel}</b>.</span>` : ""}
          ${p.info ? html`<span class="muted">${p.info}</span>` : ""}
          ${points != null ? html`<span class="num">${t("g.points", { n: points })}</span>` : ""}
          <button class="btn btn-primary btn-sm" type="button" id="g-next">${i + 1 < spec.count ? t("g.next") : t("g.finish")}</button>`;
        const next = () => { stop(); resolve({ ok, choice: c, ms, points, answer: answerLabel, label: p.labels?.[c] || c }); };
        $("#g-next", root).addEventListener("click", next);
        $("#g-next", root).focus({ preventScroll: true });
      };
      const showOptions = () => {
        if (!p.options) return;
        answers.innerHTML = p.options.map((o) => html`<button class="btn g-opt" type="button" data-opt="${o}">${p.labels?.[o] || o}</button>`).join("")
          + (spec.multi ? html`<button class="btn btn-primary g-validate" type="button" id="g-validate" disabled>${t("g.validate")}</button>` : "");
        $$(".g-opt", answers).forEach((b) => b.addEventListener("click", () => {
          if (finished) return;
          if (!spec.multi) { finish([].concat(p.answer).includes(b.dataset.opt), b.dataset.opt); return; }
          b.classList.toggle("g-picked");
          stage.querySelector(`.g-pick-${CSS.escape(b.dataset.opt)}`)?.classList.toggle("g-picked", b.classList.contains("g-picked"));   // its picture too
          picked = $$(".g-picked", answers).map((x) => x.dataset.opt);
          $("#g-validate", answers).disabled = picked.length !== spec.multi;
        }));
        $("#g-validate", answers)?.addEventListener("click", () => {
          const want = [].concat(p.answer);
          finish(picked.length === want.length && want.every((a) => picked.includes(a)), picked.slice().sort().join("+"));
        });
      };
      const begin = () => {
        try { p.render(stage, api); } catch (e) { console.error(e); stage.innerHTML = html`<div class="empty">${String(e.message || e)}</div>`; }
        showOptions();
        // a tap on an option's own picture (its frame, .g-pick-<option>) answers as its button does (owner, 2026-10-31: on a
        // phone the buttons were a long scroll away from the pictures)
        stage.addEventListener("click", (e) => {
          const f = e.target.closest('[class*="g-pick-"]'), opt = f && /\bg-pick-(\S+)/.exec(f.className)?.[1];
          if (opt && !finished) answers.querySelector(`.g-opt[data-opt="${CSS.escape(opt)}"]`)?.click();
        });
        startTimer();
        // a limited look at the map (the knockout's course choice): hidden after viewTime s, chooseTime s more to answer
        if (spec.viewTime) {
          const beep = beeper();
          let n = spec.viewTime;
          const cd = document.createElement("div"); cd.className = "g-countdown num"; stage.prepend(cd);
          const step = () => {
            if (finished || left()) return;
            cd.textContent = n > 0 ? t("g.mapFor", { n }) : t("g.chooseIn", { n: n + spec.chooseTime });
            if (n <= 3 && n > 0) beep(660, 80);
            if (n === 0) { $$(".g-canvas", stage).forEach((c) => (c.style.visibility = "hidden")); beep(880, 250); }
            if (n <= -spec.chooseTime) { finish(false, "—"); $$(".g-canvas", stage).forEach((c) => (c.style.visibility = "")); return; }
            n--;
            setTimeout(step, 1000);
          };
          step();
          p._cleanup = () => { finished = true; };
        }
      };
      if (p.memorise) {                     // first the map to remember, then the photos: no way back
        p.memorise(stage);
        answers.innerHTML = html`<button class="btn btn-primary" type="button" id="g-go">${spec.memoriseLabel || t("g.go")}</button>`;
        $("#g-go", root).addEventListener("click", () => { stage.innerHTML = ""; begin(); });
      } else begin();
    });
  }

  function summary(R) {
    const tot = S.total(R);
    const best = saveBest(spec.key, tot.value, tot.label, tot.higher);
    root.innerHTML = html`<div class="g-summary">
      <h3>${t("g.done")} <span class="g-total">${tot.label}</span></h3>
      <p class="muted">${t("g.best")} : ${best.label}${best.label === tot.label ? ` — ${t("g.newBest")}` : ""}</p>
      <div class="table-wrap" style="--table-max: 50vh"><table class="data compact"><thead><tr><th>#</th><th>${t("g.yourAnswer")}</th><th>${t("g.answer")}</th><th class="num">${t("g.time")}</th><th class="num">${t("g.pts")}</th></tr></thead>
        <tbody>${R.map((x, i) => html`<tr><td>${i + 1}</td><td class="${x.ok ? "g-ok" : "g-ko"}">${x.label ?? x.choice ?? "—"}</td><td>${x.answer}</td><td class="num">${fmtS(x.ms)}</td><td class="num">${x.points ?? "—"}</td></tr>`)}</tbody></table></div>
      <div class="row"><button class="btn btn-primary" type="button" id="g-again">${t("g.again")}</button>
        <button class="btn" type="button" id="g-rules">${t("g.rules")}</button></div></div>`;
    $("#g-again", root).addEventListener("click", () => { seed = newSeed(); play(); });
    $("#g-rules", root).addEventListener("click", () => { seed = newSeed(); intro(); });
  }

  intro();
  return { stop: () => { prep = null; root._stop?.(); } };
}

/** A small beep (the countdowns); silent where audio is not allowed. */
export function beeper() {
  let ac = null;
  return (freq = 660, ms = 100) => {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = freq; g.gain.value = 0.05;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + ms / 1000);
    } catch (e) { /* no sound then */ }
  };
}

/** A letter label row for a list of canvases (A, B, C…). */
export const LETTERS = ["A", "B", "C", "D", "E", "F"];

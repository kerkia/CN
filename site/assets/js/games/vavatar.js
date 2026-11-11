// « Virtually »'s avatar (owner, 2026-11-11): the runner the player sees in the race (vworld.js `runnerFigure`) — a woman or a
// man, the skin and the hair (its colour and its style), shorts or long legs, and the colours of the shirt, the shorts, the socks
// and the shoes. Kept in this browser (localStorage `ocn.vt.avatar`); the tab « Avatar » of Coach › Virtually shows it turning
// and walking or running in a small scene while it is chosen.

import { html, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import { THREE as THREE_URL } from "../vendor.js";
import { runnerFigure } from "./vworld.js";

const KEY = "ocn.vt.avatar";
export const SKINS = ["#f6dcc8", "#ecbf9c", "#d29a6e", "#b07548", "#83522f", "#5a3620", "#3b2316"];
export const HAIRS = ["#1b1410", "#3a2a1e", "#6b4425", "#a0662f", "#d9b36c", "#e8d8b0", "#8f8f8c", "#a8332a"];
export const KIT = ["#1f6fd1", "#0b2545", "#2bb3d9", "#0f766e", "#2f9e44", "#9acd32", "#f2d01e", "#f08a1c", "#d6312b", "#db2777",
  "#7c3aed", "#111827", "#6b7280", "#ffffff"];
export const DEFAULT = { sex: "m", skin: SKINS[2], hair: HAIRS[1], hairStyle: "short", legs: "shorts", shirt: "#1f6fd1",
  shorts: "#111827", socks: "#111827", shoes: "#f08a1c" };
const HEX = /^#[0-9a-f]{6}$/;

/** The avatar kept in this browser, else the default; anything unknown in it is dropped. */
export function loadAvatar() {
  let a = {};
  try { a = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { a = {}; }
  const out = { ...DEFAULT };
  if (a.sex === "f" || a.sex === "m") out.sex = a.sex;
  if (["short", "ponytail", "bun"].includes(a.hairStyle)) out.hairStyle = a.hairStyle;
  if (a.legs === "shorts" || a.legs === "long") out.legs = a.legs;
  for (const k of ["skin", "hair", "shirt", "shorts", "socks", "shoes"]) if (HEX.test(String(a[k] || "").toLowerCase())) out[k] = a[k].toLowerCase();
  return out;
}
function saveAvatar(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* private window: kept for the visit only */ } }

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function randomAvatar() {
  const sex = Math.random() < 0.5 ? "f" : "m";
  return { sex, skin: pick(SKINS), hair: pick(HAIRS), hairStyle: sex === "f" ? pick(["ponytail", "bun", "short"]) : pick(["short", "short", "ponytail"]),
    legs: Math.random() < 0.7 ? "shorts" : "long", shirt: pick(KIT), shorts: pick(KIT), socks: pick(KIT), shoes: pick(KIT) };
}

/** The tab: the choices on one side, the runner in its small scene on the other. Returns a stop function. */
export async function renderAvatar(el) {
  let A = loadAvatar();
  const seg = (name, list) => html`<div class="seg" role="group" aria-label="${t(`va.${name}`)}">${list.map(([k, l]) =>
    html`<button type="button" data-${kebab(name)}="${k}" aria-pressed="${A[name] === k}">${t(l)}</button>`)}</div>`;
  const swatches = (name, list) => html`<div class="va-sw" role="group" aria-label="${t(`va.${name}`)}">
    ${list.map((c) => html`<button type="button" class="va-c" data-${name}="${c}" style="background:${c}" aria-pressed="${A[name] === c}" title="${c}"></button>`)}
    ${list === KIT ? html`<label class="va-custom" title="${t("va.custom")}"><input type="color" data-pick="${name}" value="${A[name]}"><span>${t("va.custom")}</span></label>` : ""}</div>`;
  const row = (name, body) => html`<div class="va-row"><div class="va-lab">${t(`va.${name}`)}</div>${body}</div>`;
  el.innerHTML = html`<div class="va">
    <div class="card va-opts">
      <p class="muted">${t("va.lede")}</p>
      ${row("sex", seg("sex", [["f", "va.sex.f"], ["m", "va.sex.m"]]))}
      ${row("skin", swatches("skin", SKINS))}
      ${row("hair", swatches("hair", HAIRS))}
      ${row("hairStyle", seg("hairStyle", [["short", "va.hairStyle.short"], ["ponytail", "va.hairStyle.ponytail"], ["bun", "va.hairStyle.bun"]]))}
      ${row("legs", seg("legs", [["shorts", "va.legs.shorts"], ["long", "va.legs.long"]]))}
      ${row("shirt", swatches("shirt", KIT))}
      ${row("shorts", swatches("shorts", KIT))}
      ${row("socks", swatches("socks", KIT))}
      ${row("shoes", swatches("shoes", KIT))}
      <div class="va-actions"><button type="button" class="btn" id="va-random">${t("va.random")}</button>
        <button type="button" class="btn" id="va-reset">${t("va.reset")}</button></div>
      <p class="muted va-kept">${t("va.kept")}</p>
    </div>
    <div class="card va-stage">
      <div class="va-view"><canvas id="va-canvas"></canvas></div>
      ${seg("gait", [["stand", "va.gait.stand"], ["walk", "va.gait.walk"], ["run", "va.gait.run"]])}
      <p class="muted">${t("va.turn")}</p>
    </div></div>`;
  // the controls' states follow A
  const mark = () => {
    for (const b of $$("[aria-pressed]", el)) {
      const [name] = Object.keys(b.dataset); if (!name || name === "gait") continue;
      b.setAttribute("aria-pressed", String(A[name] === b.dataset[name]));
    }
    for (const i of $$("input[data-pick]", el)) i.value = A[i.dataset.pick];
  };
  const set = (patch) => { A = { ...A, ...patch }; saveAvatar(A); mark(); rebuild(); };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !el.contains(b)) return;
    if (b.id === "va-random") return set(randomAvatar());
    if (b.id === "va-reset") return set({ ...DEFAULT });
    const [name] = Object.keys(b.dataset); if (!name) return;
    if (name === "gait") { gait = b.dataset.gait; for (const x of $$("[data-gait]", el)) x.setAttribute("aria-pressed", String(x === b)); return; }
    set({ [name]: b.dataset[name] });
  });
  el.addEventListener("input", (e) => { const i = e.target.closest("input[data-pick]"); if (i) set({ [i.dataset.pick]: i.value.toLowerCase() }); });
  $(`[data-gait="run"]`, el).setAttribute("aria-pressed", "true");

  // ---- the small scene ----
  const T = await import(THREE_URL), canvas = $("#va-canvas", el), view = $(".va-view", el);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.1, 50);
  scene.add(new T.HemisphereLight(0xeef2f6, 0x6a5c46, 1.9));
  const sun = new T.DirectionalLight(0xfff1dc, 2.0); sun.position.set(-2, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 }); sun.shadow.radius = 4; scene.add(sun);
  const ground = new T.Mesh(new T.CircleGeometry(1.4, 48).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ color: 0x8a7a55 }));
  ground.receiveShadow = true; scene.add(ground);
  let fig = null, gait = "run", yaw = 0.6, drag = null, last = performance.now(), raf = 0, stopped = false;
  function rebuild() {
    if (fig) { scene.remove(fig); fig.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    fig = runnerFigure(T, A); scene.add(fig);
  }
  rebuild();
  const size = () => {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    return true;
  };
  canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, yaw]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (drag) yaw = drag[1] + (e.clientX - drag[0]) * 0.012; });
  canvas.addEventListener("pointerup", () => { drag = null; });
  const loop = (now) => {
    if (stopped) return;
    if (!el.isConnected) { stop(); return; }
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!el.offsetParent || !size()) return;                         // the tab hidden: nothing drawn
    if (!drag) yaw += dt * 0.35;
    fig.userData.animate({ stand: 0, walk: 1.4, run: 3.6 }[gait], dt);
    camera.position.set(Math.sin(yaw) * 4.8, 1.3, Math.cos(yaw) * 4.8); camera.lookAt(0, 0.9, 0);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  function stop() { stopped = true; cancelAnimationFrame(raf); renderer.dispose(); }
  return stop;
}

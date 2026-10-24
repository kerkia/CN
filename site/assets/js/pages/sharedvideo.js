// A headcam video beside « Analyse multi »'s replay (after 3DRerun): a video file chosen on this device — never sent,
// read through an object URL — played in step with one runner's race. The offset is the video's time at the runner's
// start: typed, or set by « Caler ici » once the video shows the moment the replay shows (the start's beep, a control).
// While the replay plays at up to × 16 the video plays at the same rate, put back in step when it drifts by over half a
// second; faster, it is paused and shown frame by frame; outside the runner's race it waits. The offset and the runner
// are remembered on this device per analysis and circuit.
//
// X: runners, pick() the runner by default, raceTime(r) the runner's race time at the replay's moment (s, or null),
// key (the localStorage key), playing(), speed().

import { html, raw, $ } from "../util.js";
import { t } from "../i18n.js";

export function videoPanel(host, X) {
  let url = null, video = null, last = 0;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(X.key) || "null") || {}; } catch (e) { return {}; } })();
  let who = X.runners.find((r) => r.uid === saved.uid) || X.pick(), offset = Number.isFinite(saved.offset) ? saved.offset : 0;
  const save = () => { try { localStorage.setItem(X.key, JSON.stringify({ uid: who?.uid, offset })); } catch (e) { /* this visit only */ } };
  const box = document.createElement("div");
  box.className = "sh-video";
  box.hidden = true;
  host.appendChild(box);
  function draw() {
    box.innerHTML = html`<div class="sh-video-head"><b>${t("sh.video.title")}</b><button type="button" class="btn btn-sm" data-vclose title="${t("sh.video.close")}">✕</button></div>
      <video playsinline muted preload="auto"></video>
      <div class="sh-video-row">
        <select data-vwho title="${t("prov.runner")}">${X.runners.map((r) => html`<option value="${r.uid}" ${raw(r === who ? "selected" : "")}>${r.name}</option>`)}</select>
        <label title="${t("sh.video.offset.tip")}">${t("sh.video.offset")} <input type="number" data-voff step="0.1" value="${Math.round(offset * 10) / 10}" style="width:72px"> s</label>
        <button type="button" class="btn btn-sm" data-vhere title="${t("sh.video.here.tip")}">${t("sh.video.here")}</button>
        <button type="button" class="btn btn-sm" data-vmute>${t("sh.video.sound")}</button></div>
      <p class="hint" style="margin:4px 0 0">${t("sh.video.privacy")}</p>`;
    video = $("video", box);
    video.src = url;
    $("[data-vclose]", box).addEventListener("click", close);
    $("[data-vwho]", box).addEventListener("change", (e) => { who = X.runners.find((r) => r.uid === Number(e.target.value)) || who; save(); sync(true); });
    $("[data-voff]", box).addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { offset = v; save(); sync(true); } });
    // « Caler ici »: the video's current frame is the replay's moment
    $("[data-vhere]", box).addEventListener("click", () => { const rt = X.raceTime(who); if (rt == null) return; offset = video.currentTime - rt; save(); $("[data-voff]", box).value = String(Math.round(offset * 10) / 10); });
    $("[data-vmute]", box).addEventListener("click", (e) => { video.muted = !video.muted; e.target.setAttribute("aria-pressed", String(!video.muted)); });
    // the video's own scrubbing (clicking it) is not ours: a click pauses or plays it alone, to find the frame to set
    video.addEventListener("click", () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  }
  function open(file) {
    close();
    url = URL.createObjectURL(file);
    box.hidden = false;
    draw();
    video.addEventListener("loadedmetadata", () => sync(true), { once: true });
  }
  function close() {
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    if (url) URL.revokeObjectURL(url);
    url = null; video = null; box.hidden = true; box.innerHTML = "";
  }
  /** The video at the replay's moment; force: seek even if close. */
  function sync(force = false) {
    if (!video || !who || !video.duration) return;
    const rt = X.raceTime(who), target = rt == null ? null : rt + offset;
    if (target == null || target < 0 || target > video.duration) { if (!video.paused) video.pause(); return; }
    const playing = X.playing(), speed = X.speed(), now = performance.now();
    if (playing && speed <= 16) {
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (Math.abs(video.currentTime - target) > 0.5 * Math.max(1, speed / 4)) video.currentTime = target;
      if (video.paused) video.play().catch(() => {});
      return;
    }
    if (!video.paused) video.pause();
    // paused, or too fast to play: a frame now and then (a seek is costly)
    if (force || (Math.abs(video.currentTime - target) > 0.15 && now - last > (playing ? 250 : 60))) { video.currentTime = target; last = now; }
  }
  return { open, sync, close };
}

// « En direct »: the races liveresultat shows (yesterday to next week, all countries), then one race live.
// A race page opens one WebSocket (/ws/<race>) and says which class it shows; the live Worker pushes that class each
// time it changes, and the last passings. Times are liveresultat's hundredths of a second. Everything computed here
// (who is running, for how long, who just finished, who is you or followed) costs the server nothing.
import { t, since, fmtDay, lang } from "./i18n.js";
import { settings, save, isMe, follows, toggleFollow, opened, norm } from "./settings.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATUS = { 1: "dns", 2: "dnf", 3: "mp", 4: "dsq", 5: "ot", 11: "dns", 12: "nc" };
const JUST_IN_MS = 90000;

export function render(view, args) {
  return args[0] && /^\d+$/.test(args[0]) ? race(view, args[0], args[1]) : list(view);
}

// ---- the races --------------------------------------------------------------------------------------------------
async function list(view) {
  let q = "";
  view.innerHTML = `<header class="bar"><h1>${t("live.title")}</h1></header>
    <div class="pad"><input type="search" id="q" class="search" placeholder="${t("live.search")}" autocomplete="off"></div>
    <div id="comps"><p class="muted pad">${t("live.loading")}</p></div>
    <p class="muted pad small">${t("live.source")}</p>`;
  let comps = [];
  try {
    const cached = JSON.parse(sessionStorage.getItem("ocap.comps") || "null");
    if (cached && Date.now() - cached.got < 120000) comps = cached.comps;
    else {
      const r = await fetch("api/live/list");
      comps = (await r.json()).comps;
      sessionStorage.setItem("ocap.comps", JSON.stringify({ got: Date.now(), comps }));
    }
  } catch (e) { /* offline: the races opened lately still show */ }
  const day = (d) => new Date(Date.now() + d * 86400e3).toLocaleDateString("sv-SE");
  const today = day(0), label = { [day(-1)]: t("live.yesterday"), [today]: t("live.today"), [day(1)]: t("live.tomorrow") };
  const row = ([id, name, org, date]) => `<a class="item" href="#/direct/${id}"><div><div class="name">${esc(name)}</div>
    <div class="muted small">${esc(org)}${org ? " · " : ""}${fmtDay(date)}</div></div><span class="chev" aria-hidden="true">›</span></a>`;
  function draw() {
    const n = norm(q);
    const kept = comps.filter((c) => !n || norm(`${c[1]} ${c[2]}`).includes(n));
    const groups = new Map();
    for (const c of kept) (groups.get(c[3]) || groups.set(c[3], []).get(c[3])).push(c);
    const order = [...groups.keys()].sort((a, b) => (a === today ? -1 : b === today ? 1 : 0) || Math.abs(Date.parse(a) - Date.parse(today)) - Math.abs(Date.parse(b) - Date.parse(today)));
    const mine = settings().opened.filter((o) => !n || norm(o.name).includes(n));
    document.getElementById("comps").innerHTML = (mine.length ? `<h2 class="sec">${t("live.recentOpened")}</h2>
      ${mine.map((o) => row([o.id, o.name, o.org || "", o.date])).join("")}` : "")
      + (order.length ? order.map((d) => `<h2 class="sec">${label[d] || fmtDay(d)}</h2>${groups.get(d).map(row).join("")}`).join("")
        : `<p class="muted pad">${t("live.none")}</p>`);
  }
  draw();
  document.getElementById("q").addEventListener("input", (e) => { q = e.target.value; draw(); });
}

// ---- one race -----------------------------------------------------------------------------------------------------
const hs = (h) => {                                     // hundredths -> « 41:30 », « 1:02:03 »
  if (h == null) return "";
  const s = Math.floor(h / 100);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const plus = (h) => (h ? `+${hs(h)}` : "");

/** The race's time of day now, in hundredths (its time zone, else Swedish time shifted by liveresultat's timediff). */
function nowAt(info) {
  const tz = info?.timezone || "Europe/Stockholm";
  let p;
  try { p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  catch (e) { p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  const v = (k) => Number(p.find((x) => x.type === k)?.value || 0);
  return ((v("hour") * 3600 + v("minute") * 60 + v("second")) + (info?.timezone ? 0 : (info?.timediff || 0) * 3600)) * 100;
}

function race(view, id, wanted) {
  const st = { info: null, classes: [], cls: wanted || settings().cls[id] || null, data: null, prev: null, justIn: new Map(),
    pass: [], passAt: 0, ws: null, up: false, tries: 0, open: new Set(), gone: false };
  view.innerHTML = `<header class="bar sticky"><a href="#/direct" class="back" aria-label="${t("live.title")}">‹</a>
      <div class="grow"><h1 id="title">…</h1><div class="muted small" id="sub"></div></div></header>
    <div class="status" id="status">${t("live.connecting")}</div>
    <div class="chips" id="chips" role="tablist" aria-label="${t("live.classes")}"></div>
    <div class="ticker" id="ticker" hidden></div>
    <div id="rows"></div>`;
  const $ = (s) => view.querySelector(s);

  function connect() {
    if (st.gone) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${id}`);
    st.ws = ws;
    ws.onopen = () => { st.up = true; st.tries = 0; if (st.cls) ws.send(JSON.stringify({ sub: st.cls })); status(); };
    ws.onmessage = (e) => on(JSON.parse(e.data));
    ws.onclose = () => {
      st.up = false; status();
      if (st.gone || document.hidden) return;
      setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(st.tries++, 4)]);
    };
  }

  function on(m) {
    if (m.t === "hello") {
      st.info = m.info; st.classes = m.classes; st.passAt = m.at || 0;
      $("#title").textContent = m.info?.name || id;
      $("#sub").textContent = [m.info?.organizer, m.info?.date && fmtDay(m.info.date)].filter(Boolean).join(" · ");
      opened({ id: Number(id), name: m.info?.name || id, org: m.info?.organizer || "", date: m.info?.date || "" });
      if (!st.cls || !st.classes.includes(st.cls)) pick(st.classes[0], false);
      chips();
      if (!st.classes.length) $("#rows").innerHTML = `<p class="muted pad">${t("live.noClasses")}</p>`;
    } else if (m.t === "classes") {
      st.classes = m.classes;
      if (!st.cls) pick(st.classes[0], false);
      chips();
    } else if (m.t === "class" && m.c === st.cls) {
      if (m.missing) { $("#rows").innerHTML = `<p class="muted pad">${t("live.missing")}</p>`; return; }
      // who finished since the last version: « Vient d'arriver » for a while
      if (st.data) {
        const before = new Set(st.data.rows.filter((r) => r[3] != null && r[4] === 0).map((r) => `${r[1]}|${r[2]}`));
        for (const r of m.rows) if (r[3] != null && r[4] === 0 && !before.has(`${r[1]}|${r[2]}`)) st.justIn.set(`${r[1]}|${r[2]}`, Date.now());
      }
      st.data = m; rows();
    } else if (m.t === "pass") {
      st.pass = m.items; st.passAt = m.at; ticker(); status();
    }
  }

  function pick(c, send = true) {
    if (!c) return;
    st.cls = c; st.data = null; st.justIn.clear(); st.open.clear();
    save({ cls: { ...settings().cls, [id]: c } });
    history.replaceState(null, "", `#/direct/${id}/${encodeURIComponent(c)}`);
    $("#rows").innerHTML = `<p class="muted pad">${t("live.loading")}</p>`;
    if (send && st.ws?.readyState === 1) st.ws.send(JSON.stringify({ sub: c }));
    else if (!send && st.ws?.readyState === 1) st.ws.send(JSON.stringify({ sub: c }));
    chips();
  }

  function chips() {
    $("#chips").innerHTML = st.classes.map((c) => `<button role="tab" class="chip${c === st.cls ? " on" : ""}" aria-selected="${c === st.cls}"
      data-c="${esc(c)}">${esc(c)}</button>`).join("");
    $("#chips .on")?.scrollIntoView({ inline: "center", block: "nearest" });
  }

  function status() {
    const el = $("#status");
    if (!st.up) { el.className = "status"; el.textContent = st.info ? t("live.offline") : t("live.connecting"); return; }
    // the last passing's own time of day (liveresultat's passtime, in the race's time), else when the server saw it
    const p = st.pass[0]?.[0]?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    let age = p ? (nowAt(st.info) / 100 - (Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3]))) * 1000 : null;
    if (age != null && (age < -60000 || age > 12 * 3600e3)) age = null;      // another day, or a clock off
    if (age == null && st.passAt) age = Date.now() - st.passAt;
    if (age != null) age = Math.max(0, age);
    const live = age != null && age < 300000;
    el.className = `status${live ? " live" : ""}`;
    el.innerHTML = live ? `<span class="dot" aria-hidden="true"></span>${t("live.on")} · ${t("live.ago", { t: since(age) })}`
      : age != null ? t("live.idle", { t: since(age) }) : t("live.on");
  }

  function ticker() {
    const el = $("#ticker");
    const items = st.pass.slice(0, 3);
    el.hidden = !items.length;
    el.innerHTML = `<span class="muted small">${t("live.lastPass")}</span>` + items.map(([at, name, cls, ctl, ctlName, time]) =>
      `<button class="tick" data-c="${esc(cls)}"><b>${esc(name)}</b> <span class="muted">${esc(cls)} · ${ctl === 1000 ? t("live.finish") : esc(ctlName || ctl)} ${esc(time)}</span></button>`).join("");
  }

  function rows() {
    const d = st.data;
    if (!d) return;
    const now = nowAt(st.info);
    const fin = [], run = [], wait = [], out = [];
    for (const r of d.rows) {
      const [place, , , result, status, , , start] = r;
      if (status === 0 && result != null) fin.push(r);
      else if (STATUS[status]) out.push(r);
      else if (start != null && start <= now) run.push(r);
      else wait.push(r);
    }
    fin.sort((a, b) => (a[0] ?? 1e9) - (b[0] ?? 1e9));
    run.sort((a, b) => (a[7] ?? 0) - (b[7] ?? 0));
    wait.sort((a, b) => (a[7] ?? 0) - (b[7] ?? 0));
    const ctl = d.controls || [];
    const line = (r, kind) => {
      const [place, name, club, result, status, timeplus, , start, splits] = r;
      const key = `${name}|${club}`, me = isMe(name), fol = follows(name, club);
      const just = kind === "fin" && Date.now() - (st.justIn.get(key) || 0) < JUST_IN_MS;
      let right = "", sub = esc(club);
      if (kind === "fin") right = `<div class="time">${hs(result)}</div><div class="muted small">${plus(timeplus)}</div>`;
      else if (kind === "run") {
        const last = splits ? splits.map((s, i) => (s ? [i, s] : null)).filter(Boolean).pop() : null;
        if (last) sub = t("live.atControl", { c: esc(ctl[last[0]]?.[1] || ""), p: last[1][1] ?? "–", d: plus(last[1][2]) || "+0:00" });
        right = `<div class="time muted" data-start="${start}">${hs(now - start)}</div>`;
      } else if (kind === "wait") right = `<div class="muted small">${start != null ? hs(start).replace(/^(\d+):(\d\d):\d\d$/, "$1:$2") : ""}</div>`;
      else right = `<div class="muted small">${t(`st.${STATUS[status]}`)}</div>`;
      const open = st.open.has(key) && splits && ctl.length;
      return `<div class="row${just ? " just" : ""}${me ? " me" : ""}" data-k="${esc(key)}">
        <div class="pl">${kind === "fin" ? place ?? "" : ""}</div>
        <div class="who"><div class="name">${esc(name)}${me ? ` <span class="badge">${t("live.you")}</span>` : ""}</div>
          <div class="muted small">${just ? `<span class="justin">${t("live.justIn")}</span> · ` : ""}${sub}</div>
          ${open ? `<div class="splits small">${ctl.map(([, nm], i) => (splits[i] ? `<span>${esc(nm)} ${hs(splits[i][0])} <span class="muted">(${splits[i][1] ?? "–"})</span></span>` : "")).join("")}</div>` : ""}</div>
        <div class="res">${right}</div>
        <button class="star${fol ? " on" : ""}" data-f="${esc(key)}" aria-label="${fol ? t("live.unfollow") : t("live.follow")}" aria-pressed="${fol}">★</button></div>`;
    };
    const block = (title, list, kind) => (list.length ? `<h2 class="sec">${title} <span class="muted">${list.length}</span></h2>${list.map((r) => line(r, kind)).join("")}` : "");
    $("#rows").innerHTML = (d.rows.length ? "" : `<p class="muted pad">${t("live.empty")}</p>`)
      + block(t("live.finished"), fin, "fin") + block(t("live.running"), run, "run") + block(t("live.others"), out, "out")
      + block(t("live.notStarted"), wait, "wait");
  }

  // taps: a class, a passing (opens its class), a runner (their radio splits), a star (follow)
  view.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-c]");
    if (chip) return pick(chip.dataset.c);
    const star = e.target.closest("[data-f]");
    if (star) {
      const r = st.data?.rows.find((x) => `${x[1]}|${x[2]}` === star.dataset.f);
      if (r) { toggleFollow(r[1], r[2]); rows(); }
      return;
    }
    const row = e.target.closest(".row");
    if (row) { const k = row.dataset.k; st.open.has(k) ? st.open.delete(k) : st.open.add(k); rows(); }
  });

  // the clock: running times and « il y a … » every second; the connection closed when the app is put away a while
  const tick = setInterval(() => {
    status();
    const now = nowAt(st.info);
    view.querySelectorAll("[data-start]").forEach((el) => { el.textContent = hs(now - Number(el.dataset.start)); });
    if (st.data && [...st.justIn.values()].some((x) => Date.now() - x > JUST_IN_MS && Date.now() - x < JUST_IN_MS + 1500)) rows();
  }, 1000);
  let hiddenAt = null, closer = null;
  const vis = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      closer = setTimeout(() => st.ws?.close(), 60000);
    } else {
      clearTimeout(closer);
      if (!st.ws || st.ws.readyState > 1) connect();
    }
  };
  document.addEventListener("visibilitychange", vis);
  connect();
  return () => {
    st.gone = true;
    clearInterval(tick); clearTimeout(closer);
    document.removeEventListener("visibilitychange", vis);
    st.ws?.close();
  };
}

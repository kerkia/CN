// The split times of a live race (« En direct »), for « Analyse de course » (2026-10-23): the live relay's class data
// (live/src/index.js, compact rows [place, name, club, result, status, timeplus, progress, start, splits], times in
// hundredths, controls [[code, name]]) read as one results document of « Résultats » (prov/model.py), which the
// split-time analysis (pages/splits.js) reads. Everything stays in the browser: nothing is stored.

// the list (/api/live/list) and the live connections (/ws/<race>), on this site; a developer may point them at another
// server (localStorage « ocn.liveBase »)
const devBase = (() => { try { return localStorage.getItem("ocn.liveBase"); } catch (e) { return null; } })();
export const LIVE = devBase || "";
/** The race key of a live race in the analysis's address: #/analyse-course?course=direct-<race> */
export const LIVE_KEY = "direct-";
export const liveId = (key) => (typeof key === "string" && key.startsWith(LIVE_KEY) && /^\d+$/.test(key.slice(LIVE_KEY.length)) ? key.slice(LIVE_KEY.length) : null);
const FINISH = 1000;                     // liveresultat's code of the finish in the last passings
// liveresultat's status codes -> the documents' (0 OK; 9 started, 10 not started yet: still out)
const STATUS = { 1: "dns", 2: "dnf", 3: "mp", 4: "dsq", 5: "ot", 11: "dns", 12: "nc" };

/** A control as the documents name it: its name, else its code (MeOS's 1000 + number, a repeat 101031: the number). */
const controlName = ([code, name]) => String(name || (Number(code) >= 1000 ? Number(code) % 1000 : code));

/** The race's classes (in the relay's order; those not received yet empty) as a document of « Résultats »: a runner still
 *  out is « run », their splits so far kept; a runner without any split has none (the analysis leaves them out). */
export function toDoc(info, classes, all) {
  return {
    source: "liveresultat", title: info?.name || "", url: "", live: true,
    classes: classes.map((c) => {
      const d = all.get(c) || { controls: [], rows: [] };
      return {
        name: c, controls: (d.controls || []).map(controlName),
        runners: (d.rows || []).map(([place, name, club, result, status, , , start, splits]) => {
          const ok = status === 0 && result != null;
          const sp = Array.isArray(splits) ? splits.map((s) => (s && s[0] > 0 ? s[0] / 100 : null)) : null;
          return { name, club: club || "", place: ok ? place : null, status: ok ? "ok" : STATUS[status] || "run",
            time_s: ok ? result / 100 : null, splits: sp && sp.some((x) => x != null) ? sp : null, start_s: start != null ? start / 100 : null };
        }),
      };
    }),
  };
}
/** Does a class hold a split time? */
export const hasSplits = (d) => !!d?.rows?.some((r) => Array.isArray(r[8]) && r[8].some(Boolean));

/** Watches a live race, the whole of it (every class): onChange(state) after each message that changes the data. */
export function watch(id, onChange) {
  const st = { info: null, classes: [], all: new Map(), at: 0, up: false, gone: false, tries: 0, ws: null, heard: 0, pinged: 0 };
  function connect() {
    if (st.gone) return;
    const ws = new WebSocket(`${(LIVE || location.origin).replace(/^http/, "ws")}/ws/${id}`);
    st.ws = ws;
    ws.onopen = () => { st.up = true; st.tries = 0; st.heard = Date.now(); ws.send(JSON.stringify({ sub: "*" })); onChange(st, "open"); };
    ws.onmessage = (e) => {
      st.heard = Date.now();
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === "hello") { st.info = m.info; st.classes = m.classes || []; onChange(st, "hello"); }
      else if (m.t === "classes") { st.classes = m.classes || []; onChange(st, "classes"); }
      else if (m.t === "class" && !m.missing) { st.all.set(m.c, m); st.at = Date.now(); onChange(st, "class", m.c); }
    };
    ws.onclose = () => {
      st.up = false; onChange(st, "close");
      if (!st.gone && !document.hidden) setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(st.tries++, 4)]);
    };
  }
  // the relay answers « ping » without waking; nothing heard for a minute (a phone asleep): connect again
  const beat = setInterval(() => {
    const ws = st.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - st.pinged > 25000) { st.pinged = Date.now(); try { ws.send("ping"); } catch (e) { /* closing */ } }
    if (Date.now() - st.heard > 65000) { ws.onclose = null; ws.close(); st.up = false; connect(); }
  }, 5000);
  const vis = () => { if (!document.hidden && (!st.ws || st.ws.readyState > 1)) connect(); };
  document.addEventListener("visibilitychange", vis);
  connect();
  return { st, close() { st.gone = true; clearInterval(beat); document.removeEventListener("visibilitychange", vis); st.ws?.close(); } };
}

/** Does a live race give split times? Its last passings say so when one is at a radio control; else the class of the
 *  latest passing (or the first) is read. A few seconds at most, then the connection is closed. */
export function probe(id, ms = 8000) {
  return new Promise((resolve) => {
    let ws, done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); try { ws?.close(); } catch (e) { /* closed */ } resolve(v); };
    const timer = setTimeout(() => end(false), ms);
    try { ws = new WebSocket(`${(LIVE || location.origin).replace(/^http/, "ws")}/ws/${id}`); } catch (e) { end(false); return; }
    ws.onerror = () => end(false);
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === "hello") {
        if ((m.pass || []).some((p) => Number(p[3]) !== FINISH)) return end(true);
        const c = m.pass?.[0]?.[2] || m.classes?.[0];
        if (!c) return end(false);
        ws.send(JSON.stringify({ sub: c }));
      } else if (m.t === "class") end(!m.missing && hasSplits(m));
    };
  });
}

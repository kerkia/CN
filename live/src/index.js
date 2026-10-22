// Ozimut's live relay (Worker « ocn-live », 2026-10-18): one Durable Object per
// liveresultat competition, awake only while someone watches it. Ozimut reaches it through Durable Object bindings only
// (functions/api/live/*, functions/ws/[comp].js): the Worker has no public address (workers_dev off).
//
// Each phone opens a WebSocket (one request, then nothing but the updates pushed to it) and says which class it is
// looking at. The object reads liveresultat for everyone at once — the last passings every 15 s while runners keep
// coming in (30 s when nothing moves; liveresultat caches its answers 15 s anyway), then only the classes that moved
// and that someone watches, with liveresultat's hash so an unchanged class costs a few bytes — and pushes each
// changed class to the phones watching it. Nobody left: the alarm is not set again and the object sleeps.
// The WebSocket Hibernation API keeps idle connections free; only what changed is written to storage.

import { DurableObject } from "cloudflare:workers";

const UA = "Ozimut-live/1.0 (+https://ozimut.com; one reader per competition, relayed to its spectators)";
const ACTIVE_MS = 15000, QUIET_MS = 30000;       // polling interval while passings keep coming / when nothing moves
const RECHECK_MS = 90000;                        // a watched class is re-read at least this often (passings list is short)
const MAX_READS = 30;                            // liveresultat reads per wake-up, at most (subrequest limit: 50)
// the pages' course picker shows each class's finishers (owner, 2026-10-21): the classes nobody watches are read for their
// counts only, a few per wake-up — those just punched first (at most every 30 s), then those never read, then each every
// 15 min — and only the two numbers are kept
const COUNT_READS = 3, COUNT_MOVED_MS = 30000, COUNT_STALE_MS = 900000;
const PASS_KEPT = 30;                            // the last passings kept and sent (the pages add them up over a visit)
// A page may watch the whole race (sub "*", owner 2026-10-22: a club's runners across the courses, everyone still out,
// the punches with their places, the runner search): then every class is read as a watched one, and sent to it. Up to
// ALL_NOW missing classes are read at once when it asks, the others at the next wake-ups.
const ALL = "*", ALL_NOW = 12;

const api = (env) => env.LR_API || "https://liveresultat.orientering.se/api.php";

// Races fed by their organiser through Ozimut (« Organisation › Direct », 2026-10-15): numbers from 900 000 000 (liveresultat's
// are far below), never read from liveresultat. Their object keeps what the organiser's page sends — the classes that
// changed since its last read of the timing software's export — and pushes the changes to the pages watching, as for a
// liveresultat race. The push is internal: only Ozimut reaches it, through its Durable Object binding (path /push, which
// no public route forwards: Ozimut's Function passes on /ws/<number> WebSocket requests only).
const PUSHED_FROM = 900000000;
const isPushed = (comp) => Number(comp) >= PUSHED_FROM;
const MAX_PUT = 100;                             // keys per storage.put (the limit is 128)
async function lr(env, params) {
  const r = await fetch(`${api(env)}?${new URLSearchParams(params)}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`liveresultat ${r.status}`);
  const s = await r.text();
  try { return JSON.parse(s); } catch (e) { return JSON.parse(s.replace(/[\t\r\n]+/g, " ").replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); }
}

// a class's finishers and runners (non-starters apart), for the course picker
const countOf = (rows) => [rows.filter((r) => r[4] === 0 && r[3] != null).length, rows.filter((r) => r[4] !== 1 && r[4] !== 11).length];

// a class's results, compact: [place, name, club, result, status, timeplus, progress, start, splits]
function compact(k) {
  const codes = (k.splitcontrols || []).map((s) => String(s.code));
  return {
    controls: (k.splitcontrols || []).map((s) => [String(s.code), s.name]),
    rows: (k.results || []).map((r) => [Number(r.place) || null, r.name, r.club || "", r.result === "" || r.result == null ? null : Number(r.result),
      r.status, r.timeplus === "" || r.timeplus == null ? null : Number(r.timeplus), r.progress ?? null, r.start ?? null,
      codes.length ? codes.map((c) => (r.splits?.[c] > 0 ? [r.splits[c], r.splits[`${c}_place`] ?? null, r.splits[`${c}_timeplus`] ?? null] : null)) : null]),
  };
}

export class LiveRace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.m = null;                              // memory; reloaded from storage after a hibernation
    // the pages' heartbeat, answered without waking the object (no request counted)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async load() {
    if (this.m) return this.m;
    const s = await this.ctx.storage.get(["head", "data"]);
    this.m = s.get("head") || { comp: null, info: null, classes: [], classesHash: "", passHash: "", hashes: {}, read: {}, lastChange: 0, classesAt: 0 };
    // each class under its own key (2026-10-22: one value for every class of a big race outgrew the storage's limit); the
    // former single « data » value is read once and written out class by class at the next save
    const old = s.get("data");
    this.m.data = old || {};
    this.legacy = old ? Object.keys(old) : null;
    for (const [k, v] of await this.ctx.storage.list({ prefix: "c:" })) this.m.data[k.slice(2)] = v;
    this.m.counts ||= {}; this.m.counted ||= {}; this.m.chash ||= {};       // (objects of before the counts)
    if (this.m.pushed) for (const [k, v] of Object.entries(this.m.data)) this.m.counts[k] = countOf(v.rows || []);
    return this.m;
  }

  /** The head, and the classes named (those that changed) under their own keys. */
  async save(names = []) {
    const { data, ...head } = this.m;
    const all = [...new Set([...names, ...(this.legacy || [])])].filter((c) => data[c]);
    const puts = [["head", head], ...all.map((c) => [`c:${c}`, data[c]])];
    for (let i = 0; i < puts.length; i += MAX_PUT) await this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + MAX_PUT)));
    if (this.legacy) { this.legacy = null; await this.ctx.storage.delete("data"); }
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* closed meanwhile */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/push" && request.method === "POST") return this.push(request, url.searchParams.get("comp") || "");
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket expected", { status: 426 });
    const comp = url.pathname.split("/").filter(Boolean).pop();
    if (!/^\d{1,9}$/.test(comp)) return new Response("Bad competition", { status: 400 });
    const m = await this.load();
    m.comp = comp;
    if (isPushed(comp)) {
      // an organiser's race: what they sent so far (perhaps nothing yet), no liveresultat, no alarm
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      this.send(server, { t: "hello", info: m.info || { name: "Diffusion en attente", timezone: "Europe/Paris" }, classes: m.classes,
        at: m.lastChange, pass: m.pass || null, counts: m.counts });
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!m.info) {
      try {
        m.info = await lr(this.env, { method: "getcompetitioninfo", comp });
        await this.readClasses(m);
        await this.readPassings(m);
      } catch (e) {
        return new Response("liveresultat unavailable", { status: 502 });
      }
      await this.save();
    }
    if (!m.pass) {                              // a race relayed before passings were kept: read them once
      m.passHash = "";
      try { if (await this.readPassings(m)) await this.save(); } catch (e) { /* the next wake-up */ }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // the last passings come with the hello: a page opened between two arrivals is not left empty
    this.send(server, { t: "hello", info: m.info, classes: m.classes, at: m.lastChange, pass: m.pass || null, counts: m.counts });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 2000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let q;
    if (raw === "ping") { try { ws.send("pong"); } catch (e) { /* closed */ } return; }
    try { q = JSON.parse(raw); } catch (e) { return; }
    if (typeof q.sub !== "string" || q.sub.length > 200) return;
    ws.serializeAttachment({ sub: q.sub });
    const m = await this.load();
    if (q.sub === ALL) {
      // the whole race: every class held, then the missing ones, read now (a few) or at the next wake-ups
      for (const c of m.classes) if (m.data[c]) this.send(ws, { t: "class", c, ...m.data[c] });
      if (m.pushed) return;
      const read = [];
      for (const c of m.classes.filter((x) => !m.data[x]).slice(0, ALL_NOW)) {
        try { if (await this.readClass(m, c)) { read.push(c); this.send(ws, { t: "class", c, ...m.data[c] }); } } catch (e) { break; }
      }
      if (read.length) { await this.save(read); this.send(ws, { t: "counts", counts: m.counts }); }
      return;
    }
    if (!m.classes.includes(q.sub)) return this.send(ws, { t: "class", c: q.sub, missing: true });
    if (!m.data[q.sub] && !m.pushed) {
      try { if (await this.readClass(m, q.sub)) await this.save([q.sub]); } catch (e) { /* sent at the next wake-up */ }
    }
    if (m.data[q.sub]) this.send(ws, { t: "class", c: q.sub, ...m.data[q.sub] });
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch (e) { /* already closed */ }
  }

  /** An organiser's push (internal, from Ozimut): { info, order: [class names, in the file's order], classes: { name:
   *  { controls, rows } } } — the classes that changed, in liveresultat's compact form; answers what it did. */
  async push(request, comp) {
    if (!/^\d{9}$/.test(comp) || !isPushed(comp)) return new Response("Not an organiser's race", { status: 400 });
    let p;
    try { p = await request.json(); } catch (e) { return new Response("Bad JSON", { status: 400 }); }
    const m = await this.load();
    const first = !m.pushed;
    m.comp = comp;
    m.pushed = true;
    const now = Date.now();
    let infoChanged = false;
    if (p.info && typeof p.info === "object") {
      const info = { name: String(p.info.name || "").slice(0, 160), organizer: String(p.info.organizer || "").slice(0, 160),
        date: /^\d{4}-\d\d-\d\d$/.test(p.info.date || "") ? p.info.date : null, timezone: "Europe/Paris", timediff: 0 };
      if (JSON.stringify(info) !== JSON.stringify(m.info)) { m.info = info; infoChanged = true; }
    }
    const changed = [], arrivals = [];
    for (const [name, k] of Object.entries(p.classes && typeof p.classes === "object" ? p.classes : {})) {
      if (!name || name.length > 200 || !k || !Array.isArray(k.rows) || k.rows.length > 5000) continue;
      const next = { controls: Array.isArray(k.controls) ? k.controls.slice(0, 200) : [], rows: k.rows };
      const prev = m.data[name];
      if (prev && JSON.stringify({ controls: prev.controls, rows: prev.rows }) === JSON.stringify(next)) continue;
      // the runners who finished since the last push, for the ticker of arrivals
      const before = new Set((prev?.rows || []).filter((r) => r[4] === 0 && r[3] != null).map((r) => `${r[1]}|${r[2]}`));
      for (const r of next.rows) if (r[4] === 0 && r[3] != null && !before.has(`${r[1]}|${r[2]}`)) arrivals.push([r[1], name, r[3]]);
      m.data[name] = { ...next, at: now };
      m.counts[name] = countOf(next.rows);
      changed.push(name);
    }
    const order = Array.isArray(p.order) ? p.order.filter((c) => typeof c === "string" && m.data[c]) : null;
    const classes = order && order.length ? order : [...new Set([...m.classes, ...changed])];
    const classesChanged = JSON.stringify(classes) !== JSON.stringify(m.classes);
    m.classes = classes;
    // the first push is no news (the file may already hold hours of results): no arrivals then
    if (arrivals.length && !first) {
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23" }).format(new Date(now));
      // the time written out, as liveresultat sends it in its passings (« 41:40 », « 1:05:12 »)
      const out = (h) => { const x = Math.floor(h / 100), mm = String(Math.floor(x / 60) % 60).padStart(2, "0"), ss = String(x % 60).padStart(2, "0");
        return x >= 3600 ? `${Math.floor(x / 3600)}:${mm}:${ss}` : `${Math.floor(x / 60)}:${ss}`; };
      m.pass = [...arrivals.slice(-PASS_KEPT).reverse().map(([n, k, t]) => [clock, n, k, 1000, "Arrivée", out(t)]), ...(m.pass || [])].slice(0, PASS_KEPT);
      m.lastChange = now;
    }
    const sockets = this.ctx.getWebSockets();
    if (infoChanged || first) for (const ws of sockets) this.send(ws, { t: "hello", info: m.info, classes: m.classes, at: m.lastChange, pass: m.pass || null, counts: m.counts });
    else if (classesChanged) for (const ws of sockets) this.send(ws, { t: "classes", classes: m.classes });
    if (changed.length && !infoChanged && !first) for (const ws of sockets) this.send(ws, { t: "counts", counts: m.counts });
    if (arrivals.length && !first) for (const ws of sockets) this.send(ws, { t: "pass", items: m.pass, at: m.lastChange });
    for (const ws of sockets) {
      const sub = ws.deserializeAttachment()?.sub;
      for (const c of changed) if (sub === c || sub === ALL) this.send(ws, { t: "class", c, ...m.data[c] });
    }
    // each changed class under its own key, the head apart
    const { data, ...head } = m;
    const puts = [["head", head], ...changed.map((c) => [`c:${c}`, m.data[c]])];
    for (let i = 0; i < puts.length; i += MAX_PUT) await this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + MAX_PUT)));
    return new Response(JSON.stringify({ ok: true, classes: m.classes.length, changed: changed.length, arrivals: first ? 0 : arrivals.length,
      viewers: sockets.length }), { headers: { "Content-Type": "application/json" } });
  }

  async readClasses(m) {
    const k = await lr(this.env, { method: "getclasses", comp: m.comp, last_hash: m.classesHash });
    m.classesAt = Date.now();
    if (k.status !== "OK") return false;
    m.classesHash = k.hash;
    m.classes = (k.classes || []).map((c) => c.className);
    return true;
  }

  /** Reads the last passings (kept in m.pass for the pages that open later); true when they changed. */
  async readPassings(m) {
    const p = await lr(this.env, { method: "getlastpassings", comp: m.comp, last_hash: m.passHash });
    if (p.status !== "OK") return false;
    if (m.passHash) m.lastChange = Date.now();       // (the first read is no news: passings may be hours old)
    m.passHash = p.hash;
    m.pass = (p.passings || []).slice(0, PASS_KEPT).map((x) => [x.passtime, x.runnerName, x.class, x.control, x.controlName || "", x.time]);
    return true;
  }

  /** Reads one class; true when it changed (and is then in m.data). */
  async readClass(m, name) {
    const k = await lr(this.env, { method: "getclassresults", comp: m.comp, class: name, unformattedTimes: "true", last_hash: m.hashes[name] || "" });
    m.read[name] = Date.now();
    if (k.status !== "OK") return false;
    m.hashes[name] = k.hash;
    m.data[name] = { ...compact(k), at: Date.now() };
    m.counts[name] = countOf(m.data[name].rows);
    return true;
  }

  /** Reads one class for its counts only (nobody watches it); true when they changed. */
  async readCount(m, name) {
    const k = await lr(this.env, { method: "getclassresults", comp: m.comp, class: name, unformattedTimes: "true", last_hash: m.chash[name] || "" });
    m.counted[name] = Date.now();
    if (k.status !== "OK") return false;
    m.chash[name] = k.hash;
    const c = countOf(compact(k).rows), same = JSON.stringify(c) === JSON.stringify(m.counts[name]);
    m.counts[name] = c;
    return !same;
  }

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;                 // nobody watching: no more reads until someone comes back
    const m = await this.load();
    if (m.pushed) return;                        // an organiser's race: nothing to read, its pushes carry the news
    const watched = new Map();                   // class -> its sockets
    const everyone = [], whole = [];             // whole: the pages watching every class
    for (const ws of sockets) {
      everyone.push(ws);
      const sub = ws.deserializeAttachment()?.sub;
      if (sub === ALL) whole.push(ws);
      else if (sub != null) (watched.get(sub) || watched.set(sub, []).get(sub)).push(ws);
    }
    let reads = 0, counted = false;
    const changed = [];
    try {
      reads++;
      const moved = new Set();
      if (await this.readPassings(m)) {
        for (const x of m.pass) moved.add(x[2]);
        for (const ws of everyone) this.send(ws, { t: "pass", items: m.pass, at: m.lastChange });
      }
      if (Date.now() - m.classesAt > 300000) {
        reads++;
        if (await this.readClasses(m)) for (const ws of everyone) this.send(ws, { t: "classes", classes: m.classes });
      }
      // the classes watched (every one when a page watches the whole race) that moved, were never read or are stale: those
      // just punched first, then those never read, then the oldest
      const due0 = (whole.length ? m.classes : [...watched.keys()].filter((c) => m.classes.includes(c)))
        .filter((c) => moved.has(c) || !m.data[c] || Date.now() - (m.read[c] || 0) >= RECHECK_MS)
        .sort((a, b) => (moved.has(b) - moved.has(a)) || (!!m.data[a] - !!m.data[b]) || (m.read[a] || 0) - (m.read[b] || 0));
      for (const name of due0) {
        if (reads >= MAX_READS) break;
        reads++;
        if (await this.readClass(m, name)) {
          changed.push(name); counted = true;
          for (const ws of [...(watched.get(name) || []), ...whole]) this.send(ws, { t: "class", c: name, ...m.data[name] });
        }
      }
      const now = Date.now();
      const due = (whole.length ? [] : m.classes.filter((c) => !watched.has(c)))
        .map((c) => [c, moved.has(c) ? 0 : m.counts[c] ? 2 : 1, m.counted[c] || 0])
        .filter(([, p, at]) => p === 1 || now - at > (p === 0 ? COUNT_MOVED_MS : COUNT_STALE_MS))
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, COUNT_READS);
      for (const [name] of due) {
        if (reads >= MAX_READS) break;
        reads++;
        if (await this.readCount(m, name)) counted = true;
      }
    } catch (e) {
      // liveresultat slow or down: try again at the next wake-up
      console.error(`race ${m.comp}: ${e.message || e}`);
    }
    if (counted) for (const ws of everyone) this.send(ws, { t: "counts", counts: m.counts });
    // the next wake-up first, whatever happens to the save: a failed save must not stop the pages' updates
    const active = Date.now() - m.lastChange < 120000;
    await this.ctx.storage.setAlarm(Date.now() + (active ? ACTIVE_MS : QUIET_MS));
    try { await this.save(changed); } catch (e) { console.error(`race ${m.comp}: save failed: ${e.message || e}`); }
  }
}

// The Worker itself: /ws/<comp> straight to the race's object (the site reaches it through its own Function, so that
// phones stay on the site's address); /list for the races of the coming and past days, through the directory object.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/(\d{1,9})$/);
    if (m) return env.LIVE.get(env.LIVE.idFromName(m[1])).fetch(request);
    if (url.pathname === "/list") return env.DIR.get(env.DIR.idFromName("directory")).fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

// A race's country, from the time zone its organiser declared on liveresultat (« Europe/Paris »); none declared: a
// Swedish race (liveresultat's home, where the field predates). Overseas France counts as France.
const TZ_COUNTRY = {
  "Europe/Paris": "FR", "Indian/Reunion": "FR", "Indian/Mayotte": "FR", "America/Guadeloupe": "FR", "America/Martinique": "FR",
  "America/Cayenne": "FR", "Pacific/Noumea": "FR", "Pacific/Tahiti": "FR", "Europe/Monaco": "MC", "Europe/Andorra": "AD",
  "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Atlantic/Reykjavik": "IS",
  "Europe/Tallinn": "EE", "Europe/Riga": "LV", "Europe/Vilnius": "LT", "Europe/London": "GB", "Europe/Dublin": "IE",
  "Europe/Brussels": "BE", "Europe/Amsterdam": "NL", "Europe/Luxembourg": "LU", "Europe/Berlin": "DE", "Europe/Zurich": "CH",
  "Europe/Vienna": "AT", "Europe/Rome": "IT", "Europe/Madrid": "ES", "Atlantic/Canary": "ES", "Europe/Lisbon": "PT",
  "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT", "Europe/Prague": "CZ", "Europe/Bratislava": "SK", "Europe/Warsaw": "PL",
  "Europe/Budapest": "HU", "Europe/Ljubljana": "SI", "Europe/Zagreb": "HR", "Europe/Belgrade": "RS", "Europe/Sarajevo": "BA",
  "Europe/Podgorica": "ME", "Europe/Skopje": "MK", "Europe/Tirane": "AL", "Europe/Sofia": "BG", "Europe/Bucharest": "RO",
  "Europe/Chisinau": "MD", "Europe/Athens": "GR", "Europe/Istanbul": "TR", "Asia/Istanbul": "TR", "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA", "Europe/Minsk": "BY", "Europe/Moscow": "RU", "Europe/Malta": "MT", "Asia/Nicosia": "CY",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Toronto": "CA",
  "America/Vancouver": "CA", "America/Montreal": "CA", "America/Sao_Paulo": "BR", "America/Argentina/Buenos_Aires": "AR",
  "America/Santiago": "CL", "America/Bogota": "CO", "America/Mexico_City": "MX", "Asia/Tokyo": "JP", "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK", "Asia/Seoul": "KR", "Asia/Singapore": "SG", "Asia/Kolkata": "IN", "Asia/Jerusalem": "IL",
  "Africa/Johannesburg": "ZA", "Pacific/Auckland": "NZ",
};
const countryOf = (tz) => (!tz ? "SE" : TZ_COUNTRY[tz] || (tz.startsWith("Australia/") ? "AU" : "?"));
const LIST_MS = 240000;                 // liveresultat's list read at most this often
const TZ_VERSION = 2;
const MAX_INFO = 30;                    // races looked up per call (subrequest limit: 50); the rest at the next call
// which races are live now (owner, 2026-10-22: « identify clearly which competitions are truly live »): each race of its own
// today has its last passings read (with liveresultat's hash: an unchanged list costs a few bytes), at most every PROBE_MS
// and MAX_PROBE a call, only when the list is asked for; a race is live while its last punch is under LIVE_S old
const PROBE_MS = 180000, MAX_PROBE = 15, LIVE_S = 1800;
// a time of day now in a race's time zone (else liveresultat's offset from Swedish time), in seconds
function localSeconds(tz, timediff) {
  const at = (zone) => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const v = (k) => p.find((x) => x.type === k)?.value;
    return { s: Number(v("hour")) * 3600 + Number(v("minute")) * 60 + Number(v("second")), day: `${v("year")}-${v("month")}-${v("day")}` };
  };
  try { if (tz) return at(tz); } catch (e) { /* an unknown zone */ }
  const x = at("Europe/Stockholm");
  return { s: (x.s + (timediff || 0) * 3600 + 86400) % 86400, day: x.day };
}

/** The races of the last 3 and next 7 days with their country: liveresultat's whole list (~1 MB, read with a regular
 *  expression: some names hold unescaped quotes that break it as JSON), each new race's time zone read once and kept. */
export class Directory extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname === "/broadcasts") return this.broadcasts(request);
    // liveresultat's list, read at most every LIST_MS; an answer without it (overloaded: « Connect failed: Too many
    // connections », sent with a 200) changes nothing — the last good list is served meanwhile, never an empty one
    const now = Date.now();
    let last = await this.ctx.storage.get("last");
    let pending = false;
    if (!last || now - last.at >= LIST_MS) {
      let s = "";
      try {
        const r = await fetch(`${api(this.env)}?method=getcompetitions`, { headers: { "User-Agent": UA } });
        s = r.ok ? await r.text() : "";
      } catch (e) { /* liveresultat unreachable */ }
      if (s.includes('"competitions"')) {
        const day = (d) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
        const lo = day(-3), hi = day(7), out = [];
        for (const x of s.matchAll(/"id": *(\d+), *"name": *"(.*?)", *"organizer": *"(.*?)", *"date": *"(\d{4}-\d\d-\d\d)", *"timediff": *(-?\d+)/g)) {
          if (x[4] >= lo && x[4] <= hi) out.push([Number(x[1]), x[2], x[3], x[4], Number(x[5])]);
        }
        // each race's time zone, asked once — kept only from a real answer (an error text is no time zone: it would
        // make a French race Swedish); TZ_VERSION 2 (2026-10-11) forgets those recorded during an overload
        let known = (await this.ctx.storage.get("tz")) || {};
        if ((await this.ctx.storage.get("tzv")) !== TZ_VERSION) {
          known = {};
          await this.ctx.storage.put("tzv", TZ_VERSION);
        }
        let asked = 0, added = false;
        for (const c of out) {
          if (!(c[0] in known) && asked < MAX_INFO) {
            asked++;
            try {
              const i = await (await fetch(`${api(this.env)}?method=getcompetitioninfo&comp=${c[0]}`, { headers: { "User-Agent": UA } })).text();
              if (/"id"\s*:/.test(i)) {
                known[c[0]] = i.match(/"timezone"\s*:\s*"([^"]*)"/)?.[1] ?? "";
                added = true;
              }
            } catch (e) { /* next time */ }
          }
          c.push(c[0] in known ? countryOf(known[c[0]]) : "?");
        }
        pending = out.some((c) => !(c[0] in known));
        // the races of their own today: their last punch, read now for the oldest checked (each at most every PROBE_MS)
        const probes = (await this.ctx.storage.get("probes")) || {};
        const today = out.filter((c) => c[3] === localSeconds(known[c[0]], c[4]).day);
        const due = today.filter((c) => now - (probes[c[0]]?.checked || 0) >= PROBE_MS)
          .sort((a, b) => (probes[a[0]]?.checked || 0) - (probes[b[0]]?.checked || 0)).slice(0, MAX_PROBE);
        for (const c of due) {
          const p = probes[c[0]] || {};
          try {
            const r = await (await fetch(`${api(this.env)}?method=getlastpassings&comp=${c[0]}&last_hash=${encodeURIComponent(p.hash || "")}`,
              { headers: { "User-Agent": UA } })).json();
            if (r.status === "OK") { p.hash = r.hash; p.last = r.passings?.[0]?.passtime || null; }
            if (r.status === "OK" || r.status === "NOT MODIFIED") p.checked = now;
          } catch (e) { /* next time */ }
          probes[c[0]] = p;
        }
        // the age of each race's last punch, in seconds (null: none known, or another day)
        for (const c of out) {
          const p = probes[c[0]], m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(p?.last || "");
          let age = null;
          if (m && today.includes(c)) {
            age = localSeconds(known[c[0]], c[4]).s - (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
            if (age < -300) age = null;                 // (a clock off, or yesterday's punches)
          }
          c.push(age);
        }
        // the record keeps today's races only
        await this.ctx.storage.put("probes", Object.fromEntries(today.filter((c) => probes[c[0]]).map((c) => [c[0], probes[c[0]]])));
        if (added) {
          // only the window's races are kept, so the record stays small
          await this.ctx.storage.put("tz", Object.fromEntries(out.filter((c) => c[0] in known).map((c) => [c[0], known[c[0]]])));
        }
        out.sort((a, b) => b[3].localeCompare(a[3]) || a[1].localeCompare(b[1]));
        // (races still without a country: read again soon)
        // (races still without a country: read again soon; while some race is live, every PROBE_MS)
        const anyLive = out.some((c) => c[6] != null && c[6] <= LIVE_S);
        last = { at: pending ? now - LIST_MS + 30000 : anyLive ? now - LIST_MS + PROBE_MS : now, comps: out, liveS: LIVE_S };
        await this.ctx.storage.put("last", last);
      } else {
        console.error(`directory: no list from liveresultat (${s.slice(0, 60)})`);
        pending = true;
      }
    }
    return new Response(JSON.stringify({ at: last?.at || now, comps: last?.comps || [], liveS: LIVE_S }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${pending || !last ? 30 : 120}` },
    });
  }

  /** The organisers' broadcasts (internal, from Ozimut): GET lists them, the newest first; POST { op: "new", name, date,
   *  organizer, key, by } opens one and answers its number; POST { op: "touch", id } records a push. */
  async broadcasts(request) {
    const all = (await this.ctx.storage.get("broadcasts")) || [];
    const out = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (request.method !== "POST") return out({ broadcasts: all });
    let b;
    try { b = await request.json(); } catch (e) { return new Response("Bad JSON", { status: 400 }); }
    if (b.op === "new") {
      const id = (await this.ctx.storage.get("bnext")) || PUSHED_FROM;
      all.unshift({ id, name: String(b.name || "").slice(0, 160), date: b.date || null, organizer: String(b.organizer || "").slice(0, 160),
        key: b.key ? String(b.key).slice(0, 40) : null, by: b.by ?? null, created: Date.now(), last: null });
      await this.ctx.storage.put({ bnext: id + 1, broadcasts: all.slice(0, 200) });
      return out({ id });
    }
    if (b.op === "touch") {
      const x = all.find((y) => y.id === Number(b.id));
      if (x) { x.last = Date.now(); await this.ctx.storage.put("broadcasts", all); }
      return out({ ok: !!x });
    }
    return new Response("Bad operation", { status: 400 });
  }
}

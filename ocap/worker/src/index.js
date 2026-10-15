// O'Cap live relay: one Durable Object per liveresultat competition, awake only while someone watches it.
//
// Each phone opens a WebSocket (one request, then nothing but the updates pushed to it) and says which class it is
// looking at. The object reads liveresultat for everyone at once — the last passings every 15 s while runners keep
// coming in (30 s when nothing moves; liveresultat caches its answers 15 s anyway), then only the classes that moved
// and that someone watches, with liveresultat's hash so an unchanged class costs a few bytes — and pushes each
// changed class to the phones watching it. Nobody left: the alarm is not set again and the object sleeps.
// The WebSocket Hibernation API keeps idle connections free; only what changed is written to storage.

import { DurableObject } from "cloudflare:workers";

const UA = "OCap-live/0.1 (+https://ocn.kerkia.com; one reader per competition, relayed to its spectators)";
const ACTIVE_MS = 15000, QUIET_MS = 30000;       // polling interval while passings keep coming / when nothing moves
const RECHECK_MS = 90000;                        // a watched class is re-read at least this often (passings list is short)
const MAX_READS = 30;                            // liveresultat reads per wake-up, at most (subrequest limit: 50)

const api = (env) => env.LR_API || "https://liveresultat.orientering.se/api.php";

// Races fed by their organiser through O'CN (« Organisation › Direct », 2026-10-15): numbers from 900 000 000 (liveresultat's
// are far below), never read from liveresultat. Their object keeps what the organiser's page sends — the classes that
// changed since its last read of the timing software's export — and pushes the changes to the pages watching, as for a
// liveresultat race. The push is internal: only O'CN reaches it, through its Durable Object binding (path /push, which
// no public route forwards: the Worker and O'Cap's Function pass on /ws/<number> WebSocket requests only).
const PUSHED_FROM = 900000000;
const isPushed = (comp) => Number(comp) >= PUSHED_FROM;
const MAX_PUT = 100;                             // keys per storage.put (the limit is 128)
async function lr(env, params) {
  const r = await fetch(`${api(env)}?${new URLSearchParams(params)}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`liveresultat ${r.status}`);
  const s = await r.text();
  try { return JSON.parse(s); } catch (e) { return JSON.parse(s.replace(/[\t\r\n]+/g, " ").replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); }
}

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
    this.m.data = s.get("data") || {};
    if (this.m.pushed) for (const [k, v] of await this.ctx.storage.list({ prefix: "c:" })) this.m.data[k.slice(2)] = v;
    return this.m;
  }

  async save(dataChanged) {
    const { data, ...head } = this.m;
    await this.ctx.storage.put(dataChanged ? { head, data } : { head });
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
        at: m.lastChange, pass: m.pass || null });
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
      await this.save(false);
    }
    if (!m.pass) {                              // a race relayed before passings were kept: read them once
      m.passHash = "";
      try { if (await this.readPassings(m)) await this.save(false); } catch (e) { /* the next wake-up */ }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // the last passings come with the hello: a page opened between two arrivals is not left empty
    this.send(server, { t: "hello", info: m.info, classes: m.classes, at: m.lastChange, pass: m.pass || null });
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
    if (!m.classes.includes(q.sub)) return this.send(ws, { t: "class", c: q.sub, missing: true });
    if (!m.data[q.sub] && !m.pushed) {
      try { if (await this.readClass(m, q.sub)) await this.save(true); } catch (e) { /* sent at the next wake-up */ }
    }
    if (m.data[q.sub]) this.send(ws, { t: "class", c: q.sub, ...m.data[q.sub] });
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch (e) { /* already closed */ }
  }

  /** An organiser's push (internal, from O'CN): { info, order: [class names, in the file's order], classes: { name:
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
      m.pass = [...arrivals.slice(-10).reverse().map(([n, k, t]) => [clock, n, k, 1000, "Arrivée", out(t)]), ...(m.pass || [])].slice(0, 10);
      m.lastChange = now;
    }
    const sockets = this.ctx.getWebSockets();
    if (infoChanged || first) for (const ws of sockets) this.send(ws, { t: "hello", info: m.info, classes: m.classes, at: m.lastChange, pass: m.pass || null });
    else if (classesChanged) for (const ws of sockets) this.send(ws, { t: "classes", classes: m.classes });
    if (arrivals.length && !first) for (const ws of sockets) this.send(ws, { t: "pass", items: m.pass, at: m.lastChange });
    for (const ws of sockets) {
      const sub = ws.deserializeAttachment()?.sub;
      if (sub != null && changed.includes(sub)) this.send(ws, { t: "class", c: sub, ...m.data[sub] });
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
    m.pass = (p.passings || []).slice(0, 10).map((x) => [x.passtime, x.runnerName, x.class, x.control, x.controlName || "", x.time]);
    return true;
  }

  /** Reads one class; true when it changed (and is then in m.data). */
  async readClass(m, name) {
    const k = await lr(this.env, { method: "getclassresults", comp: m.comp, class: name, unformattedTimes: "true", last_hash: m.hashes[name] || "" });
    m.read[name] = Date.now();
    if (k.status !== "OK") return false;
    m.hashes[name] = k.hash;
    m.data[name] = { ...compact(k), at: Date.now() };
    return true;
  }

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;                 // nobody watching: no more reads until someone comes back
    const m = await this.load();
    if (m.pushed) return;                        // an organiser's race: nothing to read, its pushes carry the news
    const watched = new Map();                   // class -> its sockets
    const everyone = [];
    for (const ws of sockets) {
      everyone.push(ws);
      const sub = ws.deserializeAttachment()?.sub;
      if (sub != null) (watched.get(sub) || watched.set(sub, []).get(sub)).push(ws);
    }
    let reads = 0, changed = false;
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
      for (const [name, socks] of watched) {
        if (reads >= MAX_READS) break;
        if (!m.classes.includes(name)) continue;
        if (!moved.has(name) && m.data[name] && Date.now() - (m.read[name] || 0) < RECHECK_MS) continue;
        reads++;
        if (await this.readClass(m, name)) {
          changed = true;
          for (const ws of socks) this.send(ws, { t: "class", c: name, ...m.data[name] });
        }
      }
    } catch (e) {
      // liveresultat slow or down: try again at the next wake-up
      console.error(`race ${m.comp}: ${e.message || e}`);
    }
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
const MAX_INFO = 40;                    // races looked up per call (subrequest limit: 50); the rest at the next call

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
        if (added) {
          // only the window's races are kept, so the record stays small
          await this.ctx.storage.put("tz", Object.fromEntries(out.filter((c) => c[0] in known).map((c) => [c[0], known[c[0]]])));
        }
        out.sort((a, b) => b[3].localeCompare(a[3]) || a[1].localeCompare(b[1]));
        // (races still without a country: read again soon)
        last = { at: pending ? now - LIST_MS + 30000 : now, comps: out };
        await this.ctx.storage.put("last", last);
      } else {
        console.error(`directory: no list from liveresultat (${s.slice(0, 60)})`);
        pending = true;
      }
    }
    return new Response(JSON.stringify({ at: last?.at || now, comps: last?.comps || [] }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${pending || !last ? 30 : 120}` },
    });
  }

  /** The organisers' broadcasts (internal, from O'CN): GET lists them, the newest first; POST { op: "new", name, date,
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

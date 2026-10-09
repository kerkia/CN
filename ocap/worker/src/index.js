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
  }

  async load() {
    if (this.m) return this.m;
    const s = await this.ctx.storage.get(["head", "data"]);
    this.m = s.get("head") || { comp: null, info: null, classes: [], classesHash: "", passHash: "", hashes: {}, read: {}, lastChange: 0, classesAt: 0 };
    this.m.data = s.get("data") || {};
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
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket expected", { status: 426 });
    const comp = new URL(request.url).pathname.split("/").filter(Boolean).pop();
    if (!/^\d{1,9}$/.test(comp)) return new Response("Bad competition", { status: 400 });
    const m = await this.load();
    m.comp = comp;
    if (!m.info) {
      try {
        m.info = await lr(this.env, { method: "getcompetitioninfo", comp });
        await this.readClasses(m);
      } catch (e) {
        return new Response("liveresultat unavailable", { status: 502 });
      }
      await this.save(false);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.send(server, { t: "hello", info: m.info, classes: m.classes, at: m.lastChange });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 2000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let q;
    try { q = JSON.parse(raw); } catch (e) { return; }
    if (typeof q.sub !== "string" || q.sub.length > 200) return;
    ws.serializeAttachment({ sub: q.sub });
    const m = await this.load();
    if (!m.classes.includes(q.sub)) return this.send(ws, { t: "class", c: q.sub, missing: true });
    if (!m.data[q.sub]) {
      try { if (await this.readClass(m, q.sub)) await this.save(true); } catch (e) { /* sent at the next wake-up */ }
    }
    if (m.data[q.sub]) this.send(ws, { t: "class", c: q.sub, ...m.data[q.sub] });
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch (e) { /* already closed */ }
  }

  async readClasses(m) {
    const k = await lr(this.env, { method: "getclasses", comp: m.comp, last_hash: m.classesHash });
    m.classesAt = Date.now();
    if (k.status !== "OK") return false;
    m.classesHash = k.hash;
    m.classes = (k.classes || []).map((c) => c.className);
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
    const watched = new Map();                   // class -> its sockets
    const everyone = [];
    for (const ws of sockets) {
      everyone.push(ws);
      const sub = ws.deserializeAttachment()?.sub;
      if (sub != null) (watched.get(sub) || watched.set(sub, []).get(sub)).push(ws);
    }
    let reads = 0, changed = false;
    try {
      const p = await lr(this.env, { method: "getlastpassings", comp: m.comp, last_hash: m.passHash });
      reads++;
      const moved = new Set();
      if (p.status === "OK") {
        if (m.passHash) m.lastChange = Date.now();       // (the first read is no news: passings may be hours old)
        m.passHash = p.hash;
        const items = (p.passings || []).slice(0, 10).map((x) => [x.passtime, x.runnerName, x.class, x.control, x.controlName || "", x.time]);
        for (const x of items) moved.add(x[2]);
        for (const ws of everyone) this.send(ws, { t: "pass", items, at: m.lastChange });
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
    }
    await this.save(changed);
    const active = Date.now() - m.lastChange < 120000;
    await this.ctx.storage.setAlarm(Date.now() + (active ? ACTIVE_MS : QUIET_MS));
  }
}

// The Worker itself: /ws/<comp> straight to the race's object (the site reaches it through its own Function, so that
// phones stay on the site's address); /list for the races of the coming and past days.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/(\d{1,9})$/);
    if (m) return env.LIVE.get(env.LIVE.idFromName(m[1])).fetch(request);
    if (url.pathname === "/list") return list(env);
    return new Response("Not found", { status: 404 });
  },
};

/** The competitions of the last 3 and next 7 days, from liveresultat's whole list (~1 MB, read with a regular
 *  expression: some names hold unescaped quotes that break it as JSON). */
export async function list(env) {
  const r = await fetch(`${api(env)}?method=getcompetitions`, { headers: { "User-Agent": UA }, cf: { cacheTtl: 300 } });
  const s = await r.text();
  const day = (d) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
  const lo = day(-3), hi = day(7), out = [];
  for (const x of s.matchAll(/"id": *(\d+), *"name": *"(.*?)", *"organizer": *"(.*?)", *"date": *"(\d{4}-\d\d-\d\d)", *"timediff": *(-?\d+)/g)) {
    if (x[4] >= lo && x[4] <= hi) out.push([Number(x[1]), x[2], x[3], x[4], Number(x[5])]);
  }
  out.sort((a, b) => b[3].localeCompare(a[3]) || a[1].localeCompare(b[1]));
  return new Response(JSON.stringify({ at: Date.now(), comps: out }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

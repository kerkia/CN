// A local stand-in for liveresultat's API (dev only): replays recorded, finished competitions as if they were running
// now, faster than real time — runners start, pass the radio controls and finish as the simulated clock moves on.
//   node ocap/dev/lr-mock.mjs <recording.json>… [--port 8790] [--speed 20]
// Recordings: { info, classes: { <class>: getclassresults answer } } (unformattedTimes=true). They hold real results:
// keep them outside the repository.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args.splice(i, 2)[1]) : d; };
const port = opt("--port", 8790), speed = opt("--speed", 20);
const comps = new Map();
for (const f of args) {
  const rec = JSON.parse(readFileSync(f, "utf8"));
  const runners = Object.values(rec.classes).flatMap((c) => c.results);
  const first = Math.min(...runners.map((r) => r.start).filter((s) => s > 0));
  comps.set(String(rec.info.id), { ...rec, first });
}
const t0 = Date.now();
// the simulated time of day, in hundredths: the first start 2 minutes in, then `speed` times faster than real time
const simNow = (c) => c.first - 12000 + ((Date.now() - t0) / 10) * speed;
const md5 = (s) => createHash("md5").update(s).digest("hex");

function classAt(c, name) {
  const k = c.classes[name], T = simNow(c);
  const rows = k.results.map((r) => {
    const fin = r.result && r.status === 0 ? r.start + Number(r.result) : r.start + Number(r.result || 0);
    const splits = {};
    let passed = 0;
    for (const sc of k.splitcontrols) {
      const v = r.splits?.[sc.code];
      if (v > 0 && r.start + v <= T) { splits[sc.code] = v; splits[`${sc.code}_status`] = 0; passed++; }
    }
    if (T < r.start) return { ...r, place: "", result: "", status: 10, timeplus: "", progress: 0, splits };
    if (T < fin || !r.result) return { ...r, place: "", result: "", status: 9, timeplus: "", progress: Math.round((100 * passed) / (k.splitcontrols.length + 1)), splits };
    return { ...r, splits: { ...r.splits }, progress: 100 };
  });
  // places and time behind among the finishers so far, at each radio control too
  const ok = rows.filter((r) => r.status === 0).sort((a, b) => a.result - b.result);
  ok.forEach((r, i) => { r.place = String(i + 1); r.timeplus = String(r.result - ok[0].result); });
  for (const sc of k.splitcontrols) {
    const at = rows.filter((r) => r.splits[sc.code] > 0).sort((a, b) => a.splits[sc.code] - b.splits[sc.code]);
    at.forEach((r, i) => { r.splits[`${sc.code}_place`] = i + 1; r.splits[`${sc.code}_timeplus`] = r.splits[sc.code] - at[0].splits[sc.code]; });
  }
  rows.sort((a, b) => (a.status === 0) - (b.status === 0) || 0);
  return { status: "OK", className: name, splitcontrols: k.splitcontrols, results: [...ok, ...rows.filter((r) => r.status !== 0)] };
}

function passings(c) {
  const T = simNow(c), out = [];
  for (const [name, k] of Object.entries(c.classes)) {
    for (const r of k.results) {
      if (r.status === 0 && r.result && r.start + Number(r.result) <= T) out.push({ at: r.start + Number(r.result), runnerName: r.name, class: name, control: 1000, time: Number(r.result) });
      for (const sc of k.splitcontrols) {
        const v = r.splits?.[sc.code];
        if (v > 0 && r.start + v <= T) out.push({ at: r.start + v, runnerName: r.name, class: name, control: sc.code, controlName: sc.name, time: v });
      }
    }
  }
  const clock = (h) => { const s = Math.floor(h / 100); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":"); };
  return out.sort((a, b) => b.at - a.at).slice(0, 3).map(({ at, ...p }) => ({ passtime: clock(at), ...p, time: clock(p.time).replace(/^00:/, "") }));
}

function answer(q) {
  const m = q.get("method"), c = comps.get(q.get("comp") || "");
  if (m === "getcompetitions") {
    const today = new Date().toISOString().slice(0, 10);
    return { competitions: [...comps.values()].map((x) => ({ ...x.info, date: today })) };
  }
  if (!c) return { status: "ERR" };
  if (m === "getcompetitioninfo") return { ...c.info, date: new Date().toISOString().slice(0, 10) };
  let body;
  if (m === "getclasses") body = { status: "OK", classes: Object.keys(c.classes).map((n) => ({ className: n })) };
  else if (m === "getclassresults") body = classAt(c, q.get("class"));
  else if (m === "getlastpassings") body = { status: "OK", passings: passings(c) };
  else return { status: "ERR" };
  const hash = md5(JSON.stringify(body));
  if (q.get("last_hash") === hash) return { status: "NOT MODIFIED" };
  return { ...body, hash };
}

createServer((req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(answer(q)));
}).listen(port, () => console.log(`liveresultat mock on http://localhost:${port}/api.php — ${[...comps.keys()].join(", ")}, x${speed}`));

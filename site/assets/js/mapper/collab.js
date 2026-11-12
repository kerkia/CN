// Several mappers on one map at once (owner, 2026-11-06). No exclusive lock: each editor says every 30 s that it is there, where
// its pointer is and the sector it keeps for itself (a rectangle of the map: the others' editors refuse to change what lies in
// it — the lock is on a part of the map, not on the whole map). Changes are merged by object: a save made on an older version
// (409) takes the teammates' version, applies on it what was changed here since the last common version (objects added, changed,
// deleted; symbols, colours and the map's settings by field), and saves that; an editor with nothing unsaved takes a teammate's
// new version as soon as it sees it. Where both changed the same object, the change made inside one's own sector wins, else the
// teammate's (said in the status). The others' sectors and pointers are drawn on the map in their colour.

import * as D from "./doc.js";
import * as S from "./store.js";
import { t, tn } from "./lang.js";

const EVERY = 30e3;
const COLOURS = ["#1565c0", "#2e7d32", "#c62828", "#6a1b9a", "#ef6c00", "#00838f", "#ad1457", "#4e342e"];
const colourOf = (uid) => COLOURS[Math.abs(Number(uid) || 0) % COLOURS.length];
const meets = (a, b) => a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const key = (o) => JSON.stringify(o, (k, v) => (k === "inst" || k === "bb" || k === "cellKeys" || k === "__rec" || k === "ord" || k === "dirty" ? undefined : v));

/** A three-way merge of map documents: base (the last common version), mine (here), theirs (the server's). */
export function merge3(base, mine, theirs, { mySector = null } = {}) {
  const out = JSON.parse(JSON.stringify(theirs)), conflicts = [];
  const idx = (d) => new Map((d.objects || []).map((o) => [o.id, o]));
  const B = idx(base), M = idx(mine), T = idx(theirs);
  const R = new Map(out.objects.map((o) => [o.id, o]));
  const box = (o) => { let b = null; for (const c of o?.coords || []) { const x = (c.x >> 8) / 100, y = (c.y >> 8) / 100; b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]; } return b; };
  const mineWins = (o) => mySector && meets(box(o), mySector);
  for (const [id, m] of M) {
    const b = B.get(id), th = T.get(id);
    if (!b) { if (!th) out.objects.push(JSON.parse(JSON.stringify(m))); continue; }          // added here
    if (key(m) === key(b)) continue;                                                       // not changed here
    if (!th) { if (mineWins(m)) { out.objects.push(JSON.parse(JSON.stringify(m))); conflicts.push(id); } continue; }   // deleted there, changed here
    if (key(th) === key(b) || mineWins(m)) { Object.assign(R.get(id), JSON.parse(JSON.stringify(m))); if (key(th) !== key(b)) conflicts.push(id); }
    else conflicts.push(id);                                                               // both changed: theirs kept
  }
  for (const [id, b] of B) {
    if (M.has(id)) continue;                                                               // deleted here
    const th = T.get(id);
    if (th && key(th) === key(b)) { const i = out.objects.indexOf(R.get(id)); if (i >= 0) out.objects.splice(i, 1); }
    else if (th) conflicts.push(id);
  }
  // symbols by number, the map's other fields as wholes: what changed here and not there
  const sB = new Map((base.symbols || []).map((s) => [s.sym, s])), sT = new Map((theirs.symbols || []).map((s) => [s.sym, s])), sM = new Map((mine.symbols || []).map((s) => [s.sym, s]));
  for (const [n, s] of sM) {
    const b = sB.get(n), th = sT.get(n);
    if (!b && !th) out.symbols.push(JSON.parse(JSON.stringify(s)));
    else if (b && th && key(s) !== key(b) && key(th) === key(b)) out.symbols[out.symbols.findIndex((x) => x.sym === n)] = JSON.parse(JSON.stringify(s));
  }
  for (const [n, b] of sB) if (!sM.has(n) && sT.has(n) && key(sT.get(n)) === key(b) && !(mine.objects || []).some((o) => o.sym === n)) out.symbols = out.symbols.filter((x) => x.sym !== n);
  for (const f of ["colors", "spots", "params", "parts", "backgrounds", "title", "scale", "printScale", "printArea", "realWorld", "declination", "standard"]) {
    if (key(mine[f]) !== key(base[f]) && key(theirs[f]) === key(base[f])) out[f] = JSON.parse(JSON.stringify(mine[f] ?? null));
  }
  out.dirty = { ...(theirs.dirty || {}), ...(mine.dirty || {}) };
  return { doc: out, conflicts };
}

export function start(E) {
  if (!E.id || E.readOnly) return;
  E.others = [];
  E.baseJSON = JSON.stringify(E.live.toJSON());
  const ownSector = (bb) => E.others.find((o) => o.sector && meets(bb, o.sector));
  const guard = () => {
    E.live.guard = (bb) => !ownSector(bb);
    E.live.guardMsg = t("map.sector.locked");
  };
  guard();
  E.onLive = guard;                       // a new Live (after a merge): guarded too
  const tick = async () => {
    if (!E.root?.isConnected) return;
    try {
      const r = await S.presence(E.id, { sector: E.mySector || null, at: E.cursor || null });
      E.others = (r.editors || []).map((o) => ({ ...o, colour: colourOf(o.uid) }));
      const names = E.others.map((o) => o.name).filter(Boolean);
      E.$("#mp-team").textContent = names.length ? tn("map.collab.others", names.length, { names: names.join(", ") }) : "";
      E.view.overlay();
      if (r.version > E.version && !E.dirty && !E.saving) await pull(E);
    } catch (e) { /* the next tick */ }
  };
  tick();
  E._collab = setInterval(tick, EVERY);
}
export function stop(E) { clearInterval(E._collab); if (E.id) S.leave(E.id).catch(() => {}); }

/** A teammate's newer version taken here (nothing unsaved, or merged with what is). */
export async function pull(E) {
  const { doc, version } = await S.loadDoc(E.id);
  // while it loaded, this editor may have saved a newer version itself: an older document never replaces it
  if (!doc || version <= E.version || E.saving) return;
  const base = JSON.parse(E.baseJSON || "{}"), mine = E.live.toJSON();
  const { doc: merged, conflicts } = E.dirty ? merge3(base, mine, doc, { mySector: E.mySector }) : { doc, conflicts: [] };
  reload(E, merged);
  E.version = version;
  E.baseJSON = JSON.stringify(doc);
  E.say(conflicts.length ? tn("map.collab.mergedConflicts", conflicts.length) : t("map.collab.pulled"));
}
/** A save refused (409): merged with the teammates' version, then saved again on it. */
export async function mergeAndSave(E) {
  const { doc: theirs, version } = await S.loadDoc(E.id);
  const base = JSON.parse(E.baseJSON || "{}"), mine = E.live.toJSON();
  const { doc: merged, conflicts } = merge3(base, mine, theirs, { mySector: E.mySector });
  reload(E, merged);
  E.version = await S.saveDoc(E.id, merged, version, merged.objects.length);
  E.baseJSON = JSON.stringify(merged);
  E.dirty = false;
  E.say(conflicts.length ? tn("map.collab.mergedConflicts", conflicts.length) : t("map.collab.merged"));
}
/** The document replaced under the editor (the view, the selection that still exists, the tool kept). */
function reload(E, doc) {
  const sel = [...E.sel];
  E.live = new D.Live(doc, { onChange: E.live.onChange });
  E.doc = E.live.doc;
  E.onLive?.();
  E.view.setLive(E.live);
  E.sel = new Set(sel.filter((id) => E.live.object(id)));
  E.selChanged?.();
}

/** « Mon secteur »: two clicks for its corners; again to give it up. */
export function sectorAct(E) {
  if (E.mySector) { E.mySector = null; E.say(t("map.sector.released")); E.view.overlay(); S.presence(E.id, { sector: null, at: E.cursor || null }).catch(() => {}); return; }
  let a = null;
  const prev = { tool: E.tool, name: E.toolName };
  E.say(t("map.sector.pick"));
  E.tool = { name: "sector", cursor: "crosshair",
    down(ev, p) {
      if (!a) { a = p; return; }
      const r = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])];
      const clash = E.others.find((o) => o.sector && meets(o.sector, r));
      E.tool = prev.tool; E.toolName = prev.name;
      if (clash) { E.say(t("map.sector.clash", { name: clash.name || "?" }), "bad"); return; }
      E.mySector = r; E.say(t("map.sector.kept")); E.view.overlay();
      S.presence(E.id, { sector: r, at: E.cursor || null }).catch(() => {});
    },
    move(ev, p) { this.cur = p; E.view.overlay(); },
    overlay(g) { if (a && this.cur) rect(g, E, [Math.min(a[0], this.cur[0]), Math.min(a[1], this.cur[1]), Math.max(a[0], this.cur[0]), Math.max(a[1], this.cur[1])], "#e65100", ""); } };
}
function rect(g, E, r, colour, label) {
  const m = E.view.matrix(), xs = [m.x(r[0], r[1]), m.x(r[2], r[3]), m.x(r[0], r[3]), m.x(r[2], r[1])], ys = [m.y(r[0], r[1]), m.y(r[2], r[3]), m.y(r[0], r[3]), m.y(r[2], r[1])];
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, d = E.view.dpr;
  g.save(); g.globalAlpha = 0.08; g.fillStyle = colour; g.fillRect(x0, y0, w, h); g.globalAlpha = 1;
  g.setLineDash([6 * d, 4 * d]); g.lineWidth = 2 * d; g.strokeStyle = colour; g.strokeRect(x0, y0, w, h); g.setLineDash([]);
  if (label) { g.font = `${12 * d}px system-ui, sans-serif`; g.fillStyle = colour; g.fillText(label, x0 + 6 * d, y0 + 16 * d); }
  g.restore();
}
/** The others' sectors and pointers, one's own sector. */
export function overlay(E, g) {
  for (const o of E.others || []) {
    if (o.sector) rect(g, E, o.sector, o.colour, t("map.sector.of", { name: o.name || "?" }));
    if (o.at) { const m = E.view.matrix(), x = m.x(...o.at), y = m.y(...o.at), d = E.view.dpr; g.fillStyle = o.colour; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 * d, y + 14 * d); g.lineTo(x + 3 * d, y + 12 * d); g.lineTo(x, y + 18 * d); g.closePath(); g.fill(); g.font = `${11 * d}px system-ui, sans-serif`; g.fillText(o.name || "", x + 12 * d, y + 22 * d); }
  }
  if (E.mySector) rect(g, E, E.mySector, "#e65100", t("map.sector.mine"));
}

export async function act(E, act) { if (act === "sector") return sectorAct(E); }

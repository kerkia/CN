// Pixel's invented terrain in the browser: a world made in a worker (games/vgenworker.js), turned into what games/vworld.js's
// loadRace returns for a package — race.json, heights, classes, vegetation, the ground's picture, rocks and cliffs, the map as
// an OCAD file (games/vgenmap.js) — so that games/virtually.js plays it as any map (mount's `load`).

import { raceOf, seedOf, TYPES } from "./vgen.js";
import { mapBytes, isomSet } from "./vgenmap.js";
import { loadPhotos } from "./vforest.js";

/** The world and its courses: { world, courses, ms }. onStep(step, share) while it is made. */
export function makeWorld(opts, onStep = () => {}) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL("./vgenworker.js", import.meta.url), { type: "module" }); }
    catch (e) { inline(opts, onStep).then(resolve, reject); return; }
    w.onmessage = (e) => {
      const m = e.data;
      if (m.step) onStep(m.step, m.f);
      else if (m.done) { w.terminate(); resolve(m.done); }
      else if (m.error) { w.terminate(); reject(new Error(m.error)); }
    };
    w.onerror = (e) => { w.terminate(); e.preventDefault?.(); inline(opts, onStep).then(resolve, reject); };
    w.postMessage({ opts });
  });
}
/** Without a module worker (an old browser): on the page's thread. */
async function inline(opts, onStep) {
  const [{ generate, CL, SPEED }, { setCourses, GEN_LEVELS }] = await Promise.all([import("./vgen.js"), import("./vcourse.js")]);
  const t0 = performance.now();
  const world = generate({ ...opts, onStep });
  onStep("courses", 0);
  const courses = setCourses({ W: world.W, H: world.H, h: world.h, cls: world.cls, classes: CL, speed: CL.map((n) => SPEED[n]), features: world.features },
    { seed: opts.seed, tries: opts.tries || 260, levels: GEN_LEVELS });
  return { world, courses, ms: Math.round(performance.now() - t0) };
}

/** What the game plays: { race, W, H, h, cls, veg, groundImg, feats, trees, photos, ocd, mapImage, town }. */
export async function packageOf({ world, courses }, { id, title = "" } = {}) {
  const race = raceOf(world, { id, courses });
  const [set, photos, groundImg] = await Promise.all([isomSet(), loadPhotos(race.biome?.textures),
    createImageBitmap(new ImageData(world.ground, world.W, world.H))]);
  return { race, W: world.W, H: world.H, h: world.h, cls: world.cls, veg: world.veg, groundImg, feats: world.feats, trees: null, photos,
    ocd: mapBytes(world, set, { title }), mapImage: null, town: null };
}

/** A signature of a world's courses (the controls' places): the « Carte du jour »'s runs carry it, so that a browser that made
 *  another world (it should not happen: the generator is deterministic) never mixes its runs with the others'. */
export const courseSig = (courses) => seedOf(JSON.stringify(courses.map((c) => c.controls.map((p) => [p.x, p.z])))).toString(16);

/** Today in Paris as YYYYMMDD (the « Carte du jour »'s key; the server checks the same day). */
export function parisDay(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}
/** The « Carte du jour »'s settings: its terrain type in turn, its seed from the day. */
export function dayOpts(key) {
  const days = Math.floor(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)) / 86400000);
  return { type: TYPES[((days % TYPES.length) + TYPES.length) % TYPES.length], seed: seedOf(`pixel-day-${key}`), size: 1200, detail: 0.5, relief: 0.5, green: 0.5, paths: 0.5 };
}

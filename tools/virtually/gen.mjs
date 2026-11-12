// A « Pixel » race on invented terrain (owner, 2026-11-12: « realistic invented forests by terrain type », playable in Training
// as Pixel's own maps): the browser's own generator (site/assets/js/games/vgen.js) and course setter (vcourse.js), run here so that
// an offline invented race and the one Training makes in the browser are the same world for the same settings. Nothing is read
// from anywhere: no map, no LiDAR, no licence question.
//   node --import ../mapper/shim.mjs gen.mjs <race> <type> <seed> [size m] [tries]     (from tools/virtually)
// then  py genpack.py <race>  (the package's pictures: h.png, cls.png, veg.png, ground.jpg, race.json, feats.json)
//       node thumb.mjs <race>  (pkg/thumb.webp, PowerShell)   and   py upload.py <race> [--remote]
// Writes DATA/<race>/gen/: world.json (race.json without the pictures, feats.json), h.f32, cls.u8, veg.u8, ground.u8; and
// DATA/<race>/pkg/map.ocd (the map, games/vgenmap.js).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generate, raceOf, CL, SPEED, TYPES } from "../../site/assets/js/games/vgen.js";
import { setCourses, GEN_LEVELS } from "../../site/assets/js/games/vcourse.js";
import { mapBytes } from "../../site/assets/js/games/vgenmap.js";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const DATA = process.env.VIRTUAL_DATA || path.join(execFileSync("py", ["-c", "import paths; print(paths.DATA_DIR)"], { cwd: path.resolve(HERE, "../.."), encoding: "utf8" }).trim(), "virtual");
const [race, type, seedS, sizeS = "1600", triesS = "1200"] = process.argv.slice(2);
if (!race || !TYPES.includes(type) || !(+seedS > 0)) { console.error(`node gen.mjs <race> <${TYPES.join("|")}> <seed> [size] [tries]`); process.exit(2); }
const seed = +seedS, size = +sizeS, t0 = performance.now();
const say = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const world = generate({ type, seed, size, onStep: (s, f) => f === 1 && say(s) });
const courses = setCourses({ W: world.W, H: world.H, h: world.h, cls: world.cls, classes: CL, speed: CL.map((n) => SPEED[n]), features: world.features },
  { seed, tries: +triesS, levels: GEN_LEVELS });
say("courses", courses.map((c) => `${c.id} ${c.controls.length - 2} / ${(c.length / 1000).toFixed(1)} km / ${c.climb} m`).join(", "));
const set = JSON.parse(readFileSync(path.resolve(HERE, "../../site/assets/js/mapper/sets/isom2017-2.json"), "utf8"));
const gen = path.join(DATA, race, "gen"), pkg = path.join(DATA, race, "pkg");
mkdirSync(gen, { recursive: true }); mkdirSync(pkg, { recursive: true });
writeFileSync(path.join(pkg, "map.ocd"), mapBytes(world, set, { title: race }));
const raceJ = raceOf(world, { id: race, courses });
writeFileSync(path.join(gen, "world.json"), JSON.stringify({ race: raceJ, feats: world.feats }));
writeFileSync(path.join(gen, "h.f32"), Buffer.from(world.h.buffer));
writeFileSync(path.join(gen, "cls.u8"), Buffer.from(world.cls.buffer));
writeFileSync(path.join(gen, "veg.u8"), Buffer.from(world.veg.buffer));
writeFileSync(path.join(gen, "ground.u8"), Buffer.from(world.ground.buffer));
say("written", gen, `${world.objects.length} map objects, ${world.feats.rocks.length} rocks`);

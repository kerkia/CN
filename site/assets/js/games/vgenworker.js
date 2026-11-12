// Pixel's invented terrain made off the page's thread (games/vgenpack.js starts it): the world (games/vgen.js) and its six courses
// (games/vcourse.js), the progress sent as it goes, the arrays handed over without a copy.
import { generate, CL, SPEED } from "./vgen.js";
import { setCourses, GEN_LEVELS } from "./vcourse.js";

self.onmessage = (e) => {
  const { opts } = e.data;
  try {
    const t0 = performance.now();
    const world = generate({ ...opts, onStep: (step, f) => self.postMessage({ step, f }) });
    self.postMessage({ step: "courses", f: 0 });
    const courses = setCourses({ W: world.W, H: world.H, h: world.h, cls: world.cls, classes: CL, speed: CL.map((n) => SPEED[n]), features: world.features },
      { seed: opts.seed, tries: opts.tries || 260, levels: GEN_LEVELS });
    self.postMessage({ done: { world, courses, ms: Math.round(performance.now() - t0) } }, [world.h.buffer, world.cls.buffer, world.veg.buffer, world.ground.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};

// The organiser's own courses for a « Virtually » event, in the map's mm (the OCAD file's own frame, as the Tracer keeps them):
// an IOF XML CourseData 3.0 / 2.0.3 or an OCAD course-setting file, else the map's own course setting.
//   node --import ../mapper/shim.mjs coursefile.mjs <map.ocd> <out.json> [courses.ocd|courses.xml]
// out.json: { courses: [{ name, controls: [{ kind: start|control|finish, code, x, y }] }] } (x, y map mm, y up), the courses
// whose every control has a position; build's courses.py turns them into the race's world frame.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readOcad } from "../../site/assets/js/tracer/vmap/ocad.js";
import { fromOcad, readIof } from "../../site/assets/js/tracer/iofin.js";

const [, , mapFile, out, extra] = process.argv;
let data = null;
if (extra && existsSync(extra)) {
  data = /\.xml$/i.test(extra) ? readIof(readFileSync(extra, "utf8")) : fromOcad(readOcad(readFileSync(extra)).map.courseSetting);
}
if (!data?.courses?.length) data = fromOcad(readOcad(readFileSync(mapFile)).map.courseSetting);
const at = new Map((data?.controls || []).map((c) => [c.code, c]));
const KIND = { start: "start", normal: "control", finish: "finish" };
const courses = [];
for (const co of data?.courses || []) {
  if (co.score) continue;                                     // score courses are not played in order: left out
  const ctl = [];
  for (const s of co.seq) {
    if (!KIND[s.kind]) continue;                               // crossing points and the like
    const c = at.get(s.code);
    if (!c || c.x == null || c.y == null) { ctl.length = 0; break; }
    ctl.push({ kind: KIND[s.kind], code: s.code.replace(/→$/, ""), x: c.x, y: c.y });
  }
  if (ctl.length >= 3 && ctl[0].kind === "start" && ctl[ctl.length - 1].kind === "finish") courses.push({ name: co.name, controls: ctl });
}
writeFileSync(out, JSON.stringify({ courses }));
console.log(`${courses.length} courses of ${data?.courses?.length || 0}:`, courses.map((c) => `${c.name} (${c.controls.length - 2})`).join(", "));

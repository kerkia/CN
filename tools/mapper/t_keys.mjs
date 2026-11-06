// The keys Cartographier builds at run time, each in the four catalogues.
import { TABS, CONTEXT, FILE } from "../../site/assets/js/mapper/ribbon.js";
const cats = {};
for (const l of ["fr", "en", "de", "es"]) cats[l] = (await import(`../../site/assets/js/i18n/mapper.${l}.js`)).default;
const keys = new Set();
const walk = (items) => { for (const it of items) { if (it.stack) walk(it.stack); else keys.add(`map.rib.${it.act.replace(/[:]/g, "_")}`); } };
for (const t of TABS) { keys.add(`map.tab.${t.id}`); for (const g of t.groups) { keys.add(`map.grp.${g.id}`); walk(g.items); } }
for (const [k, gs] of Object.entries(CONTEXT)) { keys.add(`map.ctx.${k}`); for (const g of gs) { keys.add(`map.grp.${g.id}`); walk(g.items); } }
for (const a of FILE) keys.add(`map.rib.file_${a}`);
for (const a of ["select", "vertex", "fill", "cut", "hole", "measure"]) keys.add(`map.hint.${a}`);
for (const a of ["straight", "curve", "free", "rect", "circle"]) keys.add(`map.hint.draw.${a}`);
for (const a of ["sel", "parts", "bg", "colors", "issues"]) keys.add(`map.right.${a}`);
for (const a of ["relief", "rock", "water", "vegetation", "manmade", "technical", "course", "other"]) keys.add(`map.grp.sym.${a}`);
for (const a of ["osm", "dem", "lidar", "bdtopo", "north", "layout"]) keys.add(`map.src.${a}`);
for (const a of ["smooth", "simplify", "toggleCurves", "union", "difference", "intersection"]) keys.add(`map.undo.${a}`);
for (const a of ["ortho", "plan", "osm"]) { keys.add(`map.bg.layer.${a}`); keys.add(`map.bg.credit.${a}`); }
for (const a of ["mapper", "viewer"]) keys.add(`map.team.${a}`);
let bad = 0;
for (const k of keys) for (const l of Object.keys(cats)) if (!(k in cats[l])) { console.log("missing", l, k); bad++; }
console.log(keys.size, "keys built at run time,", bad, "missing");

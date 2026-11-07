// The spot inks: read from OCAD, changed, written, read back.
import { readFileSync } from "node:fs";
import * as D from "../../site/assets/js/mapper/doc.js";
import { writeOcadDoc } from "../../site/assets/js/mapper/ocadout.js";
const src = new Uint8Array(readFileSync("C:/kerkia/Ozimut/work/Test files/deski 8 nov 26 F.ocd"));
const doc = D.fromOcad(src, "d");
console.log("spots", doc.spots.map((s) => s.name).join(", "));
const c = doc.colors.find((x) => x.spot?.length);
console.log("a colour", c.name, JSON.stringify(c.spot));
c.spot = [{ name: "PMS361_Green", pct: 0.4 }]; doc.spots[1].angle = 15; doc.dirty = { colors: true, spots: true };
const back = D.fromOcad(writeOcadDoc(new D.Live(doc).toJSON(), src, {}), "d");
console.log("back", JSON.stringify(back.colors.find((x) => x.num === c.num).spot), back.spots[1].name, back.spots[1].angle, back.colors.length, back.spots.length);

// A « Virtually » map's thumbnail (Coach › Virtually's Training tab): the club's OCAD map drawn by the site's own renderer
// (the Tracer's vmap) over the package's frame, in headless Edge, saved as pkg/thumb.webp (640 px wide). Run after build.py:
//   npm install (once, here)   node thumb.mjs <race> [width]
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const SITE = path.resolve(HERE, "../../site");
const DATA = process.env.VIRTUAL_DATA || path.join(execFileSync("py", ["-c", "import paths; print(paths.DATA_DIR)"], { cwd: path.resolve(HERE, "../.."), encoding: "utf8" }).trim(), "virtual");
const [race, width = "640"] = process.argv.slice(2);
const PKG = path.join(DATA, race, "pkg");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".woff2": "font/woff2" };
const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import { readOcad } from "/assets/js/tracer/vmap/ocad.js";
import { CanvasTarget } from "/assets/js/tracer/vmap/target.js";
import { Matrix } from "/assets/js/tracer/vmap/geom.js";
const r = await (await fetch("/pkg/race.json")).json();
const { map } = readOcad(new Uint8Array(await (await fetch("/pkg/map.ocd")).arrayBuffer()));
await map.ready;
const wmm = r.W / r.k, hmm = r.H / r.k, ppm = ${Number(width)} / wmm;
const c = document.createElement("canvas"); c.width = Math.round(wmm * ppm); c.height = Math.round(hmm * ppm);
const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
const [X0, Y1] = r.mm0;
const skip = new Set(map.symdefs.map((d) => d.id).filter((id) => { const n = parseInt(id, 10); return n >= 700 && n <= 799 && n !== 709; }));
map.draw(new CanvasTarget(g, new Matrix(ppm, 0, 0, -ppm, -X0 * ppm, Y1 * ppm)), [X0, Y1 - hmm, X0 + wmm, Y1], { minRes: 1 / ppm, hideSyms: skip });
window.out = c.toDataURL("image/webp", 0.82);
</script>`;
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(PAGE); return; }
  const file = p.startsWith("/pkg/") ? path.join(PKG, p.slice(5)) : path.join(SITE, p);
  try { const b = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--no-first-run", "--disable-extensions", "--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction("window.out", { timeout: 300000 });
const url = await page.evaluate(() => window.out);
await writeFile(path.join(PKG, "thumb.webp"), Buffer.from(url.split(",")[1], "base64"));
console.log(race, "thumb.webp", Math.round(url.length * 0.75 / 1024), "KB");
await browser.close(); server.close();

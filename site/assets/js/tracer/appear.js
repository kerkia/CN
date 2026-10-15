// The course against its map, as Purple Pen sets it (CourseAppearance, FindPurple.GetPurpleColor, MapDisplay.DrawHelper;
// BSD licence, assets/tracer/LICENSE-PurplePen.txt): the purple is the event's own, else the purple of an OCAD or Mapper map's
// colour table, else the IOF's; « layer » mode puts the lower purple (circles, lines, out-of-bounds areas) between the map's
// colours, under its black, and the rest of the course over the whole map; the map's « overprint » colours can be drawn
// blended darker, as they print. Shared by the editor's screen, the images and the PDFs.

import * as M from "./model.js";

/** The CMYK of the course's purple. */
export function coursePurple(ev, map) {
  return ev.appearance.purple || (map?.kind === "vector" && map.vmap.purple()?.cmyk) || M.PURPLE;
}
/** The purple a vector map's colour table holds, or null (none, or not a vector map). */
export const mapPurple = (map) => (map?.kind === "vector" && map.vmap.purple()?.cmyk) || null;
/** The purple's CMYK when it is not the default one (the event's own, else the map's), or null. */
export const purpleOverride = (ev, map) => ev.appearance.purple || mapPurple(map);

/** The map colour the lower purple goes just above, or null: no layering (not a vector map, or not « layer » mode). */
export function layerOf(ev, map) {
  if (ev.appearance.blend !== "layer" || map?.kind !== "vector") return null;
  const id = ev.appearance.lowerPurpleLayer;
  return map.vmap.colorById(id) ? id : map.vmap.lowerPurpleLayer()?.id ?? null;
}
/** The default colour for « layer » mode (FindPurple.FindBestLowerPurpleLayer), or null. */
export const defaultLayer = (map) => (map?.kind === "vector" ? map.vmap.lowerPurpleLayer()?.id ?? null : null);
/** The map's colours from the top down, for a choice: [[id, name]]. */
export const mapColors = (map) => (map?.kind === "vector" ? map.vmap.colors.slice().reverse().map((c) => [c.id, c.name || `Couleur ${c.id}`]) : []);

/** The items of the lower purple, drawn under the map's upper colours in « layer » mode. */
export const isLower = (it) => it.color === "lower" || it.color === "purple50";
export function splitItems(items) {
  const lower = [], rest = [];
  for (const it of items) (isLower(it) ? lower : rest).push(it);
  return [lower, rest];
}
/** The blend the course's items are drawn with: « layer » draws them opaque (Purple Pen: no overprint in that mode). */
export const itemBlend = (ev, map) => (layerOf(ev, map) != null ? "none" : ev.appearance.blend === "layer" ? "blend" : ev.appearance.blend);

/** Bring a vector map's drawing in line with the event: the layer it is cut at, its overprint effect. */
export async function syncMap(ev, map) {
  if (map?.kind !== "vector") return false;
  const layer = layerOf(ev, map), over = !!ev.appearance.ocadOverprint;
  if (layer === map.layer && over === map.overprint && (layer == null || map.images)) return false;
  await map.setOverprint(over);
  await map.setLayer(layer);
  return true;
}

/**
 * The map's part of the box [l, b, r, t] (map mm) drawn on a canvas g of W × H at pxPerMm: a PDF or vector map rendered for
 * the box, an image cut out of it. part: "all", "below" or "above" (vector maps only).
 */
export async function paintMap(g, ev, map, box, pxPerMm, W, H, part = "all") {
  if (!map) return;
  if (map.kind === "vector") g.drawImage(await map.renderRegion(box, pxPerMm, null, part), 0, 0, W, H);
  else if (part === "above") return;
  else if (map.renderRegion) g.drawImage(await map.renderRegion(box, pxPerMm), 0, 0, W, H);
  else {
    const s = map.pxW / ev.map.w;
    g.drawImage(map.image, box[0] * s, (ev.map.h - box[3]) * s, (box[2] - box[0]) * s, (box[3] - box[1]) * s, 0, 0, W, H);
  }
}
/**
 * The course over its map on a canvas (images, RouteGadget): the map, then the items, layered when the event says so.
 * draw(items, blend): draws a list of items on g.
 */
export async function paintCourse(g, ev, map, box, pxPerMm, W, H, items, draw, { withMap = true } = {}) {
  await syncMap(ev, map);
  const layer = withMap ? layerOf(ev, map) : null, blend = itemBlend(ev, map);
  if (layer == null) {
    if (withMap) await paintMap(g, ev, map, box, pxPerMm, W, H);
    draw(items, blend);
    return;
  }
  const [lower, rest] = splitItems(items);
  await paintMap(g, ev, map, box, pxPerMm, W, H, "below");
  draw(lower, "none");
  await paintMap(g, ev, map, box, pxPerMm, W, H, "above");
  draw(rest, "none");
}

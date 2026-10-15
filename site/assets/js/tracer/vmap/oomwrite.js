// OpenOrienteering Mapper map files written (.omap, .xmap; file format 9): a port of the parts of Purple Pen's OpenMapperExport
// (BSD licence, Copyright (c) 2006-2008 Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt) that a course file needs. The
// input is the course model ocadwrite.js describes. Mapper counts in 1/1000 mm with y down, angles in radians; its colours are
// listed from the top of the table (priority 0) down.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const um = (mm) => Math.round(mm * 1000);
const n = (v) => String(Math.round(v * 1e6) / 1e6);
const rad = (deg) => String(Math.round(((deg * Math.PI) / 180) * 1e10) / 1e10);
const JOIN = { bevel: 0, miter: 1, round: 2 }, CAP = { butt: 0, round: 1, square: 2 };
const CURVE = 1, CLOSE = 2, HOLE = 16;

/** A path's coordinates: [x, y, flags] in Mapper's units (a curve's start flagged, a closed part's last point too). */
function coordsOf(paths) {
  const out = [];
  paths.forEach((cmds, part) => {
    if (part > 0 && out.length) out[out.length - 1][2] |= HOLE;     // the last point of a part: the next one starts a hole
    let first = null;
    for (const c of cmds) {
      if (c[0] === "M" || c[0] === "L") { out.push([um(c[1]), -um(c[2]), 0]); if (!first) first = out[out.length - 1]; }
      else if (c[0] === "C") { out[out.length - 1][2] |= CURVE; out.push([um(c[1]), -um(c[2]), 0], [um(c[3]), -um(c[4]), 0], [um(c[5]), -um(c[6]), 0]); }
      else if (c[0] === "Z" && first) {
        const l = out[out.length - 1];
        if (l[0] !== first[0] || l[1] !== first[1]) out.push([first[0], first[1], 0]);
        out[out.length - 1][2] |= CLOSE;
      }
    }
  });
  return out;
}
function coordsXml(coords, textForm) {
  if (textForm) return `<coords count="${coords.length}">${coords.map(([x, y, f]) => `${x} ${y}${f ? ` ${f}` : ""};`).join("")}</coords>`;
  return `<coords count="${coords.length}">${coords.map(([x, y, f]) => `<coord x="${x}" y="${y}"${f ? ` flags="${f}"` : ""}/>`).join("")}</coords>`;
}

/** Write a course model as a Mapper file: { xmap } for the XML form with coordinates as elements. Returns the text. */
export function writeOom(model, { xmap = false } = {}) {
  const top = model.colors.slice().reverse();                 // priority 0 = the top of the table
  const cid = new Map(top.map((c, i) => [c.id, i]));
  const col = (id) => (id == null ? -1 : cid.get(id) ?? -1);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">'];
  out.push(`<notes>${esc(model.notes || "")}</notes>`);
  out.push(georef(model));
  out.push(`<colors count="${top.length}">${top.map((c, i) => `<color priority="${i}" name="${esc(c.name)}" c="${n(c.cmyk[0])}" m="${n(c.cmyk[1])}" y="${n(c.cmyk[2])}" k="${n(c.cmyk[3])}" opacity="1">`
    + `${c.overprint ? "" : '<spotcolors knockout="true"></spotcolors>'}<cmyk method="custom"/><rgb method="cmyk"/></color>`).join("")}</colors>`);
  out.push('<barrier version="6" required="0.6.0">');
  out.push(`<symbols count="${model.symbols.length}">`);
  model.symbols.forEach((s, id) => {
    const head = `<symbol type="${s.kind === "line" ? 2 : s.kind === "area" ? 4 : 8}" id="${id}" code="${esc(s.code)}" name="${esc(s.name)}">`;
    if (s.kind === "line") {
      out.push(`${head}<line_symbol color="${col(s.color)}" line_width="${um(s.width)}" minimum_length="0" join_style="${JOIN[s.join] ?? 1}" cap_style="${CAP[s.cap] ?? 0}" pointed_cap_length="0" start_offset="0" end_offset="0"`
        + ' dashed="false" segment_length="4000" end_length="0" show_at_least_one_symbol="false" minimum_mid_symbol_count="0" minimum_mid_symbol_count_when_closed="0" dash_length="4000"'
        + ' break_length="1000" dashes_in_group="1" in_group_break_length="500" half_outer_dashes="false" mid_symbols_per_spot="1" mid_symbol_distance="0" mid_symbol_placement="0"'
        + ' suppress_dash_symbol_at_ends="false"/></symbol>');
    } else if (s.kind === "area") {
      const h = s.hatch, pats = h ? h.angles.map((a) => `<pattern type="1" angle="${rad(a)}" line_spacing="${um(h.spacing)}" line_offset="0" offset_along_line="0" color="${col(h.color)}" line_width="${um(h.width)}"></pattern>`) : [];
      out.push(`${head}<area_symbol inner_color="${col(s.fill)}" min_area="0" patterns="${pats.length}">${pats.join("")}</area_symbol></symbol>`);
    } else {
      const f = s.font, fr = s.frame;
      out.push(`${head}<text_symbol icon_text="A"><font family="${esc(f.name)}" size="${um(f.size)}"${f.bold ? ' bold="true"' : ""}${f.italic ? ' italic="true"' : ""}/>`
        + `<text color="${col(s.color)}" line_spacing="1" paragraph_spacing="0" character_spacing="0"/>`
        + (fr ? `<framing color="${col(fr.color)}" mode="1" line_half_width="${um(fr.width)}" shadow_x_offset="0" shadow_y_offset="0"/>` : "")
        + "</text_symbol></symbol>");
    }
  });
  out.push("</symbols>");
  const objs = [];
  for (const o of model.objects) {
    const s = model.symbols[o.sym], id = o.sym;
    if (o.kind === "text") {
      const h = s.align === "center" ? 1 : s.align === "right" ? 2 : 0;
      objs.push(`<object type="4" symbol="${id}" rotation="${rad(o.angle || 0)}" h_align="${h}" v_align="0">${coordsXml([[um(o.x), -um(o.y), 0]], !xmap)}<text>${esc(o.text)}</text></object>`);
    } else {
      const c = coordsOf(o.paths);
      if (c.length < 2) continue;
      objs.push(`<object type="1" symbol="${id}">${coordsXml(c, !xmap)}${o.kind === "area" ? '<pattern rotation="0"><coord x="0" y="0"/></pattern>' : ""}</object>`);
    }
  }
  out.push(`<parts count="1" current="0"><part name="default part"><objects count="${objs.length}">`, ...objs, "</objects></part></parts>");
  const t = model.templates || [];
  out.push(`<templates count="${t.length}" first_front_template="${t.length}">${t.map((x) => `<template open="true" name="${esc(x.file)}" path="${esc(x.file)}" relpath="${esc(x.file)}">`
    + `<transformations><transformation role="active" x="${um(x.x)}" y="${-um(x.y)}" scale_x="${n(x.mmPerPx || 1)}" scale_y="${n(x.mmPerPx || 1)}" rotation="${rad(x.angle || 0)}"/></transformations></template>`).join("")}</templates>`);
  out.push("</barrier>", "</map>");
  return out.join(xmap ? "\n" : "") + "\n";
}

function georef(model) {
  const rw = model.realWorld;
  const head = `<georeferencing scale="${n(model.scale)}" grid_scale_factor="${n(rw?.gridScale || 1)}" declination="${n(rw?.on ? rw.angle || 0 : 0)}" grivation="${n(rw?.on ? rw.angle || 0 : 0)}"><ref_point x="0" y="0"/>`;
  if (!rw?.on) return `${head}<projected_crs id="Local"><ref_point x="0" y="0"/></projected_crs></georeferencing>`;
  let crs = '<projected_crs id="Local">';
  const z = Math.abs(rw.zone || 0);
  if (z > 2000 && z <= 2060) crs = `<projected_crs id="UTM"><spec language="PROJ.4">+proj=utm +datum=WGS84 +zone=${z - 2000}${rw.zone < 0 ? " +south" : ""}</spec><parameter>${z - 2000} ${rw.zone < 0 ? "S" : "N"}</parameter>`;
  else if (rw.epsg) crs = `<projected_crs id="EPSG"><spec language="PROJ.4">+init=epsg:${rw.epsg}</spec><parameter>${rw.epsg}</parameter>`;
  else if (rw.proj4) crs = `<projected_crs id="PROJ.4"><spec language="PROJ.4">${esc(rw.proj4)}</spec>`;
  return `${head}${crs}<ref_point x="${n(rw.x || 0)}" y="${n(rw.y || 0)}"/></projected_crs></georeferencing>`;
}

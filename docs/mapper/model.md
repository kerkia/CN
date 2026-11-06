# Cartographier — the map document

Cartographier (Orga › « Cartographier », route `orgMapper`, `#/orga-carto`) edits orienteering maps in the browser. Owner's
decisions of 2026-11-06: `.ozmap` is Ozimut's own format and holds everything needed to write the map back to OCAD; an OCAD
map opened, changed and saved as OCAD keeps every byte of what was not touched.

## Canonical form: OCAD's records

The document's symbols and objects are **OCAD's own records, as `tracer/vmap/ocad.js` reads them** (`readSymbol` and the
`read*Extra` functions for symbols, `readObject` for objects), always in **OCAD 9+ numbering and units**:

- Symbol numbers: `sym = number * 1000 + sub` (« 101.0 » = 101000, « 401.1 » = 401001). OCAD 6-8 files (`num * 10 + sub`)
  are renumbered on import.
- Lengths in symbols: hundredths of a millimetre (OCAD's units), as `readSymbol` leaves them (`lineWidth`, `mainLength`…).
- Coordinates: OCAD's integers — `{ x, y }` where `x >> 8` and `y >> 8` are hundredths of a mm (y up) and the low byte holds
  the point's flags (x: 1 first Bézier control, 2 second control, 4 no left line, 8 area border / main line off; y: 1 corner,
  2 first point of a hole, 4 no right line, 8 dash point). Helpers in `site/assets/js/mapper/geom.js`: `mmX(c)`, `mmY(c)`,
  `pt(xmm, ymm, flags)`.
- Angles: tenths of a degree (`ang`), counter-clockwise.
- Colours: `[{ num, name, cmyk: [c, m, y, k] (0..1), overprint }]` from the **bottom** of OCAD's colour table to its top
  (as `VMap.colors`); a symbol refers to a colour by `num`.

A record keeps where it came from: `rawAt: [pos, len]` in the source file (`source.ocd` in the `.ozmap`), and `dirty: true`
once changed. A record with `rawAt`, not dirty, written to a file of the source's version, is copied byte for byte.

### Symbol record (`doc.symbols[i]`)

Exactly the object `readSymbol` returns (fields `sym, otp, symTp, flags, extent, status, description, nColors`, then by kind:
point `elts`; line `lineColor … useSymbolFlags, prim, sec, corner, start, end`; line text `fontName … frOfY`; area
`borderSym, fillColor, hatch*, fillOn, borderOn, struct*, irr*, elts`; text `fontName … frOfY, pointSym*`; rectangle
`lineColor … fontSize`). `otp`: 1 point, 2 line (`symTp` 1 = line text), 3 area, 4 text, 5 rectangle, 6 line text, 7
rectangle. Symbol elements (`elts`, `prim`…): `{ type (1 line, 2 area, 3 circle, 4 dot), flags, color, lineWidth, diameter,
coords }`. Ozimut additions, never written to OCAD: `rawAt`, `dirty`, `set` (the symbol set it came from), `icon` (none).

### Object record (`doc.objects[i]`)

`{ id, sym, otp, ang, coords, text, col, lineWidth, diamFlags, objStr, objStrType }` as `readObject` returns them (`otp`:
1 point, 2 line, 3 area, 4 unformatted text, 5 formatted text, 6 line text, 7 rectangle; `sym` −2 graphics, −3 image
layer, −4 layout layer). Ozimut additions: `id` (unique in the document, stable), `part` (a part's id), `src` (where it
came from when generated: `"osm"`, `"dem"`, `"lidar"`, `"bdtopo"`…, with `srcId`), `draft` (true until accepted),
`rawAt`, `dirty`, `e` (the source's index entry: `objType, status, viewType, layoutFont…`, kept for writing).

## The document (`map.json`)

```json
{
  "format": "ozimut-map", "version": 1,
  "title": "Forêt de Desquinemarre",
  "ocad": { "version": 2018, "header": { … } },        // the source's version and header (null for a new map)
  "scale": 10000, "printScale": 10000, "printArea": [l, b, r, t] | null,
  "realWorld": { "x": 0, "y": 0, "angle": 0, "grid": 0, "paperGrid": 0, "on": true, "zone": 0, "epsg": 2154 },
  "declination": 1.9,                                    // degrees east, for magnetic north lines
  "standard": "ISOM2017-2" | "ISSprOM2019-2" | "ISMTBOM2022" | "ISSkiOM2019" | null,
  "colors": [ … ], "symbols": [ … ], "objects": [ … ],
  "params": [{ "type": 1039, "str": "…", "rawAt": [pos, len], "objIndex": 0 }],   // OCAD's parameter strings, kept
  "parts": [{ "id": "p1", "name": "Carte", "hidden": false, "locked": false }],
  "backgrounds": [{ "id": "b1", "name": "…", "kind": "image|pdf|tiff|gpx|map|wmts|dem", "file": "<sha-256>",
                    "placement": { … }, "opacity": 0.5, "visible": true }],
  "layoutImages": [{ "file": "<sha-256>", "type": "image/png", "x": 0, "y": 0, "u": 0.1, "v": 0.1 }]
}
```

`dirty` at the document level: `{ colors, georef, print }` — which parameter strings must be written again.

## The file (`.ozmap`)

A zip: `map.json`; `source.ocd` (the OCAD file it came from, byte for byte, when there is one); `files/<sha-256>` the
backgrounds' and images' bytes. A newer `version` is refused with a plain message.

## Modules

| Module | What |
|---|---|
| `tracer/vmap/ocad.js` | reads OCAD 6-2018; `readOcad` returns `records` (header, symbols, objects with `rawAt`, params) and `ctx`; exports `compileSymbol`, `compileObject`, `makeContext` |
| `mapper/doc.js` | the document: from OCAD, from a symbol set, from Mapper; compiles records into a `VMap`; edits with undo |
| `mapper/ocadout.js` | writes the document as OCAD 9-12 / 2018, carrying untouched records through |
| `mapper/fromomap.js`, `mapper/toomap.js` | Mapper's `.omap`/`.xmap` to OCAD's records, and back |
| `mapper/sets/*.json` | symbol sets authored from the IOF specifications as OCAD records |
| `mapper/data/*.js` | open data as objects: contours from a terrain model, OpenStreetMap, LiDAR results |
| `mapper/view.js`, `mapper/editor.js`, `mapper/tools.js`, `mapper/ribbon*.js` | the page |
| `functions/api/mapper/[[path]].js` | storage in R2 (`mapper/<id>/…`), team, lock, versions |

Node tests: `node --import ./tools/mapper/shim.mjs tools/mapper/<test>.mjs` (the i18n modules stubbed, `DOMParser` from
xmldom: `npm install` in `tools/mapper`).

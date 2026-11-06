// Run with: node --import ./tools/mapper/shim.mjs <test.mjs>  — registers the i18n stub and a DOMParser (xmldom) for oom.js.
import { register } from "node:module";
register("./shim-hooks.mjs", import.meta.url);
try {
  const { DOMParser } = await import("@xmldom/xmldom");
  globalThis.DOMParser ??= DOMParser;
} catch (e) { /* npm install in tools/mapper for Mapper files */ }

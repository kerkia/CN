// Node test shim for the site's browser modules (local tests of Cartographier): the i18n modules become a stub (t returns the key),
// so that tracer/vmap/*.js and mapper/*.js run in Node. Used by tools/mapper/shim.mjs through module.register.
const STUB = new URL("./stub-i18n.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (/(^|\/)(lang|i18n)\.js$/.test(spec) && ctx.parentURL && /\/site\/assets\/js\//.test(ctx.parentURL)) return { url: STUB, shortCircuit: true };
  return next(spec, ctx);
}

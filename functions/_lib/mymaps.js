// « Mes cartes »' storage keys, shared by /api/mymaps, the administrators' collection (api/admin/maplib) and the account's
// deletion. R2 (cn-state):
//   mymaps-o/<user>/<map>          the map as it came (since 2026-11-06; before, mymaps/<user>/<map>/map, still read): the
//                                  originals apart, under a prefix of their own, so that an R2 lifecycle rule can move them to
//                                  Infrequent Access (« Transition to Infrequent Access » after 30 days, prefix mymaps-o/) once
//                                  the bucket nears its free 10 GB — they are read only to zoom in closely, print, export or
//                                  replay; not set up yet (owner, 2026-11-06: « prepare the structure for when it is needed »)
//   mymaps/<user>/<map>/view       its viewing copy (2 560 px at most, WebP or JPEG, made by the browser): what the map's page
//                                  draws, so that a 15 MB scan is not read at each visit; …/thumb  its thumbnail
//   mymaps/<user>/<map>/runs/<run>.json
export const key = (uid, map, rest) => `mymaps/${uid}/${map}/${rest}`;
export const origKey = (uid, map) => `mymaps-o/${uid}/${map}`;
/** The original: under its own prefix, else where it was kept before 2026-11-06. */
export async function getOrig(env, uid, map) {
  return (await env.BUCKET.get(origKey(uid, map))) || env.BUCKET.get(key(uid, map, "map"));
}
/** The quota of an account's library (originals and runs; the viewing copies and thumbnails are Ozimut's), in bytes. */
export const quota = (env) => Math.max(1, Number(env.MYMAPS_QUOTA_MB) || 1024) * 1024 * 1024;
/** What an account's library holds, in bytes. */
export async function used(env, uid) {
  const [a, b] = await env.DB.batch([env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM mymaps WHERE user_id = ?").bind(uid),
    env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM mymap_runs WHERE user_id = ?").bind(uid)]);
  return (a.results[0]?.n || 0) + (b.results[0]?.n || 0);
}

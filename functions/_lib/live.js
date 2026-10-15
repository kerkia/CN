// The live server's register of the organisers' broadcasts (« Organisation › Direct »): the Durable Object « Directory » of
// ocap/worker, bound to O'CN as LIVE_DIR and reached at an internal path that no public route forwards.

export const liveDir = (env) => env.LIVE_DIR.get(env.LIVE_DIR.idFromName("directory"));

/** The broadcasts as the live server keeps them (with each one's opener, `by`), the newest first. */
export async function broadcasts(env) {
  const r = await liveDir(env).fetch("https://ocap-live/broadcasts");
  return (await r.json()).broadcasts || [];
}

// The live relay's register of the organisers' broadcasts (« Organisation › Direct »): the Durable Object « Directory » of
// O'CN's live relay (live/, Worker « ocn-live »; O'Cap's « ocap-live » until 2026-10-18), bound to O'CN as LIVE_DIR and reached
// at an internal path that no public route forwards. The same object gives liveresultat's list (api/live/list.js).

export const liveDir = (env) => env.LIVE_DIR.get(env.LIVE_DIR.idFromName("directory"));

/** The broadcasts as the live server keeps them (with each one's opener, `by`), the newest first. */
export async function broadcasts(env) {
  const r = await liveDir(env).fetch("https://ocn-live/broadcasts");
  return (await r.json()).broadcasts || [];
}

// Seeded random numbers for the games: a puzzle is rebuilt from its seed (mulberry32).

/** A generator of numbers in [0, 1) from `seed`. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A fresh seed. */
export const newSeed = () => (Math.random() * 4294967296) >>> 0;
/** An integer in [a, b]. */
export const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
/** A number in [a, b). */
export const range = (r, a, b) => a + r() * (b - a);
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
/** A shuffled copy. */
export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** A deterministic hash of integer coordinates (trees, stones scattered the same way each draw). */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

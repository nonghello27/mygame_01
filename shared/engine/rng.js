// Seeded PRNG for battle resolution (engine v2 onward). Every random outcome
// in the engine — damage rolls, crits, status chances, tie-breaks, random
// targeting — must flow through ONE rng created from the match's stored seed,
// so the same state + seed always reproduces the same event log (auditable,
// replayable, testable). Never use Math.random() in shared/ or server code
// that affects an outcome.
//
// mulberry32: tiny, fast, good-enough distribution for game rolls.

/** Raw generator: returns a function yielding floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Game-facing wrapper around mulberry32.
 * @param {number} seed 32-bit integer (store it with the match)
 */
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    /** Float in [0, 1). */
    next,
    /** Integer in [min, max], inclusive both ends (e.g. an ATK min–max roll). */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** True `pct` percent of the time (0–100). */
    chance(pct) {
      return next() * 100 < pct;
    },
    /** Uniform pick from a non-empty array (e.g. random-enemy targeting). */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
  };
}

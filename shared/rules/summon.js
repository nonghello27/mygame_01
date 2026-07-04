// Weighted-random monster draw for the Summon Hall (Phase 7.4 step A). Pure
// — no DB, no I/O — so server/services/summon.js can call it against a
// banner's pool and the client could import the same module to preview odds
// without re-deriving the formula (CLAUDE.md §1: one source of truth for
// numbers a player sees).
//
// Determinism (CLAUDE.md §1.6): same pool + same seed always returns the
// same speciesId. The CALLER decides the seed — server/services/summon.js
// mints one with Math.floor(Math.random() * 0x7fffffff), the same way match
// creation does, and stores it in the summons audit row so any pull can be
// replayed.

import { makeRng } from "../engine/rng.js";

/**
 * Draw ONE speciesId from a weighted pool, using exactly one rng roll.
 * @param {{speciesId:string, weight:number}[]} pool non-empty, weight >= 1
 * @param {number} seed 32-bit integer
 * @returns {string} the picked speciesId
 */
export function rollSummon(pool, seed) {
  const rng = makeRng(seed);
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = rng.next() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry.speciesId;
  }
  // Floating-point guard: a roll that lands exactly on the total (or a
  // rounding hair past it) falls through to the last entry instead of
  // returning undefined.
  return pool[pool.length - 1].speciesId;
}

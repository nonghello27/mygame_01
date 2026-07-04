// Adventure map generation + loot rolls (Phase 7.4 step B, foundations).
// Pure — no DB, no I/O — so the server can call these against a frozen
// adventure_defs.config + a minted seed, and the client could import the
// same module to preview a route without re-deriving the formula
// (CLAUDE.md §1: one source of truth for numbers a player sees).
//
// Determinism (CLAUDE.md §1.6): same config + same seed always returns the
// same map; same table + same rng state always returns the same loot roll.
// The CALLER (server/services/adventure.js, a follow-up task) mints the
// session seed the same way match creation and Summon Hall pulls do
// (Math.floor(Math.random() * 0x7fffffff)) and stores it on the
// adventure_sessions row, so any run's map AND every node's rolls are
// replayable from that one stored seed.

import { makeRng, mulberry32 } from "../engine/rng.js";

/**
 * Weighted pick of one row from a list of `{weight, ...}` objects, using
 * exactly one rng roll. Kept local (not imported from shared/rules/summon.js)
 * so this module stays self-contained, matching the existing rules modules'
 * one-file-one-concern style.
 * @param {{weight:number}[]} rows non-empty, weight >= 1
 * @param {{next:() => number}} rng
 */
function weightedPick(rows, rng) {
  const total = rows.reduce((sum, r) => sum + r.weight, 0);
  let roll = rng.next() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  // Floating-point guard: a roll that lands exactly on the total (or a
  // rounding hair past it) falls through to the last row instead of
  // returning undefined.
  return rows[rows.length - 1];
}

/**
 * Generate a run's map: `config.steps` steps, each offering `config.choices`
 * options, each option a weighted pick of a node type from `config.nodes` —
 * EXCEPT the final step, whose every option is forced to "battle" (the exit
 * guard: a full run always ends in a fight, so a route can never be
 * completed by only ever picking chest/gather nodes).
 *
 * ONE rng stream (makeRng(seed)) is consumed for the whole map, in a fixed
 * documented order: step 0's option 0, step 0's option 1, ..., step 1's
 * option 0, and so on — one roll per non-final-step option, zero rolls for
 * final-step options (their type is fixed, not rolled). Same config + seed
 * therefore always produces an identical map.
 *
 * @param {{steps:number, choices:number, nodes:{type:string, weight:number}[]}} config
 * @param {number} seed 32-bit integer
 * @returns {{steps:{options:{type:string}[]}[]}}
 */
export function generateMap(config, seed) {
  const rng = makeRng(seed);
  const steps = [];
  for (let i = 0; i < config.steps; i++) {
    const isFinal = i === config.steps - 1;
    const options = [];
    for (let j = 0; j < config.choices; j++) {
      const type = isFinal ? "battle" : weightedPick(config.nodes, rng).type;
      options.push({ type });
    }
    steps.push({ options });
  }
  return { steps };
}

/**
 * Derive the per-node seed used for that node's own rolls (a battle node's
 * fight seed, a chest/gather node's loot roll, a battle node's post-win
 * catch roll). Advances a FRESH mulberry32 stream — seeded from the
 * session's stored seed XORed with a position-dependent constant — exactly
 * once, and scales the result into the 32-bit range every other seed in this
 * codebase is stored as.
 *
 * WHY a fresh stream per node instead of continuing to draw from the map's
 * rng: every roll of the whole run must be auditable from the ONE stored
 * session seed + the node's position alone, with NO cross-node correlation
 * (drawing node N's roll wouldn't perturb node N+1's roll, and a node can be
 * re-derived in isolation without replaying every node before it — useful
 * for a follow-up task's abandoned-session cleanup or a future "peek at node
 * N" read).
 *
 * @param {number} seed the session's stored seed
 * @param {number} position the step index (0-based) of the node
 * @returns {number} a 32-bit integer in [0, 0x7fffffff)
 */
export function deriveNodeSeed(seed, position) {
  const mixed = (seed ^ Math.imul(position + 1, 0x9e3779b9)) >>> 0;
  const next = mulberry32(mixed);
  return Math.floor(next() * 0x7fffffff);
}

/**
 * Weighted pick of one loot/gather table row, then a uniform qty roll within
 * that row's [qtyMin, qtyMax]. Takes an already-made rng (built by the
 * caller from deriveNodeSeed) rather than a raw seed, so one node can roll
 * this multiple times off the same seeded stream (e.g. a chest that grants
 * more than one stack).
 * @param {{itemId:string, weight:number, qtyMin:number, qtyMax:number}[]} table
 * @param {ReturnType<typeof makeRng>} rng
 * @returns {{itemId:string, qty:number}}
 */
export function rollLoot(table, rng) {
  const row = weightedPick(table, rng);
  return { itemId: row.itemId, qty: rng.int(row.qtyMin, row.qtyMax) };
}

/**
 * Draw `n` speciesIds from a weighted encounter table, WITH replacement — one
 * rng roll per draw (server/services/adventure.js's battle-node resolver
 * calls this with n = PARTY_SIZE to build the wild team, using the SAME
 * node-seeded rng deriveNodeSeed() produced, continuing the same accounting
 * style as rollLoot: one call, one roll, per pick). Takes an already-made rng
 * (built by the caller from deriveNodeSeed), same contract as rollLoot.
 * @param {{speciesId:string, weight:number}[]} encounters non-empty, weight >= 1
 * @param {ReturnType<typeof makeRng>} rng
 * @param {number} n how many to draw
 * @returns {string[]} n speciesIds, duplicates allowed
 */
export function rollEncounter(encounters, rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(weightedPick(encounters, rng).speciesId);
  return out;
}

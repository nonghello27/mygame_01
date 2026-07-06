// Pure, seeded single-elimination bracket math (Phase 9.1 — tournaments &
// GVG share this verbatim, per docs/ROADMAP.md's Phase 9 cross-cutting
// rules). No DB, no I/O, no Math.random — every random choice (the seed
// shuffle, and the tie-break draw placements() uses to order same-round
// eliminations) flows through makeRng(seed), same determinism contract as
// shared/rules/summon.js's rollSummon / adventure.js's generateMap: same
// entrantIds + same seed ALWAYS produce the identical bracket object,
// identical round-by-round pairings, and identical placements. The caller
// (server/services/tournaments.js, a follow-up phase) mints the seed the
// same way match creation / Summon Hall pulls do and stores it on the
// event's own row, so a bracket can be re-derived and audited forever.
//
// --- bracket shape (persisted as JSONB by 9.2/9.3, re-hydrated to resume
//     resolution — every field below must stay plain-JSON-serializable) ---
//
//   {
//     seed: number,          // the 32-bit seed this bracket was built from
//     entrants: string[],    // the ORIGINAL entrant ids, unpadded, in the
//                            // order the caller passed them (not shuffled)
//     size: number,          // entrants.length padded up to the next power
//                            // of two — the bracket's fixed slot count
//     rounds: Round[],       // rounds[0] is the first real round (byes
//                            // already resolved); rounds[rounds.length-1]
//                            // is the final once it exists
//     thirdPlace: Pairing|null, // the 3rd-place decider, created the
//                            // instant the semifinal round (the round with
//                            // exactly 2 pairings) completes; stays null
//                            // for a 2-entrant field, which has no semis
//   }
//
//   Round = { pairings: Pairing[] }
//
//   Pairing = {
//     a: string|null,        // an entrant id, or null = "bye" (no opponent)
//     b: string|null,
//     winner: string|null,   // null until decided; a bye pairing is
//                            // decided immediately (winner = the non-null
//                            // side) the moment it's created
//     loser: string|null,    // null until decided; STAYS null for a bye
//                            // pairing forever — there is no real loser
//   }
//
// A pairing with one null side is a "bye": the real entrant auto-advances
// with no game played, exactly as generateBracket() creates it (never as
// the OUTPUT of nextRound() past round 0 — see the padding note below).
//
// --- padding / bye placement -------------------------------------------
//
// entrants.length is padded up to `size` (the next power of two) with
// `size - entrants.length` byes. Because a padded field always has MORE
// real entrants than half its size (size/2 < entrants.length <= size,
// otherwise `size` wouldn't be the NEXT power of two), the byes always fit
// one-per-pairing: round 0 is built by walking size/2 pairing slots, always
// filling the "a" side with a real (shuffled) entrant, then filling the "b"
// side with a bye until the bye budget runs out, after which "b" also gets
// real entrants. This guarantees no pairing ever gets two nulls, and every
// bye lives in round 0 — a real entrant that wins a bye is a normal winner
// from then on, so rounds 1+ never contain another null.
//
// --- the 3rd-place decider ------------------------------------------------
//
// Single elimination has exactly one round with 2 pairings — the
// semifinal — whichever round that is for this bracket's size (round 0
// itself for a 3-4 entrant field, a later round for bigger fields).
// nextRound() detects that round completing and builds `thirdPlace` from
// its two pairings' losers. If one of those "losers" is null (only
// possible for a 3-entrant field, where round 0 doubles as the semifinal
// and one semifinal pairing was itself a bye), the decider auto-resolves
// the same way a bye pairing does: the lone real loser takes 3rd outright,
// and there is no 4th (there were only 3 entrants total). Otherwise both
// sides are real and the caller must resolve it explicitly via
// resolveThirdPlace() once that match is played.
//
// --- placements ------------------------------------------------------------
//
// placements(bracket) assigns EVERY real entrant a distinct final rank
// 1..N (N = entrants.length), no gaps, no ties:
//   1 = the final's winner (champion)
//   2 = the final's loser
//   3 = the 3rd-place decider's winner (if a decider exists)
//   4 = the 3rd-place decider's loser (if it has one — see above)
//   5.. = everyone else, grouped by the round they were eliminated in,
//         LATER rounds ranking BETTER (a quarterfinal loser outranks a
//         round-of-16 loser); entrants tied within the same round (i.e.
//         eliminated in the same round) are ordered by a seeded
//         deterministic draw — derived from the bracket's own stored seed
//         plus that round's index, so the same bracket always produces the
//         same tie order, and a different bracket seed can (but need not)
//         produce a different one.
//
// placements() requires the bracket to be fully resolved: the final round
// must have a winner, and thirdPlace (if it exists and both its sides are
// real) must be resolved too.

import { makeRng } from "../engine/rng.js";

/** Fisher–Yates on a copy, using the given seeded rng — never Math.random. */
function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Smallest power of two >= n (n >= 1). */
function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Build one pairing from two slots (either may be null = bye). A bye
 * pairing resolves its winner immediately; a real-vs-real pairing waits.
 */
function makePairing(a, b) {
  if (a == null && b == null) throw new Error("bracket: a pairing cannot have two byes");
  if (a == null) return { a, b, winner: b, loser: null };
  if (b == null) return { a, b, winner: a, loser: null };
  return { a, b, winner: null, loser: null };
}

/**
 * Build the 3rd-place decider from the semifinal round's two losers. Mirrors
 * makePairing's bye handling: if one semifinal pairing had no real loser
 * (it was itself a bye — only possible in a 3-entrant field), the lone real
 * loser is declared 3rd immediately and there is no 4th place.
 */
function makeThirdPlace(loserA, loserB) {
  if (loserA == null && loserB == null) return null; // degenerate: no real 3rd-place candidate at all
  if (loserA == null) return { a: loserA, b: loserB, winner: loserB, loser: null };
  if (loserB == null) return { a: loserA, b: loserB, winner: loserA, loser: null };
  return { a: loserA, b: loserB, winner: null, loser: null };
}

/**
 * Seed the tie-break draw for one round's simultaneously-eliminated
 * entrants: mixes the bracket's stored seed with the round index (same
 * "XOR with a position-dependent constant" style as
 * shared/rules/adventure.js's deriveNodeSeed) so every round's tie order is
 * independently derived, replayable, and doesn't correlate across rounds.
 */
function deriveTierSeed(seed, roundIndex) {
  return (seed ^ Math.imul(roundIndex + 1, 0x9e3779b9)) >>> 0;
}

/**
 * Seeded single-elimination bracket generation: shuffle entrantIds, pad to
 * the next power of two with byes, pair into round 0. Byes auto-advance
 * (see the header's padding note) — no separate "resolve the byes" step is
 * needed before calling nextRound() on round 0.
 * @param {string[]} entrantIds at least 2, no duplicates expected (the
 *   caller — the registration flow — is the source of truth for that)
 * @param {number} seed 32-bit integer
 * @returns {object} a bracket (see the header for the full shape)
 */
export function generateBracket(entrantIds, seed) {
  if (!Array.isArray(entrantIds) || entrantIds.length < 2) {
    throw new Error("generateBracket needs at least 2 entrants");
  }
  const rng = makeRng(seed);
  const shuffled = shuffle(entrantIds, rng);
  const size = nextPowerOfTwo(shuffled.length);
  let byesLeft = size - shuffled.length;

  const padded = [];
  let idx = 0;
  for (let i = 0; i < size / 2; i++) {
    padded.push(shuffled[idx++]); // "a" slot: always a real entrant (size/2 <= entrants.length)
    if (byesLeft > 0) {
      padded.push(null); // "b" slot: a bye, until the bye budget is spent
      byesLeft--;
    } else {
      padded.push(shuffled[idx++]); // "b" slot: real once byes run out
    }
  }

  const pairings = [];
  for (let i = 0; i < padded.length; i += 2) pairings.push(makePairing(padded[i], padded[i + 1]));

  return {
    seed,
    entrants: [...entrantIds],
    size,
    rounds: [{ pairings }],
    thirdPlace: null,
  };
}

/** Deep-copy a bracket's rounds so nextRound() never mutates its input. */
function cloneRounds(rounds) {
  return rounds.map((r) => ({ pairings: r.pairings.map((p) => ({ ...p })) }));
}

/**
 * Feed a round's results in and get the next round appended. `results` is an
 * array aligned with the CURRENT (last) round's pairings — one winner id per
 * pairing; entries for pairings already decided by a bye are ignored (pass
 * null/undefined there). When the round being completed is the semifinal
 * (exactly 2 pairings), this ALSO builds `thirdPlace` from its two losers
 * (see the header). Throws if any non-bye pairing's supplied winner isn't
 * one of its two entrants, or if the bracket has no round left to advance
 * (the final is already decided).
 * @param {object} bracket
 * @param {(string|null|undefined)[]} results
 * @returns {object} a NEW bracket object (pure — the input is never mutated)
 */
export function nextRound(bracket, results) {
  const rounds = cloneRounds(bracket.rounds);
  const current = rounds[rounds.length - 1];
  if (current.pairings.length === 1 && current.pairings[0].winner != null) {
    throw new Error("bracket already has a champion — nothing left to advance");
  }

  current.pairings.forEach((p, i) => {
    if (p.winner != null) return; // already decided by a bye
    const winner = results ? results[i] : undefined;
    if (winner !== p.a && winner !== p.b) {
      throw new Error(`pairing ${i}: winner must be one of "${p.a}" or "${p.b}", got "${winner}"`);
    }
    p.winner = winner;
    p.loser = winner === p.a ? p.b : p.a;
  });

  let thirdPlace = bracket.thirdPlace;
  if (current.pairings.length === 2) {
    thirdPlace = makeThirdPlace(current.pairings[0].loser, current.pairings[1].loser);
  }

  const winners = current.pairings.map((p) => p.winner);
  if (winners.length >= 2) {
    const nextPairings = [];
    for (let i = 0; i < winners.length; i += 2) nextPairings.push(makePairing(winners[i], winners[i + 1]));
    rounds.push({ pairings: nextPairings });
  }
  // winners.length === 1 means `current` WAS the final — nothing more to add.

  return { ...bracket, rounds, thirdPlace };
}

/**
 * Resolve the 3rd-place decider once it's been played (a no-op required
 * only when both its sides are real — see the header's bye edge case,
 * which resolves it automatically at creation time instead).
 * @param {object} bracket
 * @param {string} winnerId must be one of thirdPlace.a / thirdPlace.b
 * @returns {object} a NEW bracket object
 */
export function resolveThirdPlace(bracket, winnerId) {
  if (!bracket.thirdPlace) throw new Error("this bracket has no 3rd-place decider");
  const { a, b, winner } = bracket.thirdPlace;
  if (winner != null) throw new Error("the 3rd-place decider is already resolved");
  if (winnerId !== a && winnerId !== b) {
    throw new Error(`3rd-place winner must be one of "${a}" or "${b}", got "${winnerId}"`);
  }
  const loser = winnerId === a ? b : a;
  return { ...bracket, thirdPlace: { a, b, winner: winnerId, loser } };
}

/**
 * Assign every real entrant a final rank 1..N (see the header for the exact
 * rule). Requires a fully resolved bracket: the final decided, and
 * thirdPlace (if it exists and isn't a bye-auto-resolve) decided too.
 * @param {object} bracket
 * @returns {{entrantId:string, rank:number}[]} ordered by rank ascending
 */
export function placements(bracket) {
  const { rounds, thirdPlace, seed } = bracket;
  const finalRound = rounds[rounds.length - 1];
  const finalPairing = finalRound.pairings[0];
  if (finalRound.pairings.length !== 1 || finalPairing.winner == null) {
    throw new Error("placements() needs a fully resolved bracket (no champion decided yet)");
  }
  if (thirdPlace && thirdPlace.a != null && thirdPlace.b != null && thirdPlace.winner == null) {
    throw new Error("placements() needs the 3rd-place decider resolved first");
  }

  const ranked = [
    { entrantId: finalPairing.winner, rank: 1 },
    { entrantId: finalPairing.loser, rank: 2 },
  ];
  let nextRank = 3;

  if (thirdPlace && thirdPlace.winner != null) {
    ranked.push({ entrantId: thirdPlace.winner, rank: nextRank++ });
    if (thirdPlace.loser != null) ranked.push({ entrantId: thirdPlace.loser, rank: nextRank++ });
  }

  // The semifinal round's losers are already accounted for via thirdPlace
  // above — skip it here so they're never ranked twice.
  const semiIndex = thirdPlace ? rounds.length - 2 : -1;
  for (let r = rounds.length - 2; r >= 0; r--) {
    if (r === semiIndex) continue;
    const losers = rounds[r].pairings.map((p) => p.loser).filter((id) => id != null).sort();
    if (losers.length === 0) continue;
    const order = shuffle(losers, makeRng(deriveTierSeed(seed, r)));
    for (const id of order) ranked.push({ entrantId: id, rank: nextRank++ });
  }

  return ranked;
}

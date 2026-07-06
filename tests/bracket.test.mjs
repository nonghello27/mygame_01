// Bracket math checks (Phase 9.1) — the same determinism bar as
// tests/summons.test.mjs / tests/adventures.test.mjs's rule-module checks:
// same entrants + seed must always reproduce the identical bracket,
// pairings, and placements (CLAUDE.md §1.6). Pure, no DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBracket, nextRound, resolveThirdPlace, placements } from "../shared/rules/bracket.js";

function entrants(n) {
  return Array.from({ length: n }, (_, i) => `t${i}`);
}

/** Plays a whole single-elimination bracket to completion, always crowning
 *  the LOWER-indexed entrant (by original ids' natural string order) as the
 *  winner of any real pairing — deterministic so the win path itself never
 *  introduces test-run randomness. Returns the fully-resolved bracket. */
function playOut(bracket) {
  let b = bracket;
  // Advance every round (including the final) until there's nothing left.
  for (;;) {
    const current = b.rounds[b.rounds.length - 1];
    const allDecided = current.pairings.every((p) => p.winner != null);
    if (!allDecided) {
      const results = current.pairings.map((p) => {
        if (p.winner != null) return p.winner; // bye, ignored by nextRound anyway
        return p.a < p.b ? p.a : p.b;
      });
      b = nextRound(b, results);
      continue;
    }
    // Current round fully decided. If it's the final (1 pairing), we're done
    // advancing rounds — just also resolve the 3rd-place decider if pending.
    if (current.pairings.length === 1) break;
  }
  if (b.thirdPlace && b.thirdPlace.winner == null) {
    const { a, b: bb } = b.thirdPlace;
    b = resolveThirdPlace(b, a < bb ? a : bb);
  }
  return b;
}

test("generateBracket is deterministic: same entrants + seed always reproduces the same bracket", () => {
  for (const n of [2, 3, 5, 8, 16]) {
    for (const seed of [1, 42, 12345]) {
      const first = generateBracket(entrants(n), seed);
      const second = generateBracket(entrants(n), seed);
      assert.deepEqual(second, first, `n=${n} seed=${seed} must reproduce identically`);
    }
  }
});

test("a different seed usually produces a different pairing order", () => {
  const a = generateBracket(entrants(8), 1);
  const b = generateBracket(entrants(8), 2);
  assert.notDeepEqual(a.rounds[0].pairings, b.rounds[0].pairings);
});

test("bye math at size 2: no padding, one round, final only, no semis", () => {
  const b = generateBracket(entrants(2), 7);
  assert.equal(b.size, 2);
  assert.equal(b.rounds.length, 1);
  assert.equal(b.rounds[0].pairings.length, 1);
  // 2 entrants pad to size 2 with zero byes needed — both sides are real.
  assert.notEqual(b.rounds[0].pairings[0].a, null);
  assert.notEqual(b.rounds[0].pairings[0].b, null);
  const resolved = playOut(b);
  assert.equal(resolved.thirdPlace, null, "a 2-entrant field never gets a 3rd-place decider");
  const ranks = placements(resolved);
  assert.equal(ranks.length, 2);
  assert.deepEqual(ranks.map((r) => r.rank), [1, 2]);
});

test("bye math at size 3: one bye, byes auto-advance, no null ever wins a real pairing", () => {
  const b = generateBracket(entrants(3), 11);
  assert.equal(b.size, 4);
  const round0 = b.rounds[0];
  assert.equal(round0.pairings.length, 2);
  const byePairings = round0.pairings.filter((p) => p.a === null || p.b === null);
  assert.equal(byePairings.length, 1, "exactly one bye pairing");
  for (const p of round0.pairings) {
    if (p.a === null || p.b === null) {
      assert.notEqual(p.winner, null, "a bye pairing auto-decides its winner immediately");
      assert.equal(p.loser, null, "a bye pairing never has a real loser");
    } else {
      assert.equal(p.winner, null, "a real pairing waits for a result");
    }
  }
  const resolved = playOut(b);
  const ranks = placements(resolved);
  assert.equal(ranks.length, 3, "exactly the 3 real entrants get ranked");
  assert.deepEqual(ranks.map((r) => r.rank).sort((x, y) => x - y), [1, 2, 3]);
  assert.equal(new Set(ranks.map((r) => r.entrantId)).size, 3, "no duplicate entrant in placements");
});

test("bye math at size 5: byes fit one-per-pairing, never two nulls in one pairing", () => {
  const b = generateBracket(entrants(5), 99);
  assert.equal(b.size, 8);
  for (const round of b.rounds) {
    for (const p of round.pairings) {
      assert.ok(!(p.a === null && p.b === null), "no pairing may have two byes");
    }
  }
  const resolved = playOut(b);
  const ranks = placements(resolved);
  assert.equal(ranks.length, 5);
  assert.deepEqual(ranks.map((r) => r.rank).sort((x, y) => x - y), [1, 2, 3, 4, 5]);
  assert.equal(new Set(ranks.map((r) => r.entrantId)).size, 5);
});

test("bye math at size 8: exact power of two, zero byes", () => {
  const b = generateBracket(entrants(8), 3);
  assert.equal(b.size, 8);
  for (const p of b.rounds[0].pairings) {
    assert.notEqual(p.a, null);
    assert.notEqual(p.b, null);
  }
  const resolved = playOut(b);
  assert.equal(resolved.rounds.length, 3, "8 -> 4 -> 2 -> 1: three rounds");
  const ranks = placements(resolved);
  assert.equal(ranks.length, 8);
  assert.deepEqual(ranks.map((r) => r.rank).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("bye math at size 100: right rounds, all real entrants ranked 1..100 with no duplicates", () => {
  const n = 100;
  const b = generateBracket(entrants(n), 2024);
  assert.equal(b.size, 128, "next power of two >= 100");
  const resolved = playOut(b);
  const ranks = placements(resolved);
  assert.equal(ranks.length, n);
  const rankNums = ranks.map((r) => r.rank).sort((x, y) => x - y);
  assert.deepEqual(rankNums, Array.from({ length: n }, (_, i) => i + 1));
  assert.equal(new Set(ranks.map((r) => r.entrantId)).size, n, "no duplicate entrant ids in placements");
});

test("3rd-place decider: positions 1/2/3/4 come out exactly as champion/final-loser/decider winner/loser", () => {
  const b = generateBracket(entrants(8), 55);
  const resolved = playOut(b);
  assert.notEqual(resolved.thirdPlace, null, "an 8-entrant field always gets a decider");
  assert.notEqual(resolved.thirdPlace.winner, null, "decider was resolved by playOut()");

  const finalPairing = resolved.rounds[resolved.rounds.length - 1].pairings[0];
  const ranks = placements(resolved);
  const rankOf = (id) => ranks.find((r) => r.entrantId === id).rank;

  assert.equal(rankOf(finalPairing.winner), 1);
  assert.equal(rankOf(finalPairing.loser), 2);
  assert.equal(rankOf(resolved.thirdPlace.winner), 3);
  assert.equal(rankOf(resolved.thirdPlace.loser), 4);
});

test("nextRound rejects a winner that isn't one of the pairing's two entrants", () => {
  const b = generateBracket(entrants(4), 1);
  assert.throws(() => nextRound(b, ["not-an-entrant", b.rounds[0].pairings[1].a]));
});

test("nextRound refuses to advance past an already-decided champion", () => {
  const b = generateBracket(entrants(2), 1);
  const resolved = nextRound(b, [b.rounds[0].pairings[0].a]);
  assert.throws(() => nextRound(resolved, [resolved.rounds[0].pairings[0].a]));
});

test("resolveThirdPlace rejects a winner outside the decider's two entrants and double-resolution", () => {
  const b = generateBracket(entrants(4), 1);
  const r0 = nextRound(b, b.rounds[0].pairings.map((p) => p.a));
  assert.notEqual(r0.thirdPlace, null);
  assert.throws(() => resolveThirdPlace(r0, "not-an-entrant"));
  const resolved = resolveThirdPlace(r0, r0.thirdPlace.a);
  assert.throws(() => resolveThirdPlace(resolved, resolved.thirdPlace.a));
});

test("placements ties: same-round eliminations get distinct ranks, stable per seed, sometimes differ across seeds", () => {
  // 16 entrants: round 0 (round of 16) has 8 losers who all tie for ranks
  // 9-16 — enough same-round ties to exercise the seeded draw.
  const n = 16;
  const runs = {};
  for (const seed of [1, 2, 3]) {
    const resolved = playOut(generateBracket(entrants(n), seed));
    const ranks = placements(resolved);
    assert.equal(new Set(ranks.map((r) => r.rank)).size, n, "no duplicate ranks");
    // Re-run placements() on the SAME resolved bracket: must be stable.
    const again = placements(resolved);
    assert.deepEqual(again, ranks, `seed ${seed}: placements must be stable across repeated calls`);
    runs[seed] = ranks;
  }
  // At least one pair of seeds should differ in tie order somewhere (bracket
  // shape differs by seed anyway, but specifically check the tie-break
  // isn't literally hardcoded to entrant-array order).
  const diffs = [1, 2, 3].some((s1, i) =>
    [1, 2, 3].slice(i + 1).some((s2) => JSON.stringify(runs[s1]) !== JSON.stringify(runs[s2]))
  );
  assert.ok(diffs, "different seeds should (almost always) produce different placement orders");
});

// Pure math checks for the GVG war relay (Phase 9.7) — same determinism bar
// as tests/bracket.test.mjs, built on the zero-variance lane fixtures
// tests/relay-engine.test.mjs uses for its own carry-over checks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWarRelay } from "../shared/rules/gvgWar.js";
import { resolveBattle } from "../shared/engine/resolve.js";
import { deriveNodeSeed } from "../shared/rules/adventure.js";
import { makeRng } from "../shared/engine/rng.js";
import { lane } from "./fixtures.mjs";

/** A lineup entry: {teamId, lanes}. */
function team(teamId, lanes) {
  return { teamId, lanes };
}

// A team that can never finish off its opponent within the engine's
// TURN_CAP — absurd maxHp, zero attack power (strike() still floors a hit at
// 1 dmg, but 200 turns of at most 1 dmg/hit never dents a 7-figure maxHp) —
// guaranteed to draw against anything built the same way.
function undefeatableLanes(hpBase = 5_000_000) {
  return [lane(0, { name: "Wall", maxHp: hpBase, atkMin: 0, atkMax: 0, crit: 0, spd: 10 })];
}

// A team that wins fast and clean against `undefeatableLanes`-style walls:
// huge attack, normal hp — used as the "weak/strong" pair for decisive wins.
function strongLanes(name = "Striker") {
  return [lane(0, { name, maxHp: 150, atkMin: 40, atkMax: 40, crit: 0, spd: 12 })];
}
function weakLanes(name = "Punchbag") {
  return [lane(0, { name, maxHp: 60, atkMin: 5, atkMax: 5, crit: 0, spd: 8 })];
}

test("determinism: same lineups + same warSeed always reproduce an identical result", () => {
  const lineupA = [team(1, strongLanes("A0")), team(2, weakLanes("A1"))];
  const lineupB = [team(10, weakLanes("B0")), team(11, strongLanes("B1"))];

  const first = resolveWarRelay(lineupA, lineupB, 777);
  const second = resolveWarRelay(lineupA, lineupB, 777);
  assert.deepEqual(second, first);
});

test("single team vs single team: a decisive war ends after exactly one battle, no tiebreak", () => {
  const lineupA = [team(1, strongLanes())];
  const lineupB = [team(10, weakLanes())];

  const result = resolveWarRelay(lineupA, lineupB, 5);
  assert.equal(result.battles.length, 1);
  assert.equal(result.tiebreak, false);
  assert.ok(result.winner === "a" || result.winner === "b");
  assert.equal(result.battles[0].teamA, 1);
  assert.equal(result.battles[0].teamB, 10);
});

test("the loser's next team steps in fresh while the winner carries its exact finalState forward", () => {
  // Guild A fields one strong team the whole war; guild B fields two weaker
  // teams. A should beat B0 (battle 0), carrying its (possibly bruised)
  // finalState into battle 1 against B's fresh team B1.
  const lineupA = [team("A0", strongLanes("Ace"))];
  const lineupB = [team("B0", weakLanes("First")), team("B1", weakLanes("Second"))];
  const warSeed = 123;

  const result = resolveWarRelay(lineupA, lineupB, warSeed);

  // Manually replay the same two battles off the engine directly, using
  // the SAME derivation rule the module documents, to prove the numbers
  // resolveWarRelay reports are not just internally self-consistent but
  // actually correct against the engine.
  const seed0 = deriveNodeSeed(warSeed, 0);
  const battle0 = resolveBattle(lineupA[0].lanes, lineupB[0].lanes, seed0);
  assert.equal(battle0.youWin, true, "test fixture must have A win battle 0 for this test to mean anything");

  const carriedA = lineupA[0].lanes.map((l) => {
    const carry = battle0.finalState.a.find((s) => s.idx === l.idx);
    return { ...l, startHp: carry.hp, startStatuses: carry.statuses };
  });
  const seed1 = deriveNodeSeed(warSeed, 1);
  const battle1 = resolveBattle(carriedA, lineupB[1].lanes, seed1);

  assert.equal(result.battles.length, 2);
  assert.equal(result.battles[0].outcome, "a");
  assert.equal(result.battles[0].teamA, "A0");
  assert.equal(result.battles[0].teamB, "B0");
  assert.equal(result.battles[1].teamA, "A0", "the winning side's SAME team continues");
  assert.equal(result.battles[1].teamB, "B1", "the losing side's NEXT team steps in");
  assert.equal(result.battles[1].outcome, battle1.draw ? "draw" : battle1.youWin ? "a" : "b");
  assert.equal(result.battles[1].aAlive, battle1.finalState.a.filter((s) => s.hp > 0).length);
  assert.equal(result.battles[1].bAlive, battle1.finalState.b.filter((s) => s.hp > 0).length);
  assert.equal(result.winner, battle1.draw ? undefined : battle1.youWin ? "a" : "b");

  // And the carry-over genuinely changed the fight: a FRESH (uncarried) A0
  // against B1 must produce a different log than the carried one.
  const freshBattle1 = resolveBattle(lineupA[0].lanes, lineupB[1].lanes, seed1);
  assert.notDeepEqual(battle1.events, freshBattle1.events, "carried hp must actually change battle 1's outcome vs. a fresh start");
});

test("a drawn battle eliminates BOTH current teams — each side's next team steps in fresh", () => {
  const lineupA = [team("A-wall", undefeatableLanes()), team("A-striker", strongLanes("A finisher"))];
  const lineupB = [team("B-wall", undefeatableLanes()), team("B-punchbag", weakLanes("B finisher"))];
  const warSeed = 999;

  const result = resolveWarRelay(lineupA, lineupB, warSeed);

  assert.equal(result.battles[0].outcome, "draw", "two undefeatable walls must draw out the turn cap");
  assert.equal(result.battles.length, 2, "both sides' walls are eliminated together, exactly one more battle decides the war");
  assert.equal(result.battles[1].teamA, "A-striker");
  assert.equal(result.battles[1].teamB, "B-punchbag");
  assert.notEqual(result.battles[1].outcome, "draw", "the finishers are built to decide the war, not draw again");
  assert.ok(result.winner === "a" || result.winner === "b");
  assert.equal(result.tiebreak, false);
});

test("simultaneous exhaustion (a draw when both sides are on their last team) breaks with a deterministic seeded coin flip", () => {
  const lineupA = [team("A-only", undefeatableLanes())];
  const lineupB = [team("B-only", undefeatableLanes(5_000_001))];
  const warSeed = 4242;

  const result = resolveWarRelay(lineupA, lineupB, warSeed);

  assert.equal(result.battles.length, 1);
  assert.equal(result.battles[0].outcome, "draw");
  assert.equal(result.tiebreak, true);
  const expectedWinner = makeRng(warSeed).chance(50) ? "a" : "b";
  assert.equal(result.winner, expectedWinner);

  // And it's still deterministic across repeated calls.
  const again = resolveWarRelay(lineupA, lineupB, warSeed);
  assert.deepEqual(again, result);
});

test("input lineups are never mutated", () => {
  const lineupA = [team("A0", strongLanes("Ace")), team("A1", weakLanes("Reserve"))];
  const lineupB = [team("B0", weakLanes("First")), team("B1", strongLanes("Second"))];
  const before = JSON.parse(JSON.stringify({ lineupA, lineupB }));

  resolveWarRelay(lineupA, lineupB, 55);

  assert.deepEqual(JSON.parse(JSON.stringify({ lineupA, lineupB })), before);
});

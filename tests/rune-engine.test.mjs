// Behavior tests for the rune stages (Phase 7.3 step C): the battle_start
// rune stage (fires after equipment, GAME_DESIGN §7's firing order) and the
// target_select/override_targeting trigger (targeting "modified by runes").
// Built on zero-variance lanes, same style as equipment-engine.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBattle } from "../shared/engine/resolve.js";
import { lane, equip, rune } from "./fixtures.mjs";

test("rune battle_start effect fires AFTER equipment buffs, applies its stat, and tallies one charge", () => {
  const rosterA = [
    lane(0, {
      maxHp: 100, atkMin: 1, atkMax: 1, spd: 10,
      equipment: [equip("eq_iron_sword")], // battle_start perm_stat atk pct 10
      runes: [rune("rn_swift", { instanceId: 42 })], // battle_start perm_stat spd flat 3 perLevel 1
    }),
  ];
  const rosterB = [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 1 })];

  const { events, runeUse } = resolveBattle(rosterA, rosterB, 5);

  const equipBuffIdx = events.findIndex((e) => e.t === "buff" && e.skill === "eq_iron_sword");
  const runeEventIdx = events.findIndex((e) => e.t === "rune" && e.rune === "rn_swift");
  const runeBuffIdx = events.findIndex((e) => e.t === "buff" && e.skill === "rn_swift");

  assert.ok(equipBuffIdx >= 0, "equipment buff must fire");
  assert.ok(runeEventIdx >= 0, "rune trigger event must fire");
  assert.ok(runeBuffIdx >= 0, "the rune's stat effect must fire");
  assert.ok(equipBuffIdx < runeEventIdx, "equipment fires before runes (battle_start order)");
  assert.ok(runeEventIdx < runeBuffIdx, "the rune event precedes the effect it caused");

  assert.deepEqual(runeUse, { a: { 42: 1 }, b: {} }, "one charge tallied under its instance id, side a");
});

test("targeting override: a front-locked attacker with rn_hunter strikes the lowest-HP% enemy instead of the front", () => {
  const rosterA = [
    // Faster range ally softens B1 (behind the front) before Hunter acts.
    lane(0, { name: "Ally", attackKind: "range", targeting: "behind_front", atkMin: 80, atkMax: 80, spd: 30 }),
    // Melee -> innate targeting is hard-locked to "front" (B0) without the rune.
    lane(1, { name: "Hunter", atkMin: 10, atkMax: 10, spd: 10, runes: [rune("rn_hunter", { instanceId: 9 })] }),
  ];
  const rosterB = [
    lane(0, { name: "Front", maxHp: 500, atkMin: 1, atkMax: 1, spd: 1 }),
    lane(1, { name: "Weak", maxHp: 500, atkMin: 1, atkMax: 1, spd: 1 }),
  ];

  const { events, runeUse } = resolveBattle(rosterA, rosterB, 3);

  // By the time Hunter (spd 10, slower than Ally's 30) gets its first turn,
  // B1's HP% has already dropped below B0's — lowest_hp_pct now disagrees
  // with the melee front lock, and rn_hunter's charges are untouched.
  const hunterStrikes = events.filter((e) => e.t === "strike" && e.att.side === "a" && e.att.idx === 1);
  assert.ok(hunterStrikes.length > 0, "Hunter must land at least one strike");
  assert.equal(hunterStrikes[0].def.idx, 1, "the rune overrides Hunter's front lock toward the weakened B1");

  const runeEvents = events.filter((e) => e.t === "rune" && e.side === "a" && e.idx === 1);
  assert.ok(runeEvents.length > 0, "at least one rune trigger for the overridden turn(s)");
  assert.equal(runeUse.a[9], runeEvents.length, "tally equals the count of that rune's rune events");
});

test("charge exhaustion: chargesLeft 1 overrides exactly once, then reverts to normal (front) targeting", () => {
  const rosterA = [
    lane(0, { name: "Ally", attackKind: "range", targeting: "behind_front", atkMin: 80, atkMax: 80, spd: 30 }),
    lane(1, {
      name: "Hunter", atkMin: 10, atkMax: 10, spd: 10,
      runes: [rune("rn_hunter", { instanceId: 9, chargesLeft: 1 })],
    }),
  ];
  const rosterB = [
    lane(0, { name: "Front", maxHp: 900, atkMin: 1, atkMax: 1, spd: 1 }),
    lane(1, { name: "Weak", maxHp: 900, atkMin: 1, atkMax: 1, spd: 1 }),
  ];

  const { events, runeUse } = resolveBattle(rosterA, rosterB, 3);

  const hunterStrikes = events.filter((e) => e.t === "strike" && e.att.side === "a" && e.att.idx === 1);
  assert.ok(hunterStrikes.length >= 2, "Hunter must act more than once for this test to mean anything");
  assert.equal(hunterStrikes[0].def.idx, 1, "the single charge overrides the first strike toward B1");
  for (const s of hunterStrikes.slice(1)) {
    assert.equal(s.def.idx, 0, "once exhausted, Hunter reverts to its innate front lock");
  }

  const runeEvents = events.filter((e) => e.t === "rune" && e.side === "a" && e.idx === 1);
  assert.equal(runeEvents.length, 1, "the rune fires exactly once before running out of charges");
  assert.equal(runeUse.a[9], 1);
});

test("side separation: a side-b rune's tally lands under runeUse.b, never runeUse.a", () => {
  const rosterA = [lane(0, { maxHp: 100, atkMin: 5, atkMax: 5, spd: 5 })];
  const rosterB = [
    lane(0, { maxHp: 100, atkMin: 5, atkMax: 5, spd: 5, runes: [rune("rn_swift", { instanceId: 5 })] }),
  ];

  const { runeUse } = resolveBattle(rosterA, rosterB, 8);

  assert.deepEqual(runeUse.a, {}, "side a has no runes and must tally nothing");
  assert.equal(runeUse.b[5], 1, "side b's rune tallies under runeUse.b");
});

test("determinism/back-compat: absent vs. empty runes fields produce an identical result (no runes anywhere)", () => {
  const mkNoField = () => [
    lane(0, { atkMin: 20, atkMax: 40, crit: 30, spd: 12 }),
    lane(1, { atkMin: 25, atkMax: 30, crit: 10, spd: 9 }),
  ];
  const mkEmptyArray = () => mkNoField().map((l) => ({ ...l, runes: [] }));
  const bEnemy = () => [lane(0, { maxHp: 999, atkMin: 15, atkMax: 15, spd: 11 })];

  const withoutField = resolveBattle(mkNoField(), bEnemy(), 100);
  const withEmptyArray = resolveBattle(mkEmptyArray(), bEnemy(), 100);
  assert.deepEqual(withoutField, withEmptyArray);
  assert.deepEqual(withoutField.runeUse, { a: {}, b: {} }, "no runes anywhere ⇒ empty tallies, not absent ones");
});

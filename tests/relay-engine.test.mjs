// Behavior tests for carry-over battle state (Phase 9.6): the optional
// startHp/startStatuses a lane snapshot may carry in, and the finalState
// envelope every battle now returns for the next relay battle to consume.
// Built on zero-variance lanes, same style as rune-engine.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveBattle } from "../shared/engine/resolve.js";
import { STATUSES } from "../shared/rules/statuses.js";
import { lane, equip, rune, BATTLES } from "./fixtures.mjs";

const golden = (name) =>
  JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), "utf8"));

// A status registered as a dot, for the "carried DOT ticks" case below.
const DOT_STATUS = Object.entries(STATUSES).find(([, def]) => def.dot)[0];

test("chained battles are deterministic: feeding finalState forward reproduces the exact same logs twice", () => {
  const mkA = () => [
    lane(0, { name: "Front", maxHp: 200, atkMin: 10, atkMax: 10, spd: 15 }),
    lane(1, { name: "Back", maxHp: 150, atkMin: 8, atkMax: 8, spd: 9 }),
  ];
  const mkFreshEnemy = () => [lane(0, { name: "E1", maxHp: 999, atkMin: 12, atkMax: 12, spd: 11 })];

  function runChain() {
    const battle1 = resolveBattle(mkA(), mkFreshEnemy(), 41);
    const carried = mkA().map((l) => {
      const carry = battle1.finalState.a.find((s) => s.idx === l.idx);
      return { ...l, startHp: carry.hp, startStatuses: carry.statuses };
    });
    const battle2 = resolveBattle(carried, mkFreshEnemy(), 42);
    return { battle1, battle2 };
  }

  const run1 = runChain();
  const run2 = runChain();
  assert.deepEqual(run1.battle1, run2.battle1, "battle 1 must be identical across runs");
  assert.deepEqual(run1.battle2, run2.battle2, "battle 2 (fed from battle 1's finalState) must be identical across runs");

  // Battle 2's units must actually start at the carried hp, not full health:
  // a fresh (full-health) baseline run must diverge from the carried run.
  const freshBattle2 = resolveBattle(mkA(), mkFreshEnemy(), 42);
  assert.notDeepEqual(run1.battle2.events, freshBattle2.events, "carried hp must change battle 2's outcome vs. a fresh start");

  const carriedHp = run1.battle1.finalState.a.map((s) => s.hp);
  assert.ok(carriedHp.some((hp) => hp < 200 || hp < 150), "battle 1 must actually have damaged side a for this test to mean anything");
});

test("determinism/back-compat: absent carry fields vs. explicit full-health/empty carry fields produce an identical log", () => {
  const mkNoField = () => [
    lane(0, { atkMin: 20, atkMax: 40, crit: 30, spd: 12 }),
    lane(1, { atkMin: 25, atkMax: 30, crit: 10, spd: 9 }),
  ];
  const mkExplicitFull = () => mkNoField().map((l) => ({ ...l, startHp: l.maxHp, startStatuses: [] }));
  const bEnemy = () => [lane(0, { maxHp: 999, atkMin: 15, atkMax: 15, spd: 11 })];

  const withoutFields = resolveBattle(mkNoField(), bEnemy(), 100);
  const withExplicitFields = resolveBattle(mkExplicitFull(), bEnemy(), 100);
  assert.deepEqual(withoutFields, withExplicitFields);
});

test("existing golden fixtures are unchanged by the feature: events replay byte-identical", () => {
  for (const [name, { seed, rosterA, rosterB, trainers }] of Object.entries(BATTLES)) {
    const result = resolveBattle(rosterA, rosterB, seed, trainers);
    assert.deepEqual(result.events, golden(name).events, `${name}'s events must be unchanged`);
  }
});

test("a carried dot status ticks on the carried unit's very first turn", () => {
  const carriedUnit = lane(0, {
    name: "Poisoned", maxHp: 200, atkMin: 5, atkMax: 5, spd: 20,
    startStatuses: [{ id: DOT_STATUS, turnsLeft: 2, pct: 10 }],
  });
  const { events } = resolveBattle([carriedUnit], [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 1 })], 6);

  const firstTurnIdx = events.findIndex((e) => e.t === "turn" && e.side === "a" && e.idx === 0);
  const dotIdx = events.findIndex((e) => e.t === "dot" && e.side === "a" && e.idx === 0 && e.status === DOT_STATUS);
  assert.ok(firstTurnIdx >= 0, "the carried unit must get a turn");
  assert.ok(dotIdx >= 0, "the carried status must tick as a dot event");
  assert.ok(dotIdx > firstTurnIdx && dotIdx < events.findIndex((e, i) => i > firstTurnIdx && e.t === "turn"),
    "the dot must fire during the carried unit's own first turn");
  assert.equal(events[dotIdx].dmg, 20, "10% of 200 maxHp");
});

test("born fallen: a unit entering at startHp 0 never acts and emits no fall event for itself", () => {
  const rosterA = [
    lane(0, { name: "AlreadyDown", maxHp: 200, atkMin: 5, atkMax: 5, spd: 30, startHp: 0 }),
    lane(1, { name: "Standing", maxHp: 200, atkMin: 5, atkMax: 5, spd: 10 }),
  ];
  const rosterB = [lane(0, { name: "Foe", maxHp: 999, atkMin: 1, atkMax: 1, spd: 1 })];

  const { events, finalState } = resolveBattle(rosterA, rosterB, 6);

  assert.ok(!events.some((e) => e.t === "turn" && e.side === "a" && e.idx === 0), "the born-fallen unit must never get a turn");
  assert.ok(!events.some((e) => e.t === "fall" && e.side === "a" && e.idx === 0), "no fall event — it fell in an earlier battle, not this one");
  assert.ok(events.some((e) => e.t === "turn" && e.side === "a" && e.idx === 1), "its living ally must still act normally");
  assert.equal(finalState.a.find((s) => s.idx === 0).hp, 0, "finalState still reports the fallen unit at 0 hp");
});

test("born fallen: a battle_start perm_stat maxHp passive/equipment/rune fires NOTHING for it, and finalState never resurrects it", () => {
  const bornFallen = lane(0, {
    name: "AlreadyDown", maxHp: 200, atkMin: 5, atkMax: 5, spd: 10, startHp: 0,
    // A skill passive, a piece of monster-domain equipment, AND a rune all
    // carry a battle_start perm_stat maxHp effect (eq_leather_mail/
    // rn_fortitude) — every one of them would set `target.hp = target.maxHp`
    // (applyEffect's perm_stat maxHp case) if it fired, silently reviving a
    // unit that should stay dead across the relay.
    skills: [{ id: "sk_test_maxhp", name: "Test MaxHp", slot: "normal", cooldown: 0, level: 1,
               data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 50 }] } }],
    equipment: [equip("eq_leather_mail")],
    runes: [rune("rn_fortitude", { instanceId: 77 })],
  });
  const rosterA = [bornFallen];
  const rosterB = [lane(0, { name: "Foe", maxHp: 999, atkMin: 1, atkMax: 1, spd: 1 })];

  const { events, finalState, runeUse } = resolveBattle(rosterA, rosterB, 6);

  assert.ok(!events.some((e) => e.t === "buff" && e.side === "a" && e.idx === 0), "no buff event for the born-fallen unit's own passive/equipment");
  assert.ok(!events.some((e) => e.t === "heal" && e.side === "a" && e.idx === 0), "no heal event for the born-fallen unit");
  assert.ok(!events.some((e) => e.t === "rune" && e.side === "a" && e.idx === 0), "its rune never even fires (no charge spent)");
  assert.deepEqual(runeUse.a, {}, "the untouched rune's instance never enters the tally");
  assert.equal(finalState.a.find((s) => s.idx === 0).hp, 0, "finalState must still report it at 0 hp, never resurrected");
});

test("born fallen: a side entering with every unit at 0 hp loses immediately, decided (not a draw)", () => {
  const rosterA = [
    lane(0, { maxHp: 200, atkMin: 5, atkMax: 5, spd: 10, startHp: 0 }),
    lane(1, { maxHp: 150, atkMin: 5, atkMax: 5, spd: 8, startHp: 0 }),
  ];
  const rosterB = [lane(0, { maxHp: 100, atkMin: 5, atkMax: 5, spd: 5 })];

  const { youWin, draw, survivor, events } = resolveBattle(rosterA, rosterB, 6);

  assert.equal(draw, false, "the battle must be decided, not a draw");
  assert.equal(youWin, false, "side a, entirely born fallen, must lose");
  assert.equal(survivor.side, "b");
  assert.ok(!events.some((e) => e.side === "a" && e.t === "turn"), "a fully born-fallen side never takes a single turn");
});

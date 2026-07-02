// Behavior tests for engine v2's turn pipeline, built on zero-variance lanes
// (min == max, crit/evade 0, acc 100) so outcomes are seed-independent where
// the mechanic under test is not itself random.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBattle } from "../shared/engine/resolve.js";
import { lane, skill } from "./fixtures.mjs";

const turnsOf = (events, side) => events.filter((e) => e.t === "turn" && e.side === side);

test("faster units act more often (readiness gauge)", () => {
  // spd 25 fills 100 in 4 ticks; spd 10 needs 10 — expect fast, fast, slow.
  const { events } = resolveBattle(
    [lane(0, { spd: 25, maxHp: 400, atkMin: 1, atkMax: 1 })],
    [lane(0, { spd: 10, maxHp: 400, atkMin: 1, atkMax: 1 })],
    1
  );
  const firstThree = events.filter((e) => e.t === "turn").slice(0, 3).map((e) => e.side);
  assert.deepEqual(firstThree, ["a", "a", "b"]);
});

test("range attacks into the front lane keep only 25% power", () => {
  const { events } = resolveBattle(
    [lane(0, { attackKind: "range", targeting: "front", atkMin: 100, atkMax: 100, maxHp: 999, spd: 20 })],
    [lane(0, { atkMin: 1, atkMax: 1, maxHp: 999, spd: 5 })],
    3
  );
  const first = events.find((e) => e.t === "strike" && e.att.side === "a");
  assert.equal(first.dmg, 25);
});

test("range targeting behind_front skips the tank; melee cannot", () => {
  const { events } = resolveBattle(
    [lane(0, { attackKind: "range", targeting: "behind_front", atkMin: 100, atkMax: 100, maxHp: 999, spd: 20 })],
    [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 5 }), lane(1, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 5 })],
    3
  );
  const first = events.find((e) => e.t === "strike" && e.att.side === "a");
  assert.equal(first.def.idx, 1, "should hit the back lane");
  assert.equal(first.dmg, 100, "no front penalty in the back");
});

test("stun makes the victim skip its turn", () => {
  const stunner = lane(0, { spd: 30, maxHp: 999, atkMin: 5, atkMax: 5,
    skills: [{ id: "sk_test_stun", name: "Test Stun", slot: "normal", cooldown: 0, level: 1,
               data: { power: { scale: "phys", pct: 100 },
                       onHit: [{ op: "apply_status", status: "stun", chance: 100, turns: 2 }] } }] });
  const { events } = resolveBattle([stunner], [lane(0, { spd: 10, maxHp: 999 })], 5);
  assert.ok(events.some((e) => e.t === "status" && e.status === "stun" && e.side === "b"));
  assert.ok(events.some((e) => e.t === "skip" && e.side === "b"), "stunned unit must skip");
});

test("burn ticks damage at the victim's turn start", () => {
  const burner = lane(0, { spd: 30, maxHp: 999, atkMin: 1, atkMax: 1,
    skills: [{ id: "sk_test_burn", name: "Test Burn", slot: "normal", cooldown: 0, level: 1,
               data: { power: { scale: "phys", pct: 100 },
                       onHit: [{ op: "apply_status", status: "burn", chance: 100, turns: 2, pct: 10 }] } }] });
  const { events } = resolveBattle([burner], [lane(0, { spd: 10, maxHp: 200 })], 9);
  const dot = events.find((e) => e.t === "dot" && e.side === "b");
  assert.ok(dot, "burn must tick");
  assert.equal(dot.dmg, 20, "10% of 200 maxHp");
});

test("ultimates wait out their cooldown, then fire", () => {
  const ult = { ...skill("sk_arrow_rain"), cooldown: 2 };
  const archer = lane(0, { attackKind: "range", atkMin: 10, atkMax: 10, maxHp: 999, spd: 10, skills: [ult] });
  const { events } = resolveBattle([archer], [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 10 })], 11);
  const turns = [];
  let n = 0;
  for (const e of events) {
    if (e.t === "turn" && e.side === "a") n++;
    if (e.t === "skill" && e.side === "a" && e.skill === "sk_arrow_rain") turns.push(n);
  }
  assert.ok(turns.length > 0, "ultimate must fire");
  assert.ok(turns[0] > 1, "not on the very first turn (starts on cooldown)");
});

test("element advantage shows up in the damage and the event tag", () => {
  const { events } = resolveBattle(
    [lane(0, { element: "fire", atkMin: 100, atkMax: 100, maxHp: 999, spd: 20 })],
    [lane(0, { element: "wind", maxHp: 999, atkMin: 1, atkMax: 1, spd: 5 })],
    13
  );
  const first = events.find((e) => e.t === "strike" && e.att.side === "a");
  assert.equal(first.dmg, 125);
  assert.equal(first.eff, "strong");
});

test("same seed = identical log; different seed diverges", () => {
  const mk = () => [
    lane(0, { atkMin: 20, atkMax: 40, crit: 30, spd: 12 }),
    lane(1, { atkMin: 25, atkMax: 30, crit: 10, spd: 9 }),
  ];
  const a1 = resolveBattle(mk(), mk().map((l, i) => ({ ...l, idx: i })), 100);
  const a2 = resolveBattle(mk(), mk().map((l, i) => ({ ...l, idx: i })), 100);
  const b = resolveBattle(mk(), mk().map((l, i) => ({ ...l, idx: i })), 101);
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.events, b.events);
});

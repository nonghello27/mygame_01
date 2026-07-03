// Behavior tests for the battle_start equipment stage (Phase 7.2 step C):
// monster-domain gear on a lane, trainer-domain gear via the `trainers` arg,
// fired in the fixed order trainer skills -> passives -> equipment (GAME_
// DESIGN §7). Built on zero-variance lanes, same style as engine.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBattle } from "../shared/engine/resolve.js";
import { lane, skill, trainerSkill, equip } from "./fixtures.mjs";

test("monster equipment fires a buff event AFTER passive buffs and tskill events", () => {
  const rosterA = [
    lane(0, {
      maxHp: 100, atkMin: 1, atkMax: 1, spd: 10,
      skills: [skill("sk_tough")], // battle_start passive perm_stat maxHp pct 15
      equipment: [equip("eq_iron_sword")], // battle_start perm_stat atk pct 10
    }),
  ];
  const rosterB = [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 1 })];
  const trainers = { a: { skills: [trainerSkill("ts_war_might", 1)] } };

  const { events } = resolveBattle(rosterA, rosterB, 5, trainers);

  const tskillIdx = events.findIndex((e) => e.t === "tskill");
  const trainerBuffIdx = events.findIndex((e) => e.t === "buff" && e.skill === "ts_war_might");
  const passiveBuffIdx = events.findIndex((e) => e.t === "buff" && e.skill === "sk_tough");
  const equipBuffIdx = events.findIndex((e) => e.t === "buff" && e.skill === "eq_iron_sword");

  assert.ok(tskillIdx >= 0, "trainer skill must announce itself");
  assert.ok(trainerBuffIdx >= 0, "trainer skill buff must fire");
  assert.ok(passiveBuffIdx >= 0, "unit passive buff must fire");
  assert.ok(equipBuffIdx >= 0, "equipment buff must fire");

  assert.ok(trainerBuffIdx < passiveBuffIdx, "trainer skills fire before passives");
  assert.ok(passiveBuffIdx < equipBuffIdx, "passives fire before equipment");
  assert.ok(tskillIdx < equipBuffIdx, "trainer skills fire before equipment");
});

test("monster equipment perLevel scaling: enhance level raises the effect", () => {
  // eq_leather_mail: battle_start perm_stat maxHp pct 12, perLevel 3. A
  // perm_stat maxHp effect sets hp = maxHp exactly, so the FIRST strike this
  // unit takes (before it has acted) reports that maxHp as `before` — a
  // deterministic, seed-independent read of the post-buff maxHp.
  const mkA = (level) => [
    lane(0, { maxHp: 100, atkMin: 1, atkMax: 1, spd: 5, equipment: [equip("eq_leather_mail", level)] }),
  ];
  const mkB = () => [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 20 })];

  const lvl1 = resolveBattle(mkA(1), mkB(), 5);
  const lvl3 = resolveBattle(mkA(3), mkB(), 5);

  const strike1 = lvl1.events.find((e) => e.t === "strike" && e.def.side === "a");
  const strike3 = lvl3.events.find((e) => e.t === "strike" && e.def.side === "a");
  assert.ok(strike1 && strike3, "B must strike A before A acts");

  // level 1: pct 12 -> maxHp 112. level 3: pct 12 + 3*(3-1) = 18 -> maxHp 118.
  assert.equal(strike1.before, 112);
  assert.equal(strike3.before, 118);
  assert.equal(strike3.before - strike1.before, 6, "extra maxHp must equal base * perLevel*(level-1) / 100");
});

test("trainer-domain equipment is a side-wide aura: every unit on that side, none on the other", () => {
  const rosterA = [lane(0, { name: "A0" }), lane(1, { name: "A1" }), lane(2, { name: "A2" })];
  const rosterB = [lane(0, { name: "B0" }), lane(1, { name: "B1" })];
  const trainers = { a: { equipment: [equip("eq_trainer_vest")] } }; // battle_start perm_stat maxHp

  const { events } = resolveBattle(rosterA, rosterB, 11, trainers);
  const buffsA = events.filter((e) => e.t === "buff" && e.skill === "eq_trainer_vest" && e.side === "a");
  const buffsB = events.filter((e) => e.t === "buff" && e.skill === "eq_trainer_vest" && e.side === "b");

  assert.equal(buffsA.length, 3, "every unit on side a gets the aura");
  assert.deepEqual(new Set(buffsA.map((e) => e.idx)), new Set([0, 1, 2]));
  assert.equal(buffsB.length, 0, "side b must not receive an aura meant for side a");
});

test("old-shape trainers arg (bare {skills}, no equipment key) still works", () => {
  const rosterA = [lane(0, { atkMin: 20, atkMax: 20, spd: 12 })];
  const rosterB = [lane(0, { maxHp: 999, atkMin: 1, atkMax: 1, spd: 8 })];
  // No `equipment` key at all — the old (pre-7.2) trainers shape.
  const trainers = { a: { skills: [trainerSkill("ts_war_might", 1)] } };

  const { events } = resolveBattle(rosterA, rosterB, 5, trainers);
  assert.ok(events.some((e) => e.t === "tskill" && e.skill === "ts_war_might"));
});

test("absent vs. empty equipment fields produce an identical event log (back-compat)", () => {
  const mkNoField = () => [lane(0, { atkMin: 20, atkMax: 40, crit: 30, spd: 12 }), lane(1, { atkMin: 25, atkMax: 30, crit: 10, spd: 9 })];
  const mkEmptyArray = () =>
    mkNoField().map((l) => ({ ...l, equipment: [] }));

  const bEnemy = () => [lane(0, { maxHp: 999, atkMin: 15, atkMax: 15, spd: 11 })];

  const withoutField = resolveBattle(mkNoField(), bEnemy(), 100);
  const withEmptyArray = resolveBattle(mkEmptyArray(), bEnemy(), 100, { a: { equipment: [] }, b: {} });
  assert.deepEqual(withoutField, withEmptyArray);
});

// Unit tests for the shared/rules registries — the engine's balance data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStats, hitChance, powerScore } from "../shared/rules/formulas.js";
import { elementMultiplier } from "../shared/rules/elements.js";
import { selectTargets } from "../shared/rules/targeting.js";
import { statMod, hasFlag } from "../shared/rules/statuses.js";
import { RANKS } from "../shared/rules/ranks.js";
import { makeRng } from "../shared/engine/rng.js";

test("deriveStats maps attributes onto battle stats", () => {
  const d = deriveStats({ hp: 130, atk: 24, spd: 6 }, { str: 8, agi: 3, vit: 10, int: 2, dex: 4 });
  assert.equal(d.maxHp, 210);       // 130 + 10*8
  assert.equal(d.atkMin, 32);       // 24 + 8
  assert.equal(d.atkMax, 34);       // 24 + 8 + ceil(4/2)
  assert.equal(d.matkMin, 4);       // 2*2
  assert.equal(d.spd, 9);           // 6 + 3
  assert.equal(d.crit, 7);          // 5 + 4*0.5
});

test("element chart: cycle, holy/dark, neutral", () => {
  assert.equal(elementMultiplier("fire", "wind"), 1.25);
  assert.equal(elementMultiplier("wind", "fire"), 0.8);
  assert.equal(elementMultiplier("water", "fire"), 1.25);
  assert.equal(elementMultiplier("holy", "dark"), 1.25);
  assert.equal(elementMultiplier("dark", "holy"), 1.25);
  assert.equal(elementMultiplier("neutral", "fire"), 1);
  assert.equal(elementMultiplier("fire", "fire"), 1);
});

test("hitChance clamps and ignores evade on frozen targets", () => {
  const att = { acc: 90 };
  assert.equal(hitChance(att, { evade: 20 }, false), 70);
  assert.equal(hitChance(att, { evade: 20 }, true), 90);
  assert.equal(hitChance({ acc: 200 }, { evade: 0 }, false), 100);
  assert.equal(hitChance({ acc: 10 }, { evade: 25 }, false), 50);
});

test("targeting rules pick the documented lanes", () => {
  const rng = makeRng(1);
  const u = (idx, hp, maxHp = 100) => ({ idx, hp, maxHp });
  const alive = [u(0, 90), u(1, 30), u(2, 80)];
  assert.equal(selectTargets("front", alive, rng)[0].idx, 0);
  assert.equal(selectTargets("behind_front", alive, rng)[0].idx, 1);
  assert.equal(selectTargets("behind_front", [u(0, 50)], rng)[0].idx, 0, "falls back to front alone");
  assert.equal(selectTargets("backmost", alive, rng)[0].idx, 2);
  assert.equal(selectTargets("lowest_hp_pct", alive, rng)[0].idx, 1);
  assert.equal(selectTargets("front", alive, rng, "all").length, 3);
  assert.equal(selectTargets("front", [], rng).length, 0);
});

test("stat modifiers stack additively and expire with the status list", () => {
  const unit = { statuses: [{ id: "atk_up", pct: 20 }, { id: "atk_down", pct: -15 }] };
  assert.equal(statMod(unit, "atk"), 1.05);
  assert.equal(statMod({ statuses: [] }, "atk"), 1);
  assert.ok(hasFlag({ statuses: [{ id: "stun" }] }, "control"));
  assert.ok(!hasFlag({ statuses: [{ id: "burn" }] }, "control"));
});

test("RANKS is the closed, ascending D..SSR ladder", () => {
  assert.deepEqual(RANKS, ["D", "C", "B", "A", "S", "SR", "SSR"]);
  assert.equal(RANKS.length, 7);
});

test("powerScore is a display-only number derived from deriveStats() output", () => {
  // Sile: base {hp:80, atk:36, spd:9}, attrs {str:6, agi:9, vit:4, int:3, dex:10}
  const d = deriveStats({ hp: 80, atk: 36, spd: 9 }, { str: 6, agi: 9, vit: 4, int: 3, dex: 10 });
  assert.equal(d.maxHp, 112);
  assert.equal(d.atkMin, 42);
  assert.equal(d.atkMax, 47);
  assert.equal(d.matkMin, 6);
  assert.equal(d.matkMax, 9);
  assert.equal(d.spd, 18);
  assert.equal(powerScore(d), 992); // 112 + (42+47)*5 + (6+9)*5 + 18*20
});

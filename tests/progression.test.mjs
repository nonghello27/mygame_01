// Trainer progression grammar checks (Phase 6 step 3) — pure, no DB. Mirrors
// tests/admin-validate.test.mjs / tests/jobs.test.mjs: validateLearnChoice is
// the wall between the learn-skill endpoint and trainer_skills, so every
// rejection path is unit-tested here before it ever touches server code.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPERTISE_UNLOCK_EXP, TRAINER_SKILL_SLOTS, validateLearnChoice,
} from "../shared/rules/progression.js";

const DEFS = [
  { id: "ts_war_might", expertiseId: "warrior", name: "Warlord's Might" },
  { id: "ts_war_bulwark", expertiseId: "warrior", name: "Bulwark" },
  { id: "ts_wiz_focus", expertiseId: "wizard", name: "Arcane Focus" },
];

const warrior = { expertise: "warrior" };
const noExpertise = { expertise: null };

test("grammar constants are numbers", () => {
  assert.equal(typeof EXPERTISE_UNLOCK_EXP, "number");
  assert.equal(typeof TRAINER_SKILL_SLOTS, "number");
  assert.ok(TRAINER_SKILL_SLOTS > 0);
});

test("valid learn into each slot is accepted", () => {
  assert.equal(validateLearnChoice(warrior, DEFS, [], 0, "ts_war_might"), null);
  assert.equal(validateLearnChoice(warrior, DEFS, [], 1, "ts_war_bulwark"), null);
});

test("re-picking the same skill already held in that slot is accepted", () => {
  const slots = [{ slot: 0, skillId: "ts_war_might", level: 3 }];
  assert.equal(validateLearnChoice(warrior, DEFS, slots, 0, "ts_war_might"), null);
});

test("clearing a slot with skillId null is always valid slot-wise", () => {
  assert.equal(validateLearnChoice(warrior, DEFS, [], 0, null), null);
  assert.equal(validateLearnChoice(noExpertise, DEFS, [], 1, null), null);
});

test("bad slot is rejected", () => {
  assert.match(validateLearnChoice(warrior, DEFS, [], -1, "ts_war_might"), /slot/);
  assert.match(validateLearnChoice(warrior, DEFS, [], TRAINER_SKILL_SLOTS, "ts_war_might"), /slot/);
  assert.match(validateLearnChoice(warrior, DEFS, [], 1.5, "ts_war_might"), /slot/);
  assert.match(validateLearnChoice(warrior, DEFS, [], "0", "ts_war_might"), /slot/);
});

test("no expertise chosen yet is rejected", () => {
  assert.match(validateLearnChoice(noExpertise, DEFS, [], 0, "ts_war_might"), /expertise/);
});

test("unknown skill id is rejected", () => {
  assert.match(validateLearnChoice(warrior, DEFS, [], 0, "ts_nope"), /unknown skill/);
});

test("skill from a different expertise is rejected", () => {
  assert.match(validateLearnChoice(warrior, DEFS, [], 0, "ts_wiz_focus"), /warrior/);
});

test("the same skill already learned in the OTHER slot is rejected", () => {
  const slots = [{ slot: 1, skillId: "ts_war_might", level: 1 }];
  assert.match(validateLearnChoice(warrior, DEFS, slots, 0, "ts_war_might"), /already learned/);
});

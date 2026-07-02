// Admin write-validation checks (Phase 5). These pure validators are the
// wall between the admin console and the master tables: anything they let
// through will be interpreted by the engine's closed op set, so they must
// (a) accept every row of today's real seed content unchanged and
// (b) reject shapes the engine would silently misread.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateClass, validateSkill, validateSpecies, validateJob, enums,
} from "../server/services/adminValidate.js";
import { SKILLS } from "../src/data/skills.js";
import { JOBS } from "../src/data/jobs.js";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { CLASS_META } from "../src/data/classes.js";

const rejects = (fn, why) => assert.throws(fn, (e) => e.status === 400, why);

// --- the entire live seed must pass unchanged --------------------------------

test("every seed class validates", () => {
  for (const [cls, m] of Object.entries(CLASS_META)) {
    assert.deepEqual(validateClass({ cls, attackName: m.attackName, fx: m.fx }).cls, cls);
  }
});

test("every seed skill validates and round-trips its data", () => {
  for (const sk of SKILLS) {
    const v = validateSkill(sk);
    assert.equal(v.id, sk.id);
    assert.deepEqual(v.data, sk.data, `${sk.id}: data changed in validation`);
  }
});

test("every seed species validates against the seed classes + skills", () => {
  const context = {
    classNames: Object.keys(CLASS_META),
    skillsById: new Map(SKILLS.map((k) => [k.id, k])),
  };
  for (const u of [...ROSTER_A, ...ROSTER_B]) {
    const v = validateSpecies({
      id: "sp_" + u.name.toLowerCase(),
      name: u.name, cls: u.cls, emoji: u.emoji, sprite: u.sprite ?? null,
      starter: ROSTER_A.includes(u),
      element: u.element, attackKind: u.attackKind, attackStyle: u.attackStyle,
      targeting: u.targeting,
      base: { hp: u.hp, atk: u.atk, spd: u.spd },
      attrs: u.attrs, skills: u.skills,
    }, context);
    assert.deepEqual(v.skills, u.skills.map((s) => s ?? null), `${u.name}: loadout`);
  }
});

test("every seed job validates and round-trips its rewards", () => {
  for (const j of JOBS) {
    assert.deepEqual(validateJob(j).rewards, j.rewards, `${j.id}: rewards`);
  }
});

// --- shapes the engine would misread must be 400s ----------------------------

test("skill data rejects unknown keys, ops, statuses, and stats", () => {
  const base = { id: "sk_x", name: "X", slot: "normal", cooldown: 0 };
  rejects(() => validateSkill({ ...base, data: { damage: 5 } }), "unknown top key");
  rejects(() => validateSkill({ ...base, data: { power: { scale: "true", pct: 100 } } }), "bad scale");
  rejects(() => validateSkill({ ...base, data: { power: { scale: "phys", pct: 100 }, target: { rule: "weakest" } } }), "unknown rule");
  rejects(() => validateSkill({ ...base, data: { power: { scale: "phys", pct: 100 },
    onHit: [{ op: "apply_status", status: "sleep", turns: 1 }] } }), "unknown status");
  rejects(() => validateSkill({ ...base, slot: "passive",
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "def", flat: 5 }] } }), "unknown stat");
  rejects(() => validateSkill({ ...base, data: {} }), "empty data");
});

test("slot and data must agree (passive skills carry passives, actives don't)", () => {
  rejects(() => validateSkill({ id: "sk_x", name: "X", slot: "passive", cooldown: 0,
    data: { power: { scale: "phys", pct: 100 } } }));
  rejects(() => validateSkill({ id: "sk_x", name: "X", slot: "normal", cooldown: 0,
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }] } }));
});

test("species loadout enforces slot types and known relations", () => {
  const context = {
    classNames: ["Knight"],
    skillsById: new Map(SKILLS.map((k) => [k.id, k])),
  };
  const ok = {
    id: "sp_test", name: "Test", cls: "Knight", emoji: "🧪", sprite: null, starter: false,
    element: "fire", attackKind: "melee", attackStyle: "phys", targeting: "front",
    base: { hp: 100, atk: 20, spd: 6 }, attrs: { str: 1, agi: 1, vit: 1, int: 1, dex: 1 },
    skills: ["sk_tough", null, "sk_power_strike", "sk_inferno"],
  };
  assert.equal(validateSpecies(ok, context).id, "sp_test");
  rejects(() => validateSpecies({ ...ok, cls: "Ninja" }, context), "unknown class");
  rejects(() => validateSpecies({ ...ok, skills: ["sk_power_strike", null, "sk_power_strike", "sk_inferno"] }, context),
    "normal skill in a passive slot");
  rejects(() => validateSpecies({ ...ok, skills: ["sk_tough", null, "sk_missing", "sk_inferno"] }, context),
    "unknown skill id");
  rejects(() => validateSpecies({ ...ok, skills: [null, null, null] }, context), "must be 4 slots");
  rejects(() => validateSpecies({ ...ok, element: "plasma" }, context), "unknown element");
  rejects(() => validateSpecies({ ...ok, id: "TestSpecies" }, context), "id must be sp_*");
});

test("job rewards must match the kind exactly", () => {
  const work = { id: "job_x", kind: "work", name: "X", durationS: 60 };
  const train = { id: "train_x", kind: "training", name: "X", durationS: 60 };
  rejects(() => validateJob({ ...work, rewards: { gold: 5, trainerExp: 2, attr: "str" } }), "mixed keys");
  rejects(() => validateJob({ ...work, rewards: { gold: 0, trainerExp: 0 } }), "pays nothing");
  rejects(() => validateJob({ ...train, rewards: { attr: "luck", gain: 1 } }), "unknown attr");
  rejects(() => validateJob({ ...train, rewards: { attr: "str", gain: 0 } }), "zero gain");
  rejects(() => validateJob({ ...work, durationS: 1, rewards: { gold: 5, trainerExp: 2 } }), "too short");
});

test("enums expose exactly what the dropdowns need", () => {
  const e = enums();
  assert.deepEqual(e.loadoutSlotTypes, ["passive", "passive", "normal", "ultimate"]);
  assert.ok(e.elements.includes("fire") && e.targeting.includes("front") && e.statuses.includes("burn"));
});

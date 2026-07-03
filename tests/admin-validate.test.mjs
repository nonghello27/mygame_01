// Admin write-validation checks (Phase 5). These pure validators are the
// wall between the admin console and the master tables: anything they let
// through will be interpreted by the engine's closed op set, so they must
// (a) accept every row of today's real seed content unchanged and
// (b) reject shapes the engine would silently misread.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateClass, validateSkill, validateSpecies, validateJob, enums,
  validateItem, validateEquipment, validateRune,
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
  assert.deepEqual(e.itemKinds, ["material", "consumable"]);
  assert.deepEqual(e.equipDomains, ["trainer", "monster"]);
  assert.deepEqual(e.equipSlots.monster, ["weapon", "armor", "accessory"]);
  assert.deepEqual(e.equipSlots.trainer, ["head", "body", "charm"]);
});

// --- items / equipment / runes (Phase 7.1) --------------------------------------

test("validateItem accepts a happy-path row and rejects bad shapes", () => {
  const ok = validateItem({ id: "it_potion_small", kind: "consumable", name: "Small Potion" });
  assert.equal(ok.id, "it_potion_small");
  assert.equal(ok.description, null, "description defaults to null");
  assert.equal(
    validateItem({ id: "it_x", kind: "material", name: "X", description: "  a thing  " }).description,
    "a thing"
  );

  rejects(() => validateItem({ id: "itbad", kind: "material", name: "X" }), "id must be it_*");
  rejects(() => validateItem({ id: "it_x", kind: "consumables", name: "X" }), "unknown kind");
  rejects(() => validateItem({ id: "it_x", kind: "material", name: "" }), "name required");
  rejects(() => validateItem({ id: "it_x", kind: "material", name: "X", description: "y".repeat(201) }),
    "description too long");
});

test("validateEquipment enforces domain/slot pairing, effects grammar, enhance bounds", () => {
  const ok = validateEquipment({
    id: "eq_iron_sword", domain: "monster", slot: "weapon", name: "Iron Sword",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
    enhance: { maxLevel: 5, goldPerLevel: 50 },
  });
  assert.equal(ok.id, "eq_iron_sword");
  assert.equal(ok.effects[0].perLevel, 2, "equipment effects allow perLevel");

  const noEnhance = validateEquipment({
    id: "eq_charm", domain: "trainer", slot: "charm", name: "Charm",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "crit", flat: 5 }],
  });
  assert.equal(noEnhance.enhance, null, "enhance defaults to null when omitted");

  rejects(() => validateEquipment({
    id: "badid", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
  }), "id must be eq_*");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "planet", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
  }), "unknown domain");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "trainer", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
  }), "slot not valid for domain");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X", effects: [],
  }), "effects must be non-empty");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1, perLevel: 101 }],
  }), "perLevel out of range");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 0, goldPerLevel: 50 },
  }), "enhance.maxLevel too low");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 21, goldPerLevel: 50 },
  }), "enhance.maxLevel too high");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 0 },
  }), "enhance.goldPerLevel too low");
});

test("validateEquipment's enhance.material is optional and round-trips (Phase 7.2 step B)", () => {
  const withMaterial = validateEquipment({
    id: "eq_iron_sword", domain: "monster", slot: "weapon", name: "Iron Sword",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone", qtyPerLevel: 1 } },
  });
  assert.deepEqual(withMaterial.enhance.material, { itemId: "it_enhance_stone", qtyPerLevel: 1 });

  const goldOnly = validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50 },
  });
  assert.equal(goldOnly.enhance.material, undefined, "material stays absent when not given");

  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone", qtyPerLevel: 1, foo: 1 } },
  }), "unknown key in material");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "enhance_stone", qtyPerLevel: 1 } },
  }), "material.itemId must match it_*");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone", qtyPerLevel: 0 } },
  }), "material.qtyPerLevel too low");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone", qtyPerLevel: 101 } },
  }), "material.qtyPerLevel too high");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone" } },
  }), "material missing qtyPerLevel");
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { qtyPerLevel: 1 } },
  }), "material missing itemId");
});

test("validateRune enforces the effects grammar (with perLevel) and charge/gold bounds", () => {
  const ok = validateRune({
    id: "rn_swift", name: "Swift Rune",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 3, perLevel: 1 }],
    maxCharges: 5, repairGold: 30,
  });
  assert.equal(ok.id, "rn_swift");
  assert.equal(ok.effects[0].perLevel, 1);

  rejects(() => validateRune({
    id: "rnbad", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 5, repairGold: 0,
  }), "id must be rn_*");
  rejects(() => validateRune({
    id: "rn_x", name: "X", effects: [], maxCharges: 5, repairGold: 0,
  }), "effects must be non-empty");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 0, repairGold: 0,
  }), "maxCharges must be positive");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 101, repairGold: 0,
  }), "maxCharges too high");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 5, repairGold: -1,
  }), "repairGold must be >= 0");
});

test("species accepts optional runeSlots (default 1, bounded 0-5)", () => {
  const context = {
    classNames: ["Knight"],
    skillsById: new Map(SKILLS.map((k) => [k.id, k])),
  };
  const base = {
    id: "sp_test2", name: "Test2", cls: "Knight", emoji: "🧪", sprite: null, starter: false,
    element: "fire", attackKind: "melee", attackStyle: "phys", targeting: "front",
    base: { hp: 100, atk: 20, spd: 6 }, attrs: { str: 1, agi: 1, vit: 1, int: 1, dex: 1 },
    skills: ["sk_tough", null, "sk_power_strike", "sk_inferno"],
  };
  assert.equal(validateSpecies(base, context).runeSlots, 1, "default is 1 when omitted");
  assert.equal(validateSpecies({ ...base, runeSlots: 3 }, context).runeSlots, 3);
  rejects(() => validateSpecies({ ...base, runeSlots: -1 }, context), "runeSlots below 0");
  rejects(() => validateSpecies({ ...base, runeSlots: 6 }, context), "runeSlots above 5");
});

test("skill passives still reject perLevel (grammar unchanged from before 7.1)", () => {
  rejects(() => validateSkill({
    id: "sk_x", name: "X", slot: "passive", cooldown: 0,
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "atk", flat: 5, perLevel: 2 }] },
  }), "skills don't get perLevel on passives");
});

// Admin write-validation checks (Phase 5). These pure validators are the
// wall between the admin console and the master tables: anything they let
// through will be interpreted by the engine's closed op set, so they must
// (a) accept every row of today's real seed content unchanged and
// (b) reject shapes the engine would silently misread.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateClass, validateSkill, validateSpecies, validateJob, enums,
  validateItem, validateEquipment, validateRune, validateSummon, validateAdventure,
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
  assert.equal(ok.sellGold, 0, "sellGold defaults to 0 when absent");
  assert.equal(
    validateItem({ id: "it_x", kind: "material", name: "X", description: "  a thing  " }).description,
    "a thing"
  );
  assert.equal(
    validateItem({ id: "it_x", kind: "material", name: "X", sellGold: 15 }).sellGold, 15,
    "sellGold round-trips when given"
  );

  rejects(() => validateItem({ id: "itbad", kind: "material", name: "X" }), "id must be it_*");
  rejects(() => validateItem({ id: "it_x", kind: "consumables", name: "X" }), "unknown kind");
  rejects(() => validateItem({ id: "it_x", kind: "material", name: "" }), "name required");
  rejects(() => validateItem({ id: "it_x", kind: "material", name: "X", description: "y".repeat(201) }),
    "description too long");
  rejects(() => validateItem({ id: "it_x", kind: "material", name: "X", sellGold: -1 }),
    "sellGold must be >= 0");
});

test("validateEquipment enforces domain/slot pairing, effects grammar, enhance bounds", () => {
  const ok = validateEquipment({
    id: "eq_iron_sword", domain: "monster", slot: "weapon", name: "Iron Sword",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
    enhance: { maxLevel: 5, goldPerLevel: 50 },
  });
  assert.equal(ok.id, "eq_iron_sword");
  assert.equal(ok.effects[0].perLevel, 2, "equipment effects allow perLevel");
  assert.equal(ok.sellGold, 0, "sellGold defaults to 0 when absent");

  const noEnhance = validateEquipment({
    id: "eq_charm", domain: "trainer", slot: "charm", name: "Charm",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "crit", flat: 5 }],
    sellGold: 60,
  });
  assert.equal(noEnhance.enhance, null, "enhance defaults to null when omitted");
  assert.equal(noEnhance.sellGold, 60, "sellGold round-trips when given");

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
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 1 }],
    sellGold: -1,
  }), "sellGold must be >= 0");
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
  assert.equal(ok.sellGold, 0, "sellGold defaults to 0 when absent");

  const withSell = validateRune({
    id: "rn_swift", name: "Swift Rune",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 3, perLevel: 1 }],
    maxCharges: 5, repairGold: 30, sellGold: 35,
  });
  assert.equal(withSell.sellGold, 35, "sellGold round-trips when given");

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
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 5, repairGold: 0, sellGold: -1,
  }), "sellGold must be >= 0");
});

test("validateRune accepts the target_select/override_targeting shape and rejects bad/mixed shapes", () => {
  const ok = validateRune({
    id: "rn_hunter", name: "Hunter Rune",
    effects: [{ when: "target_select", op: "override_targeting", rule: "lowest_hp_pct" }],
    maxCharges: 8, repairGold: 50,
  });
  assert.deepEqual(ok.effects, [{ when: "target_select", op: "override_targeting", rule: "lowest_hp_pct" }]);

  // A rune may mix battle_start entries and target_select entries across
  // DIFFERENT array entries — each entry is validated independently.
  const mixedEntries = validateRune({
    id: "rn_x", name: "X",
    effects: [
      { when: "battle_start", op: "perm_stat", stat: "spd", flat: 1 },
      { when: "target_select", op: "override_targeting", rule: "backmost" },
    ],
    maxCharges: 5, repairGold: 10,
  });
  assert.equal(mixedEntries.effects.length, 2);

  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "target_select", op: "override_targeting", rule: "weakest" }],
    maxCharges: 5, repairGold: 0,
  }), "unknown targeting rule");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "target_select", op: "perm_stat", stat: "spd", flat: 1 }],
    maxCharges: 5, repairGold: 0,
  }), "target_select entry must use override_targeting, not perm_stat");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "battle_start", op: "override_targeting", rule: "front" }],
    maxCharges: 5, repairGold: 0,
  }), "battle_start entry must use perm_stat, not override_targeting");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "target_select", op: "override_targeting", rule: "front", pct: 5 }],
    maxCharges: 5, repairGold: 0,
  }), "override_targeting shape rejects extra keys like pct");
  rejects(() => validateRune({
    id: "rn_x", name: "X",
    effects: [{ when: "target_select", op: "override_targeting" }],
    maxCharges: 5, repairGold: 0,
  }), "override_targeting requires a rule");
});

test("validateEquipment regression: still rejects a target_select effect (rune-only shape)", () => {
  rejects(() => validateEquipment({
    id: "eq_x", domain: "monster", slot: "weapon", name: "X",
    effects: [{ when: "target_select", op: "override_targeting", rule: "lowest_hp_pct" }],
  }), "equipment must not accept the rune-only target_select trigger");
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

// --- summon hall (Phase 7.4 step A) ---------------------------------------------

test("validateSummon accepts a happy-path def and defaults description/enabled", () => {
  const ok = validateSummon({
    id: "sm_novice", name: "Novice Summon",
    cost: [{ type: "gold", amount: 100 }],
    pool: [{ speciesId: "sp_vorth", weight: 1 }],
  });
  assert.equal(ok.id, "sm_novice");
  assert.equal(ok.description, "", "description defaults to empty string");
  assert.equal(ok.enabled, true, "enabled defaults to true");
  assert.deepEqual(ok.cost, [{ type: "gold", amount: 100 }]);
  assert.deepEqual(ok.pool, [{ speciesId: "sp_vorth", weight: 1 }]);

  const full = validateSummon({
    id: "sm_scroll", name: "Scroll Summon", description: "  spends a scroll  ", enabled: false,
    cost: [{ type: "item", itemId: "it_summon_scroll", qty: 1 }],
    pool: [
      { speciesId: "sp_vorth", weight: 25 },
      { speciesId: "sp_garran", weight: 15 },
    ],
  });
  assert.equal(full.description, "spends a scroll");
  assert.equal(full.enabled, false);
});

test("validateSummon rejects malformed cost/pool shapes", () => {
  const base = { id: "sm_x", name: "X" };
  rejects(() => validateSummon({ ...base, cost: [], pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "empty cost");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "quest", amount: 1 }], pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "unknown cost type");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 10 }, { type: "gold", amount: 20 }],
    pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "at most one gold entry");
  rejects(() => validateSummon({ ...base,
    cost: [
      { type: "item", itemId: "it_summon_scroll", qty: 1 },
      { type: "item", itemId: "it_summon_scroll", qty: 2 },
    ],
    pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "duplicate itemId in cost");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 0 }], pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "cost amount must be >= 1");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 10 }], pool: [] }),
    "empty pool");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 10 }],
    pool: [{ speciesId: "sp_vorth", weight: 1 }, { speciesId: "sp_vorth", weight: 2 }] }),
    "duplicate speciesId in pool");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 10 }], pool: [{ speciesId: "sp_vorth", weight: 0 }] }),
    "pool weight must be >= 1");
  rejects(() => validateSummon({ ...base,
    cost: [{ type: "gold", amount: 10 }], pool: [{ speciesId: "sp_vorth", weight: -1 }] }),
    "negative pool weight");
  rejects(() => validateSummon({ name: "X",
    cost: [{ type: "gold", amount: 10 }], pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "missing id");
  rejects(() => validateSummon({ id: "smbad", name: "X",
    cost: [{ type: "gold", amount: 10 }], pool: [{ speciesId: "sp_vorth", weight: 1 }] }),
    "id must be sm_*");
});

test("enums include summonCostTypes", () => {
  assert.deepEqual(enums().summonCostTypes, ["gold", "item"]);
});

// --- adventures (Phase 7.4 step B) --------------------------------------------

const ADVENTURE_CONFIG = {
  steps: 5,
  choices: 2,
  nodes: [
    { type: "battle", weight: 50 },
    { type: "chest", weight: 25 },
    { type: "gather", weight: 25 },
  ],
  encounters: [
    { speciesId: "sp_vorth", weight: 40 },
    { speciesId: "sp_mesha", weight: 35 },
  ],
  loot: [
    { itemId: "it_potion_small", weight: 50, qtyMin: 1, qtyMax: 2 },
    { itemId: "it_enhance_stone", weight: 40, qtyMin: 1, qtyMax: 3 },
  ],
  gather: [
    { itemId: "it_enhance_stone", weight: 80, qtyMin: 1, qtyMax: 2 },
  ],
  catchPct: 25,
};

test("validateAdventure accepts a happy-path def and defaults description/enabled", () => {
  const ok = validateAdventure({ id: "ad_verdant_trail", name: "Verdant Trail", config: ADVENTURE_CONFIG });
  assert.equal(ok.id, "ad_verdant_trail");
  assert.equal(ok.description, "", "description defaults to empty string");
  assert.equal(ok.enabled, true, "enabled defaults to true");
  assert.deepEqual(ok.config, ADVENTURE_CONFIG);

  const full = validateAdventure({
    id: "ad_x", name: "X", description: "  a route  ", enabled: false, config: ADVENTURE_CONFIG,
  });
  assert.equal(full.description, "a route");
  assert.equal(full.enabled, false);
});

test("validateAdventure rejects malformed config shapes", () => {
  const base = { id: "ad_x", name: "X" };
  const cfg = (patch) => ({ ...ADVENTURE_CONFIG, ...patch });

  rejects(() => validateAdventure({ ...base, config: cfg({ steps: 2 }) }), "steps below min");
  rejects(() => validateAdventure({ ...base, config: cfg({ steps: 11 }) }), "steps above max");
  rejects(() => validateAdventure({ ...base, config: cfg({ choices: 1 }) }), "choices below min");
  rejects(() => validateAdventure({ ...base, config: cfg({ choices: 4 }) }), "choices above max");
  rejects(() => validateAdventure({ ...base, config: cfg({ nodes: [] }) }), "empty nodes");
  rejects(() => validateAdventure({ ...base, config: cfg({ nodes: [{ type: "shop", weight: 1 }] }) }),
    "unknown node type");
  rejects(() => validateAdventure({ ...base, config: cfg({
    nodes: [{ type: "battle", weight: 1 }, { type: "battle", weight: 2 }],
  }) }), "duplicate node type");
  rejects(() => validateAdventure({ ...base, config: cfg({ encounters: [] }) }), "empty encounters");
  rejects(() => validateAdventure({ ...base, config: cfg({
    encounters: [{ speciesId: "sp_vorth", weight: 1 }, { speciesId: "sp_vorth", weight: 2 }],
  }) }), "duplicate encounters speciesId");
  rejects(() => validateAdventure({ ...base, config: cfg({ loot: [] }) }), "empty loot");
  rejects(() => validateAdventure({ ...base, config: cfg({
    loot: [
      { itemId: "it_potion_small", weight: 1, qtyMin: 1, qtyMax: 2 },
      { itemId: "it_potion_small", weight: 2, qtyMin: 1, qtyMax: 2 },
    ],
  }) }), "duplicate loot itemId");
  rejects(() => validateAdventure({ ...base, config: cfg({
    loot: [{ itemId: "it_potion_small", weight: 1, qtyMin: 3, qtyMax: 2 }],
  }) }), "qtyMax < qtyMin");
  rejects(() => validateAdventure({ ...base, config: cfg({ catchPct: -1 }) }), "catchPct below min");
  rejects(() => validateAdventure({ ...base, config: cfg({ catchPct: 101 }) }), "catchPct above max");
  rejects(() => validateAdventure({ name: "X", config: ADVENTURE_CONFIG }), "missing id");
  rejects(() => validateAdventure({ id: "adbad", name: "X", config: ADVENTURE_CONFIG }), "id must be ad_*");
});

test("enums include adventureNodeTypes", () => {
  assert.deepEqual(enums().adventureNodeTypes, ["battle", "chest", "gather"]);
});

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
  validateEventSchedule, validateEventRewards, validateTournament, validateGvgEvent,
} from "../server/services/adminValidate.js";
import { SKILLS } from "../src/data/skills.js";
import { JOBS } from "../src/data/jobs.js";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { CLASS_META } from "../src/data/classes.js";

const rejects = (fn, why) => assert.throws(fn, (e) => e.status === 400, why);

// --- the entire live seed must pass unchanged --------------------------------

test("every seed class validates", () => {
  for (const [cls, m] of Object.entries(CLASS_META)) {
    const v = validateClass({ cls, attackName: m.attackName, fx: m.fx, icon: m.icon });
    assert.deepEqual(v.cls, cls);
    assert.equal(v.icon, m.icon);
  }
});

test("validateClass's icon is optional: absent -> null, a valid id round-trips, a bad one rejects", () => {
  assert.equal(validateClass({ cls: "Knight", attackName: "Blade Arc", fx: "slash" }).icon, null);
  assert.equal(
    validateClass({ cls: "Knight", attackName: "Blade Arc", fx: "slash", icon: "" }).icon, null);
  assert.equal(
    validateClass({ cls: "Knight", attackName: "Blade Arc", fx: "slash", icon: "knight-2" }).icon,
    "knight-2");
  rejects(() => validateClass({ cls: "Knight", attackName: "Blade Arc", fx: "slash", icon: "Knight" }),
    "icon must be lowercase");
  rejects(() => validateClass({ cls: "Knight", attackName: "Blade Arc", fx: "slash", icon: "1knight" }),
    "icon must start with a letter");
});

test("every seed skill validates and round-trips its data", () => {
  for (const sk of SKILLS) {
    const v = validateSkill(sk);
    assert.equal(v.id, sk.id);
    assert.deepEqual(v.data, sk.data, `${sk.id}: data changed in validation`);
    assert.equal(v.icon, sk.icon ?? null);
    assert.equal(v.animation, sk.animation ?? null);
  }
});

test("validateSkill's icon/animation are optional: absent -> null, valid values round-trip, bad ones reject", () => {
  const base = { id: "sk_x", name: "X", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 100 } } };
  assert.equal(validateSkill(base).icon, null);
  assert.equal(validateSkill(base).animation, null);
  assert.equal(validateSkill({ ...base, icon: "" }).icon, null);
  assert.equal(validateSkill({ ...base, animation: "" }).animation, null);
  assert.equal(validateSkill({ ...base, icon: "slash-2" }).icon, "slash-2");
  assert.equal(validateSkill({ ...base, animation: "x.svg" }).animation, "x.svg");
  assert.equal(validateSkill({ ...base, animation: "x.png" }).animation, "x.png");
  rejects(() => validateSkill({ ...base, icon: "Slash" }), "icon must be lowercase");
  rejects(() => validateSkill({ ...base, animation: "x" }), "animation needs an extension");
  rejects(() => validateSkill({ ...base, animation: "x.gif" }), "animation extension must be svg or png");
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

test("species rank accepts a valid rank, defaults to D when absent, rejects unknowns", () => {
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
  assert.equal(validateSpecies({ ...ok, rank: "SSR" }, context).rank, "SSR");
  assert.equal(validateSpecies(ok, context).rank, "D", "defaults to D when absent");
  rejects(() => validateSpecies({ ...ok, rank: "X" }, context), "unknown rank");
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
  assert.deepEqual(e.ranks, ["D", "C", "B", "A", "S", "SR", "SSR"]);
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
  assert.deepEqual(ok.config, { ...ADVENTURE_CONFIG, enemies: { min: 1, max: 3 } });

  const full = validateAdventure({
    id: "ad_x", name: "X", description: "  a route  ", enabled: false, config: ADVENTURE_CONFIG,
  });
  assert.equal(full.description, "a route");
  assert.equal(full.enabled, false);
});

// Phase 10.14 — config.enemies: the route's difficulty knob for how many
// wild monsters a battle node fields. Optional; defaults to {min:1,max:3}.
test("validateAdventure's config.enemies defaults to {min:1,max:3}, round-trips a valid pair, and rejects bad shapes", () => {
  const cfg = (patch) => ({ ...ADVENTURE_CONFIG, ...patch });

  assert.deepEqual(
    validateAdventure({ id: "ad_x", name: "X", config: ADVENTURE_CONFIG }).config.enemies,
    { min: 1, max: 3 },
    "default applied when absent"
  );
  assert.deepEqual(
    validateAdventure({ id: "ad_x", name: "X", config: cfg({ enemies: { min: 2, max: 3 } }) }).config.enemies,
    { min: 2, max: 3 },
    "a valid {min,max} passes through"
  );
  rejects(() => validateAdventure({ id: "ad_x", name: "X", config: cfg({ enemies: { min: 3, max: 2 } }) }),
    "rejects min > max");
  rejects(() => validateAdventure({ id: "ad_x", name: "X", config: cfg({ enemies: { min: 0, max: 3 } }) }),
    "rejects min below range");
  rejects(() => validateAdventure({ id: "ad_x", name: "X", config: cfg({ enemies: { min: 1, max: 4 } }) }),
    "rejects max above range");
  rejects(() => validateAdventure({ id: "ad_x", name: "X", config: cfg({ enemies: { min: 1, max: 3, extra: 1 } }) }),
    "rejects unknown keys inside enemies");
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

// --- events: shared schedule + reward grammar (Phase 9.1) --------------------

test("enums include eventRewardTypes", () => {
  assert.deepEqual(enums().eventRewardTypes, ["gold", "item", "equipment", "rune", "monster"]);
});

test("validateEventSchedule accepts a future starts<ends pair and round-trips as ISO strings", () => {
  const starts = new Date(Date.now() + 60_000).toISOString();
  const ends = new Date(Date.now() + 120_000).toISOString();
  const v = validateEventSchedule({ regStartsAt: starts, regEndsAt: ends });
  assert.equal(new Date(v.regStartsAt).toISOString(), starts);
  assert.equal(new Date(v.regEndsAt).toISOString(), ends);
});

test("validateEventSchedule rejects starts>=ends, a past date, and an invalid date", () => {
  const future = (ms) => new Date(Date.now() + ms).toISOString();
  rejects(() => validateEventSchedule({ regStartsAt: future(120_000), regEndsAt: future(60_000) }),
    "starts after ends");
  rejects(() => validateEventSchedule({ regStartsAt: future(60_000), regEndsAt: future(60_000) }),
    "starts equal to ends");
  rejects(() => validateEventSchedule({ regStartsAt: new Date(Date.now() - 60_000).toISOString(), regEndsAt: future(60_000) }),
    "starts in the past");
  rejects(() => validateEventSchedule({ regStartsAt: future(60_000), regEndsAt: new Date(Date.now() - 60_000).toISOString() }),
    "ends in the past");
  rejects(() => validateEventSchedule({ regStartsAt: "not-a-date", regEndsAt: future(60_000) }),
    "invalid start date");
});

const EVENT_LOOKUPS = {
  itemIds: new Set(["it_potion_small"]),
  equipmentDefIds: new Set(["eq_iron_sword"]),
  runeDefIds: new Set(["rn_swift"]),
  speciesIds: new Set(["sp_vorth"]),
};

test("validateEventRewards accepts a full grammar round-trip: every reward type, position + percentile tiers", () => {
  const config = {
    positionRewards: {
      1: [{ type: "gold", amount: 500 }, { type: "monster", speciesId: "sp_vorth" }],
      2: [{ type: "equipment", equipmentDefId: "eq_iron_sword" }],
      3: [{ type: "rune", runeDefId: "rn_swift" }],
    },
    percentileRewards: [
      { fromPct: 1, toPct: 50, rewards: [{ type: "item", itemId: "it_potion_small", qty: 3 }] },
      { fromPct: 51, toPct: 100, rewards: [{ type: "gold", amount: 10 }] },
    ],
  };
  const v = validateEventRewards(config, EVENT_LOOKUPS);
  assert.deepEqual(v, config);
});

test("validateEventRewards: positionRewards is optional and defaults to {}", () => {
  const v = validateEventRewards({
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 1 }] }],
  }, EVENT_LOOKUPS);
  assert.deepEqual(v.positionRewards, {});
});

test("validateEventRewards rejects a bad reward type and a missing qty on an item reward", () => {
  const base = { positionRewards: {}, percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [] }] };
  rejects(() => validateEventRewards({
    ...base, percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "diamond", amount: 1 }] }],
  }, EVENT_LOOKUPS), "unknown reward type");
  rejects(() => validateEventRewards({
    ...base, percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "item", itemId: "it_potion_small" }] }],
  }, EVENT_LOOKUPS), "item reward missing qty");
});

test("validateEventRewards rejects a tier gap, a tier overlap, a bad start, and a bad end", () => {
  const reward = [{ type: "gold", amount: 1 }];
  rejects(() => validateEventRewards({
    percentileRewards: [
      { fromPct: 1, toPct: 40, rewards: reward },
      { fromPct: 50, toPct: 100, rewards: reward },
    ],
  }, EVENT_LOOKUPS), "gap between tiers");
  rejects(() => validateEventRewards({
    percentileRewards: [
      { fromPct: 1, toPct: 60, rewards: reward },
      { fromPct: 50, toPct: 100, rewards: reward },
    ],
  }, EVENT_LOOKUPS), "overlapping tiers");
  rejects(() => validateEventRewards({
    percentileRewards: [{ fromPct: 2, toPct: 100, rewards: reward }],
  }, EVENT_LOOKUPS), "first tier must start at 1");
  rejects(() => validateEventRewards({
    percentileRewards: [{ fromPct: 1, toPct: 99, rewards: reward }],
  }, EVENT_LOOKUPS), "last tier must end at 100");
});

test("validateEventRewards rejects an unknown itemId/equipmentDefId/runeDefId/speciesId via the lookups", () => {
  const wrap = (reward) => ({ percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [reward] }] });
  rejects(() => validateEventRewards(wrap({ type: "item", itemId: "it_nope", qty: 1 }), EVENT_LOOKUPS),
    "unknown itemId");
  rejects(() => validateEventRewards(wrap({ type: "equipment", equipmentDefId: "eq_nope" }), EVENT_LOOKUPS),
    "unknown equipmentDefId");
  rejects(() => validateEventRewards(wrap({ type: "rune", runeDefId: "rn_nope" }), EVENT_LOOKUPS),
    "unknown runeDefId");
  rejects(() => validateEventRewards(wrap({ type: "monster", speciesId: "sp_nope" }), EVENT_LOOKUPS),
    "unknown speciesId");
});

// --- tournaments (Phase 9.2) --------------------------------------------------

function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function baseTournamentInput(overrides = {}) {
  return {
    name: "Spring Cup",
    regStartsAt: futureIso(60_000),
    regEndsAt: futureIso(120_000),
    rewards: {
      percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 10 }] }],
    },
    ...overrides,
  };
}

test("validateTournament accepts a happy-path row, defaults description/entryFee, and composes schedule+rewards", () => {
  const input = baseTournamentInput({
    description: "A friendly seasonal bracket",
    entryFee: 100,
    rewards: {
      positionRewards: { 1: [{ type: "gold", amount: 500 }] },
      percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 10 }] }],
    },
  });
  const v = validateTournament(input, EVENT_LOOKUPS);
  assert.equal(v.name, "Spring Cup");
  assert.equal(v.description, "A friendly seasonal bracket");
  assert.equal(v.entryFee, 100);
  assert.equal(new Date(v.regStartsAt).toISOString(), input.regStartsAt);
  assert.equal(new Date(v.regEndsAt).toISOString(), input.regEndsAt);
  assert.deepEqual(v.rewards, input.rewards);
});

test("validateTournament defaults description to '' and entryFee to 0 when absent", () => {
  const v = validateTournament(baseTournamentInput(), EVENT_LOOKUPS);
  assert.equal(v.description, "");
  assert.equal(v.entryFee, 0);
});

test("validateTournament rejects a missing/blank name", () => {
  rejects(() => validateTournament(baseTournamentInput({ name: "" }), EVENT_LOOKUPS), "blank name");
  rejects(() => validateTournament({ ...baseTournamentInput(), name: undefined }, EVENT_LOOKUPS), "missing name");
});

test("validateTournament rejects a negative entryFee", () => {
  rejects(() => validateTournament(baseTournamentInput({ entryFee: -1 }), EVENT_LOOKUPS), "negative entry fee");
});

test("validateTournament rejects a bad registration window (delegates to validateEventSchedule)", () => {
  rejects(() => validateTournament(
    baseTournamentInput({ regStartsAt: futureIso(120_000), regEndsAt: futureIso(60_000) }), EVENT_LOOKUPS
  ), "starts after ends");
  rejects(() => validateTournament(
    baseTournamentInput({ regStartsAt: new Date(Date.now() - 60_000).toISOString() }), EVENT_LOOKUPS
  ), "start in the past");
});

test("validateTournament rejects malformed/unknown-id rewards (delegates to validateEventRewards)", () => {
  rejects(() => validateTournament(
    baseTournamentInput({ rewards: { percentileRewards: [{ fromPct: 1, toPct: 50, rewards: [{ type: "gold", amount: 1 }] }] } }),
    EVENT_LOOKUPS
  ), "percentile tiers must cover 1-100");
  rejects(() => validateTournament(
    baseTournamentInput({
      rewards: { percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "item", itemId: "it_nope", qty: 1 }] }] },
    }),
    EVENT_LOOKUPS
  ), "unknown itemId via lookups");
});

// --- GVG events (Phase 9.5) ---------------------------------------------------

function baseGvgInput(overrides = {}) {
  return {
    name: "Guild Clash",
    regStartsAt: futureIso(60_000),
    regEndsAt: futureIso(120_000),
    rewards: {
      percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "gold", amount: 10 }] }],
    },
    ...overrides,
  };
}

test("validateGvgEvent accepts a happy-path row and defaults minTeams/maxTeams to 1/10", () => {
  const input = baseGvgInput({ description: "Guild vs. guild, weekly" });
  const v = validateGvgEvent(input, EVENT_LOOKUPS);
  assert.equal(v.name, "Guild Clash");
  assert.equal(v.description, "Guild vs. guild, weekly");
  assert.equal(v.minTeams, 1);
  assert.equal(v.maxTeams, 10);
  assert.equal(new Date(v.regStartsAt).toISOString(), input.regStartsAt);
  assert.equal(new Date(v.regEndsAt).toISOString(), input.regEndsAt);
  assert.deepEqual(v.rewards, { positionRewards: {}, ...input.rewards });
});

test("validateGvgEvent accepts explicit minTeams/maxTeams within 1-10", () => {
  const v = validateGvgEvent(baseGvgInput({ minTeams: 3, maxTeams: 5 }), EVENT_LOOKUPS);
  assert.equal(v.minTeams, 3);
  assert.equal(v.maxTeams, 5);
});

test("validateGvgEvent rejects minTeams > maxTeams", () => {
  rejects(() => validateGvgEvent(baseGvgInput({ minTeams: 6, maxTeams: 5 }), EVENT_LOOKUPS),
    "minTeams greater than maxTeams");
});

test("validateGvgEvent rejects minTeams/maxTeams out of the 1-10 range", () => {
  rejects(() => validateGvgEvent(baseGvgInput({ minTeams: 0 }), EVENT_LOOKUPS), "minTeams below 1");
  rejects(() => validateGvgEvent(baseGvgInput({ maxTeams: 11 }), EVENT_LOOKUPS), "maxTeams above 10");
});

test("validateGvgEvent rejects a bad registration window (delegates to validateEventSchedule)", () => {
  rejects(() => validateGvgEvent(
    baseGvgInput({ regStartsAt: futureIso(120_000), regEndsAt: futureIso(60_000) }), EVENT_LOOKUPS
  ), "starts after ends");
});

test("validateGvgEvent rejects malformed/unknown-id rewards (delegates to validateEventRewards)", () => {
  rejects(() => validateGvgEvent(
    baseGvgInput({
      rewards: { percentileRewards: [{ fromPct: 1, toPct: 100, rewards: [{ type: "item", itemId: "it_nope", qty: 1 }] }] },
    }),
    EVENT_LOOKUPS
  ), "unknown itemId via lookups");
});

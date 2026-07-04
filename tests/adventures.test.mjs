// Adventure master-data grammar + pure map/loot rules checks (Phase 7.4 step
// B, foundations + session engine) — the same role tests/summons.test.mjs
// plays for the Summon Hall: every row of the seed content must pass its own
// validator unchanged, every referenced species/item must be real, and
// generateMap()/deriveNodeSeed()/rollLoot()/rollEncounter() must be
// deterministic (CLAUDE.md §1.6) and obey the documented shape/exit-guard
// rules. The DB-touching session service (server/services/adventure.js) is
// exercised the same way matches.js/pvp.js are — not unit-tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADVENTURES } from "../src/data/adventures.js";
import { ITEMS } from "../src/data/items.js";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { validateAdventure, ADVENTURE_NODE_TYPES } from "../server/services/adminValidate.js";
import { generateMap, deriveNodeSeed, rollLoot, rollEncounter } from "../shared/rules/adventure.js";
import { makeRng } from "../shared/engine/rng.js";

test("adventure ids are unique, ad_-prefixed, and every row validates unchanged", () => {
  const ids = ADVENTURES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate adventure id");
  for (const id of ids) assert.match(id, /^ad_[a-z0-9_]+$/);

  for (const ad of ADVENTURES) {
    const v = validateAdventure(ad);
    assert.equal(v.id, ad.id);
    assert.equal(v.name, ad.name);
    assert.deepEqual(v.config, ad.config, `${ad.id}: config changed in validation`);
  }
});

test("every encounters speciesId is a real species id derived from src/data/units.js", () => {
  const speciesIds = new Set([...ROSTER_A, ...ROSTER_B].map((u) => "sp_" + u.name.toLowerCase()));
  for (const ad of ADVENTURES) {
    for (const e of ad.config.encounters) {
      assert.ok(speciesIds.has(e.speciesId), `${ad.id}: encounters speciesId "${e.speciesId}" is not a known species`);
    }
  }
});

test("every loot/gather itemId exists in src/data/items.js", () => {
  const itemIds = new Set(ITEMS.map((i) => i.id));
  for (const ad of ADVENTURES) {
    for (const row of [...ad.config.loot, ...ad.config.gather]) {
      assert.ok(itemIds.has(row.itemId), `${ad.id}: itemId "${row.itemId}" is not a known item`);
    }
  }
});

const CONFIG = {
  steps: 5,
  choices: 2,
  nodes: [
    { type: "battle", weight: 50 },
    { type: "chest", weight: 25 },
    { type: "gather", weight: 25 },
  ],
};

test("generateMap is deterministic: same config + seed always returns the same map", () => {
  for (const seed of [1, 42, 12345, 999999]) {
    const first = generateMap(CONFIG, seed);
    const second = generateMap(CONFIG, seed);
    assert.deepEqual(second, first, `seed ${seed} must reproduce the same map`);
  }
});

test("generateMap shape: config.steps steps, config.choices options each, types from ADVENTURE_NODE_TYPES", () => {
  const map = generateMap(CONFIG, 7);
  assert.equal(map.steps.length, CONFIG.steps);
  for (const step of map.steps) {
    assert.equal(step.options.length, CONFIG.choices);
    for (const opt of step.options) {
      assert.ok(ADVENTURE_NODE_TYPES.includes(opt.type), `unexpected node type "${opt.type}"`);
    }
  }
});

test("generateMap forces every final-step option to battle (the exit guard)", () => {
  for (const seed of [1, 2, 3, 4, 5, 100, 5000]) {
    const map = generateMap(CONFIG, seed);
    const finalStep = map.steps[map.steps.length - 1];
    for (const opt of finalStep.options) {
      assert.equal(opt.type, "battle", `seed ${seed}: final step option must be "battle"`);
    }
  }
});

test("generateMap: over many seeds, every non-final node type appears somewhere", () => {
  const seen = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const map = generateMap(CONFIG, seed);
    for (let i = 0; i < map.steps.length - 1; i++) {
      for (const opt of map.steps[i].options) seen.add(opt.type);
    }
  }
  for (const n of CONFIG.nodes) {
    assert.ok(seen.has(n.type), `node type "${n.type}" was never picked across 300 seeds`);
  }
});

test("deriveNodeSeed returns stable ints in [0, 0x7fffffff) and differs across positions", () => {
  const seed = 12345;
  for (let position = 0; position < 10; position++) {
    const first = deriveNodeSeed(seed, position);
    assert.equal(deriveNodeSeed(seed, position), first, `position ${position} must be stable`);
    assert.ok(Number.isInteger(first));
    assert.ok(first >= 0 && first < 0x7fffffff);
  }
  const values = new Set();
  for (let position = 0; position < 10; position++) values.add(deriveNodeSeed(seed, position));
  assert.ok(values.size > 1, "different positions should (almost always) derive different seeds");
});

test("rollLoot returns a table row's itemId with qty within [qtyMin, qtyMax]", () => {
  const table = [
    { itemId: "it_potion_small", weight: 50, qtyMin: 1, qtyMax: 2 },
    { itemId: "it_enhance_stone", weight: 40, qtyMin: 1, qtyMax: 3 },
    { itemId: "it_summon_scroll", weight: 10, qtyMin: 1, qtyMax: 1 },
  ];
  const rng = makeRng(deriveNodeSeed(999, 2));
  for (let i = 0; i < 20; i++) {
    const { itemId, qty } = rollLoot(table, rng);
    const row = table.find((r) => r.itemId === itemId);
    assert.ok(row, `rollLoot returned unknown itemId "${itemId}"`);
    assert.ok(qty >= row.qtyMin && qty <= row.qtyMax, `qty ${qty} out of bounds for ${itemId}`);
  }
});

const ENCOUNTERS = [
  { speciesId: "sp_vorth", weight: 40 },
  { speciesId: "sp_mesha", weight: 35 },
  { speciesId: "sp_gronk", weight: 25 },
];

test("rollEncounter is deterministic: same encounters + seeded rng state always returns the same n draws", () => {
  for (const seed of [1, 42, 12345, 999999]) {
    const first = rollEncounter(ENCOUNTERS, makeRng(seed), 3);
    const second = rollEncounter(ENCOUNTERS, makeRng(seed), 3);
    assert.deepEqual(second, first, `seed ${seed} must reproduce the same draws`);
  }
});

test("rollEncounter shape: returns n speciesIds, all from the table (with replacement)", () => {
  const rng = makeRng(2024);
  const known = new Set(ENCOUNTERS.map((e) => e.speciesId));
  const draws = rollEncounter(ENCOUNTERS, rng, 3);
  assert.equal(draws.length, 3);
  for (const speciesId of draws) {
    assert.ok(known.has(speciesId), `rollEncounter returned unknown speciesId "${speciesId}"`);
  }
});

test("rollEncounter: over many seeds, every table entry gets drawn at least once", () => {
  const seen = new Set();
  for (let seed = 0; seed < 300; seed++) {
    for (const speciesId of rollEncounter(ENCOUNTERS, makeRng(seed), 3)) seen.add(speciesId);
  }
  for (const e of ENCOUNTERS) {
    assert.ok(seen.has(e.speciesId), `speciesId "${e.speciesId}" was never drawn across 300 seeds`);
  }
});

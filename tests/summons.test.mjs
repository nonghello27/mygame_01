// Summon Hall master-data grammar checks (Phase 7.4 step A) — the same role
// tests/items.test.mjs plays for ITEMS/EQUIPMENT/RUNES: every row of the
// seed content must pass its own validator unchanged, and rollSummon()'s
// weighted draw must be deterministic (CLAUDE.md §1.6) and actually give
// every pool entry a shot over enough seeds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SUMMONS } from "../src/data/summons.js";
import { ITEMS } from "../src/data/items.js";
import { ROSTER_A, ROSTER_B } from "../src/data/units.js";
import { validateSummon } from "../server/services/adminValidate.js";
import { rollSummon } from "../shared/rules/summon.js";

test("summon ids are unique, sm_-prefixed, and every row validates unchanged", () => {
  const ids = SUMMONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate summon id");
  for (const id of ids) assert.match(id, /^sm_[a-z0-9_]+$/);

  for (const sm of SUMMONS) {
    const v = validateSummon(sm);
    assert.equal(v.id, sm.id);
    assert.equal(v.name, sm.name);
    assert.deepEqual(v.cost, sm.cost, `${sm.id}: cost changed in validation`);
    assert.deepEqual(v.pool, sm.pool, `${sm.id}: pool changed in validation`);
  }
});

test("every pool speciesId is a real species id derived from src/data/units.js", () => {
  const speciesIds = new Set([...ROSTER_A, ...ROSTER_B].map((u) => "sp_" + u.name.toLowerCase()));
  for (const sm of SUMMONS) {
    for (const p of sm.pool) {
      assert.ok(speciesIds.has(p.speciesId), `${sm.id}: pool speciesId "${p.speciesId}" is not a known species`);
    }
  }
});

test("every item cost's itemId exists in src/data/items.js", () => {
  const itemIds = new Set(ITEMS.map((i) => i.id));
  for (const sm of SUMMONS) {
    for (const c of sm.cost.filter((c) => c.type === "item")) {
      assert.ok(itemIds.has(c.itemId), `${sm.id}: cost itemId "${c.itemId}" is not a known item`);
    }
  }
});

test("rollSummon is deterministic: same pool + seed always returns the same speciesId", () => {
  const pool = [
    { speciesId: "sp_vorth", weight: 40 },
    { speciesId: "sp_mesha", weight: 35 },
    { speciesId: "sp_gronk", weight: 25 },
  ];
  for (const seed of [1, 42, 12345, 999999]) {
    const first = rollSummon(pool, seed);
    for (let i = 0; i < 5; i++) {
      assert.equal(rollSummon(pool, seed), first, `seed ${seed} must reproduce the same pick`);
    }
  }
});

test("rollSummon gives every pool entry a shot over enough seeds", () => {
  const pool = [
    { speciesId: "sp_vorth", weight: 25 },
    { speciesId: "sp_mesha", weight: 20 },
    { speciesId: "sp_gronk", weight: 20 },
    { speciesId: "sp_garran", weight: 15 },
    { speciesId: "sp_sile", weight: 10 },
    { speciesId: "sp_brak", weight: 10 },
  ];
  const seen = new Set();
  for (let seed = 0; seed < 400; seed++) {
    seen.add(rollSummon(pool, seed));
  }
  for (const p of pool) {
    assert.ok(seen.has(p.speciesId), `${p.speciesId} was never picked across 400 seeds`);
  }
});

// Item/equipment/rune master-data grammar checks (Phase 7.1) — the same
// role tests/jobs.test.mjs plays for JOBS: every row of the seed content
// must pass its own validator unchanged, and ids must be unique per file,
// so a malformed row is caught here instead of failing silently at
// db:seed or (worse) at grant/consume time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS } from "../src/data/items.js";
import { EQUIPMENT } from "../src/data/equipment.js";
import { RUNES } from "../src/data/runes.js";
import { validateItem, validateEquipment, validateRune } from "../server/services/adminValidate.js";

test("item ids are unique and every row validates unchanged", () => {
  const ids = ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate item id");
  for (const it of ITEMS) {
    const v = validateItem(it);
    assert.equal(v.id, it.id);
    assert.equal(v.kind, it.kind);
    assert.equal(v.name, it.name);
  }
});

test("equipment ids are unique and every row validates unchanged", () => {
  const ids = EQUIPMENT.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate equipment id");
  for (const eq of EQUIPMENT) {
    const v = validateEquipment(eq);
    assert.equal(v.id, eq.id);
    assert.equal(v.domain, eq.domain);
    assert.equal(v.slot, eq.slot);
    assert.deepEqual(v.effects, eq.effects, `${eq.id}: effects changed in validation`);
    assert.deepEqual(v.enhance, eq.enhance ?? null, `${eq.id}: enhance changed in validation`);
  }
});

test("equipment covers both domains and more than one slot", () => {
  const domains = new Set(EQUIPMENT.map((e) => e.domain));
  assert.ok(domains.has("monster") && domains.has("trainer"), "both domains represented");
  const slots = new Set(EQUIPMENT.map((e) => e.slot));
  assert.ok(slots.size > 1, "more than one slot represented");
});

test("rune ids are unique and every row validates unchanged", () => {
  const ids = RUNES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate rune id");
  for (const rn of RUNES) {
    const v = validateRune(rn);
    assert.equal(v.id, rn.id);
    assert.deepEqual(v.effects, rn.effects, `${rn.id}: effects changed in validation`);
    assert.equal(v.maxCharges, rn.maxCharges);
    assert.equal(v.repairGold, rn.repairGold);
  }
});

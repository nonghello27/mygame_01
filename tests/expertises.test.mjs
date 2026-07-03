// Trainer-skill master-data grammar checks. Balance numbers are free to
// change; the SHAPE is not — the engine will interpret these effects with
// the same closed op set it already uses for monster skills (applyEffect()
// in shared/engine/resolve.js), so a malformed row would fail silently once
// PVP battles start consuming them. Catch it here instead, before it ever
// reaches db:seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPERTISES } from "../src/data/expertises.js";
import { TARGETING } from "../shared/rules/targeting.js";
import { STATUSES } from "../shared/rules/statuses.js";

const TRIGGERS = ["battle_start", "after_ally_turns"];
const OPS = ["perm_stat", "heal", "apply_status"];

function allSkills() {
  return EXPERTISES.flatMap((ex) => ex.skills.map((sk) => ({ expertise: ex.id, ...sk })));
}

test("expertise ids are unique, stable-looking strings", () => {
  const ids = EXPERTISES.map((ex) => ex.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate expertise id");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9_]+$/);
});

test("every expertise has a name and at least one skill", () => {
  for (const ex of EXPERTISES) {
    assert.ok(typeof ex.name === "string" && ex.name.length > 0, `${ex.id}: name`);
    assert.ok(Array.isArray(ex.skills) && ex.skills.length > 0, `${ex.id}: skills`);
  }
});

test("trainer skill ids are unique and ts_-prefixed", () => {
  const ids = allSkills().map((sk) => sk.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate trainer skill id");
  for (const id of ids) assert.match(id, /^ts_[a-z0-9_]+$/);
});

test("every trainer skill has a name and at least one effect", () => {
  for (const sk of allSkills()) {
    assert.ok(typeof sk.name === "string" && sk.name.length > 0, `${sk.id}: name`);
    assert.ok(Array.isArray(sk.data?.effects) && sk.data.effects.length > 0, `${sk.id}: effects`);
  }
});

test("every effect uses a known trigger and op", () => {
  for (const sk of allSkills()) {
    for (const fx of sk.data.effects) {
      assert.ok(TRIGGERS.includes(fx.when), `${sk.id}: when ${fx.when}`);
      assert.ok(OPS.includes(fx.op), `${sk.id}: op ${fx.op}`);
    }
  }
});

test("every effect sets an explicit target with a known rule", () => {
  for (const sk of allSkills()) {
    for (const fx of sk.data.effects) {
      assert.ok(fx.target && typeof fx.target === "object", `${sk.id}: target`);
      assert.ok(fx.target.rule in TARGETING, `${sk.id}: target.rule ${fx.target.rule}`);
      assert.ok(
        fx.target.count === "all" || Number.isInteger(fx.target.count),
        `${sk.id}: target.count ${fx.target.count}`
      );
    }
  }
});

test("apply_status effects name a known status with numeric turns/pct/chance", () => {
  for (const sk of allSkills()) {
    for (const fx of sk.data.effects.filter((f) => f.op === "apply_status")) {
      assert.ok(fx.status in STATUSES, `${sk.id}: status ${fx.status}`);
      assert.ok(Number.isInteger(fx.turns) && fx.turns > 0, `${sk.id}: turns`);
      if (fx.pct !== undefined) assert.ok(typeof fx.pct === "number", `${sk.id}: pct`);
      if (fx.chance !== undefined) assert.ok(typeof fx.chance === "number", `${sk.id}: chance`);
    }
  }
});

test("perm_stat and heal effects carry numeric magnitudes", () => {
  for (const sk of allSkills()) {
    for (const fx of sk.data.effects) {
      if (fx.op === "perm_stat") {
        assert.ok(typeof fx.stat === "string" && fx.stat.length > 0, `${sk.id}: stat`);
        assert.ok(
          typeof fx.pct === "number" || typeof fx.flat === "number",
          `${sk.id}: pct or flat`
        );
      } else if (fx.op === "heal") {
        assert.ok(typeof fx.pct === "number" && fx.pct > 0, `${sk.id}: heal pct`);
      }
    }
  }
});

test("every effect's perLevel, when present, is a number", () => {
  for (const sk of allSkills()) {
    for (const fx of sk.data.effects) {
      if (fx.perLevel !== undefined) assert.ok(typeof fx.perLevel === "number", `${sk.id}: perLevel`);
    }
  }
});

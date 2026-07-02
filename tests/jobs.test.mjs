// Job master-data grammar checks. Balance numbers are free to change; the
// SHAPE is not — the settlement code and the farm UI both interpret rewards
// by kind, so a malformed row would fail silently at payout time. Catch it
// here instead, before it ever reaches db:seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS } from "../src/data/jobs.js";

const ATTRS = ["str", "agi", "vit", "int", "dex"];

test("job ids are unique, stable-looking strings", () => {
  const ids = JOBS.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate job id");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9_]+$/);
});

test("every job has a valid kind, name, and positive duration", () => {
  for (const j of JOBS) {
    assert.ok(["work", "training"].includes(j.kind), `${j.id}: kind ${j.kind}`);
    assert.ok(typeof j.name === "string" && j.name.length > 0, `${j.id}: name`);
    assert.ok(Number.isInteger(j.durationS) && j.durationS > 0, `${j.id}: durationS`);
  }
});

test("work rewards pay the trainer: { gold, trainerExp } positive integers", () => {
  for (const j of JOBS.filter((x) => x.kind === "work")) {
    assert.ok(Number.isInteger(j.rewards.gold) && j.rewards.gold > 0, `${j.id}: gold`);
    assert.ok(
      Number.isInteger(j.rewards.trainerExp) && j.rewards.trainerExp > 0,
      `${j.id}: trainerExp`
    );
  }
});

test("training rewards grow one known attribute: { attr, gain }", () => {
  for (const j of JOBS.filter((x) => x.kind === "training")) {
    assert.ok(ATTRS.includes(j.rewards.attr), `${j.id}: attr ${j.rewards.attr}`);
    assert.ok(Number.isInteger(j.rewards.gain) && j.rewards.gain > 0, `${j.id}: gain`);
  }
});

test("every trainable attribute has a training job", () => {
  const covered = new Set(
    JOBS.filter((j) => j.kind === "training").map((j) => j.rewards.attr)
  );
  assert.deepEqual([...covered].sort(), [...ATTRS].sort());
});

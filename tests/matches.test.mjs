// Pure-logic tests for the match service: the permutation gate that stands
// between a client-supplied lane order and the battle engine. (The DB-touching
// create/resolve paths are exercised against a real database, not here.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder } from "../server/services/matches.js";

const roster = [
  { idx: 0, name: "front" },
  { idx: 1, name: "mid" },
  { idx: 2, name: "back" },
];

test("a valid permutation reorders the snapshot", () => {
  assert.deepEqual(
    applyOrder(roster, [2, 0, 1]).map((u) => u.name),
    ["back", "front", "mid"]
  );
});

test("identity order keeps the snapshot as-is", () => {
  assert.deepEqual(applyOrder(roster, [0, 1, 2]), roster);
});

test("rejects duplicated lanes (unit-cloning attempt)", () => {
  assert.throws(() => applyOrder(roster, [0, 0, 1]), /illegal order/);
});

test("rejects wrong length (dropping a weak unit)", () => {
  assert.throws(() => applyOrder(roster, [0, 1]), /permutation/);
  assert.throws(() => applyOrder(roster, [0, 1, 2, 2]), /permutation/);
});

test("rejects out-of-range and non-integer lanes", () => {
  assert.throws(() => applyOrder(roster, [0, 1, 3]), /illegal order/);
  assert.throws(() => applyOrder(roster, [0, 1, -1]), /illegal order/);
  assert.throws(() => applyOrder(roster, [0, 1, 1.5]), /illegal order/);
  assert.throws(() => applyOrder(roster, [0, 1, "2"]), /illegal order/);
});

test("rejects non-arrays", () => {
  for (const bad of [null, undefined, "012", { 0: 0 }]) {
    assert.throws(() => applyOrder(roster, bad), /permutation/);
  }
});

test("validation errors carry HTTP 400 for the api layer", () => {
  try {
    applyOrder(roster, null);
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal(e.status, 400);
  }
});

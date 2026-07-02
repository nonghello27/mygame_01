import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, makeRng } from "../shared/engine/rng.js";

test("same seed reproduces the same sequence (determinism)", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test("mulberry32(1) golden sequence is stable across refactors", () => {
  // If this changes, every stored match seed replays differently — that is a
  // breaking change to persisted battles, not a refactor.
  const r = mulberry32(1);
  const got = Array.from({ length: 4 }, () => r());
  assert.deepEqual(got, [
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
  ]);
});

test("different seeds diverge", () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test("int(min,max) stays in bounds and hits both ends", () => {
  const rng = makeRng(42);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
});

test("chance(pct) respects the edges and tracks the rate", () => {
  const rng = makeRng(7);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    assert.equal(makeRng(i).chance(0), false);
    if (rng.chance(30)) hits++;
  }
  const rate = hits / 2000;
  assert.ok(rate > 0.25 && rate < 0.35, `30% chance measured at ${rate}`);
});

test("pick() only returns array members", () => {
  const rng = makeRng(99);
  const arr = ["x", "y", "z"];
  for (let i = 0; i < 300; i++) assert.ok(arr.includes(rng.pick(arr)));
});

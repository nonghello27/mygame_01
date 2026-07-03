// Golden-log tests for the battle engine. Given the same snapshots + seed the
// engine must always produce the exact same event log. If a rules change
// makes one of these fail INTENTIONALLY, inspect the diff, then regenerate
// (node tests/golden/regen.mjs) in the same commit as the rules change —
// never regenerate to silence a failure you can't explain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveBattle } from "../shared/engine/resolve.js";
import { BATTLES } from "./fixtures.mjs";

const golden = (name) =>
  JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), "utf8"));

for (const [name, { seed, rosterA, rosterB, trainers }] of Object.entries(BATTLES)) {
  test(`${name} (seed ${seed}) reproduces its golden log exactly`, () => {
    assert.deepEqual(resolveBattle(rosterA, rosterB, seed, trainers), golden(name));
  });
}

test("engine invariants hold on the golden logs", () => {
  for (const name of Object.keys(BATTLES)) {
    const { youWin, draw, survivor, events } = golden(name);
    if (!draw) assert.equal(survivor.side, youWin ? "a" : "b");
    for (const e of events) {
      if (e.t === "strike" || e.t === "dot") {
        assert.equal(e.after, Math.max(0, e.before - e.dmg), "damage math must be consistent");
        assert.ok(e.after >= 0, "hp never negative");
      }
      if (e.t === "strike") assert.notEqual(e.att.side, e.def.side, "no friendly fire");
      if (e.t === "heal") assert.equal(e.after, e.before + e.amount);
    }
    const falls = events.filter((e) => e.t === "fall");
    if (!draw) {
      assert.ok(falls.length >= 1);
      assert.notEqual(falls[falls.length - 1].side, survivor.side, "last to fall is on the losing side");
    }
  }
});

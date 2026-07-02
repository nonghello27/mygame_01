// Golden-log tests for the battle engine. The engine is deterministic, so a
// fixture roster must always produce the exact same event log. If a rules
// change makes one of these fail INTENTIONALLY, inspect the diff, then
// regenerate (node tests/golden/regen.mjs) in the same commit as the rules
// change — never regenerate to silence a failure you can't explain.
//
// Engine v2 (roadmap Phase 3) must keep these passing in its melee/flat-damage
// configuration before growing new mechanics: that is the v1-parity gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveBattle } from "../shared/engine/resolve.js";
import { BATTLES } from "./fixtures.mjs";

const golden = (name) =>
  JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), "utf8"));

for (const [name, { rosterA, rosterB }] of Object.entries(BATTLES)) {
  test(`${name} reproduces its golden log exactly`, () => {
    assert.deepEqual(resolveBattle(rosterA, rosterB), golden(name));
  });
}

test("engine invariants hold on the golden logs", () => {
  for (const name of Object.keys(BATTLES)) {
    const { youWin, survivor, events } = golden(name);
    assert.equal(survivor.side, youWin ? "a" : "b");
    for (const e of events) {
      if (e.t !== "strike") continue;
      assert.equal(e.after, Math.max(0, e.before - e.dmg), "strike math must be consistent");
      assert.notEqual(e.att.side, e.def.side, "no friendly fire in v1");
    }
    const last = events[events.length - 1];
    assert.equal(last.t, "fall", "battle ends when the last loser falls");
    assert.notEqual(last.side, survivor.side);
  }
});

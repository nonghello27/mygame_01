// pickParty() grammar checks (Phase 10.2): the battlefield party picker's
// pure selection logic — no DB, no HTTP. Mirrors saveDefense's validation
// ladder (server/services/pvp.js) plus the one new rule a live match needs
// that a passive defense formation doesn't: the picked monsters must
// actually be available right now, not just owned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickParty } from "../server/services/matches.js";

const rosterOf = (ids) => ids.map((id) => ({ id }));

// A roster of 4 owned monsters; #4 is busy (owned but not currently available).
const roster = rosterOf([1, 2, 3, 4]);
const available = rosterOf([1, 2, 3]);

const rejects = (fn, status, why) => assert.throws(fn, (e) => e.status === status, why);

test("null monsterIds returns the first TEAM_SIZE available monsters, in order", () => {
  const picked = pickParty(roster, available, null);
  assert.deepEqual(picked.map((m) => m.id), [1, 2, 3]);
});

test("happy path returns the caller's own order, not roster/available order", () => {
  const picked = pickParty(roster, available, [3, 1, 2]);
  assert.deepEqual(picked.map((m) => m.id), [3, 1, 2]);
});

test("wrong count (not exactly 3) throws 400", () => {
  rejects(() => pickParty(roster, available, [1, 2]), 400, "2 ids");
  rejects(() => pickParty(roster, available, [1, 2, 3, 4]), 400, "4 ids");
  rejects(() => pickParty(roster, available, []), 400, "0 ids");
});

test("non-integer / non-numeric ids throw 400", () => {
  rejects(() => pickParty(roster, available, [1, 2, "not-a-number"]), 400, "non-numeric");
  rejects(() => pickParty(roster, available, [1, 2, 1.5]), 400, "fractional");
  rejects(() => pickParty(roster, available, [1, 2, 0]), 400, "zero/non-positive");
});

test("duplicate ids throw 400", () => {
  rejects(() => pickParty(roster, available, [1, 1, 2]), 400, "duplicate");
});

test("an id not on the roster (unowned) throws 400", () => {
  rejects(() => pickParty(roster, available, [1, 2, 99]), 400, "unowned id");
});

test("an owned but busy id (in roster, not in available) throws 409", () => {
  rejects(() => pickParty(roster, available, [1, 2, 4]), 409, "busy monster");
});

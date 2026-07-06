// Event reward grammar + resolution checks (Phase 9.1) — pure math, no DB.
// Covers the percentile-formula edge cases 9.3's real payout will lean on:
// tiny fields where tiers collapse to a single rank, and the "podium never
// also gets a percentile tier" rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_REWARD_TYPES, validatePercentileCoverage, percentileForRank, resolveRewards,
} from "../shared/rules/rewards.js";

test("EVENT_REWARD_TYPES is the closed list the grammar promises", () => {
  assert.deepEqual(EVENT_REWARD_TYPES, ["gold", "item", "equipment", "rune", "monster"]);
});

test("percentileForRank: the ceiling formula lands every rank in [1,100]", () => {
  assert.equal(percentileForRank(1, 4), 25);
  assert.equal(percentileForRank(4, 4), 100);
  assert.equal(percentileForRank(4, 100), 4);
  assert.equal(percentileForRank(100, 100), 100);
  assert.equal(percentileForRank(1, 1), 100);
});

test("validatePercentileCoverage accepts a full 1-100 partition", () => {
  const tiers = [
    { fromPct: 1, toPct: 50, rewards: [] },
    { fromPct: 51, toPct: 100, rewards: [] },
  ];
  assert.deepEqual(validatePercentileCoverage(tiers), tiers);
});

test("validatePercentileCoverage rejects a gap, an overlap, a bad start, and a bad end", () => {
  assert.throws(() => validatePercentileCoverage([
    { fromPct: 1, toPct: 40, rewards: [] },
    { fromPct: 50, toPct: 100, rewards: [] }, // gap 41-49
  ]), /fromPct must be 41/);
  assert.throws(() => validatePercentileCoverage([
    { fromPct: 1, toPct: 60, rewards: [] },
    { fromPct: 50, toPct: 100, rewards: [] }, // overlap 50-60
  ]), /fromPct must be 61/);
  assert.throws(() => validatePercentileCoverage([
    { fromPct: 2, toPct: 100, rewards: [] }, // doesn't start at 1
  ]), /fromPct must be 1/);
  assert.throws(() => validatePercentileCoverage([
    { fromPct: 1, toPct: 99, rewards: [] }, // doesn't end at 100
  ]), /cover up to pct 100/);
  assert.throws(() => validatePercentileCoverage([]), /non-empty/);
});

// --- resolveRewards ----------------------------------------------------------

const GOLD = (n) => [{ type: "gold", amount: n }];

test("resolveRewards: positions 1/2/3 get position rewards only, never a percentile top-up", () => {
  const placements = [
    { entrantId: "a", rank: 1 },
    { entrantId: "b", rank: 2 },
    { entrantId: "c", rank: 3 },
    { entrantId: "d", rank: 4 },
  ];
  const config = {
    positionRewards: { 1: GOLD(100), 2: GOLD(60), 3: GOLD(30) },
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: GOLD(5) }],
  };
  const out = resolveRewards(placements, config);
  assert.deepEqual(out, [
    { trainerId: "a", rewards: GOLD(100) },
    { trainerId: "b", rewards: GOLD(60) },
    { trainerId: "c", rewards: GOLD(30) },
    { trainerId: "d", rewards: GOLD(5) },
  ]);
});

test("resolveRewards: an absent position key pays nothing extra for that rank (no percentile fallback)", () => {
  const placements = [{ entrantId: "a", rank: 1 }, { entrantId: "b", rank: 2 }];
  const config = {
    positionRewards: { 1: GOLD(100) }, // rank 2 has no entry
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: GOLD(999) }],
  };
  const out = resolveRewards(placements, config);
  assert.deepEqual(out[0], { trainerId: "a", rewards: GOLD(100) });
  assert.deepEqual(out[1], { trainerId: "b", rewards: [] }, "rank 2 with no positionRewards entry pays nothing");
});

test("resolveRewards on a 3-entrant field: rank 3 is a position, no percentile rank exists at all", () => {
  const placements = [
    { entrantId: "a", rank: 1 },
    { entrantId: "b", rank: 2 },
    { entrantId: "c", rank: 3 },
  ];
  const config = {
    positionRewards: { 1: GOLD(100), 2: GOLD(50), 3: GOLD(25) },
    percentileRewards: [{ fromPct: 1, toPct: 100, rewards: GOLD(1) }],
  };
  const out = resolveRewards(placements, config);
  assert.deepEqual(out.map((o) => o.rewards), [GOLD(100), GOLD(50), GOLD(25)]);
});

test("resolveRewards on a 4-entrant field: rank 4's percentile is 100 and lands in exactly one tier", () => {
  const placements = [
    { entrantId: "a", rank: 1 },
    { entrantId: "b", rank: 2 },
    { entrantId: "c", rank: 3 },
    { entrantId: "d", rank: 4 },
  ];
  const config = {
    positionRewards: { 1: GOLD(1), 2: GOLD(1), 3: GOLD(1) },
    percentileRewards: [
      { fromPct: 1, toPct: 99, rewards: GOLD(50) },
      { fromPct: 100, toPct: 100, rewards: GOLD(10) },
    ],
  };
  const out = resolveRewards(placements, config);
  assert.deepEqual(out[3], { trainerId: "d", rewards: GOLD(10) }, "rank 4/4 = pct 100 -> the top-end tier");
});

test("resolveRewards on a 5-entrant field: ranks 4 and 5 each land in exactly one tier", () => {
  // ranks 4,5 of 5 -> pct ceil(4*100/5)=80, ceil(5*100/5)=100
  const placements = [1, 2, 3, 4, 5].map((rank) => ({ entrantId: `e${rank}`, rank }));
  const config = {
    positionRewards: {},
    percentileRewards: [
      { fromPct: 1, toPct: 80, rewards: GOLD(20) },
      { fromPct: 81, toPct: 100, rewards: GOLD(5) },
    ],
  };
  const out = resolveRewards(placements, config);
  assert.deepEqual(out[3], { trainerId: "e4", rewards: GOLD(20) }, "rank 4/5 = pct 80 -> the lower tier (inclusive)");
  assert.deepEqual(out[4], { trainerId: "e5", rewards: GOLD(5) }, "rank 5/5 = pct 100 -> the upper tier");
});

test("resolveRewards on a 100-entrant field: spot-checks land where the formula predicts", () => {
  const placements = Array.from({ length: 100 }, (_, i) => ({ entrantId: `e${i + 1}`, rank: i + 1 }));
  const config = {
    positionRewards: { 1: GOLD(1000), 2: GOLD(500), 3: GOLD(250) },
    percentileRewards: [
      { fromPct: 1, toPct: 10, rewards: GOLD(100) },
      { fromPct: 11, toPct: 50, rewards: GOLD(40) },
      { fromPct: 51, toPct: 100, rewards: GOLD(10) },
    ],
  };
  const out = resolveRewards(placements, config);
  const byId = Object.fromEntries(out.map((o) => [o.trainerId, o.rewards]));
  assert.deepEqual(byId.e1, GOLD(1000), "rank 1 is a position reward");
  assert.deepEqual(byId.e4, GOLD(100), "rank 4 -> pct 4 -> top tier");
  assert.deepEqual(byId.e10, GOLD(100), "rank 10 -> pct 10 -> still top tier (inclusive boundary)");
  assert.deepEqual(byId.e11, GOLD(40), "rank 11 -> pct 11 -> mid tier");
  assert.deepEqual(byId.e50, GOLD(40), "rank 50 -> pct 50 -> still mid tier");
  assert.deepEqual(byId.e51, GOLD(10), "rank 51 -> pct 51 -> bottom tier");
  assert.deepEqual(byId.e100, GOLD(10), "rank 100 -> pct 100 -> bottom tier");
});

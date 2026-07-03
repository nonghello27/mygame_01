// Pure-logic tests for the PVP ladder math: Elo deltas and season-end reward
// tiers. No DB — server/services/pvp.js is the DB-touching half, not covered
// here (same split as tests/matches.test.mjs for applyOrder).

import { test } from "node:test";
import assert from "node:assert/strict";
import { eloDelta, seasonRewardGold, ELO_K } from "../shared/rules/pvp.js";

test("equal ratings, a win, is exactly +K/2", () => {
  assert.equal(eloDelta(1000, 1000, 1), 16);
  assert.equal(ELO_K, 32);
});

test("equal ratings, a loss, is exactly -K/2", () => {
  assert.equal(eloDelta(1000, 1000, 0), -16);
});

test("equal ratings, a draw, is a wash", () => {
  assert.equal(eloDelta(1000, 1000, 0.5), 0);
});

test("win/loss deltas are near-mirrors (rounding may differ by at most 1)", () => {
  for (const [a, b] of [[1000, 1000], [1200, 1000], [900, 1300], [1000, 1001]]) {
    const winnerDelta = eloDelta(a, b, 1);
    const loserDelta = eloDelta(b, a, 0);
    assert.ok(
      Math.abs(winnerDelta - -loserDelta) <= 1,
      `mismatch at (${a},${b}): winner +${winnerDelta}, loser ${loserDelta}`
    );
  }
});

test("an underdog wins more rating than a favorite winning the same way", () => {
  const underdogWin = eloDelta(900, 1300, 1); // big rating gap, lower-rated wins
  const favoriteWin = eloDelta(1300, 900, 1); // big rating gap, higher-rated wins
  assert.ok(underdogWin > favoriteWin, `${underdogWin} should exceed ${favoriteWin}`);
  assert.ok(underdogWin > 16, "underdog win should beat the even-odds baseline");
  assert.ok(favoriteWin < 16, "favorite win should undershoot the even-odds baseline");
});

test("a draw moves ratings toward each other: the higher-rated side loses points", () => {
  const higher = eloDelta(1300, 1000, 0.5);
  const lower = eloDelta(1000, 1300, 0.5);
  assert.ok(higher < 0, `higher-rated draw delta should be negative, got ${higher}`);
  assert.ok(lower > 0, `lower-rated draw delta should be positive, got ${lower}`);
});

test("delta is always clamped within [-K, K]", () => {
  const ratings = [400, 800, 1000, 1200, 1600, 2400];
  for (const a of ratings) {
    for (const b of ratings) {
      for (const score of [0, 0.5, 1]) {
        const d = eloDelta(a, b, score);
        assert.ok(d >= -ELO_K && d <= ELO_K, `eloDelta(${a},${b},${score}) = ${d} out of [-K,K]`);
      }
    }
  }
});

test("seasonRewardGold: no games played this season pays nothing, any rank", () => {
  assert.equal(seasonRewardGold(1, 0), 0);
  assert.equal(seasonRewardGold(50, 0), 0);
});

test("seasonRewardGold tiers: 1st, 2nd-3rd, 4th-10th, everyone else", () => {
  assert.equal(seasonRewardGold(1, 10), 500);
  assert.equal(seasonRewardGold(2, 10), 300);
  assert.equal(seasonRewardGold(3, 10), 300);
  assert.equal(seasonRewardGold(4, 10), 150);
  assert.equal(seasonRewardGold(10, 10), 150);
  assert.equal(seasonRewardGold(11, 10), 50);
  assert.equal(seasonRewardGold(9999, 10), 50);
});

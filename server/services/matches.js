// Match use-cases: create a session, resolve it once. This is where the
// anti-tamper design lives (ARCHITECTURE §6):
//
//   createMatch  — SERVER picks the defender team and its lane order, mints
//                  the RNG seed, and snapshots the attacker's real stats.
//                  Everything the battle will use is frozen in the DB now.
//   resolveMatch — the client contributes exactly ONE thing: the lane order
//                  of its own snapshot (a permutation, validated). The result
//                  persists on the row; a second resolve attempt loses.

import { randomUUID } from "node:crypto";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { deriveStats } from "../../shared/rules/formulas.js";
import { eloDelta } from "../../shared/rules/pvp.js";
import { httpError } from "../http.js";
import { listSpecies, listStarterSpecies } from "../repos/species.js";
import { listMonstersByTrainer, grantStarters } from "../repos/monsters.js";
import { insertMatch, getMatch, claimResolve } from "../repos/matches.js";
import { ensureSeason } from "./pvp.js";
import { ensureRankEntry, applyRatingResult } from "../repos/pvp.js";
import { settleActivities } from "./activities.js";

// Exported: server/services/pvp.js reuses this exact team size for PVP
// attacker-side selection (same rule as free play).
export const TEAM_SIZE = 3;

/** @returns {Promise<{matchId:string, you:object[], enemy:object[]}>} */
export async function createMatch(sql, trainerId) {
  // The trainer's own team — starters are granted on first need (lazy, like
  // everything else). Wire shape: idx is the lane identity the client and
  // server exchange; stats ride along for display but the DB copy is what
  // the resolve step will use.
  //
  // Settle finished jobs first, then honor the busy lock: a monster that is
  // out working or training can't be frozen into a new match snapshot.
  await settleActivities(sql, trainerId);
  let roster = await listMonstersByTrainer(sql, trainerId);
  if (roster.length === 0) {
    roster = await grantStarters(sql, trainerId, await listStarterSpecies(sql));
  }
  const available = roster.filter((m) => !m.busyUntil || new Date(m.busyUntil) <= new Date());
  if (available.length < TEAM_SIZE) {
    throw httpError(409, "not enough available monsters — some are still working or training");
  }
  const attacker = available.slice(0, TEAM_SIZE).map(toLane);

  // Server-picked opponent: random species, random lane order, frozen in the
  // snapshot. (Phase 6 swaps this for another trainer's defense formation.)
  const species = await listSpecies(sql);
  const defender = shuffle(species).slice(0, TEAM_SIZE).map(toLane);
  if (attacker.length === 0 || defender.length === 0) {
    throw httpError(500, "no monsters available — is master data seeded?");
  }

  const match = {
    id: randomUUID(),
    attackerId: trainerId,
    // v1 combat is deterministic, but the seed is minted and stored from day
    // one so every persisted match is replayable when engine v2 starts rolling.
    seed: Math.floor(Math.random() * 0x7fffffff),
    attackerSnapshot: attacker,
    defenderSnapshot: defender,
  };
  await insertMatch(sql, match);
  return { matchId: match.id, seed: match.seed, you: attacker, enemy: defender };
}

/** @returns the battle result {youWin, survivor, events}, now persisted. */
export async function resolveMatch(sql, trainerId, matchId, playerOrder) {
  const match = await getMatch(sql, String(matchId ?? ""));
  // 404 for both "no such match" and "someone else's match": don't leak which.
  if (!match || match.attackerId !== trainerId) throw httpError(404, "match not found");
  if (match.status !== "open") throw httpError(409, "match already resolved — start a new one");

  const rosterA = applyOrder(match.attackerSnapshot, playerOrder);
  const rosterB = match.defenderSnapshot; // lane order fixed at creation, by the server

  // Snapshots + stored seed in, deterministic event log out: this exact
  // battle can be re-derived from the match row forever. A free match has no
  // trainer skills frozen in (both null) — resolveBattle treats that exactly
  // like {} (Step 2 guarantee), so free-match behavior is unchanged.
  const result = resolveBattle(rosterA, rosterB, match.seed, {
    a: { skills: match.attackerTrainer ?? [] },
    b: { skills: match.defenderTrainer ?? [] },
  });

  // PVP rating: computed BEFORE the claim (so both attackerTrainer/defenderId
  // are still the frozen snapshot values) and attached into the persisted
  // result for an auditable record, but only APPLIED to rank_entries after
  // we've actually won the resolve claim — a lost claim (409, someone else
  // resolved first) must not double-apply a rating change.
  let pvpApply = null;
  if (match.kind === "pvp") {
    const season = await ensureSeason(sql);
    const [attackerEntry, defenderEntry] = await Promise.all([
      ensureRankEntry(sql, season.id, match.attackerId),
      ensureRankEntry(sql, season.id, match.defenderId),
    ]);
    const outcome = result.draw ? "draw" : result.youWin ? "win" : "loss";
    const scoreA = result.draw ? 0.5 : result.youWin ? 1 : 0;
    const deltaA = eloDelta(attackerEntry.rating, defenderEntry.rating, scoreA);
    const deltaB = eloDelta(defenderEntry.rating, attackerEntry.rating, 1 - scoreA);
    result.pvp = { yourDelta: deltaA, theirDelta: deltaB, yourRating: attackerEntry.rating + deltaA };
    pvpApply = { seasonId: season.id, deltaA, deltaB, outcome };
  }

  if (!(await claimResolve(sql, match.id, result))) {
    throw httpError(409, "match already resolved — start a new one");
  }

  // NOTE: a crash between claimResolve succeeding and this applying would
  // leave the rating update unapplied even though the result (with its
  // intended pvp.{yourDelta,theirDelta}) is already persisted — accepted for
  // now; the persisted result JSONB keeps the intended deltas auditable so a
  // reconciliation pass could replay them later if this ever matters.
  if (pvpApply) {
    await applyRatingResult(
      sql, pvpApply.seasonId, match.attackerId, match.defenderId,
      pvpApply.deltaA, pvpApply.deltaB, pvpApply.outcome
    );
  }

  return result;
}

/**
 * Reorder a snapshot by a client-supplied permutation, rejecting anything that
 * is not a bijection over [0..n-1]. This stops a hacked client from duplicating
 * a strong unit, dropping a weak one, or smuggling in an out-of-range lane.
 * Stats always come from the snapshot (the DB).
 */
export function applyOrder(roster, order) {
  const n = roster.length;
  if (!Array.isArray(order) || order.length !== n) {
    throw httpError(400, `order must be a permutation of ${n} lanes`);
  }
  const seen = new Set();
  const out = [];
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) {
      throw httpError(400, `illegal order: ${JSON.stringify(order)}`);
    }
    seen.add(i);
    out.push(roster[i]);
  }
  return out;
}

/**
 * A snapshot lane: identity + traits + DERIVED battle stats + skills, frozen
 * at match creation. Derivation happens exactly once, here — the engine and
 * the client both consume these numbers as-is (single source of truth).
 */
// Exported: server/services/pvp.js reuses this for a defense formation's
// lanes rather than duplicating the derivation.
export const toLane = (m, i) => ({
  idx: i,
  // owned monsters have numeric ids; species-built (wild) lanes have none
  monsterId: typeof m.id === "number" ? m.id : null,
  speciesId: m.speciesId ?? m.id,
  name: m.name,
  cls: m.cls,
  emoji: m.emoji,
  sprite: m.sprite,
  element: m.element,
  attackKind: m.attackKind,
  attackStyle: m.attackStyle,
  targeting: m.targeting,
  attrs: m.attrs,
  ...deriveStats(m.base, m.attrs),
  skills: m.skills ?? [],
});

/** Fisher–Yates on a copy. Match composition randomness is not part of battle
 *  determinism — the snapshot freezes whatever was picked. */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

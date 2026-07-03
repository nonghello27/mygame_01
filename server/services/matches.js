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
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes, applyRuneWear } from "../repos/runes.js";
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
  // Equipped monster-domain gear AND socketed runes ride along in the lane
  // (Phase 7.2 step C / 7.3 step C) — both grouped per monster since a lane
  // only knows its own monster's pieces. Free matches deliberately do NOT
  // freeze trainer-domain equipment, same parity as trainer skills (Phase 6):
  // those are PVP-only auras. Runes have no trainer-domain equivalent.
  const equipByMonster = groupByMonster(await listEquippedMonsterEquipment(sql, trainerId));
  const runesByMonster = groupByMonster(await listSocketedRunes(sql, trainerId));
  const attacker = available.slice(0, TEAM_SIZE).map((m, i) =>
    toLane(m, i, equipByMonster.get(m.id) ?? [], runesByMonster.get(m.id) ?? [])
  );

  // Server-picked opponent: random species, random lane order, frozen in the
  // snapshot. (Phase 6 swaps this for another trainer's defense formation.)
  // Wild lanes never carry equipment or runes — .map((m, i) => toLane(m, i))
  // rather than the bare .map(toLane): Array#map also passes (index, array)
  // to its callback, and toLane's 3rd/4th params ARE equipment/runes, so a
  // bare `.map(toLane)` would leak the whole source array in as "equipment".
  const species = await listSpecies(sql);
  const defender = shuffle(species).slice(0, TEAM_SIZE).map((m, i) => toLane(m, i));
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
  // trainer skills/equipment frozen in (both null) — normalizeTrainer treats
  // that exactly like {skills:[], equipment:[]} (Step 2 guarantee), so
  // free-match behavior is unchanged.
  //
  // normalizeTrainer also carries matches created before this deploy: those
  // rows freeze the OLD bare-array shape (`attacker_trainer` = a skills
  // array, not {skills, equipment}) since trainer equipment didn't exist yet
  // — a match still open across the deploy boundary must resolve exactly as
  // it would have before, so an array is read as "just skills, no equipment"
  // rather than crashing on `.skills`.
  const normalizeTrainer = (t) =>
    Array.isArray(t) ? { skills: t, equipment: [] } : { skills: t?.skills ?? [], equipment: t?.equipment ?? [] };
  const result = resolveBattle(rosterA, rosterB, match.seed, {
    a: normalizeTrainer(match.attackerTrainer),
    b: normalizeTrainer(match.defenderTrainer),
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
  // leave the rating update (and, since 7.3, rune durability) unapplied even
  // though the result (with its intended pvp.{yourDelta,theirDelta} and the
  // engine's runeUse tally) is already persisted — accepted for now; the
  // persisted result JSONB keeps both auditable so a reconciliation pass
  // could replay them later if this ever matters.
  if (pvpApply) {
    await applyRatingResult(
      sql, pvpApply.seasonId, match.attackerId, match.defenderId,
      pvpApply.deltaA, pvpApply.deltaB, pvpApply.outcome
    );
  }

  // Rune durability (Phase 7.3 step C): only ATTACKER-owned rune instances
  // wear, in both free and PVP matches — a free match's wild defender has no
  // instance ids to wear anyway (result.runeUse.b would be keyed by whatever
  // the wild lane's runes[] carried, i.e. nothing), and a PVP defender's
  // runes deliberately do NOT decay while they're offline (ROADMAP 7.3's
  // locked design decision) even though they still affected the fight.
  // Settled only after the resolve claim is won, same once-only reasoning as
  // Elo above — a losing/replayed resolve must not double-wear.
  await applyRuneWear(sql, match.attackerId, result.runeUse?.a);

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
 * A snapshot lane: identity + traits + DERIVED battle stats + skills +
 * equipped monster-domain gear + socketed runes, frozen at match creation.
 * Derivation happens exactly once, here — the engine and the client both
 * consume these numbers as-is (single source of truth). `deriveStats()`
 * itself stays untouched by equipment or runes (CLAUDE.md): both apply
 * inside the engine as data-driven effect sources (battle_start perm_stat
 * for equipment/some rune effects, target_select override for runes' other
 * shape), same grammar as a passive skill, never baked into these base
 * numbers.
 */
// Exported: server/services/pvp.js reuses this for a defense formation's
// lanes rather than duplicating the derivation.
export const toLane = (m, i, equipment = [], runes = []) => ({
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
  // Each entry already shaped {id, name, level, effects} by
  // listEquippedMonsterEquipment — id is the equipment_defs id, level is
  // enhance_level + 1 (see that repo function for why).
  equipment,
  // Each entry already shaped {instanceId, id, name, level, chargesLeft,
  // effects} by listSocketedRunes — id is the rune_defs id, instanceId is
  // the owned rune row's id (what the engine's runeUse tally and
  // applyRuneWear key durability off of).
  runes,
});

/**
 * Group a snapshot-read's rows (one row per piece, each tagged with the
 * owning monster's id) into a Map of monsterId -> lane-shaped array, so each
 * lane can pull just its own monster's pieces. Generic over the row shape —
 * used for both listEquippedMonsterEquipment's rows (equipment) and
 * listSocketedRunes' rows (runes). Shared by createMatch and pvp.js's
 * createPvpMatch (attacker AND defender sides) so the grouping logic lives
 * in exactly one place.
 */
export function groupByMonster(rows) {
  const byMonster = new Map();
  for (const { monsterId, ...piece } of rows) {
    if (!byMonster.has(monsterId)) byMonster.set(monsterId, []);
    byMonster.get(monsterId).push(piece);
  }
  return byMonster;
}

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

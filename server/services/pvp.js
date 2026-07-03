// PVP use-cases (Phase 6 step 4): defense formations, the lazy season
// rollover, the ladder read, and matchmaking a PVP attack. Server-authoritative
// throughout — trainerId always comes from the session, never the body; the
// client only ever sends monster ids to save into a formation.

import { randomUUID } from "node:crypto";
import { httpError } from "../http.js";
import { SEASON_LENGTH_DAYS } from "../../shared/rules/pvp.js";
import { listMonstersByTrainer, grantStarters } from "../repos/monsters.js";
import { listStarterSpecies } from "../repos/species.js";
import { insertMatch } from "../repos/matches.js";
import {
  getDefenseFormation, saveDefenseFormation, getFormationMonsters, listPvpCandidates,
  getTrainerSkillsSnapshot, getActiveSeason, insertSeason, claimSeasonClose,
  ensureRankEntry, topEntries, rankOf, payoutSeason,
} from "../repos/pvp.js";
import { settleActivities } from "./activities.js";
import { TEAM_SIZE, toLane } from "./matches.js";

/**
 * Lazy season rollover — the same pattern as settleActivities: no cron, this
 * runs at the top of every PVP read/write and brings the season state up to
 * date before anything else happens.
 *
 *   no active season       -> insert one (008_pvp_guards.sql's partial
 *                              unique index makes "at most one" a DB
 *                              invariant; a lost race just re-reads)
 *   active but past ends_at -> claim the close (claimSeasonClose is the same
 *                              claim-guard shape as claimResolve/settleWork);
 *                              the CLAIM WINNER pays out the season, then
 *                              opens the next one. Everyone else's claim
 *                              fails and they just loop around to read the
 *                              winner's new season.
 *
 * Bounded retry loop instead of recursion: the guard + claim make forward
 * progress guaranteed within a handful of iterations even under contention.
 */
export async function ensureSeason(sql) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let season = await getActiveSeason(sql);
    if (!season) {
      season = await insertSeason(sql, SEASON_LENGTH_DAYS);
      if (!season) continue; // lost the insert race — re-read next loop
    }
    if (new Date(season.endsAt) > new Date()) return season;

    if (await claimSeasonClose(sql, season.id)) {
      await payoutSeason(sql, season.id);
      const next = await insertSeason(sql, SEASON_LENGTH_DAYS);
      if (next) return next;
      // someone else's insert beat ours to the unique slot — loop and read it
    }
  }
  throw httpError(500, "could not establish an active PVP season");
}

/** Everything the ladder screen needs: current season, top 20, and me. */
export async function getLadder(sql, trainerId) {
  const season = await ensureSeason(sql);
  const me = await ensureRankEntry(sql, season.id, trainerId);
  const [top, rank] = await Promise.all([
    topEntries(sql, season.id, 20),
    rankOf(sql, season.id, trainerId),
  ]);
  return {
    season: { id: season.id, endsAt: season.endsAt },
    top,
    me: { ...me, rank },
  };
}

/**
 * Save (upsert) the trainer's 3-monster defense formation. Every id must be
 * owned by this trainer — an id that belongs to someone else 404s exactly
 * like an id that doesn't exist, so a hacked client can't probe other
 * trainers' monster ids. Busy monsters ARE allowed: defense is passive, it
 * never blocks a monster from working/training.
 */
export async function saveDefense(sql, trainerId, monsterIds) {
  await settleActivities(sql, trainerId);

  if (!Array.isArray(monsterIds) || monsterIds.length !== 3) {
    throw httpError(400, "monsterIds must be exactly 3 monster ids");
  }
  const ids = monsterIds.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw httpError(400, "monsterIds must be integer monster ids");
  }
  if (new Set(ids).size !== ids.length) {
    throw httpError(400, "monsterIds must be 3 distinct monsters");
  }

  const roster = await listMonstersByTrainer(sql, trainerId);
  const owned = new Set(roster.map((m) => m.id));
  for (const id of ids) {
    if (!owned.has(id)) throw httpError(404, "monster not found");
  }

  await saveDefenseFormation(sql, trainerId, ids, "Defense");
  return getDefense(sql, trainerId);
}

/** The trainer's saved defense formation with display data, or null. */
export async function getDefense(sql, trainerId) {
  const formation = await getDefenseFormation(sql, trainerId);
  if (!formation) return null;

  const roster = await listMonstersByTrainer(sql, trainerId);
  const byId = new Map(roster.map((m) => [m.id, m]));
  return {
    formationId: formation.formationId,
    name: formation.name,
    slots: formation.slots.map((s) => {
      const m = byId.get(s.monsterId);
      return {
        position: s.position,
        monsterId: s.monsterId,
        name: m?.name ?? null,
        cls: m?.cls ?? null,
        emoji: m?.emoji ?? null,
        sprite: m?.sprite ?? null,
      };
    }),
  };
}

/**
 * Open a PVP match: your own current roster (same selection rule as free
 * play) vs. another trainer's saved defense formation, picked from a small
 * rating-proximity pool. Snapshots + a fresh seed are frozen into the match
 * row exactly like createMatch — the resolve step (server/services/matches.js)
 * is the only place a battle actually runs.
 */
export async function createPvpMatch(sql, trainerId) {
  await settleActivities(sql, trainerId);
  const season = await ensureSeason(sql);
  const me = await ensureRankEntry(sql, season.id, trainerId);

  let roster = await listMonstersByTrainer(sql, trainerId);
  if (roster.length === 0) {
    roster = await grantStarters(sql, trainerId, await listStarterSpecies(sql));
  }
  const available = roster.filter((m) => !m.busyUntil || new Date(m.busyUntil) <= new Date());
  if (available.length < TEAM_SIZE) {
    throw httpError(409, "not enough available monsters — some are still working or training");
  }
  const attacker = available.slice(0, TEAM_SIZE).map(toLane);
  const attackerTrainer = await getTrainerSkillsSnapshot(sql, trainerId);

  // Composition randomness (which opponent, out of the nearby-rating pool) —
  // not battle randomness. Same reasoning as shuffle() in createMatch: it
  // decides WHAT gets frozen into the snapshot, not how the fight plays out.
  const candidates = await listPvpCandidates(sql, trainerId, season.id, me.rating, 5);
  if (candidates.length === 0) {
    throw httpError(409, "no opponents with a defense formation yet");
  }
  const opponent = candidates[Math.floor(Math.random() * candidates.length)];

  const defenderRoster = await getFormationMonsters(sql, opponent.trainerId, "defense");
  if (defenderRoster.length !== TEAM_SIZE) {
    // A candidate is only listed when its formation has exactly 3 slots, so
    // this would mean it changed between the two reads — treat it the same
    // as "no opponent available" rather than freezing a partial team.
    throw httpError(409, "opponent's defense formation is incomplete — try again");
  }
  const defender = defenderRoster.map(toLane);
  const defenderTrainer = await getTrainerSkillsSnapshot(sql, opponent.trainerId);
  await ensureRankEntry(sql, season.id, opponent.trainerId);

  const match = {
    id: randomUUID(),
    attackerId: trainerId,
    seed: Math.floor(Math.random() * 0x7fffffff),
    attackerSnapshot: attacker,
    defenderSnapshot: defender,
    kind: "pvp",
    defenderId: opponent.trainerId,
    attackerTrainer,
    defenderTrainer,
  };
  await insertMatch(sql, match);
  return {
    matchId: match.id,
    seed: match.seed,
    you: attacker,
    enemy: defender,
    opponent: { name: opponent.name, rating: opponent.rating },
  };
}

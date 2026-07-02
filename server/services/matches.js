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
import { listSpecies, listStarterSpecies } from "../repos/species.js";
import { listMonstersByTrainer, grantStarters } from "../repos/monsters.js";
import { insertMatch, getMatch, claimResolve } from "../repos/matches.js";

const TEAM_SIZE = 3;

/** Error with an HTTP status the api/ layer can pass through. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** @returns {Promise<{matchId:string, you:object[], enemy:object[]}>} */
export async function createMatch(sql, trainerId) {
  // The trainer's own team — starters are granted on first need (lazy, like
  // everything else). Wire shape: idx is the lane identity the client and
  // server exchange; stats ride along for display but the DB copy is what
  // the resolve step will use.
  let roster = await listMonstersByTrainer(sql, trainerId);
  if (roster.length === 0) {
    roster = await grantStarters(sql, trainerId, await listStarterSpecies(sql));
  }
  const attacker = roster.slice(0, TEAM_SIZE).map(toLane);

  // Server-picked opponent: random species, random lane order, frozen in the
  // snapshot. (Phase 5 swaps this for another trainer's defense formation.)
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

  const result = resolveBattle(rosterA, rosterB);

  if (!(await claimResolve(sql, match.id, result))) {
    throw httpError(409, "match already resolved — start a new one");
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

const toLane = (m, i) => ({
  idx: i,
  // owned monsters have numeric ids; species-built (wild) lanes have none
  monsterId: typeof m.id === "number" ? m.id : null,
  speciesId: m.speciesId ?? m.id,
  name: m.name,
  cls: m.cls,
  emoji: m.emoji,
  sprite: m.sprite,
  hp: m.hp,
  atk: m.atk,
  spd: m.spd,
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

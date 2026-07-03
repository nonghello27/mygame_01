// Content boundary — the single place the game asks for its DATA (matches,
// classes, sprite manifest) or posts battle choices. Everything authoritative
// comes from the serverless API in /api; core/ and ui/ are untouched because
// they already await these functions. Sprites stay a local manifest for now
// (pure visual config, consumed synchronously by ui/sprite.js).

import { SPRITES } from "../data/sprites.js";

/** GET a JSON endpoint, throwing on a non-2xx so callers fail loudly. */
async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

/** POST a JSON body, surfacing the server's error message on a non-2xx. */
async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `POST ${path} failed: ${res.status}`);
  return data;
}

/** @returns {Promise<Record<string, object>>} class metadata keyed by class name. */
export async function loadClasses() {
  return getJson("/api/classes");
}

/** @returns {Promise<Record<string, object>>} sprite manifest keyed by sprite id. */
export async function loadSprites() {
  return SPRITES;
}

/**
 * Open a match session. The server assembles YOUR team from your owned
 * monsters (granting starters on the very first call) and picks + freezes the
 * enemy team and lane order. Requires login.
 * @param {string} [mode] "pvp" opens a ladder match against another
 *   trainer's saved defense formation; omit (or anything else) for today's
 *   free match against a random species team — existing callers unchanged.
 * @returns {Promise<{matchId:string, you:object[], enemy:object[], opponent?:{name:string,rating:number}}>}
 */
export async function createMatch(mode) {
  return postJson("/api/match", mode ? { mode } : {});
}

/**
 * The farm: job list, your monsters with busy state, running assignments.
 * Reading it also SETTLES anything that finished (lazy time) — `settled`
 * carries what this read paid out, `trainer` the fresh gold/exp.
 * @returns {Promise<{trainer:object, settled:object[], jobs:object[], monsters:object[], active:object[]}>}
 */
export async function loadFarm() {
  return getJson("/api/activities");
}

/**
 * Assign a monster to a job. Two ids — duration and rewards are the server's
 * business. Responds with the same shape as loadFarm().
 */
export async function startJob(monsterId, jobId) {
  return postJson("/api/activities", { monsterId, jobId });
}

/**
 * Resolve a match on the server. The only choice the client sends is the lane
 * ORDER of its own army (a permutation of idx); the server owns the stats,
 * the enemy, and the outcome. Each match resolves exactly once.
 * @param {string} matchId
 * @param {number[]} playerOrder player army lane indices, front-first
 * @returns {Promise<{youWin:boolean, survivor:{side:string,idx:number}|null, events:object[]}>}
 */
export async function requestBattle(matchId, playerOrder) {
  return postJson("/api/battle", { matchId, playerOrder });
}

/**
 * Trainer progression: expertises, trainer skill defs, and this trainer's
 * own expertise/exp/learned skills — everything the Trainer panel needs.
 * @returns {Promise<{expertises:object[], skillDefs:object[], skills:object[], expertise:string|null, exp:number, unlockExp:number}>}
 */
export async function fetchProgression() {
  return getJson("/api/progression");
}

/** Pick (or switch) expertise. Switching wipes both learned skill slots. */
export async function chooseExpertise(expertiseId) {
  return postJson("/api/progression", { expertiseId });
}

/** Learn a trainer skill into a slot, or clear it (skillId: null). */
export async function learnTrainerSkill(slot, skillId) {
  return postJson("/api/trainer-skills", { slot, skillId });
}

/**
 * The trainer's saved PVP defense formation, or null if none is saved yet.
 * @returns {Promise<{formationId:number, name:string, slots:object[]}|null>}
 */
export async function fetchDefense() {
  return getJson("/api/formation");
}

/** Save (upsert) the defense formation as exactly 3 owned monster ids, front-first. */
export async function saveDefense(monsterIds) {
  return postJson("/api/formation", { monsterIds });
}

/**
 * The PVP ladder: current season, top 20, and this trainer's own standing.
 * @returns {Promise<{season:object, top:object[], me:object}>}
 */
export async function fetchLadder() {
  return getJson("/api/ladder");
}

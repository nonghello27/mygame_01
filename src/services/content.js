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
  return getJson("/api/trainer/classes");
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
  return postJson("/api/battle/match", mode ? { mode } : {});
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
  return postJson("/api/battle/resolve", { matchId, playerOrder });
}

/**
 * Trainer progression: expertises, trainer skill defs, and this trainer's
 * own expertise/exp/learned skills — everything the Trainer panel needs.
 * @returns {Promise<{expertises:object[], skillDefs:object[], skills:object[], expertise:string|null, exp:number, unlockExp:number}>}
 */
export async function fetchProgression() {
  return getJson("/api/trainer/progression");
}

/** Pick (or switch) expertise. Switching wipes both learned skill slots. */
export async function chooseExpertise(expertiseId) {
  return postJson("/api/trainer/progression", { expertiseId });
}

/** Learn a trainer skill into a slot, or clear it (skillId: null). */
export async function learnTrainerSkill(slot, skillId) {
  return postJson("/api/trainer/skills", { slot, skillId });
}

/**
 * The trainer's saved PVP defense formation, or null if none is saved yet.
 * @returns {Promise<{formationId:number, name:string, slots:object[]}|null>}
 */
export async function fetchDefense() {
  return getJson("/api/battle/formation");
}

/** Save (upsert) the defense formation as exactly 3 owned monster ids, front-first. */
export async function saveDefense(monsterIds) {
  return postJson("/api/battle/formation", { monsterIds });
}

/**
 * The PVP ladder: current season, top 20, and this trainer's own standing.
 * @returns {Promise<{season:object, top:object[], me:object}>}
 */
export async function fetchLadder() {
  return getJson("/api/battle/ladder");
}

/**
 * The trainer's inventory (Phase 7.1): item stacks, owned equipment
 * (bag + equipped), and owned runes. Pure read — acquisition happens
 * through the admin console's grant control until Phase 7.4.
 * @returns {Promise<{items:object[], equipment:{trainer:object[], monster:object[]}, runes:object[]}>}
 */
export async function fetchInventory() {
  return getJson("/api/trainer/inventory");
}

/**
 * Equip a monster-domain piece onto a monster, or unequip it (monsterId: null).
 * Equipping into an occupied slot auto-returns the previous occupant to the
 * bag — no need to unequip first.
 * @param {number} equipmentId the owned instance's id (inventory row's `id`)
 * @param {number|null} monsterId owned monster id to equip onto, or null to unequip
 * @returns {Promise<object>} the refreshed inventory (same shape as fetchInventory())
 */
export async function equipMonsterEquipment(equipmentId, monsterId) {
  return postJson("/api/trainer/equipment/equip", { domain: "monster", equipmentId, monsterId });
}

/**
 * Equip or unequip a trainer-domain piece (worn by the trainer, not a monster).
 * @param {number} equipmentId the owned instance's id
 * @param {boolean} equip true to equip (into the def's own slot), false to unequip
 * @returns {Promise<object>} the refreshed inventory
 */
export async function equipTrainerEquipment(equipmentId, equip) {
  return postJson("/api/trainer/equipment/equip", { domain: "trainer", equipmentId, equip });
}

/**
 * Raise one owned piece's enhance level by exactly 1, paying its gold (and
 * optional material) cost from the def's enhance curve.
 * @param {'trainer'|'monster'} domain
 * @param {number} equipmentId the owned instance's id
 * @returns {Promise<{gold:number, inventory:object}>} the trainer's new gold
 *   balance and the refreshed inventory, in one round trip
 */
export async function enhanceEquipment(domain, equipmentId) {
  return postJson("/api/trainer/equipment/enhance", { domain, equipmentId });
}

/**
 * Socket one owned rune onto a monster, or unsocket it (monsterId: null).
 * 409s when the rune is broken (repair it first) or the monster has no free
 * rune slots left.
 * @param {number} runeId the owned instance's id (inventory row's `id`)
 * @param {number|null} monsterId owned monster id to socket onto, or null to unsocket
 * @returns {Promise<object>} the refreshed inventory (same shape as fetchInventory())
 */
export async function socketRune(runeId, monsterId) {
  return postJson("/api/trainer/runes/socket", { runeId, monsterId });
}

/**
 * Fully recharge one owned rune, paying its def's flat repair_gold. 409s
 * when the rune is already full and unbroken.
 * @param {number} runeId the owned instance's id
 * @returns {Promise<{gold:number, inventory:object}>} the trainer's new gold
 *   balance and the refreshed inventory, in one round trip
 */
export async function repairRune(runeId) {
  return postJson("/api/trainer/runes/repair", { runeId });
}

/**
 * The Summon Hall (Phase 7.4 step A): the enabled banners a trainer can pull
 * from right now. Pure read — the pull itself is performSummon().
 * @returns {Promise<{summons:{id:string, name:string, description:string,
 *   cost:object[], pool:object[]}[]}>}
 */
export async function fetchSummonHall() {
  return getJson("/api/trainer/summon");
}

/**
 * Pull one Summon Hall banner: pays its cost (gold and/or items) and mints a
 * new monster from a seeded weighted roll over the banner's pool.
 * @param {string} summonId
 * @returns {Promise<{summonId:string, seed:number, monster:object,
 *   gold:number, inventory:object}>} the minted monster (same shape as a
 *   farm roster entry), the trainer's new gold balance, and the refreshed
 *   inventory, in one round trip
 */
export async function performSummon(summonId) {
  return postJson("/api/trainer/summon", { summonId });
}

/**
 * The Adventure panel's one read (Phase 7.4 step B): the enabled routes
 * (public fields only — id/name/description) plus the trainer's current
 * session, if any (null when nothing is running). The session view exposes
 * ONLY the step in front of the player — the server never ships the whole
 * frozen map.
 * @returns {Promise<{adventures:{id:string,name:string,description:string}[],
 *   session:object|null}>}
 */
export async function fetchAdventureState() {
  return getJson("/api/adventure/state");
}

/**
 * Start a run: lock exactly 3 owned, free monsters as the party — their
 * ORDER is the lane order for the whole run — and freeze a freshly
 * generated map behind a seed. 409s if a run is already active or a chosen
 * monster is busy/not owned.
 * @param {string} adventureId
 * @param {number[]} monsterIds exactly 3 distinct owned free monster ids
 * @returns {Promise<{session:object}>}
 */
export async function startAdventure(adventureId, monsterIds) {
  return postJson("/api/adventure/start", { adventureId, monsterIds });
}

/**
 * Resolve the current step's chosen option. Every roll (loot, the wild
 * team, the fight, the catch) happens server-side, seeded from the frozen
 * session — this only ever sends an index into the step's own options.
 * @param {number} choice index into the current step's `options`
 * @returns {Promise<{session:object, node:{position:number, choice:number,
 *   type:string, loot?:{itemId:string,qty:number}[],
 *   battle?:{won:boolean,events:object[]},
 *   catch?:{speciesId:string,name:string,monsterId:number}}>}
 */
export async function moveAdventure(choice) {
  return postJson("/api/adventure/move", { choice });
}

/** Give up the active run early — same terminal effect as a lost battle,
 *  except by the player's own choice; releases the party either way. */
export async function abandonAdventure() {
  return postJson("/api/adventure/abandon", {});
}

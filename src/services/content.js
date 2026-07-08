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
 * monsters (granting starters on the very first call) — the first 3
 * available, or the exact 3 the optional `monsterIds` picks, in that order
 * (Phase 10.2) — and picks + freezes the enemy team and lane order. Requires
 * login.
 * @param {string} [mode] "pvp" opens a ladder match against another
 *   trainer's saved defense formation; omit (or anything else) for today's
 *   free match against a random species team — existing callers unchanged.
 * @param {number[]} [monsterIds] exactly 3 distinct owned, non-busy monster
 *   ids choosing WHICH monsters fight and their initial lane order; omit for
 *   the server's default (first 3 available).
 * @param {string} [keepEnemyMatchId] (Phase 10.4, free matches only) the id
 *   of the caller's OWN prior free match whose frozen enemy this new match
 *   reuses verbatim ("same enemy, new lineup"); omit for the server's
 *   default (a fresh random-species enemy).
 * @returns {Promise<{matchId:string, you:object[], enemy:object[], opponent?:{name:string,rating:number}}>}
 */
export async function createMatch(mode, monsterIds, keepEnemyMatchId) {
  return postJson("/api/battle/match", {
    ...(mode ? { mode } : {}),
    ...(monsterIds ? { monsterIds } : {}),
    ...(keepEnemyMatchId ? { keepEnemyMatchId } : {}),
  });
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

/**
 * Browse open marketplace listings (Phase 8): search/filter + paging, all
 * server-side. Undefined/empty params are simply omitted from the querystring
 * (the server fills in its own defaults).
 * @param {{kind?:string, q?:string, minPrice?:number, maxPrice?:number,
 *   limit?:number, offset?:number}} [params]
 * @returns {Promise<{listings:object[]}>}
 */
export async function fetchMarket(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();
  return getJson(query ? `/api/market/browse?${query}` : "/api/market/browse");
}

/** Every listing the caller has ever created, any status, newest first. */
export async function fetchMyListings() {
  return getJson("/api/market/mine");
}

/**
 * List one owned good for sale. The good is escrowed immediately (removed
 * from usable inventory/roster) — cancel returns it.
 * @param {{kind:'item'|'equipment'|'rune'|'monster', refId?:number,
 *   defId?:string, qty?:number, price:number}} body
 * @returns {Promise<{listing:object, listings:object[]}>} the created listing
 *   + the caller's refreshed listing list
 */
export async function createListing(body) {
  return postJson("/api/market/list", body);
}

/** Buy one open listing — debits the buyer, credits the seller, transfers
 *  the good, exactly once. Self-purchase and races both 409. */
export async function buyListing(listingId) {
  return postJson("/api/market/buy", { listingId });
}

/** Cancel one of the caller's own open listings, returning the escrowed good. */
export async function cancelListing(listingId) {
  return postJson("/api/market/cancel", { listingId });
}

/**
 * Sell straight to the system for a fixed per-def price (`sellGold` on each
 * inventory row) — the instant, no-buyer-needed alternative to a marketplace
 * listing. Monsters are never sellable this way.
 * @param {{kind:'item'|'equipment'|'rune', defId?:string, id?:number, qty?:number}} body
 * @returns {Promise<{gold:number, inventory:object}>}
 */
export async function sellToSystem(body) {
  return postJson("/api/trainer/inventory/sell", body);
}

/**
 * The Tournament panel's one read (Phase 9.2): every tournament (any status —
 * cancelled/past stay visible as history), each with a live entrant count and
 * the CALLER's own entry summary (or null) — never another trainer's team.
 * @returns {Promise<{tournaments:{id:number, name:string, description:string,
 *   regStartsAt:string, regEndsAt:string, status:string, entryFee:number,
 *   rewards:object, entrantCount:number,
 *   myEntry:{enteredAt:string, monsterIds:number[], feePaid:number}|null}[]}>}
 */
export async function fetchTournaments() {
  return getJson("/api/battle/tournaments");
}

/**
 * Register exactly 3 owned, free monsters for one tournament — their ORDER
 * is the lane order the frozen team snapshot freezes. 409s: "registration is
 * not open", "not enough gold for the entry fee", "a monster is busy or not
 * yours", "already registered for this tournament".
 * @param {number} tournamentId
 * @param {number[]} monsterIds exactly 3 distinct owned free monster ids
 * @returns {Promise<{entry:{enteredAt:string, monsterIds:number[], feePaid:number}}>}
 */
export async function registerTournament(tournamentId, monsterIds) {
  return postJson("/api/battle/tournament/register", { tournamentId, monsterIds });
}

/** Withdraw a registration while the window is still open — releases the
 *  party lock and refunds whatever this entry actually paid. */
export async function withdrawTournament(tournamentId) {
  return postJson("/api/battle/tournament/withdraw", { tournamentId });
}

/**
 * The bracket/standings detail view (Phase 9.3): entrants (display only —
 * never another trainer's lanes), the bracket re-derived round by round
 * (each pairing `{a, b, winner, seed}`, entrant ids or null for a bye), the
 * 3rd-place pairing (same shape, or null if this field never had one), the
 * enriched standings ({rank, entryId, trainerId, trainerName, reward}), and
 * the caller's own entry summary. `rounds`/`thirdPlace`/`standings` are all
 * null/empty for a tournament that hasn't started running yet.
 * @param {number} tournamentId
 */
export async function fetchTournamentDetail(tournamentId) {
  return getJson(`/api/battle/tournament/detail?id=${encodeURIComponent(tournamentId)}`);
}

/**
 * Every guild (Phase 9.4), newest first — id/name/description/emblem plus a
 * live member count and the leader's display name. Pure read, no auth
 * distinction beyond being logged in.
 * @returns {Promise<{guilds:{id:number, name:string, description:string,
 *   emblem:string, leaderId:number, leaderName:string, memberCount:number,
 *   createdAt:string}[]}>}
 */
export async function fetchGuildBrowse() {
  return getJson("/api/guild/browse");
}

/**
 * The caller's whole guild view. Guildless: `{guild:null, myApplications}`.
 * In a guild: `{guild, myRole, members}` plus an `applications` array — but
 * ONLY when `myRole` is `'leader'` or `'officer'` (a plain member never sees
 * the pending queue, same shape the server enforces).
 * @returns {Promise<object>}
 */
export async function fetchGuildMe() {
  return getJson("/api/guild/me");
}

/** Found a new guild for the flat gold cost (server-enforced). */
export async function createGuild(name, description, emblem) {
  return postJson("/api/guild/create", { name, description, emblem });
}

/** Apply to join a guild, with an optional message. */
export async function applyGuild(guildId, message) {
  return postJson("/api/guild/apply", { guildId, message });
}

/** Accept a pending application into the caller's own guild (leader only). */
export async function acceptGuildApplication(applicationId) {
  return postJson("/api/guild/accept", { applicationId });
}

/** Reject a pending application (leader only). */
export async function rejectGuildApplication(applicationId) {
  return postJson("/api/guild/reject", { applicationId });
}

/** Leave the caller's own guild. 409s for a leader — transfer first. */
export async function leaveGuild() {
  return postJson("/api/guild/leave", {});
}

/** Remove a member from the caller's guild (leader only). */
export async function kickGuildMember(trainerId) {
  return postJson("/api/guild/kick", { trainerId });
}

/** Promote/demote a member to 'officer' or 'member' (leader only). */
export async function promoteGuildMember(trainerId, role) {
  return postJson("/api/guild/promote", { trainerId, role });
}

/** Hand guild leadership to another member (leader only). */
export async function transferGuildLeadership(trainerId) {
  return postJson("/api/guild/transfer", { trainerId });
}

// --- GVG events (Phase 9.5) ---------------------------------------------------

/**
 * Every GVG event (any status — cancelled/past stay visible as history), each
 * with a live registered-guild count, the caller's OWN team summary (or
 * null), and — only while the caller is in a guild — whether that guild has
 * registered. A guild's LEADER additionally sees every team their guild has
 * submitted (`guildTeams`: display info only, never another trainer's lanes).
 * @returns {Promise<{membership:{guildId:number, role:string}|null,
 *   events:{id:number, name:string, description:string, regStartsAt:string,
 *   regEndsAt:string, status:string, minTeams:number, maxTeams:number,
 *   rewards:object, registeredGuildCount:number,
 *   myTeam:{teamId:number, monsterIds:number[], battleOrder:number|null,
 *   submittedAt:string}|null, guildRegistered?:boolean,
 *   guildTeams?:{teamId:number, trainerId:number, trainerName:string,
 *   display:object[], battleOrder:number|null, submittedAt:string}[]}[]}>}
 */
export async function fetchGvgEvents() {
  return getJson("/api/guild/gvg/events");
}

/**
 * Submit exactly 3 owned, free monsters as one team for a GVG event — one
 * submission per trainer per event. 409s: "join a guild first", "team
 * submission is not open", "a monster is busy or not yours", "you already
 * submitted a team for this event".
 * @param {number} eventId
 * @param {number[]} monsterIds exactly 3 distinct owned free monster ids
 * @returns {Promise<{team:{teamId:number, monsterIds:number[],
 *   battleOrder:number|null, submittedAt:string}}>}
 */
export async function submitGvgTeam(eventId, monsterIds) {
  return postJson("/api/guild/gvg/submit", { eventId, monsterIds });
}

/**
 * Withdraw the caller's own submitted team while it's still unpicked and the
 * window is open. 409s: "team submission is closed", "your team is in the
 * guild's lineup — ask your leader to unpick it first"; 404 "you have no
 * team submitted for this event".
 * @param {number} eventId
 * @returns {Promise<{withdrawn:true}>}
 */
export async function withdrawGvgTeam(eventId) {
  return postJson("/api/guild/gvg/withdraw", { eventId });
}

/**
 * Replace the guild's whole lineup for one event — leader only. `teamIds` is
 * the ordered (1st to last) list of submitted team ids to field; any
 * submitted team NOT listed drops out of the lineup. 403 "leader only", 409
 * "the registration window is closed", 400 for a bad/unknown team id.
 * @param {number} eventId
 * @param {number[]} teamIds ordered team ids, first to last
 * @returns {Promise<{guildTeams:object[]}>} the refreshed lineup (same shape
 *   as fetchGvgEvents()'s guildTeams)
 */
export async function setGvgLineup(eventId, teamIds) {
  return postJson("/api/guild/gvg/lineup", { eventId, teamIds });
}

/**
 * Register the guild for a GVG event — leader only, requires a valid ordered
 * lineup already staged via setGvgLineup(). 403 "leader only", 409
 * "registration is not open" / "set a lineup of N-M teams first" / "your
 * guild is already registered".
 * @param {number} eventId
 * @returns {Promise<{registered:true, lineup:number[]}>}
 */
export async function registerGvgGuild(eventId) {
  return postJson("/api/guild/gvg/register", { eventId });
}

/**
 * The war-bracket/standings detail view (Phase 9.7): registered guilds
 * (display only — never another guild's lanes), a `teams` map (gvg_teams id
 * -> {guildId, trainerId, trainerName, display}) for labeling bracket/battle
 * lines, the bracket re-derived round by round (each pairing `{a, b, winner,
 * seed, battles, tiebreak}`, guild ids or null for a bye — `battles` is the
 * per-battle relay summary, null while unplayed), the 3rd-place pairing
 * (same shape, or null if this field never had one), the enriched standings
 * ({rank, guildId, guildName, rewards:{teamId, trainerId, trainerName,
 * reward}[]}), and the caller's own guild id (`myGuildId`, null when
 * guildless). `rounds`/`thirdPlace`/`standings` are all null/empty for an
 * event that hasn't started running yet.
 * @param {number} eventId
 */
export async function fetchGvgDetail(eventId) {
  return getJson(`/api/guild/gvg/detail?id=${encodeURIComponent(eventId)}`);
}

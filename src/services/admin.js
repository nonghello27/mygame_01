// Admin-console I/O boundary (Phase 5). Same contract as services/content.js:
// ui/admin.js never touches fetch() itself. Every mutation responds with a
// fresh masterState — the console re-renders what the server now holds, so
// the client never has to patch its own copy of master data.

async function request(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed: ${res.status}`);
  return data;
}

/** @typedef {{classes:object[], skills:object[], species:object[], jobs:object[],
 *   itemDefs:object[], equipmentDefs:object[], runeDefs:object[],
 *   summonDefs:object[], adventureDefs:object[], enums:object}} MasterState */

/** @returns {Promise<MasterState>} everything the console renders, in one read. */
export const loadMaster = () => request("/api/admin/master", "GET");

export const saveClass = (row) => request("/api/admin/classes", "POST", row);
export const deleteClass = (cls) => request("/api/admin/classes", "DELETE", { cls });

export const saveSkill = (row) => request("/api/admin/skills", "POST", row);
export const deleteSkill = (id) => request("/api/admin/skills", "DELETE", { id });

export const saveSpecies = (row) => request("/api/admin/species", "POST", row);
export const deleteSpecies = (id) => request("/api/admin/species", "DELETE", { id });

export const saveJob = (row) => request("/api/admin/jobs", "POST", row);
export const deleteJob = (id) => request("/api/admin/jobs", "DELETE", { id });

export const saveItem = (row) => request("/api/admin/items", "POST", row);
export const deleteItem = (id) => request("/api/admin/items", "DELETE", { id });

export const saveEquipment = (row) => request("/api/admin/equipment", "POST", row);
export const deleteEquipment = (id) => request("/api/admin/equipment", "DELETE", { id });

export const saveRune = (row) => request("/api/admin/runes", "POST", row);
export const deleteRune = (id) => request("/api/admin/runes", "DELETE", { id });

export const saveSummon = (row) => request("/api/admin/summons", "POST", row);
export const deleteSummon = (id) => request("/api/admin/summons", "DELETE", { id });

export const saveAdventure = (row) => request("/api/admin/adventures", "POST", row);
export const deleteAdventure = (id) => request("/api/admin/adventures", "DELETE", { id });

/**
 * Grant an item/equipment piece/rune to a trainer (defaults to the calling
 * admin server-side when trainerId is omitted) — an admin-only shortcut for
 * seeding test data; the Summon Hall (Phase 7.4 step A, `/api/trainer/summon`)
 * is now the player-facing acquisition path.
 * @param {{trainerId?:number, kind:'item'|'equipment'|'rune', defId:string, qty?:number}} body
 * @returns {Promise<{trainer:object, inventory:object}>}
 */
export const grant = (body) => request("/api/admin/grant", "POST", body);

/** @returns {Promise<{trainers:object[]}>} every account, for the 👥 Trainers tab's roster browser. */
export const loadTrainers = () => request("/api/admin/trainers", "GET");

/** @returns {Promise<{trainer:object, monsters:object[], unassigned:object[]}>} one
 *  trainer's full roster, plus every unassigned (ownerless) monster available to attach. */
export const loadTrainerMonsters = (trainerId) =>
  request(`/api/admin/monsters?trainerId=${trainerId}`, "GET");

/**
 * Mint one new monster instance for a trainer from a species master row.
 * @param {{trainerId:number, speciesId:string}} body
 * @returns {Promise<{trainer:object, monster:object, monsters:object[], unassigned:object[]}>}
 */
export const mintMonsterFor = (body) => request("/api/admin/monsters", "POST", body);

/**
 * Attach an existing unassigned monster (no owner) to a trainer's account.
 * @param {{trainerId:number, monsterId:number}} body
 * @returns {Promise<{trainer:object, monster:object, monsters:object[], unassigned:object[]}>}
 */
export const attachMonsterTo = (body) => request("/api/admin/monsters", "POST", body);

/**
 * Detach a monster from a trainer's account — the relation is removed, the
 * monster persists unassigned (growth/skills intact); its equipped gear and
 * socketed runes return to the trainer's bag. 409 while busy or in the
 * saved PVP defense formation.
 * @param {{trainerId:number, monsterId:number}} body
 * @returns {Promise<{trainer:object, monsters:object[], unassigned:object[]}>}
 */
export const detachMonsterFrom = (body) => request("/api/admin/monsters", "DELETE", body);

// --- tournaments (Phase 9.2) -------------------------------------------------
// Unlike the master-table CRUD above, this reads its OWN endpoint rather than
// folding into loadMaster()'s masterState — tournaments are admin-created
// INSTANCE data (one-off scheduled events), not reusable master content.

/** @returns {Promise<{tournaments:object[]}>} every tournament (any status), with a live entrant count. */
export const loadTournaments = () => request("/api/admin/tournaments", "GET");

/**
 * Create a tournament. Status always starts 'scheduled' server-side.
 * @param {{name:string, description?:string, entryFee?:number,
 *   regStartsAt:string, regEndsAt:string, rewards:object}} row
 * @returns {Promise<{tournament:object}>}
 */
export const createTournament = (row) => request("/api/admin/tournaments", "POST", row);

/**
 * Cancel at any non-completed status: releases every entrant's locks and
 * refunds every entry's fee, keeping the row visible in history.
 * @param {number} id
 * @returns {Promise<{tournament:object}>}
 */
export const cancelTournament = (id) => request("/api/admin/tournaments/cancel", "POST", { id });

// --- GVG events (Phase 9.5) --------------------------------------------------
// Same reasoning as tournaments above: this reads its OWN endpoint rather than
// folding into loadMaster()'s masterState — GVG events are admin-created
// INSTANCE data (one-off scheduled events), not reusable master content.

/** @returns {Promise<{events:object[]}>} every GVG event (any status), with a live registered-guild count. */
export const loadGvgEvents = () => request("/api/admin/gvg", "GET");

/**
 * Create a GVG event. Status always starts 'scheduled' server-side.
 * @param {{name:string, description?:string, minTeams?:number, maxTeams?:number,
 *   regStartsAt:string, regEndsAt:string, rewards:object}} row
 * @returns {Promise<{event:object}>}
 */
export const createGvgEvent = (row) => request("/api/admin/gvg", "POST", row);

/**
 * Cancel at any non-completed status: releases every submitted team's busy
 * lock, keeping the row visible in history. GVG events have no entry fee, so
 * there is nothing to refund.
 * @param {number} id
 * @returns {Promise<{event:object}>}
 */
export const cancelGvgEvent = (id) => request("/api/admin/gvg/cancel", "POST", { id });

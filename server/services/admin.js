// Admin console use-cases (Phase 5): the is_admin gate, the one-shot master
// state read, and validated writes to the master tables. Server-authoritative
// like everything else: the client sends proposed ROWS, but every value is
// validated here (adminValidate.js) against the engine's closed enum sets and
// the current DB relations before a single statement runs — and deletes are
// refused (409) while instance rows still reference the master row.

import { httpError } from "../http.js";
import { getTrainerById, setGold } from "../repos/trainers.js";
import {
  listMonstersByTrainer, mintMonster, getMonsterById,
  listUnassignedMonsters, detachMonster, returnMonsterGearToBag, attachMonster,
  getMonsterDetachDiagnostic, isMonsterEscrowed, setMonsterRank,
} from "../repos/monsters.js";
import { getSpeciesById } from "../repos/species.js";
import {
  listClassesAdmin, upsertClass, classUsage, deleteClass,
  listSkillsAdmin, upsertSkill, skillUsage, deleteSkill,
  listSpeciesAdmin, upsertSpecies, speciesUsage, deleteSpecies,
  listJobsAdmin, upsertJob, jobUsage, deleteJob,
  listItemsAdmin, upsertItem, itemUsage, deleteItem,
  listEquipmentAdmin, upsertEquipment, equipmentUsage, deleteEquipment,
  listRunesAdmin, upsertRune, runeUsage, deleteRune,
  listSummonsAdmin, upsertSummon, summonUsage, deleteSummon,
  listAdventuresAdmin, upsertAdventure, adventureUsage, deleteAdventure,
  listTrainersAdmin,
} from "../repos/admin.js";
import {
  enums, validateClass, validateSkill, validateSpecies, validateJob,
  validateItem, validateEquipment, validateRune, validateSummon, validateAdventure,
} from "./adminValidate.js";
import { grant as grantInventory } from "./inventory.js";
import { RANKS } from "../../shared/rules/ranks.js";

/** Is this email on the ADMIN_EMAILS allowlist? (Promotion happens at login.) */
export function isAdminEmail(email) {
  if (!email) return false;
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(email).toLowerCase());
}

/** 401 when logged out, 403 when not an admin; returns the trainer otherwise. */
export async function requireAdmin(sql, trainerId) {
  if (!trainerId) throw httpError(401, "not logged in");
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) throw httpError(401, "unknown trainer");
  if (!trainer.isAdmin) throw httpError(403, "admin only");
  return trainer;
}

/** Everything the console renders, in one read: all master tables
 *  (with usage counts) + the enum registries the dropdowns are built from. */
export async function masterState(sql) {
  const [classes, skills, species, jobs, itemDefs, equipmentDefs, runeDefs, summonDefs, adventureDefs] =
    await Promise.all([
      listClassesAdmin(sql), listSkillsAdmin(sql), listSpeciesAdmin(sql), listJobsAdmin(sql),
      listItemsAdmin(sql), listEquipmentAdmin(sql), listRunesAdmin(sql), listSummonsAdmin(sql),
      listAdventuresAdmin(sql),
    ]);
  return {
    classes, skills, species, jobs, itemDefs, equipmentDefs, runeDefs, summonDefs, adventureDefs,
    enums: enums(),
  };
}

// --- writes: validate → persist. Handlers respond with a fresh masterState. ---

export async function saveClass(sql, input) {
  await upsertClass(sql, validateClass(input));
}

export async function removeClass(sql, cls) {
  if (typeof cls !== "string" || !cls) throw httpError(400, "cls is required");
  const used = await classUsage(sql, cls);
  if (used.species > 0) {
    throw httpError(409, `cannot delete "${cls}": ${used.species} species still use it`);
  }
  await deleteClass(sql, cls);
}

export async function saveSkill(sql, input) {
  await upsertSkill(sql, validateSkill(input));
}

export async function removeSkill(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await skillUsage(sql, id);
  if (used.species > 0 || used.monsters > 0) {
    throw httpError(409,
      `cannot delete "${id}": in ${used.species} species loadouts and ${used.monsters} owned monsters`);
  }
  await deleteSkill(sql, id);
}

export async function saveSpecies(sql, input) {
  // Relations are validated against the DB as it is right now: the class must
  // exist, every loadout entry must be a real skill of the right slot type.
  const [classes, skills] = await Promise.all([listClassesAdmin(sql), listSkillsAdmin(sql)]);
  const species = validateSpecies(input, {
    classNames: classes.map((c) => c.cls),
    skillsById: new Map(skills.map((k) => [k.id, k])),
  });
  await upsertSpecies(sql, species);
}

export async function removeSpecies(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await speciesUsage(sql, id);
  if (used.monsters > 0) {
    throw httpError(409, `cannot delete "${id}": ${used.monsters} owned monsters are this species`);
  }
  await deleteSpecies(sql, id);
}

export async function saveJob(sql, input) {
  await upsertJob(sql, validateJob(input));
}

export async function removeJob(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await jobUsage(sql, id);
  if (used.activities > 0) {
    throw httpError(409, `cannot delete "${id}": ${used.activities} activities reference it`);
  }
  await deleteJob(sql, id);
}

// --- items / equipment / runes (Phase 7.1) --------------------------------------

export async function saveItem(sql, input) {
  await upsertItem(sql, validateItem(input));
}

export async function removeItem(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await itemUsage(sql, id);
  if (used.owned > 0) throw httpError(409, `cannot delete "${id}": ${used.owned} trainers own it`);
  await deleteItem(sql, id);
}

export async function saveEquipment(sql, input) {
  await upsertEquipment(sql, validateEquipment(input));
}

export async function removeEquipment(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await equipmentUsage(sql, id);
  if (used.trainer > 0 || used.monster > 0) {
    throw httpError(409,
      `cannot delete "${id}": owned by ${used.trainer} trainers and ${used.monster} monsters`);
  }
  await deleteEquipment(sql, id);
}

export async function saveRune(sql, input) {
  await upsertRune(sql, validateRune(input));
}

export async function removeRune(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await runeUsage(sql, id);
  if (used.owned > 0) throw httpError(409, `cannot delete "${id}": ${used.owned} trainers own it`);
  await deleteRune(sql, id);
}

// --- summon hall (Phase 7.4 step A) --------------------------------------------

/**
 * validateSummon() is pure grammar only (no DB); the referential checks a
 * banner actually needs — every pool speciesId must be a real species, every
 * item cost's itemId must be a real item — happen here against fresh DB
 * state, same precedent as saveSpecies() checking class/skill relations.
 */
export async function saveSummon(sql, input) {
  const summon = validateSummon(input);
  const [species, items] = await Promise.all([listSpeciesAdmin(sql), listItemsAdmin(sql)]);
  const speciesIds = new Set(species.map((s) => s.id));
  const itemIds = new Set(items.map((i) => i.id));
  for (const p of summon.pool) {
    if (!speciesIds.has(p.speciesId)) throw httpError(400, `pool references unknown species "${p.speciesId}"`);
  }
  for (const c of summon.cost) {
    if (c.type === "item" && !itemIds.has(c.itemId)) throw httpError(400, `cost references unknown item "${c.itemId}"`);
  }
  await upsertSummon(sql, summon);
}

export async function removeSummon(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await summonUsage(sql, id);
  if (used.pulls > 0) throw httpError(409, `cannot delete "${id}": ${used.pulls} pulls reference it`);
  await deleteSummon(sql, id);
}

// --- adventures (Phase 7.4 step B) --------------------------------------------

/**
 * validateAdventure() is pure grammar only (no DB); the referential checks a
 * route actually needs — every encounters speciesId must be a real species,
 * every loot itemId must be a real item — happen here against fresh DB
 * state, same precedent as saveSummon() checking pool/cost relations.
 */
export async function saveAdventure(sql, input) {
  const adventure = validateAdventure(input);
  const [species, items] = await Promise.all([listSpeciesAdmin(sql), listItemsAdmin(sql)]);
  const speciesIds = new Set(species.map((s) => s.id));
  const itemIds = new Set(items.map((i) => i.id));
  for (const e of adventure.config.encounters) {
    if (!speciesIds.has(e.speciesId)) {
      throw httpError(400, `encounters references unknown species "${e.speciesId}"`);
    }
  }
  for (const row of adventure.config.loot) {
    if (!itemIds.has(row.itemId)) throw httpError(400, `loot references unknown item "${row.itemId}"`);
  }
  await upsertAdventure(sql, adventure);
}

export async function removeAdventure(sql, id) {
  if (typeof id !== "string" || !id) throw httpError(400, "id is required");
  const used = await adventureUsage(sql, id);
  if (used.sessions > 0) throw httpError(409, `cannot delete "${id}": ${used.sessions} sessions reference it`);
  await deleteAdventure(sql, id);
}

/**
 * The ONLY acquisition source until 7.4 (marketplace/summons): an admin
 * grants an item/equipment piece/rune to a trainer (defaulting to
 * themselves). Kept here (not in inventory.js) because the admin-only gate
 * and the 404-on-unknown-trainer check belong with the other admin routes;
 * the actual grant logic (kind/defId/qty validation, unknown-def 404) lives
 * in services/inventory.js so it's reusable by future non-admin flows.
 */
export async function grantToTrainer(sql, adminId, { trainerId, kind, defId, qty }) {
  const id = trainerId === undefined || trainerId === null ? adminId : Number(trainerId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "trainerId must be a trainer's id");
  const trainer = await getTrainerById(sql, id);
  if (!trainer) throw httpError(404, "unknown trainer");
  await grantInventory(sql, id, { kind, defId, qty });
  return trainer;
}

// --- trainer accounts + monster minting/detach/attach (admin roster browser) ---
//
// Ownership is detachable (012_monster_release.sql): an admin can DETACH a
// monster from an account (trainer_id -> NULL) without deleting it — the
// row, its grown attributes, and its skills persist as "unassigned" — and
// later ATTACH that same unassigned monster to a (possibly different)
// trainer. listUnassignedMonsters() rides along on every read below so the
// console's detail view always shows both a trainer's roster AND the pool
// of orphans available to attach.

export async function listTrainers(sql) {
  return listTrainersAdmin(sql);
}

/**
 * Set a trainer's gold to an ABSOLUTE amount (Phase 10.1) — unlike
 * debitGold/refundGold's relative math, the admin states the balance
 * directly. requireAdmin() stays a route-layer concern (like every other
 * admin write); this assumes the caller already gated it.
 */
export async function setTrainerGold(sql, { trainerId, gold }) {
  const id = Number(trainerId);
  if (!Number.isInteger(id)) throw httpError(400, "trainerId must be an integer id");
  if (!Number.isSafeInteger(gold) || gold < 0) {
    throw httpError(400, "gold must be a non-negative integer");
  }
  const trainer = await setGold(sql, id, gold);
  if (!trainer) throw httpError(404, "no such trainer");
  return { trainer };
}

export async function trainerMonsters(sql, trainerId) {
  if (!Number.isInteger(trainerId) || trainerId <= 0) {
    throw httpError(400, "trainerId must be a trainer's id");
  }
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) throw httpError(404, "unknown trainer");
  return {
    trainer,
    monsters: await listMonstersByTrainer(sql, trainerId),
    unassigned: await listUnassignedMonsters(sql),
  };
}

/**
 * Mint one new monster instance for any trainer from a species master row.
 * No payment legs (unlike performSummon) — this is an admin grant, not an
 * acquisitive action a trainer paid for — so there's nothing to compensate
 * on failure; mintMonster() itself is the only write.
 */
export async function mintMonsterForTrainer(sql, { trainerId, speciesId }) {
  const id = Number(trainerId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "trainerId must be a trainer's id");
  const trainer = await getTrainerById(sql, id);
  if (!trainer) throw httpError(404, "unknown trainer");

  if (typeof speciesId !== "string" || !speciesId) throw httpError(400, "speciesId is required");
  const species = await getSpeciesById(sql, speciesId);
  if (!species) throw httpError(404, "unknown species");

  const monsterId = await mintMonster(sql, id, species);
  return {
    trainer,
    monster: await getMonsterById(sql, id, monsterId),
    monsters: await listMonstersByTrainer(sql, id),
    unassigned: await listUnassignedMonsters(sql),
  };
}

/**
 * Attach an existing UNASSIGNED monster (trainer_id IS NULL) to a trainer's
 * account — the second way to grow a roster besides minting fresh. The
 * guarded UPDATE (attachMonster) is the whole gate: a lost claim and a
 * nonexistent monsterId are indistinguishable by design (both just mean
 * "there is no unassigned monster with that id right now"), so this
 * deliberately does NOT pre-read to tell them apart — same 409-covers-both
 * shape as equipment's enhance()/runes' repair() claim failures. The ONE
 * exception (Phase 8): a monster escrowed in an open marketplace listing IS
 * distinguishable and worth naming specifically, since silently refusing to
 * say why would look like a bug rather than "someone is selling this".
 */
export async function attachMonsterToTrainer(sql, { trainerId, monsterId }) {
  const id = Number(trainerId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "trainerId must be a trainer's id");
  const trainer = await getTrainerById(sql, id);
  if (!trainer) throw httpError(404, "unknown trainer");

  const mId = Number(monsterId);
  if (!Number.isInteger(mId) || mId <= 0) throw httpError(400, "monsterId must be a monster's id");

  const claimed = await attachMonster(sql, id, mId);
  if (!claimed) {
    if (await isMonsterEscrowed(sql, mId)) {
      throw httpError(409, "monster is escrowed in a marketplace listing");
    }
    throw httpError(409, "monster is already owned or does not exist");
  }

  return {
    trainer,
    monster: await getMonsterById(sql, id, mId),
    monsters: await listMonstersByTrainer(sql, id),
    unassigned: await listUnassignedMonsters(sql),
  };
}

/**
 * Detach one monster from a trainer's account, leaving it "unassigned"
 * (trainer_id -> NULL) rather than deleting it — see 012_monster_release.sql.
 * detachMonster()'s guarded UPDATE is the only gate; when it loses, this
 * re-reads the row (diagnostics only, never a second gate — same spirit as
 * equipment.js's claim-first-then-pay services distinguishing WHY a claim
 * failed after the fact) to answer a specific 409/404 instead of one generic
 * message, because unlike attach, a lost detach claim has several distinct,
 * actionable causes worth telling apart (busy / in a formation / not yours).
 */
export async function detachMonsterFromTrainer(sql, { trainerId, monsterId }) {
  const id = Number(trainerId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "trainerId must be a trainer's id");
  const trainer = await getTrainerById(sql, id);
  if (!trainer) throw httpError(404, "unknown trainer");

  const mId = Number(monsterId);
  if (!Number.isInteger(mId) || mId <= 0) throw httpError(400, "monsterId must be a monster's id");

  const claimed = await detachMonster(sql, id, mId);
  if (!claimed) {
    const row = await getMonsterDetachDiagnostic(sql, mId);
    if (!row || Number(row.trainer_id) !== id) {
      throw httpError(404, "monster does not belong to that trainer");
    }
    if (row.busy_until && new Date(row.busy_until) > new Date()) {
      throw httpError(409, `monster is busy (${row.busy_kind})`);
    }
    if (row.in_formation) {
      throw httpError(409, "monster is in the defense formation — remove it there first");
    }
    // The claim lost for a reason the diagnostic couldn't pin down (e.g. a
    // race that resolved between the two reads) — one generic fallback.
    throw httpError(409, "detach failed — try again");
  }

  await returnMonsterGearToBag(sql, mId);

  return {
    trainer,
    monsters: await listMonstersByTrainer(sql, id),
    unassigned: await listUnassignedMonsters(sql),
  };
}

/**
 * Set one owned monster's rank directly (Phase 10.9) — the per-monster
 * counterpart to a species' rank baseline (saveSpecies() above). Only
 * trainerId/monsterId/rank are trusted from the request body; everything
 * else (whether the pair actually exists/matches) is re-derived from the DB
 * via setMonsterRank()'s guarded UPDATE (CLAUDE.md §1.1). Responds with the
 * same {trainer, monsters, unassigned} shape detachMonsterFromTrainer() does,
 * so the console's Manage view can just re-render from whatever comes back.
 */
export async function updateMonsterRank(sql, { trainerId, monsterId, rank }) {
  const id = Number(trainerId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "trainerId must be a trainer's id");
  const trainer = await getTrainerById(sql, id);
  if (!trainer) throw httpError(404, "unknown trainer");

  const mId = Number(monsterId);
  if (!Number.isInteger(mId) || mId <= 0) throw httpError(400, "monsterId must be a monster's id");

  if (!RANKS.includes(rank)) throw httpError(400, `rank must be one of: ${RANKS.join(", ")}`);

  const claimed = await setMonsterRank(sql, id, mId, rank);
  if (!claimed) throw httpError(404, "monster not found");

  return {
    trainer,
    monsters: await listMonstersByTrainer(sql, id),
    unassigned: await listUnassignedMonsters(sql),
  };
}

// Admin console use-cases (Phase 5): the is_admin gate, the one-shot master
// state read, and validated writes to the master tables. Server-authoritative
// like everything else: the client sends proposed ROWS, but every value is
// validated here (adminValidate.js) against the engine's closed enum sets and
// the current DB relations before a single statement runs — and deletes are
// refused (409) while instance rows still reference the master row.

import { httpError } from "../http.js";
import { getTrainerById } from "../repos/trainers.js";
import {
  listClassesAdmin, upsertClass, classUsage, deleteClass,
  listSkillsAdmin, upsertSkill, skillUsage, deleteSkill,
  listSpeciesAdmin, upsertSpecies, speciesUsage, deleteSpecies,
  listJobsAdmin, upsertJob, jobUsage, deleteJob,
  listItemsAdmin, upsertItem, itemUsage, deleteItem,
  listEquipmentAdmin, upsertEquipment, equipmentUsage, deleteEquipment,
  listRunesAdmin, upsertRune, runeUsage, deleteRune,
} from "../repos/admin.js";
import {
  enums, validateClass, validateSkill, validateSpecies, validateJob,
  validateItem, validateEquipment, validateRune,
} from "./adminValidate.js";
import { grant as grantInventory } from "./inventory.js";

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
  const [classes, skills, species, jobs, itemDefs, equipmentDefs, runeDefs] = await Promise.all([
    listClassesAdmin(sql), listSkillsAdmin(sql), listSpeciesAdmin(sql), listJobsAdmin(sql),
    listItemsAdmin(sql), listEquipmentAdmin(sql), listRunesAdmin(sql),
  ]);
  return { classes, skills, species, jobs, itemDefs, equipmentDefs, runeDefs, enums: enums() };
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

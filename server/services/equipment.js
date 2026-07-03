// Equipment use-cases (Phase 7.2). Step A is equip/unequip; step B adds
// enhance() (engine wiring is a later step in this sub-phase). The client
// sends a CHOICE (which owned piece, onto which monster or into which
// trainer slot, or "raise this one a level"); every id is re-checked against
// fresh DB state before anything moves, same as saveDefense()'s ownership
// gate in server/services/pvp.js.

import { httpError } from "../http.js";
import {
  getTrainerEquipmentInstance, getMonsterEquipmentInstance, monsterOwnedByTrainer,
  equipMonsterEquipment, unequipMonsterEquipment,
  equipTrainerEquipment, unequipTrainerEquipment,
  claimEnhanceTrainerEquipment, claimEnhanceMonsterEquipment,
  revertEnhanceTrainerEquipment, revertEnhanceMonsterEquipment,
} from "../repos/equipment.js";
import { debitGold, refundGold } from "../repos/trainers.js";
import { consumeItem as consumeItemRepo } from "../repos/inventory.js";
import { getInventory } from "./inventory.js";

const DOMAINS = ["trainer", "monster"];

/**
 * Equip or unequip one owned piece of equipment, then hand back the full
 * inventory read (same shape as GET /api/trainer/inventory) so the client
 * refreshes in one round trip — same precedent as saveDefense() returning
 * getDefense().
 * @param {{domain:'trainer'|'monster', equipmentId:number, monsterId?:number|null, equip?:boolean}} body
 */
export async function equip(sql, trainerId, body) {
  const { domain, equipmentId, monsterId, equip: equipFlag } = body ?? {};

  if (!DOMAINS.includes(domain)) throw httpError(400, `domain must be one of: ${DOMAINS.join(", ")}`);
  const eqId = Number(equipmentId);
  if (!Number.isInteger(eqId) || eqId <= 0) throw httpError(400, "equipmentId must be a positive integer");

  if (domain === "monster") {
    if (monsterId !== null && monsterId !== undefined) {
      const mId = Number(monsterId);
      if (!Number.isInteger(mId) || mId <= 0) throw httpError(400, "monsterId must be a positive integer or null");
    } else if (monsterId === undefined) {
      throw httpError(400, "monsterId is required (a monster id, or null to unequip)");
    }

    // 404, not leaking whether the id exists but belongs to someone else.
    const instance = await getMonsterEquipmentInstance(sql, trainerId, eqId);
    if (!instance) throw httpError(404, "equipment not found");

    if (monsterId === null) {
      await unequipMonsterEquipment(sql, trainerId, eqId);
    } else {
      const mId = Number(monsterId);
      if (!(await monsterOwnedByTrainer(sql, trainerId, mId))) throw httpError(404, "monster not found");
      await equipMonsterEquipment(sql, trainerId, eqId, mId, instance.slot);
    }
  } else {
    // domain === "trainer"
    if (typeof equipFlag !== "boolean") throw httpError(400, "equip must be a boolean");

    const instance = await getTrainerEquipmentInstance(sql, trainerId, eqId);
    if (!instance) throw httpError(404, "equipment not found");

    if (equipFlag) {
      await equipTrainerEquipment(sql, trainerId, eqId, instance.slot);
    } else {
      await unequipTrainerEquipment(sql, trainerId, eqId);
    }
  }

  return getInventory(sql, trainerId);
}

/**
 * Raise one owned piece's enhance_level by exactly 1, paying its master-data
 * cost exactly once. Claim-first-then-pay (see server/repos/equipment.js's
 * header): the claim's WHERE already prechecked gold/materials, so a pay leg
 * failing after a won claim means a concurrent spend raced it — the response
 * is a compensating revert/refund rather than a free upgrade left in place.
 * @param {{domain:'trainer'|'monster', equipmentId:number}} body
 * @returns {{gold:number, inventory:object}} the trainer's new gold balance
 *   and the refreshed inventory read, in one round trip (same precedent as
 *   equip() returning getInventory()).
 */
export async function enhance(sql, trainerId, body) {
  const { domain, equipmentId } = body ?? {};

  if (!DOMAINS.includes(domain)) throw httpError(400, `domain must be one of: ${DOMAINS.join(", ")}`);
  const eqId = Number(equipmentId);
  if (!Number.isInteger(eqId) || eqId <= 0) throw httpError(400, "equipmentId must be a positive integer");

  const isMonster = domain === "monster";
  const instance = isMonster
    ? await getMonsterEquipmentInstance(sql, trainerId, eqId)
    : await getTrainerEquipmentInstance(sql, trainerId, eqId);
  if (!instance) throw httpError(404, "equipment not found");

  const curve = instance.enhance;
  if (!curve) throw httpError(400, "this piece can't be enhanced");
  const expectedLevel = instance.enhance_level;
  if (expectedLevel >= curve.maxLevel) throw httpError(409, "already at max level");

  const goldCost = curve.goldPerLevel;
  const material = curve.material ?? null;

  const claim = isMonster
    ? await claimEnhanceMonsterEquipment(sql, trainerId, eqId, expectedLevel, curve.maxLevel, goldCost, material)
    : await claimEnhanceTrainerEquipment(sql, trainerId, eqId, expectedLevel, curve.maxLevel, goldCost, material);
  // One message covers a raced level change, insufficient gold, and
  // insufficient material — the client can't tell them apart anyway (its
  // inventory read is stale either way and a re-fetch will show what's short).
  if (!claim) throw httpError(409, "enhance failed — check gold, materials, or try again");

  const revert = isMonster ? revertEnhanceMonsterEquipment : revertEnhanceTrainerEquipment;

  const debited = await debitGold(sql, trainerId, goldCost);
  if (!debited) {
    await revert(sql, trainerId, eqId, expectedLevel);
    throw httpError(409, "not enough gold");
  }

  if (material) {
    const spent = await consumeItemRepo(sql, trainerId, material.itemId, material.qtyPerLevel);
    if (!spent) {
      await refundGold(sql, trainerId, goldCost);
      await revert(sql, trainerId, eqId, expectedLevel);
      throw httpError(409, "not enough material");
    }
  }

  return { gold: Number(debited.gold), inventory: await getInventory(sql, trainerId) };
}

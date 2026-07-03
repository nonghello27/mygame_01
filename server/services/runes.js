// Rune use-cases (Phase 7.3). Step A is socket/unsocket; step B adds
// repair(). Same shape as equipment's equip()/enhance()
// (server/services/equipment.js): the client sends a CHOICE (which owned
// rune, onto which monster or back to the bag, or "repair this one"), every
// id is re-checked against fresh DB state, and the response is the
// refreshed inventory read so the client updates in one round trip.

import { httpError } from "../http.js";
import {
  getRuneInstance, socketRune, unsocketRune,
  claimRepairRune, revertRepairRune,
} from "../repos/runes.js";
// Generic "does this monster id belong to this trainer?" check — it already
// exists in repos/equipment.js (nothing monster-specific about it, and the
// same lookup equipment's equip() needs), so it's reused here rather than
// duplicated in repos/runes.js.
import { monsterOwnedByTrainer } from "../repos/equipment.js";
import { debitGold } from "../repos/trainers.js";
import { getInventory } from "./inventory.js";

/**
 * Socket or unsocket one owned rune, then hand back the full inventory read
 * (same shape as GET /api/trainer/inventory) — same precedent as equip()
 * returning getInventory().
 * @param {{runeId:number, monsterId:number|null}} body
 */
export async function socket(sql, trainerId, body) {
  const { runeId, monsterId } = body ?? {};

  const rId = Number(runeId);
  if (!Number.isInteger(rId) || rId <= 0) throw httpError(400, "runeId must be a positive integer");

  if (monsterId !== null && monsterId !== undefined) {
    const mId = Number(monsterId);
    if (!Number.isInteger(mId) || mId <= 0) throw httpError(400, "monsterId must be a positive integer or null");
  } else if (monsterId === undefined) {
    throw httpError(400, "monsterId is required (a monster id, or null to unsocket)");
  }

  // 404, not leaking whether the id exists but belongs to someone else.
  const instance = await getRuneInstance(sql, trainerId, rId);
  if (!instance) throw httpError(404, "rune not found");

  if (monsterId === null) {
    await unsocketRune(sql, trainerId, rId);
  } else {
    if (instance.broken) throw httpError(409, "rune is broken — repair it first");

    const mId = Number(monsterId);
    if (!(await monsterOwnedByTrainer(sql, trainerId, mId))) throw httpError(404, "monster not found");

    const socketed = await socketRune(sql, trainerId, rId, mId);
    // The instance exists and isn't broken (both already checked above), so a
    // failed guard here can only mean the capacity check lost.
    if (!socketed) throw httpError(409, "no free rune slots on that monster");
  }

  return getInventory(sql, trainerId);
}

/**
 * Fully recharge one owned rune — `charges_left -> max_charges`,
 * `broken -> false` — paying the def's flat `repair_gold` exactly once.
 * Claim-first-then-pay (see server/repos/runes.js's header): the claim's
 * WHERE already prechecked gold, so debitGold failing after a won claim
 * means a concurrent spend raced it — the response is a compensating
 * revert rather than a free repair left in place. A socketed rune stays
 * socketed; repair only touches charges_left/broken.
 * @param {{runeId:number}} body
 * @returns {{gold:number, inventory:object}} the trainer's new gold balance
 *   and the refreshed inventory read, in one round trip (same precedent as
 *   equipment's enhance() returning {gold, inventory}).
 */
export async function repair(sql, trainerId, body) {
  const { runeId } = body ?? {};

  const rId = Number(runeId);
  if (!Number.isInteger(rId) || rId <= 0) throw httpError(400, "runeId must be a positive integer");

  // 404, not leaking whether the id exists but belongs to someone else.
  const instance = await getRuneInstance(sql, trainerId, rId);
  if (!instance) throw httpError(404, "rune not found");

  const expectedCharges = instance.charges_left;
  const expectedBroken = instance.broken;
  const maxCharges = instance.max_charges;
  if (expectedCharges >= maxCharges && !expectedBroken) {
    throw httpError(409, "rune doesn't need repair");
  }

  const goldCost = instance.repair_gold;

  const claim = await claimRepairRune(sql, trainerId, rId, expectedCharges, expectedBroken, maxCharges, goldCost);
  // One message covers a raced charges/broken change and insufficient gold —
  // the client can't tell them apart anyway (its inventory read is stale
  // either way and a re-fetch will show what's short).
  if (!claim) throw httpError(409, "repair failed — check gold or try again");

  const debited = await debitGold(sql, trainerId, goldCost);
  if (!debited) {
    await revertRepairRune(sql, trainerId, rId, expectedCharges, expectedBroken, maxCharges);
    throw httpError(409, "not enough gold");
  }

  return { gold: Number(debited.gold), inventory: await getInventory(sql, trainerId) };
}

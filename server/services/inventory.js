// Inventory use-cases (Phase 7.1). grant() is the ONLY acquisition path
// until 7.4 (marketplace/summons) wires up real sources — it's reached
// today only through the admin-gated POST /api/admin/grant (see
// services/admin.js grantToTrainer), which exists purely so 7.1–7.3 are
// testable live. consumeItem()/getInventory() are the pieces later phases
// (7.2 enhancement, battle consumables) will call directly.

import { httpError } from "../http.js";
import {
  getItemDef, grantItem, consumeItem as consumeItemRepo,
  getEquipmentDomain, grantEquipment, grantMonsterEquipment,
  grantRune, listInventory,
  getOwnedEquipmentForSale, deleteTrainerEquipmentForSale, deleteMonsterEquipmentForSale,
  restoreTrainerEquipment, restoreMonsterEquipment,
  getRuneForSale, deleteRuneForSale, restoreRune,
} from "../repos/inventory.js";
import { refundGold } from "../repos/trainers.js";

const GRANT_KINDS = ["item", "equipment", "rune"];
const SELL_KINDS = ["item", "equipment", "rune"];

/**
 * Grant one thing to a trainer's inventory.
 * @param {{kind:'item'|'equipment'|'rune', defId:string, qty?:number}} body
 */
export async function grant(sql, trainerId, { kind, defId, qty }) {
  if (!GRANT_KINDS.includes(kind)) throw httpError(400, `kind must be one of: ${GRANT_KINDS.join(", ")}`);
  if (typeof defId !== "string" || !defId) throw httpError(400, "defId is required");

  if (kind === "item") {
    const def = await getItemDef(sql, defId);
    if (!def) throw httpError(404, `unknown item "${defId}"`);
    const n = qty === undefined ? 1 : Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw httpError(400, "qty must be an integer between 1 and 1000");
    return grantItem(sql, trainerId, defId, n);
  }

  if (kind === "equipment") {
    const domain = await getEquipmentDomain(sql, defId);
    if (!domain) throw httpError(404, `unknown equipment "${defId}"`);
    return domain === "trainer"
      ? grantEquipment(sql, trainerId, defId)
      : grantMonsterEquipment(sql, trainerId, defId);
  }

  // kind === "rune"
  const row = await grantRune(sql, trainerId, defId);
  if (!row) throw httpError(404, `unknown rune "${defId}"`);
  return row;
}

/** Spend qty from a trainer's item stack — throws 409 when there isn't enough. */
export async function consumeItem(sql, trainerId, defId, qty) {
  const row = await consumeItemRepo(sql, trainerId, defId, qty);
  if (!row) throw httpError(409, `not enough "${defId}" to spend ${qty}`);
  return row;
}

/** Everything the inventory screen needs, in one read. */
export async function getInventory(sql, trainerId) {
  return listInventory(sql, trainerId);
}

// --- sell-to-system (Phase 8) --------------------------------------------------
//
// The instant, fixed-price path — as opposed to the marketplace's
// player-to-player listings (server/services/market.js). Same claim-first-
// then-pay family: a guarded destructive claim (stack decrement / DELETE)
// followed by a gold credit, with a compensating restore if that credit leg
// somehow loses a race after the claim already won (same shape as
// equipment's enhance()/runes' repair() reverting a claimed change when the
// pay leg fails). Monsters are never sellable to the system — kind is
// deliberately not in SELL_KINDS.

/**
 * @param {{kind:'item'|'equipment'|'rune', defId?:string, id?:number, qty?:number}} body
 * @returns {{gold:number, inventory:object}} same shape as equip()/enhance()/
 *   socket()/repair() — the trainer's new gold balance + the refreshed
 *   inventory read, in one round trip.
 */
export async function sellToSystem(sql, trainerId, body) {
  const { kind, defId, id, qty } = body ?? {};
  if (!SELL_KINDS.includes(kind)) throw httpError(400, `kind must be one of: ${SELL_KINDS.join(", ")}`);

  if (kind === "item") return sellItem(sql, trainerId, { defId, qty });
  if (kind === "equipment") return sellEquipment(sql, trainerId, { id });
  return sellRune(sql, trainerId, { id });
}

async function afterSold(sql, trainerId, gold) {
  return { gold, inventory: await getInventory(sql, trainerId) };
}

async function sellItem(sql, trainerId, { defId, qty }) {
  if (typeof defId !== "string" || !defId) throw httpError(400, "defId is required");
  const n = qty === undefined ? 1 : Number(qty);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, "qty must be a positive integer");

  const def = await getItemDef(sql, defId);
  if (!def) throw httpError(404, `unknown item "${defId}"`);
  if (!def.sell_gold) throw httpError(409, "can't be sold to the system");

  // Escrow claim: the guarded stack decrement IS the whole gate.
  const consumed = await consumeItemRepo(sql, trainerId, defId, n);
  if (!consumed) throw httpError(409, "not enough of that item");

  const total = def.sell_gold * n;
  try {
    const credited = await refundGold(sql, trainerId, total);
    return afterSold(sql, trainerId, Number(credited.gold));
  } catch (err) {
    // Compensate: give the stack back rather than leave it charged for nothing.
    await grantItem(sql, trainerId, defId, n);
    throw err;
  }
}

async function sellEquipment(sql, trainerId, { id }) {
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) throw httpError(400, "id must be a positive integer");

  const instance = await getOwnedEquipmentForSale(sql, trainerId, eqId);
  if (!instance) throw httpError(404, "equipment not found");
  if (!instance.sell_gold) throw httpError(409, "can't be sold to the system");

  const del = instance.domain === "trainer" ? deleteTrainerEquipmentForSale : deleteMonsterEquipmentForSale;
  const restore = instance.domain === "trainer" ? restoreTrainerEquipment : restoreMonsterEquipment;

  const deleted = await del(sql, trainerId, eqId);
  if (!deleted) throw httpError(409, "unequip it first");

  try {
    const credited = await refundGold(sql, trainerId, instance.sell_gold);
    return afterSold(sql, trainerId, Number(credited.gold));
  } catch (err) {
    await restore(sql, deleted);
    throw err;
  }
}

async function sellRune(sql, trainerId, { id }) {
  const runeId = Number(id);
  if (!Number.isInteger(runeId) || runeId <= 0) throw httpError(400, "id must be a positive integer");

  const instance = await getRuneForSale(sql, trainerId, runeId);
  if (!instance) throw httpError(404, "rune not found");
  if (!instance.sell_gold) throw httpError(409, "can't be sold to the system");

  const deleted = await deleteRuneForSale(sql, trainerId, runeId);
  if (!deleted) throw httpError(409, "unsocket it first");

  try {
    const credited = await refundGold(sql, trainerId, instance.sell_gold);
    return afterSold(sql, trainerId, Number(credited.gold));
  } catch (err) {
    await restoreRune(sql, deleted);
    throw err;
  }
}

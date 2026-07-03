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
} from "../repos/inventory.js";

const GRANT_KINDS = ["item", "equipment", "rune"];

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

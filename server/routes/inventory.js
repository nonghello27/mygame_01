// GET /api/trainer/inventory -> { items, equipment:{trainer,monster}, runes }
// for the session cookie, or 401 when logged out. Pure read — acquisition
// happens through /api/admin/grant (Phase 7.1's only source), the Summon
// Hall, Adventure, or (Phase 8) the marketplace.
//
// POST /api/trainer/inventory/sell { kind:'item'|'equipment'|'rune',
//   defId?, id?, qty? } -> { gold, inventory } — the instant, fixed-price
// sell-to-system path (Phase 8); see server/services/inventory.js
// sellToSystem() for the claim-first-then-pay flow.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getInventory, sellToSystem } from "../services/inventory.js";

export async function inventory(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await getInventory(sql, trainerId));
}

export async function sell(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await sellToSystem(sql, trainerId, body));
}

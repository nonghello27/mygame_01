// GET /api/trainer/inventory -> { items, equipment:{trainer,monster}, runes }
// for the session cookie, or 401 when logged out. Pure read — acquisition
// happens through /api/admin/grant (Phase 7.1's only source) or later phases.

import { db } from "../db.js";
import { sendJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getInventory } from "../services/inventory.js";

export async function inventory(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await getInventory(sql, trainerId));
}

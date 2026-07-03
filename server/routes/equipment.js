// POST /api/trainer/equipment/equip { domain, equipmentId, monsterId?, equip? }
// -> equip/unequip one owned piece of gear, returning the refreshed inventory
// (same shape as GET /api/trainer/inventory). POST /api/trainer/equipment/enhance
// { domain, equipmentId } -> raise one owned piece's enhance_level by 1,
// returning { gold, inventory }. Validation and ownership checks live in
// server/services/equipment.js — these handlers only wire session + body to
// that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { equip as equipUseCase, enhance as enhanceUseCase } from "../services/equipment.js";

export async function equip(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await equipUseCase(sql, trainerId, body));
}

export async function enhance(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await enhanceUseCase(sql, trainerId, body));
}

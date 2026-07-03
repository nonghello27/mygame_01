// POST /api/trainer/runes/socket { runeId, monsterId } -> socket/unsocket one
// owned rune, returning the refreshed inventory (same shape as GET
// /api/trainer/inventory). POST /api/trainer/runes/repair { runeId } ->
// fully recharge one owned rune, returning { gold, inventory }. Validation
// and ownership checks live in server/services/runes.js — these handlers
// only wire session + body to that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { socket as socketUseCase, repair as repairUseCase } from "../services/runes.js";

export async function socket(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await socketUseCase(sql, trainerId, body));
}

export async function repair(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await repairUseCase(sql, trainerId, body));
}

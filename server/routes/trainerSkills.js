// POST /api/trainer-skills { slot, skillId } -> learn a trainer skill into a
// learn slot, or clear it (skillId: null). Validated against fresh DB state
// in server/services/progression.js — the client only ever sends a choice.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { learnSkill } from "../services/progression.js";

export async function trainerSkills(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const { slot, skillId } = await readJson(req);
  const sql = db();
  const state = await learnSkill(sql, trainerId, Number(slot), skillId ?? null);
  sendJson(res, 200, state);
}

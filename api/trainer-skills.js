// POST /api/trainer-skills { slot, skillId } -> learn a trainer skill into a
// learn slot, or clear it (skillId: null). Validated against fresh DB state
// in server/services/progression.js — the client only ever sends a choice.

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { learnSkill } from "../server/services/progression.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const { slot, skillId } = await readJson(req);
    const sql = db();
    const state = await learnSkill(sql, trainerId, Number(slot), skillId ?? null);
    sendJson(res, 200, state);
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

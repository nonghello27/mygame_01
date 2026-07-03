// GET /api/me -> { trainer, settled, trainerSkills } for the session cookie,
// or 401 when logged out.
//
// This is the app's "who am I / what's my state" read, and the anchor of the
// lazy-time design (ARCHITECTURE §6): finished work/training activities are
// settled HERE, before the trainer row is returned — so the gold/exp the
// client sees already include everything that finished while it was away.
// trainerSkills rides along too (the trainer's 2 learn slots) so the header/
// UI can show them without a second round trip to /api/progression.
// Later phases hang more lazy resolution on this read (season rollovers etc).

import { db } from "../db.js";
import { sendJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getTrainerById } from "../repos/trainers.js";
import { listTrainerSkills } from "../repos/progression.js";
import { settleActivities } from "../services/activities.js";

export async function me(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  const settled = await settleActivities(sql, trainerId);
  const trainer = await getTrainerById(sql, trainerId);
  if (!trainer) return sendJson(res, 401, { error: "unknown trainer" });
  const trainerSkills = await listTrainerSkills(sql, trainerId);

  sendJson(res, 200, { trainer, settled, trainerSkills });
}

// GET /api/me -> { trainer } for the session cookie, or 401 when logged out.
//
// This is the app's "who am I / what's my state" read, and the anchor of the
// lazy-time design (ARCHITECTURE §6): finished work/training activities are
// settled HERE, before the trainer row is returned — so the gold/exp the
// client sees already include everything that finished while it was away.
// Later phases hang more lazy resolution on this read (season rollovers etc).

import { db, sendJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getTrainerById } from "../server/repos/trainers.js";
import { settleActivities } from "../server/services/activities.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const sql = db();
    const settled = await settleActivities(sql, trainerId);
    const trainer = await getTrainerById(sql, trainerId);
    if (!trainer) return sendJson(res, 401, { error: "unknown trainer" });

    sendJson(res, 200, { trainer, settled });
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
}

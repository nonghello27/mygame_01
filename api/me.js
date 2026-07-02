// GET /api/me -> { trainer } for the session cookie, or 401 when logged out.
//
// This is the app's "who am I / what's my state" read. Later phases hang lazy
// resolution here (ARCHITECTURE §6): finished work/training timers, season
// rollovers etc. get settled during this read before the state is returned.

import { db, sendJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getTrainerById } from "../server/repos/trainers.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const trainer = await getTrainerById(db(), trainerId);
    if (!trainer) return sendJson(res, 401, { error: "unknown trainer" });

    sendJson(res, 200, { trainer });
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
}

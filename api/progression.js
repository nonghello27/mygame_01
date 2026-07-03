// GET  /api/progression                 -> expertises, trainer skill defs,
//                                           and the trainer's own
//                                           expertise/exp/learned skills —
//                                           everything the progression
//                                           screen needs in one call.
// POST /api/progression { expertiseId } -> pick (or switch) expertise.
//                                           Switching wipes both learn
//                                           slots (GAME_DESIGN §2).

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getProgression, chooseExpertise } from "../server/services/progression.js";

export default async function handler(req, res) {
  try {
    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
    const sql = db();

    let state;
    if (req.method === "GET") {
      state = await getProgression(sql, trainerId);
    } else if (req.method === "POST") {
      const { expertiseId } = await readJson(req);
      state = await chooseExpertise(sql, trainerId, expertiseId);
    } else {
      return sendJson(res, 405, { error: "GET or POST only" });
    }

    sendJson(res, 200, state);
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

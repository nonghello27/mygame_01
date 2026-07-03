// GET  /api/progression                 -> expertises, trainer skill defs,
//                                           and the trainer's own
//                                           expertise/exp/learned skills —
//                                           everything the progression
//                                           screen needs in one call.
// POST /api/progression { expertiseId } -> pick (or switch) expertise.
//                                           Switching wipes both learn
//                                           slots (GAME_DESIGN §2).

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getProgression, chooseExpertise } from "../services/progression.js";

export async function progression(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
  const sql = db();

  let state;
  if (req.method === "GET") {
    state = await getProgression(sql, trainerId);
  } else {
    const { expertiseId } = await readJson(req);
    state = await chooseExpertise(sql, trainerId, expertiseId);
  }

  sendJson(res, 200, state);
}

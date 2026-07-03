// GET  /api/activities                       -> the farm: jobs, monsters
//                                               (with busy state), running
//                                               assignments — after settling
//                                               anything that finished.
// POST /api/activities { monsterId, jobId }  -> assign a monster to a job.
//
// Both respond with the same shape: { trainer, settled, jobs, monsters,
// active } — trainer is re-read AFTER settlement so gold/exp are fresh, and
// `settled` lists what this very read paid out (the client shows it as
// "collected" messages).

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getTrainerById } from "../repos/trainers.js";
import { farmState, startActivity } from "../services/activities.js";

export async function activities(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
  const sql = db();

  let state;
  if (req.method === "GET") {
    state = await farmState(sql, trainerId);
  } else {
    const { monsterId, jobId } = await readJson(req);
    state = await startActivity(sql, trainerId, monsterId, jobId);
  }

  const trainer = await getTrainerById(sql, trainerId);
  sendJson(res, 200, { trainer, ...state });
}

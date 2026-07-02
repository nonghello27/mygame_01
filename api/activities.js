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

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getTrainerById } from "../server/repos/trainers.js";
import { farmState, startActivity } from "../server/services/activities.js";

export default async function handler(req, res) {
  try {
    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
    const sql = db();

    let state;
    if (req.method === "GET") {
      state = await farmState(sql, trainerId);
    } else if (req.method === "POST") {
      const { monsterId, jobId } = await readJson(req);
      state = await startActivity(sql, trainerId, monsterId, jobId);
    } else {
      return sendJson(res, 405, { error: "GET or POST only" });
    }

    const trainer = await getTrainerById(sql, trainerId);
    sendJson(res, 200, { trainer, ...state });
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

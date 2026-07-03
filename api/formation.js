// GET  /api/formation                 -> the trainer's saved defense
//                                        formation (with display data), or
//                                        null if they haven't saved one yet.
// POST /api/formation { monsterIds }  -> save (upsert) the defense formation
//                                        as exactly 3 owned monster ids, in
//                                        lane order. Busy monsters are fine
//                                        (defense is passive).

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getDefense, saveDefense } from "../server/services/pvp.js";

export default async function handler(req, res) {
  try {
    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
    const sql = db();

    if (req.method === "GET") {
      return sendJson(res, 200, await getDefense(sql, trainerId));
    }
    if (req.method === "POST") {
      const { monsterIds } = await readJson(req);
      return sendJson(res, 200, await saveDefense(sql, trainerId, monsterIds));
    }
    return sendJson(res, 405, { error: "GET or POST only" });
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

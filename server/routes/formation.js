// GET  /api/formation                 -> the trainer's saved defense
//                                        formation (with display data), or
//                                        null if they haven't saved one yet.
// POST /api/formation { monsterIds }  -> save (upsert) the defense formation
//                                        as exactly 3 owned monster ids, in
//                                        lane order. Busy monsters are fine
//                                        (defense is passive).

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getDefense, saveDefense } from "../services/pvp.js";

export async function formation(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });
  const sql = db();

  if (req.method === "GET") {
    return sendJson(res, 200, await getDefense(sql, trainerId));
  }
  const { monsterIds } = await readJson(req);
  return sendJson(res, 200, await saveDefense(sql, trainerId, monsterIds));
}

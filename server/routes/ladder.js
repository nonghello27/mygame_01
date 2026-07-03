// GET /api/ladder -> { season:{id,endsAt}, top:[...], me:{rating,wins,
//                       losses,draws,rank} }
//
// Ensures the PVP season is up to date (lazy rollover — closes + pays out an
// expired season, opens the next one) and that this trainer has a rank entry
// before reading the ladder.

import { db } from "../db.js";
import { sendJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getLadder } from "../services/pvp.js";

export async function ladder(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  sendJson(res, 200, await getLadder(db(), trainerId));
}

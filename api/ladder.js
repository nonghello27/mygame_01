// GET /api/ladder -> { season:{id,endsAt}, top:[...], me:{rating,wins,
//                       losses,draws,rank} }
//
// Ensures the PVP season is up to date (lazy rollover — closes + pays out an
// expired season, opens the next one) and that this trainer has a rank entry
// before reading the ladder.

import { db, sendJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { getLadder } from "../server/services/pvp.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    sendJson(res, 200, await getLadder(db(), trainerId));
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

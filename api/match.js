// POST /api/match -> { matchId, seed, you: [...], enemy: [...] }
//
// Opens a battle session for the logged-in trainer: the server picks and
// freezes the enemy team (composition AND lane order) plus the RNG seed.
// Starter monsters are granted here on a trainer's very first match.

import { db, sendJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { createMatch } from "../server/services/matches.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    sendJson(res, 200, await createMatch(db(), trainerId));
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

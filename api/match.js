// POST /api/match { mode? }  -> { matchId, seed, you: [...], enemy: [...] }
//
// Opens a battle session for the logged-in trainer: the server picks and
// freezes the enemy team (composition AND lane order) plus the RNG seed.
// Starter monsters are granted here on a trainer's very first match.
//
// mode is the only body field this endpoint reads: mode === "pvp" opens a
// ladder match against another trainer's saved defense formation; anything
// else (including no body at all) is today's free match against a random
// species team, unchanged.

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { createMatch } from "../server/services/matches.js";
import { createPvpMatch } from "../server/services/pvp.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const { mode } = await readJson(req);
    const sql = db();
    const result = mode === "pvp" ? await createPvpMatch(sql, trainerId) : await createMatch(sql, trainerId);
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, e.status || 500, { error: String(e?.message || e) });
  }
}

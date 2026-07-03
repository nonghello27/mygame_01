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

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { createMatch } from "../services/matches.js";
import { createPvpMatch } from "../services/pvp.js";

export async function match(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const { mode } = await readJson(req);
  const sql = db();
  const result = mode === "pvp" ? await createPvpMatch(sql, trainerId) : await createMatch(sql, trainerId);
  sendJson(res, 200, result);
}

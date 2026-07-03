// POST /api/battle
//   body: { matchId, playerOrder: number[] }
//   -> { youWin, survivor:{side,idx}|null, events:[...] }
//
// Resolves a match session created by POST /api/match. Everything that
// matters was frozen server-side at match creation (enemy team + order,
// seed, the attacker's stats); the client's only input is the lane order of
// its OWN army — validated as a strict permutation. The result is persisted
// on the match row and a match can be resolved exactly once, so replaying a
// won layout or retrying a loss is rejected with 409.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { resolveMatch } from "../services/matches.js";

export async function battle(req, res) {
  try {
    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const { matchId, playerOrder } = await readJson(req);
    sendJson(res, 200, await resolveMatch(db(), trainerId, matchId, playerOrder));
  } catch (e) {
    // This endpoint has always defaulted errors to 400 (the client sent a
    // bad choice), not the router's 500 — keep that.
    if (!e.status) e.status = 400;
    throw e;
  }
}

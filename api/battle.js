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

import { db, sendJson, readJson } from "./_db.js";
import { trainerIdFromRequest } from "../server/auth.js";
import { resolveMatch } from "../server/services/matches.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });

    const trainerId = trainerIdFromRequest(req);
    if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

    const { matchId, playerOrder } = await readJson(req);
    sendJson(res, 200, await resolveMatch(db(), trainerId, matchId, playerOrder));
  } catch (e) {
    sendJson(res, e.status || 400, { error: String(e?.message || e) });
  }
}

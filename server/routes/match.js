// POST /api/match { mode?, monsterIds?, keepEnemyMatchId? }
//   -> { matchId, seed, you: [...], enemy: [...] }
//
// Opens a battle session for the logged-in trainer: the server picks and
// freezes the enemy team (composition AND lane order) plus the RNG seed.
// Starter monsters are granted here on a trainer's very first match.
//
// Three body fields this endpoint reads:
//   mode              - "pvp" opens a ladder match against another
//                        trainer's saved defense formation; anything else
//                        (including no body at all) is today's free match
//                        against a random species team, unchanged.
//   monsterIds        - optional (Phase 10.2, both modes): exactly 3 owned,
//                        non-busy monster ids choosing WHICH monsters fight
//                        and in what initial lane order. Omitted = the
//                        first 3 available, the pre-10.2 behavior.
//                        Validated server-side by pickParty()
//                        (server/services/matches.js) — never trusted.
//   keepEnemyMatchId   - optional (Phase 10.4, free matches only): the id
//                        of the caller's own prior free match whose frozen
//                        enemy this new match reuses verbatim ("same enemy,
//                        new lineup"). Validated server-side by
//                        createMatch() — never trusted. 400 if sent
//                        alongside mode:"pvp", which has no fixed enemy to
//                        keep.

import { db } from "../db.js";
import { sendJson, readJson, httpError } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { createMatch } from "../services/matches.js";
import { createPvpMatch } from "../services/pvp.js";

export async function match(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const { mode, monsterIds, keepEnemyMatchId } = await readJson(req);
  if (mode === "pvp" && keepEnemyMatchId != null) {
    throw httpError(400, "keepEnemyMatchId is not supported for pvp matches");
  }
  const sql = db();
  const result = mode === "pvp"
    ? await createPvpMatch(sql, trainerId, monsterIds)
    : await createMatch(sql, trainerId, monsterIds, keepEnemyMatchId);
  sendJson(res, 200, result);
}

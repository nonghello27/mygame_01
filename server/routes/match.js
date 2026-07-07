// POST /api/match { mode?, monsterIds? }  -> { matchId, seed, you: [...], enemy: [...] }
//
// Opens a battle session for the logged-in trainer: the server picks and
// freezes the enemy team (composition AND lane order) plus the RNG seed.
// Starter monsters are granted here on a trainer's very first match.
//
// Two body fields this endpoint reads:
//   mode        - "pvp" opens a ladder match against another trainer's
//                 saved defense formation; anything else (including no body
//                 at all) is today's free match against a random species
//                 team, unchanged.
//   monsterIds  - optional (Phase 10.2, both modes): exactly 3 owned,
//                 non-busy monster ids choosing WHICH monsters fight and in
//                 what initial lane order. Omitted = the first 3 available,
//                 the pre-10.2 behavior. Validated server-side by
//                 pickParty() (server/services/matches.js) — never trusted.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { createMatch } from "../services/matches.js";
import { createPvpMatch } from "../services/pvp.js";

export async function match(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const { mode, monsterIds } = await readJson(req);
  const sql = db();
  const result = mode === "pvp"
    ? await createPvpMatch(sql, trainerId, monsterIds)
    : await createMatch(sql, trainerId, monsterIds);
  sendJson(res, 200, result);
}

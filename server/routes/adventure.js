// GET  /api/adventure/state   -> { adventures, session } the enabled routes
//   (public fields only) plus the trainer's current session, if any.
// POST /api/adventure/start   { adventureId, monsterIds } -> lock a 3-monster
//   party, generate the map, freeze both into a new session -> { session }.
// POST /api/adventure/move    { choice } -> resolve the current step's chosen
//   option -> { session, node } (node carries the battle event log, if any).
// POST /api/adventure/abandon {} -> give up the active run -> { session }.
//
// Same "act, then hand back everything the client needs to refresh"
// precedent as equipment's equip()/enhance() and runes' socket()/repair() —
// validation, claiming, and every roll all live in
// server/services/adventure.js; these handlers only wire session + body to
// that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { getState, start as startAdventure, move as moveAdventure, abandon as abandonAdventure } from "../services/adventure.js";

export async function state(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await getState(sql, trainerId));
}

export async function start(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await startAdventure(sql, trainerId, body));
}

export async function move(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await moveAdventure(sql, trainerId, body));
}

export async function abandon(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await abandonAdventure(sql, trainerId));
}

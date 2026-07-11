// GET  /api/adventure/state     -> { adventures, session } the enabled
//   routes (public fields only — id/name/description/width/height/
//   difficulties) plus the trainer's current session, if any.
// POST /api/adventure/start     { adventureId, difficulty, monsterIds } ->
//   lock a 3-monster party, generate the maze at the chosen difficulty,
//   freeze both (plus the move budget) into a new session -> { session }.
// POST /api/adventure/move      { x, y } -> step onto an adjacent, passable
//   cell, spending one move. An open/already-cleared cell is just a step; a
//   fresh item cell rolls loot in the same claim; a fresh monster cell
//   STAGES a battle instead (Phase 10.14's shape, unchanged) -> { session,
//   node }. Running the move budget to 0 anywhere but the entrance strands
//   the run (fails it) in the same call.
// POST /api/adventure/battle    { order } -> resolve a staged battle with
//   the player's own lane order (an applyOrder permutation, same gate
//   battle/resolve uses) -> { session, node } (node carries the battle event
//   log, plus gold/exp/catch summaries on a win). A win no longer completes
//   the run by itself — only exit() does; a win on the party's last move
//   away from the entrance strands it instead.
// POST /api/adventure/surrender {} -> give up a staged battle — a defeat,
//   forfeiting every escrowed reward -> { session }.
// POST /api/adventure/exit      {} -> leave the maze from the entrance —
//   THE ONLY way a run completes; grants every escrowed chest/item/battle
//   reward logged so far, all at once -> { session, granted }. 409 unless
//   standing at the entrance.
// POST /api/adventure/abandon   {} -> give up the active run -> { session }.
//
// Same "act, then hand back everything the client needs to refresh"
// precedent as equipment's equip()/enhance() and runes' socket()/repair() —
// validation, claiming, and every roll all live in
// server/services/adventure.js; these handlers only wire session + body to
// that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import {
  getState, start as startAdventure, move as moveAdventure,
  battle as battleAdventure, surrender as surrenderAdventure,
  exit as exitAdventure, abandon as abandonAdventure,
} from "../services/adventure.js";

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

export async function battle(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await battleAdventure(sql, trainerId, body));
}

export async function surrender(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await surrenderAdventure(sql, trainerId));
}

export async function exit(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await exitAdventure(sql, trainerId));
}

export async function abandon(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await abandonAdventure(sql, trainerId));
}

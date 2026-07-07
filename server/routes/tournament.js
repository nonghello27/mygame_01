// GET  /api/battle/tournaments          -> { tournaments } every tournament
//   (any status — cancelled/past stay visible as history), each with a live
//   entrant count and the CALLER's own entry summary ({enteredAt,
//   monsterIds, feePaid}) or null — never another trainer's team.
// POST /api/battle/tournament/register  { tournamentId, monsterIds } ->
//   { entry } register exactly 3 owned, free monsters for one tournament.
// POST /api/battle/tournament/withdraw  { tournamentId } -> { withdrawn:true }
//   give up a registration while the window is still open.
// GET  /api/battle/tournament/detail    ?id=<tournamentId> -> the bracket +
//   standings detail view (Phase 9.3) — settlement runs first (the lazy
//   hook), so this always reflects the freshest possible state.
//
// Rides the EXISTING `battle` domain router (server/routers/battle.js) — no
// new serverless function this phase (CLAUDE.md §5). Same "act, then hand
// back everything the client needs" precedent as adventure.js's handlers;
// validation, claiming, and every compensation live in
// server/services/tournament.js — these handlers only wire session + body
// to that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { listTournaments, register, withdraw, getTournamentDetail } from "../services/tournament.js";

export async function tournaments(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, await listTournaments(sql, trainerId));
}

export async function tournamentRegister(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await register(sql, trainerId, body?.tournamentId, body?.monsterIds));
}

export async function tournamentWithdraw(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await withdraw(sql, trainerId, body?.tournamentId));
}

export async function tournamentDetail(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  // createRouter strips the query string for ROUTING only — req.url still
  // carries it here (same precedent as server/routes/market.js's browse()).
  const params = new URL(req.url, "http://localhost").searchParams;
  const id = params.get("id");
  if (!id) return sendJson(res, 400, { error: "id is required" });
  sendJson(res, 200, await getTournamentDetail(sql, trainerId, id));
}

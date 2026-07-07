// GET  /api/guild/browse   -> { guilds } — every guild (id, name,
//   description, emblem, memberCount, leaderName), newest first.
// GET  /api/guild/me       -> the caller's whole guild view (see
//   server/services/guild.js's me() for the exact shape — guildless vs.
//   member vs. leader/officer differ only in which keys are present).
// POST /api/guild/create   { name, description?, emblem? } -> the me() view
// POST /api/guild/apply    { guildId, message? } -> the me() view
// POST /api/guild/accept   { applicationId } -> the me() view (leader only)
// POST /api/guild/reject   { applicationId } -> the me() view (leader only)
// POST /api/guild/leave    {} -> { left:true }
// POST /api/guild/kick     { trainerId } -> the me() view (leader only)
// POST /api/guild/promote  { trainerId, role:'officer'|'member' } -> the me()
//   view (leader only)
// POST /api/guild/transfer { trainerId } -> the me() view (leader only)
//
// Same "act, then hand back everything the client needs to refresh"
// precedent as market's list()/buy()/cancel() — validation, role checks, and
// every SQL statement live in server/services/guild.js; these handlers only
// wire session + request to that use-case. Service functions are imported
// under a `Uc` (use-case) suffix purely to avoid shadowing this file's own
// same-named exported handlers (server/routers/guild.js imports THESE names).

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import {
  browse as browseUc, me as meUc, create as createUc, apply as applyUc,
  accept as acceptUc, reject as rejectUc, leave as leaveUc, kick as kickUc,
  promote as promoteUc, transfer as transferUc,
} from "../services/guild.js";

export async function browse(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  sendJson(res, 200, await browseUc(db()));
}

export async function me(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  sendJson(res, 200, await meUc(db(), trainerId));
}

export async function create(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await createUc(db(), trainerId, body));
}

export async function apply(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await applyUc(db(), trainerId, body));
}

export async function accept(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await acceptUc(db(), trainerId, body));
}

export async function reject(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await rejectUc(db(), trainerId, body));
}

export async function leave(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  sendJson(res, 200, await leaveUc(db(), trainerId));
}

export async function kick(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await kickUc(db(), trainerId, body));
}

export async function promote(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await promoteUc(db(), trainerId, body));
}

export async function transfer(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await transferUc(db(), trainerId, body));
}

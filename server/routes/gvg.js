// GET  /api/guild/gvg/events  -> { membership, events } — every GVG event
//   (any status), each with a live registered-guild count, the caller's own
//   team summary, and (only while in a guild) whether their guild has
//   registered; a guild's LEADER additionally sees `guildTeams` per event —
//   every team their guild has submitted (display info only, never lanes —
//   see server/services/gvg.js's listGvgEvents for the exact shape).
// POST /api/guild/gvg/submit  { eventId, monsterIds } -> { team } submit
//   exactly 3 owned, free monsters as one team (any guild member, one
//   submission per trainer per event).
// POST /api/guild/gvg/withdraw { eventId } -> { withdrawn:true } withdraw
//   the caller's own team while it's still unpicked and the window is open.
// POST /api/guild/gvg/lineup  { eventId, teamIds } -> { guildTeams } leader
//   only: replace the guild's whole lineup (ordered submitted-team ids).
// POST /api/guild/gvg/register { eventId } -> { registered:true, lineup }
//   leader only: register the guild once a valid lineup is staged.
//
// Same "act, then hand back everything the client needs to refresh"
// precedent as server/routes/guild.js — validation, role checks, and every
// SQL statement live in server/services/gvg.js; these handlers only wire
// session + request to that use-case. Service functions are imported under a
// `Uc` (use-case) suffix purely to avoid shadowing this file's own
// same-named exported handlers (server/routers/guild.js imports THESE names).

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import {
  listGvgEvents as listGvgEventsUc,
  submitTeam as submitTeamUc,
  withdrawTeam as withdrawTeamUc,
  setLineup as setLineupUc,
  registerGuild as registerGuildUc,
} from "../services/gvg.js";

export async function gvgEvents(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  sendJson(res, 200, await listGvgEventsUc(db(), trainerId));
}

export async function gvgSubmit(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await submitTeamUc(db(), trainerId, body));
}

export async function gvgWithdraw(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await withdrawTeamUc(db(), trainerId, body));
}

export async function gvgLineup(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await setLineupUc(db(), trainerId, body));
}

export async function gvgRegister(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  sendJson(res, 200, await registerGuildUc(db(), trainerId, body));
}

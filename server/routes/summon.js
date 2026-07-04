// GET  /api/trainer/summon -> { summons } the enabled Summon Hall banners.
// POST /api/trainer/summon { summonId } -> pull one banner: pays its cost,
//   mints one new monster, and returns { summonId, seed, monster, gold,
//   inventory } — same "act, then hand back everything the client needs to
//   refresh" precedent as equipment's equip()/enhance() and runes' socket()/
//   repair(). Validation, payment, and the roll all live in
//   server/services/summon.js — these handlers only wire session + body to
//   that use-case.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import { listSummonHall, performSummon } from "../services/summon.js";

export async function summonHall(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const sql = db();
  sendJson(res, 200, { summons: await listSummonHall(sql) });
}

export async function summon(req, res) {
  const trainerId = trainerIdFromRequest(req);
  if (!trainerId) return sendJson(res, 401, { error: "not logged in" });

  const body = await readJson(req);
  const sql = db();
  sendJson(res, 200, await performSummon(sql, trainerId, body));
}

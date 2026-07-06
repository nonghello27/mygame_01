// The /api/admin/* endpoints. Every admin route has the same shape:
// authenticate the session, re-check is_admin in the DB (403 otherwise), run
// the mutation, respond with a FRESH masterState so the console just
// re-renders what the server now holds.
//
// GET /api/admin/master -> { classes, skills, species, jobs, itemDefs,
//                             equipmentDefs, runeDefs, enums }
//   The admin console's single read: every master table with usage
//   counts, plus the enum registries (elements, targeting rules, statuses,
//   slot types, item kinds, equipment domains/slots) straight from
//   shared/rules and adminValidate.js — the UI builds its dropdowns from
//   these, so the form options can never drift from what the engine
//   interprets. Admin only.
//
// POST   /api/admin/classes { cls, attackName, fx }  -> upsert a class
// DELETE /api/admin/classes { cls }                  -> delete (409 if species use it)
//
// POST   /api/admin/skills { id, name, slot, cooldown, data }  -> upsert a skill
//        (data is validated against the engine's closed op grammar)
// DELETE /api/admin/skills { id }  -> delete (409 while loadouts/monsters use it)
//
// POST   /api/admin/species { id, name, cls, emoji, sprite, starter, element,
//                             attackKind, attackStyle, targeting, base, attrs,
//                             skills:[p1,p2,normal,ult] }  -> upsert species + loadout
//        (class must exist; each loadout entry must be a skill of the slot's type)
// DELETE /api/admin/species { id }  -> delete (409 while owned monsters exist)
//
// POST   /api/admin/jobs { id, kind, name, durationS, rewards }  -> upsert a job
//        (work: rewards {gold, trainerExp} | training: rewards {attr, gain})
// DELETE /api/admin/jobs { id }  -> delete (409 while activities reference it)
//
// POST   /api/admin/items { id, kind, name, description }  -> upsert an item
// DELETE /api/admin/items { id }  -> delete (409 while any trainer owns it)
//
// POST   /api/admin/equipment { id, domain, slot, name, description,
//                                effects, enhance }  -> upsert equipment
//        (domain 'monster': slot weapon|armor|accessory; domain 'trainer':
//        slot head|body|charm; effects: battle_start/perm_stat list, may
//        carry perLevel; enhance: {maxLevel, goldPerLevel} or null)
// DELETE /api/admin/equipment { id }  -> delete (409 while owned)
//
// POST   /api/admin/runes { id, name, description, effects, maxCharges,
//                            repairGold }  -> upsert a rune
// DELETE /api/admin/runes { id }  -> delete (409 while any trainer owns it)
//
// POST   /api/admin/summons { id, name, description, cost, pool, enabled }
//        -> upsert a Summon Hall banner (Phase 7.4 step A). cost: a
//        non-empty list of {type:'gold',amount} | {type:'item',itemId,qty}
//        (at most one gold entry, no duplicate itemIds; every itemId must
//        name a real item_defs row). pool: a non-empty list of
//        {speciesId, weight} (no duplicate speciesIds; every speciesId must
//        name a real monster_species row). enabled defaults to true.
// DELETE /api/admin/summons { id }  -> delete (409 while any pull references it)
//
// POST   /api/admin/adventures { id, name, description, config, enabled }
//        -> upsert an Adventure route (Phase 7.4 step B). config: {steps,
//        choices, nodes, encounters, loot, gather, catchPct} — see
//        src/data/adventures.js's header for the full grammar; every
//        encounters speciesId must name a real monster_species row, every
//        loot/gather itemId must name a real item_defs row. enabled
//        defaults to true.
// DELETE /api/admin/adventures { id }  -> delete (409 while any session references it)
//
// Every mutation above responds with a fresh masterState. Admin only.
//
// GET  /api/admin/tournaments  -> { tournaments }  (Phase 9.2) every
//   tournament (any status) with a live entrant count — the admin tab's list.
// POST /api/admin/tournaments  { name, description?, entryFee?, regStartsAt,
//   regEndsAt, rewards }  -> { tournament }  create one; status always starts
//   'scheduled' (9.3's settleTournaments() is what later advances it).
//   rewards is the Phase 9.1 grammar (positionRewards for ranks 1-3,
//   percentileRewards tiers covering everyone else) — every itemId/
//   equipmentDefId/runeDefId/speciesId it names must be a real master row.
// POST /api/admin/tournaments/cancel  { id }  -> { tournament }  cancel at
//   any non-completed status: refunds every entrant's fee and releases their
//   busy locks (idempotent — safe to click twice), pays nothing else, and
//   keeps the row visible in history. 409 while already 'completed'.
//
// POST /api/admin/grant { trainerId?, kind, defId, qty? }
//   The only acquisition source until Phase 7.4 (marketplace/summons):
//   grants an item/equipment/rune to a trainer (defaults to the calling
//   admin). Responds with the inventory the grant landed in. Admin only.
//
// GET /api/admin/trainers -> { trainers }
//   Every trainer account (id, name, email, gold, exp, expertise, isAdmin,
//   createdAt, monsterCount). Admin only.
//
// GET  /api/admin/monsters?trainerId=<id> -> { trainer, monsters, unassigned }
//   One trainer's full monster roster, plus every UNASSIGNED monster
//   (trainer_id IS NULL — detached from an account but not deleted; see
//   012_monster_release.sql) available to attach elsewhere. Admin only.
// POST /api/admin/monsters { trainerId, speciesId } -> { trainer, monster, monsters, unassigned }
//   Mints one new monster instance for that trainer from a species master
//   row (base stats/attrs/skills copied straight from the species, same as
//   grantStarters()/the Summon Hall's mint). Admin only.
// POST /api/admin/monsters { trainerId, monsterId } -> { trainer, monster, monsters, unassigned }
//   Attaches an existing UNASSIGNED monster (trainer_id IS NULL) to that
//   trainer instead of minting a fresh one — send exactly one of speciesId
//   (mint) or monsterId (attach), never both/neither. Admin only.
// DELETE /api/admin/monsters { trainerId, monsterId } -> { trainer, monsters, unassigned }
//   Detaches one monster from that trainer's account: trainer_id -> NULL,
//   the row/attributes/skills persist as unassigned rather than being
//   deleted. Its equipped gear/socketed runes return to the trainer's bag.
//   409 while busy or while a member of the trainer's saved PVP defense
//   formation (remove it there first). Admin only.

import { db } from "../db.js";
import { sendJson, readJson, httpError } from "../http.js";
import { trainerIdFromRequest } from "../auth.js";
import {
  requireAdmin,
  masterState,
  saveClass,
  removeClass,
  saveSkill,
  removeSkill,
  saveSpecies,
  removeSpecies,
  saveJob,
  removeJob,
  saveItem,
  removeItem,
  saveEquipment,
  removeEquipment,
  saveRune,
  removeRune,
  saveSummon,
  removeSummon,
  saveAdventure,
  removeAdventure,
  grantToTrainer,
  listTrainers,
  trainerMonsters,
  mintMonsterForTrainer,
  attachMonsterToTrainer,
  detachMonsterFromTrainer,
} from "../services/admin.js";
import { getInventory } from "../services/inventory.js";
import { adminCreate as createTournament, adminCancel as cancelTournament, adminList as listTournamentsAdmin } from "../services/tournament.js";

export async function master(req, res) {
  const sql = db();
  await requireAdmin(sql, trainerIdFromRequest(req));
  sendJson(res, 200, await masterState(sql));
}

/**
 * Build a POST(upsert)/DELETE(remove) handler for one master table.
 * (The router only dispatches POST and DELETE here.)
 * @param {(sql, body) => Promise<void>} save    validated upsert
 * @param {(sql, id) => Promise<void>}   remove  guarded delete
 * @param {string} idKey  body field naming the row on DELETE ('id' or 'cls')
 */
function crudHandler(save, remove, idKey = "id") {
  return async function handler(req, res) {
    const sql = db();
    await requireAdmin(sql, trainerIdFromRequest(req));

    const body = await readJson(req);
    if (req.method === "POST") await save(sql, body);
    else await remove(sql, body[idKey]);

    sendJson(res, 200, await masterState(sql));
  };
}

export const classes = crudHandler(saveClass, removeClass, "cls");
export const skills = crudHandler(saveSkill, removeSkill);
export const species = crudHandler(saveSpecies, removeSpecies);
export const jobs = crudHandler(saveJob, removeJob);
export const items = crudHandler(saveItem, removeItem);
export const equipment = crudHandler(saveEquipment, removeEquipment);
export const runes = crudHandler(saveRune, removeRune);
export const summons = crudHandler(saveSummon, removeSummon);
export const adventures = crudHandler(saveAdventure, removeAdventure);

export async function grant(req, res) {
  const sql = db();
  const admin = await requireAdmin(sql, trainerIdFromRequest(req));

  const body = await readJson(req);
  const trainer = await grantToTrainer(sql, admin.id, body);

  sendJson(res, 200, { trainer, inventory: await getInventory(sql, trainer.id) });
}

export async function trainers(req, res) {
  const sql = db();
  await requireAdmin(sql, trainerIdFromRequest(req));
  sendJson(res, 200, { trainers: await listTrainers(sql) });
}

export async function monsters(req, res) {
  const sql = db();
  await requireAdmin(sql, trainerIdFromRequest(req));

  if (req.method === "GET") {
    // createRouter strips the query string for ROUTING only — req.url still
    // carries it here.
    const trainerId = new URL(req.url, "http://localhost").searchParams.get("trainerId");
    sendJson(res, 200, await trainerMonsters(sql, Number(trainerId)));
    return;
  }

  const body = await readJson(req);

  if (req.method === "DELETE") {
    sendJson(res, 200, await detachMonsterFromTrainer(sql, body));
    return;
  }

  // POST: exactly one of speciesId (mint a fresh instance) or monsterId
  // (attach an existing unassigned one) — the branch on which field is
  // present lives here; the actual logic lives in services/admin.js.
  const { speciesId, monsterId } = body ?? {};
  if ((speciesId === undefined) === (monsterId === undefined)) {
    throw httpError(400, "send speciesId (mint) or monsterId (attach)");
  }
  sendJson(res, 200, monsterId !== undefined
    ? await attachMonsterToTrainer(sql, body)
    : await mintMonsterForTrainer(sql, body));
}

// --- tournaments (Phase 9.2) --------------------------------------------------
//
// Unlike the master-table crudHandler()s above, these respond with just the
// tournament(s) touched — not a full masterState — since tournaments are
// admin-created INSTANCE data (CLAUDE.md §1.3), not master content the
// console's other tabs read via GET /api/admin/master.

export async function tournaments(req, res) {
  const sql = db();
  await requireAdmin(sql, trainerIdFromRequest(req));

  if (req.method === "GET") {
    sendJson(res, 200, await listTournamentsAdmin(sql));
    return;
  }

  const body = await readJson(req);
  sendJson(res, 200, { tournament: await createTournament(sql, body) });
}

export async function tournamentCancel(req, res) {
  const sql = db();
  await requireAdmin(sql, trainerIdFromRequest(req));

  const body = await readJson(req);
  sendJson(res, 200, { tournament: await cancelTournament(sql, body?.id) });
}

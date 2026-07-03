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
// Every mutation above responds with a fresh masterState. Admin only.
//
// POST /api/admin/grant { trainerId?, kind, defId, qty? }
//   The only acquisition source until Phase 7.4 (marketplace/summons):
//   grants an item/equipment/rune to a trainer (defaults to the calling
//   admin). Responds with the inventory the grant landed in. Admin only.

import { db } from "../db.js";
import { sendJson, readJson } from "../http.js";
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
  grantToTrainer,
} from "../services/admin.js";
import { getInventory } from "../services/inventory.js";

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

export async function grant(req, res) {
  const sql = db();
  const admin = await requireAdmin(sql, trainerIdFromRequest(req));

  const body = await readJson(req);
  const trainer = await grantToTrainer(sql, admin.id, body);

  sendJson(res, 200, { trainer, inventory: await getInventory(sql, trainer.id) });
}

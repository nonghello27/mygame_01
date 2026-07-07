// The shared event-reward GRANT registry (Phase 9.1's reward grammar,
// shared/rules/rewards.js) — ONE registry, no drift, for every event
// settlement engine that pays shared/rules/rewards.js's `resolveRewards()`
// output out to a trainer: server/services/tournament.js's settleRunning()
// and server/services/gvg.js's settleRunningGvg() both import THIS instead
// of keeping their own copy (this module used to live inline in
// tournament.js; Phase 9.7 lifted it out here the moment a second caller
// needed it — same "one source of truth" reasoning as shared/rules/
// bracket.js/rewards.js themselves being shared between the two domains).
//
// The pluggable REQUIREMENT_CHECKERS (server/services/summon.js) / NODE_
// RESOLVERS (server/services/adventure.js) precedent, CLAUDE.md §1.4: a new
// reward type is one more entry here (plus one more branch in
// shared/rules/rewards.js's EVENT_REWARD_TYPES and server/services/
// adminValidate.js's validateReward) — never a bare `if` bolted onto an
// existing branch. Keys cover EVENT_REWARD_TYPES exactly.

import { httpError } from "../http.js";
import { refundGold } from "../repos/trainers.js";
import {
  grantItem, grantEquipment, grantMonsterEquipment, grantRune, getEquipmentDomain,
} from "../repos/inventory.js";
import { mintMonster } from "../repos/monsters.js";
import { getSpeciesById } from "../repos/species.js";

export const REWARD_GRANTERS = {
  gold: (sql, trainerId, r) => refundGold(sql, trainerId, r.amount),
  item: (sql, trainerId, r) => grantItem(sql, trainerId, r.itemId, r.qty),
  equipment: async (sql, trainerId, r) => {
    const domain = await getEquipmentDomain(sql, r.equipmentDefId);
    return domain === "monster"
      ? grantMonsterEquipment(sql, trainerId, r.equipmentDefId)
      : grantEquipment(sql, trainerId, r.equipmentDefId);
  },
  rune: (sql, trainerId, r) => grantRune(sql, trainerId, r.runeDefId),
  monster: async (sql, trainerId, r) => {
    const species = await getSpeciesById(sql, r.speciesId);
    if (!species) throw httpError(500, `event reward names an unknown species "${r.speciesId}"`);
    return mintMonster(sql, trainerId, species);
  },
};

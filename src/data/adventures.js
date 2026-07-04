// Adventure master data, seeded into adventure_defs (npm run db:seed).
// Phase 7.4 step B — the second acquisition path (after the Summon Hall,
// step A). A trainer sends a party down a route generated from `config` by
// shared/rules/adventure.js's generateMap(); the FOLLOW-UP task's session
// service walks the frozen map, resolving each node the party picks.
//
// `config` grammar (validated by server/services/adminValidate.js's
// validateAdventure — keep this comment and that validator in sync):
//   steps        integer 3-10   — the map's length (generateMap's step count)
//   choices      integer 2-3    — options offered per step
//   nodes        non-empty array of { type, weight }, type one of
//                ADVENTURE_NODE_TYPES ("battle"|"chest"|"gather"), weight >= 1,
//                no duplicate types — the weighted table generateMap() draws
//                each non-final-step option's type from. A later node kind is
//                one new ADVENTURE_NODE_TYPES entry + one new resolver entry
//                in the step-B session service, never a branch here.
//   encounters   non-empty array (max 50) of { speciesId, weight }, speciesId
//                matching /^sp_[a-z0-9_]+$/, weight >= 1, no duplicate
//                speciesIds — the wild pool a "battle" node's enemy team is
//                drawn from.
//   loot         non-empty array (max 50) of { itemId, weight, qtyMin, qtyMax },
//                itemId matching /^it_[a-z0-9_]+$/, weight >= 1, qtyMin >= 1,
//                qtyMax >= qtyMin (both <= 100), no duplicate itemIds — what a
//                "chest" node drops (shared/rules/adventure.js rollLoot()).
//   gather       same shape/constraints as loot — what a "gather" node yields.
//   catchPct     integer 0-100  — chance to catch one defeated wild monster
//                after winning a "battle" node.
//
// Ids are stable strings — never renumber.

export const ADVENTURES = [
  { id: "ad_verdant_trail", name: "Verdant Trail",
    description: "A gentle woodland route for a beginner party — light wild encounters, easy pickings.",
    config: {
      steps: 5,
      choices: 2,
      nodes: [
        { type: "battle", weight: 50 },
        { type: "chest", weight: 25 },
        { type: "gather", weight: 25 },
      ],
      encounters: [
        { speciesId: "sp_vorth", weight: 40 },
        { speciesId: "sp_mesha", weight: 35 },
        { speciesId: "sp_gronk", weight: 25 },
      ],
      loot: [
        { itemId: "it_potion_small", weight: 50, qtyMin: 1, qtyMax: 2 },
        { itemId: "it_enhance_stone", weight: 40, qtyMin: 1, qtyMax: 3 },
        { itemId: "it_summon_scroll", weight: 10, qtyMin: 1, qtyMax: 1 },
      ],
      gather: [
        { itemId: "it_enhance_stone", weight: 80, qtyMin: 1, qtyMax: 2 },
        { itemId: "it_potion_small", weight: 20, qtyMin: 1, qtyMax: 1 },
      ],
      catchPct: 25,
    } },
];

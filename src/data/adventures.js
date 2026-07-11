// Adventure master data, seeded into adventure_defs (npm run db:seed).
// Phase 7.4 step B's second acquisition path (after the Summon Hall, step
// A), REWRITTEN for Phase 11 — Adventure 2.0's explorable grid maze replaces
// the old linear step-list.
//
// `config` grammar (validated by server/services/adminValidate.js's
// validateAdventure — keep this comment and that validator in sync):
//   width        integer 5-20   — the maze's column count
//   height       integer 5-20   — the maze's row count
//   movesBonus   optional integer 0-500, default 0 — flat moves added on top
//                of the chosen party's summed SPD when a run's move budget
//                is frozen (server/services/adventure.js, Phase 11.2).
//   difficulties object with EXACTLY the keys "easy"/"medium"/"hard", every
//                one required. Each tier is
//                  { monsterPct, itemPct, battleGold:{min,max}, battleExp:{min,max} }
//                monsterPct/itemPct: integers 1-60, their SUM <= 80 (a
//                harder tier packs the maze denser with BOTH monsters and
//                items, but at least a fifth of the open floor always stays
//                empty) — shared/rules/adventure.js's generateGridMap() uses
//                these two knobs to seed each maze's content. battleGold/
//                battleExp: each an integer {min,max} (0-10000, min <= max),
//                the gold/exp roll a battle-cell win escrows on top of the
//                existing catchPct catch roll.
//   encounters   non-empty array (max 50) of { speciesId, weight }, speciesId
//                matching /^sp_[a-z0-9_]+$/, weight >= 1, no duplicate
//                speciesIds — the wild pool a monster cell's enemy team is
//                drawn from (shared/rules/adventure.js rollEncounter()).
//   loot         non-empty array (max 50) of { itemId, weight, qtyMin, qtyMax },
//                itemId matching /^it_[a-z0-9_]+$/, weight >= 1, qtyMin >= 1,
//                qtyMax >= qtyMin (both <= 100), no duplicate itemIds — what
//                stepping onto an item cell rolls (rollLoot()).
//   catchPct     integer 0-100  — chance to catch one defeated wild monster
//                after winning a battle cell.
//   enemies      optional { min, max }, both 1-3, min <= max — how many wild
//                monsters a battle cell fields (the rolled count feeds
//                rollEncounter() the same way it did under the old grammar).
//                Absent defaults to { min: 1, max: 3 }.
//
// Ids are stable strings — never renumber. ad_verdant_trail keeps its
// Phase 7.4 id on purpose: npm run db:seed upserts by id, so this rewrite
// overwrites the old step-list-grammar row in place rather than orphaning it.

export const ADVENTURES = [
  { id: "ad_verdant_trail", name: "Verdant Trail",
    description: "A gentle 8x8 woodland maze for a beginner party — light wild encounters, easy pickings.",
    config: {
      width: 8,
      height: 8,
      movesBonus: 20,
      difficulties: {
        easy: { monsterPct: 12, itemPct: 15, battleGold: { min: 10, max: 25 }, battleExp: { min: 5, max: 10 } },
        medium: { monsterPct: 20, itemPct: 20, battleGold: { min: 20, max: 45 }, battleExp: { min: 10, max: 20 } },
        hard: { monsterPct: 30, itemPct: 30, battleGold: { min: 40, max: 80 }, battleExp: { min: 20, max: 40 } },
      },
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
      catchPct: 25,
      // A beginner route: mostly solo wild encounters, occasionally a pair.
      enemies: { min: 1, max: 2 },
    } },

  { id: "ad_old_quarry", name: "Old Quarry",
    description: "A cramped 10x10 rockbound maze — tougher packs and better hauls for a seasoned party.",
    config: {
      width: 10,
      height: 10,
      movesBonus: 35,
      difficulties: {
        // Same density knobs as Verdant Trail; rewards ~1.5x.
        easy: { monsterPct: 12, itemPct: 15, battleGold: { min: 15, max: 38 }, battleExp: { min: 8, max: 15 } },
        medium: { monsterPct: 20, itemPct: 20, battleGold: { min: 30, max: 68 }, battleExp: { min: 15, max: 30 } },
        hard: { monsterPct: 30, itemPct: 30, battleGold: { min: 60, max: 120 }, battleExp: { min: 30, max: 60 } },
      },
      encounters: [
        // The quarry's rockier wilds favor sp_gronk over the woodland pair.
        { speciesId: "sp_gronk", weight: 40 },
        { speciesId: "sp_vorth", weight: 30 },
        { speciesId: "sp_mesha", weight: 30 },
      ],
      loot: [
        { itemId: "it_enhance_stone", weight: 45, qtyMin: 1, qtyMax: 3 },
        { itemId: "it_potion_small", weight: 35, qtyMin: 1, qtyMax: 2 },
        { itemId: "it_summon_scroll", weight: 20, qtyMin: 1, qtyMax: 2 },
      ],
      catchPct: 20,
      // Packs run a little larger down here.
      enemies: { min: 1, max: 3 },
    } },

  { id: "ad_deepwood_labyrinth", name: "Deepwood Labyrinth",
    description: "A sprawling 15x15 maze for an expert party — the deepest wilds and the richest hauls.",
    config: {
      width: 15,
      height: 15,
      movesBonus: 70,
      difficulties: {
        // Same density knobs again; rewards ~2.5x Verdant Trail's.
        easy: { monsterPct: 12, itemPct: 15, battleGold: { min: 25, max: 63 }, battleExp: { min: 13, max: 25 } },
        medium: { monsterPct: 20, itemPct: 20, battleGold: { min: 50, max: 113 }, battleExp: { min: 25, max: 50 } },
        hard: { monsterPct: 30, itemPct: 30, battleGold: { min: 100, max: 200 }, battleExp: { min: 50, max: 100 } },
      },
      encounters: [
        // Deeper wilds skew toward the toughest local species.
        { speciesId: "sp_gronk", weight: 45 },
        { speciesId: "sp_mesha", weight: 30 },
        { speciesId: "sp_vorth", weight: 25 },
      ],
      loot: [
        // Rarer, better hauls the deeper the maze goes.
        { itemId: "it_summon_scroll", weight: 35, qtyMin: 1, qtyMax: 2 },
        { itemId: "it_enhance_stone", weight: 40, qtyMin: 2, qtyMax: 4 },
        { itemId: "it_potion_small", weight: 25, qtyMin: 1, qtyMax: 3 },
      ],
      catchPct: 15,
      // Full packs are the norm this deep in.
      enemies: { min: 2, max: 3 },
    } },
];

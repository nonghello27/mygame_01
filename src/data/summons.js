// Summon Hall master data, seeded into summon_defs (npm run db:seed).
// Phase 7.4 step A — the first real acquisition path (before this, the only
// source was the admin-gated POST /api/admin/grant).
//
// `cost` is a non-empty array of requirement objects, each one of:
//   { type: "gold", amount }        — at most one gold entry per banner
//   { type: "item", itemId, qty }   — no duplicate itemIds per banner
// (a later phase's "quest" requirement type slots in the same way — see
// server/services/summon.js's REQUIREMENT_CHECKERS registry).
//
// `pool` is a non-empty array of { speciesId, weight } (no duplicate
// speciesIds) — shared/rules/summon.js rollSummon() draws one speciesId,
// weighted, from this list using a freshly minted, stored RNG seed.
//
// Ids are stable strings — never renumber.

export const SUMMONS = [
  { id: "sm_novice", name: "Novice Summon",
    description: "A basic gold summon that draws from the wild pool. Always available.",
    cost: [{ type: "gold", amount: 100 }],
    pool: [
      { speciesId: "sp_vorth", weight: 40 },
      { speciesId: "sp_mesha", weight: 35 },
      { speciesId: "sp_gronk", weight: 25 },
    ] },

  { id: "sm_scroll", name: "Scroll Summon",
    description: "Spend a Summon Scroll for a shot at any of the six known species, " +
      "weighted toward the wild pool.",
    cost: [{ type: "item", itemId: "it_summon_scroll", qty: 1 }],
    pool: [
      { speciesId: "sp_vorth", weight: 25 },
      { speciesId: "sp_mesha", weight: 20 },
      { speciesId: "sp_gronk", weight: 20 },
      { speciesId: "sp_garran", weight: 15 },
      { speciesId: "sp_sile", weight: 10 },
      { speciesId: "sp_brak", weight: 10 },
    ] },
];

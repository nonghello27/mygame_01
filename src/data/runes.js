// Rune master data, seeded into rune_defs (npm run db:seed). Runes socket
// onto a monster (species.rune_slots caps how many; server/repos/runes.js).
// Effects are either the battle_start/perm_stat grammar shared with
// equipment_defs.effects, OR the rune-only `target_select`/
// `override_targeting` trigger (Phase 7.3 step C) — a rune can steer which
// enemy a turn targets, one charge per trigger regardless of how many
// battle_start effects a def carries (see shared/engine/resolve.js's
// fireRune). validateRuneEffects (server/services/adminValidate.js) is the
// grammar gate; equipment/skills never get the override shape.
//
// `maxCharges` seeds a rune instance's charges_left on grant; charges drain
// as battles consume them (durability settlement in
// server/services/matches.js resolveMatch), and `repairGold` is what the
// repair flow charges to un-break a rune once it hits zero. `sellGold`
// (Phase 8) is the per-unit instant sell-to-system price; 0 means not
// sellable to the system (the marketplace is the only way to move it).
// `icon` (Phase 10.17) is an optional base filename (no extension) under
// public/icons/runes/; NULL/absent falls back to the def id, then default.png.
// Ids are stable strings — never renumber.

export const RUNES = [
  { id: "rn_swift", name: "Swift Rune",
    description: "Quickens the wearer's reflexes.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 3, perLevel: 1 }],
    maxCharges: 5, repairGold: 30, sellGold: 35 },

  { id: "rn_fortitude", name: "Fortitude Rune",
    description: "Toughens the wearer's constitution.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 10, perLevel: 2 }],
    maxCharges: 5, repairGold: 40, sellGold: 45 },

  { id: "rn_precision", name: "Precision Rune",
    description: "Steadies the wearer's aim.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "acc", flat: 4, perLevel: 1 }],
    maxCharges: 3, repairGold: 25, sellGold: 30 },

  { id: "rn_hunter", name: "Hunter Rune",
    description: "Guides attacks toward the weakest foe.",
    effects: [{ when: "target_select", op: "override_targeting", rule: "lowest_hp_pct" }],
    maxCharges: 8, repairGold: 50, sellGold: 60 },
];

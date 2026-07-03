// Rune master data, seeded into rune_defs (npm run db:seed). Runes socket
// onto a monster (7.3 — socketing + monster_species.rune_slots aren't wired
// up yet; this step only seeds the defs + acquisition/inventory). Effects
// use the same battle_start/perm_stat grammar as equipment_defs.effects —
// targeting-override ops (the more "rune-like" behavior) arrive in 7.3.
//
// `maxCharges` seeds a rune instance's charges_left on grant; charges drain
// as later phases spend them, and `repairGold` is what 7.3's repair flow
// will charge to un-break a rune once it hits zero. Ids are stable strings
// — never renumber.

export const RUNES = [
  { id: "rn_swift", name: "Swift Rune",
    description: "Quickens the wearer's reflexes.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 3, perLevel: 1 }],
    maxCharges: 5, repairGold: 30 },

  { id: "rn_fortitude", name: "Fortitude Rune",
    description: "Toughens the wearer's constitution.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 10, perLevel: 2 }],
    maxCharges: 5, repairGold: 40 },

  { id: "rn_precision", name: "Precision Rune",
    description: "Steadies the wearer's aim.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "acc", flat: 4, perLevel: 1 }],
    maxCharges: 3, repairGold: 25 },
];

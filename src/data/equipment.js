// Equipment master data, seeded into equipment_defs (npm run db:seed).
// Two domains, each with 3 slots:
//   monster  — weapon | armor | accessory (equips onto an owned monster)
//   trainer  — head   | body  | charm     (equips onto the trainer)
//
// `effects` reuses the EXACT battle_start/perm_stat grammar skill passives
// already use (shared/engine/resolve.js applyEffect()) — no engine change —
// but unlike a skill passive, an effect here may carry `perLevel` so 7.2's
// enhancement system (enhance.maxLevel steps, enhance.goldPerLevel cost per
// step) has something to scale. `enhance: null` means the piece can't be
// enhanced at all. A piece's `enhance` may also carry an optional `material:
// { itemId, qtyPerLevel }` (Phase 7.2, step B) — a flat qty of that item_defs
// stack spent per step, alongside gold; omitted means gold-only. Nothing
// here is wired into a battle snapshot yet — that lands when 7.2/7.3
// actually consume equipped rows.
// Ids are stable strings — never renumber.

export const EQUIPMENT = [
  { id: "eq_iron_sword", domain: "monster", slot: "weapon", name: "Iron Sword",
    description: "A sturdy blade. Raises ATK.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2 }],
    enhance: { maxLevel: 5, goldPerLevel: 50, material: { itemId: "it_enhance_stone", qtyPerLevel: 1 } } },

  { id: "eq_leather_mail", domain: "monster", slot: "armor", name: "Leather Mail",
    description: "Light armor. Raises max HP.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 12, perLevel: 3 }],
    enhance: { maxLevel: 5, goldPerLevel: 40 } },

  { id: "eq_swift_charm", domain: "monster", slot: "accessory", name: "Swift Charm",
    description: "A charm that quickens the wearer.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 2, perLevel: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 60 } },

  { id: "eq_trainer_cap", domain: "trainer", slot: "head", name: "Trainer's Cap",
    description: "A worn cap. Sharpens accuracy.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "acc", flat: 3, perLevel: 1 }],
    enhance: { maxLevel: 5, goldPerLevel: 45 } },

  { id: "eq_trainer_vest", domain: "trainer", slot: "body", name: "Trainer's Vest",
    description: "A padded vest. Raises max HP.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 8, perLevel: 2 }],
    enhance: { maxLevel: 5, goldPerLevel: 45 } },

  { id: "eq_lucky_charm", domain: "trainer", slot: "charm", name: "Lucky Charm",
    description: "A trinket that favors critical strikes.",
    effects: [{ when: "battle_start", op: "perm_stat", stat: "crit", flat: 5, perLevel: 1 }],
    enhance: null },
];

// Item master data, seeded into item_defs (npm run db:seed). Two kinds:
//   material    — stacks used up by other systems (7.2 enhancement spends
//                 it_enhance_stone; 7.4 summoning spends it_summon_scroll)
//   consumable  — stacks a trainer uses directly (nothing consumes these
//                 yet; 7.1 only wires acquisition + the inventory read)
// `sellGold` (Phase 8) is the per-unit instant sell-to-system price; 0 means
// not sellable to the system (the marketplace is the only way to move it).
// Ids are stable strings — never renumber.

export const ITEMS = [
  { id: "it_enhance_stone", kind: "material", name: "Enhance Stone",
    description: "Feeds equipment enhancement (Phase 7.2).", sellGold: 15 },
  { id: "it_summon_scroll", kind: "material", name: "Summon Scroll",
    description: "Feeds monster summoning (Phase 7.4).", sellGold: 40 },
  { id: "it_potion_small", kind: "consumable", name: "Small Potion",
    description: "A basic restorative. Not yet consumable in battle.", sellGold: 10 },
];

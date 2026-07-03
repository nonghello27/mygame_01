// Item master data, seeded into item_defs (npm run db:seed). Two kinds:
//   material    — stacks used up by other systems (7.2 enhancement spends
//                 it_enhance_stone; 7.4 summoning spends it_summon_scroll)
//   consumable  — stacks a trainer uses directly (nothing consumes these
//                 yet; 7.1 only wires acquisition + the inventory read)
// Ids are stable strings — never renumber.

export const ITEMS = [
  { id: "it_enhance_stone", kind: "material", name: "Enhance Stone",
    description: "Feeds equipment enhancement (Phase 7.2)." },
  { id: "it_summon_scroll", kind: "material", name: "Summon Scroll",
    description: "Feeds monster summoning (Phase 7.4)." },
  { id: "it_potion_small", kind: "consumable", name: "Small Potion",
    description: "A basic restorative. Not yet consumable in battle." },
];

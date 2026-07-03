// Expertise + trainer-skill master data, seeded into expertises and
// trainer_skill_defs (npm run db:seed). A trainer picks one expertise and
// learns 2 of its skills into fixed slots (trainer_skills). Effects use the
// SAME closed op set the battle engine already interprets for monster
// skills (shared/engine/resolve.js applyEffect()) — no new engine branches
// are needed to consume this data:
//
//   { when: "battle_start" | "after_ally_turns",   // the only two triggers
//     op:   "perm_stat" | "heal" | "apply_status",
//     ...op params, exactly what applyEffect() already reads:
//       perm_stat:    stat ("atk"|"maxHp"|"spd"|"crit"|...), pct? or flat?
//       heal:         pct
//       apply_status: status (id in shared/rules/statuses.js), turns, pct?, chance?
//     perLevel: <number>,   // added to pct (or flat) per skill level above 1
//     target:   { rule: <key in shared/rules/targeting.js>, count: <n | "all"> } }
//
// All trainer-skill targets are the caster's OWN side — the engine passes
// the caster's allies as the pool, so `target.rule` only matters when
// count < "all" (e.g. picking the lowest_hp_pct ally to heal).
// Ids are stable strings — never renumber.

export const EXPERTISES = [
  {
    id: "warrior",
    name: "Warrior",
    skills: [
      {
        id: "ts_war_might", name: "Warlord's Might",
        data: { effects: [
          { when: "battle_start", op: "perm_stat", stat: "atk", pct: 10, perLevel: 2,
            target: { rule: "front", count: "all" } },
        ] },
      },
      {
        id: "ts_war_bulwark", name: "Bulwark",
        data: { effects: [
          { when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 12, perLevel: 2,
            target: { rule: "front", count: "all" } },
        ] },
      },
      {
        id: "ts_war_rally", name: "Rallying Cry",
        data: { effects: [
          { when: "after_ally_turns", op: "heal", pct: 6, perLevel: 1,
            target: { rule: "lowest_hp_pct", count: 1 } },
        ] },
      },
    ],
  },
  {
    id: "wizard",
    name: "Wizard",
    skills: [
      {
        id: "ts_wiz_focus", name: "Arcane Focus",
        data: { effects: [
          { when: "battle_start", op: "perm_stat", stat: "crit", flat: 10, perLevel: 2,
            target: { rule: "front", count: "all" } },
        ] },
      },
      {
        id: "ts_wiz_haste", name: "Haste",
        data: { effects: [
          { when: "battle_start", op: "perm_stat", stat: "spd", flat: 2, perLevel: 1,
            target: { rule: "front", count: "all" } },
        ] },
      },
      {
        id: "ts_wiz_mend", name: "Mending Word",
        data: { effects: [
          { when: "after_ally_turns", op: "heal", pct: 8, perLevel: 1,
            target: { rule: "lowest_hp_pct", count: 1 } },
        ] },
      },
    ],
  },
  {
    id: "shaman",
    name: "Shaman",
    skills: [
      {
        id: "ts_sha_totem", name: "Spirit Totem",
        data: { effects: [
          { when: "battle_start", op: "perm_stat", stat: "spd", flat: 3, perLevel: 1,
            target: { rule: "front", count: "all" } },
        ] },
      },
      {
        id: "ts_sha_mend", name: "Ancestral Mend",
        data: { effects: [
          { when: "after_ally_turns", op: "heal", pct: 7, perLevel: 1,
            target: { rule: "lowest_hp_pct", count: 1 } },
        ] },
      },
      {
        id: "ts_sha_warcry", name: "War Chant",
        data: { effects: [
          { when: "after_ally_turns", op: "apply_status", status: "atk_up",
            turns: 2, pct: 10, chance: 50, perLevel: 2,
            target: { rule: "front", count: 1 } },
        ] },
      },
    ],
  },
];

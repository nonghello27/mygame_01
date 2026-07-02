// Job master data, seeded into job_defs (npm run db:seed). Two kinds:
//   work     — the monster earns for the TRAINER: rewards { gold, trainerExp }
//   training — the monster grows ONE attribute:   rewards { attr, gain }
// Durations are prototype values; balance lives here (data), not in code.
// Ids are stable strings — never renumber.

export const JOBS = [
  // --- work: send a monster out, collect gold + trainer exp ---------------
  { id: "job_delivery", kind: "work", name: "Quick delivery", durationS: 60,
    rewards: { gold: 5, trainerExp: 3 } },
  { id: "job_errand", kind: "work", name: "Run errands", durationS: 5 * 60,
    rewards: { gold: 15, trainerExp: 8 } },
  { id: "job_patrol", kind: "work", name: "Patrol duty", durationS: 30 * 60,
    rewards: { gold: 80, trainerExp: 40 } },
  { id: "job_mine", kind: "work", name: "Mine crystals", durationS: 2 * 3600,
    rewards: { gold: 320, trainerExp: 150 } },

  // --- training: the monster's attribute grows permanently ----------------
  { id: "train_str", kind: "training", name: "Strength drills", durationS: 10 * 60,
    rewards: { attr: "str", gain: 1 } },
  { id: "train_agi", kind: "training", name: "Agility course", durationS: 10 * 60,
    rewards: { attr: "agi", gain: 1 } },
  { id: "train_vit", kind: "training", name: "Endurance run", durationS: 10 * 60,
    rewards: { attr: "vit", gain: 1 } },
  { id: "train_int", kind: "training", name: "Meditation", durationS: 10 * 60,
    rewards: { attr: "int", gain: 1 } },
  { id: "train_dex", kind: "training", name: "Target practice", durationS: 10 * 60,
    rewards: { attr: "dex", gain: 1 } },
];

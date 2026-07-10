// Monster rank tiers — a closed, ascending grading scale. Master species
// rows AND owned monster instance rows each carry one column: a species'
// rank is its baseline (set in src/data/units.js or live via the admin
// console), an owned monster copies it at mint time and then lives its own
// life from there (admin-editable, and meant to become player-upgradeable
// in a later phase). Display-only today — no engine effect.

export const RANKS = ["D", "C", "B", "A", "S", "SR", "SSR"];

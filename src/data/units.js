// Species definitions — seeded into `monster_species` (+ `species_skills`) by
// db/seed.mjs. ROSTER_A are the STARTER species every new trainer receives;
// ROSTER_B is the wild/enemy pool. `hp/atk/spd` are the BASE statline;
// battle stats are derived from base + attrs in shared/rules/formulas.js.
//
// Per species: element (shared/rules/elements.js), attackKind 'melee'|'range'
// (melee always hits the front; range uses `targeting` from
// shared/rules/targeting.js and pays the front-line penalty), attackStyle
// 'phys'|'mag' (which derived roll the basic attack uses), attrs
// {str,agi,vit,int,dex}, and skills [passive1, passive2, normal, ultimate]
// (ids from data/skills.js, null = empty slot).
//
// `sprite` is OPTIONAL and points at a sheet id in data/sprites.js; units
// without one fall back to their emoji (see ui/sprite.js).

/** @typedef {{name:string, cls:string, emoji:string, hp:number, atk:number, spd:number,
 *   element:string, attackKind:string, attackStyle:string, targeting:string,
 *   attrs:{str:number,agi:number,vit:number,int:number,dex:number},
 *   skills:(string|null)[], sprite?:string, rank?:string}} SpeciesDef */

/** @type {SpeciesDef[]} starter species */
export const ROSTER_A = [
  { name: "Garran", cls: "Knight", emoji: "🛡️", hp: 130, atk: 24, spd: 6, sprite: "u4",
    element: "earth", attackKind: "melee", attackStyle: "phys", targeting: "front",
    attrs: { str: 8, agi: 3, vit: 10, int: 2, dex: 4 }, rank: "B",
    skills: ["sk_tough", null, "sk_power_strike", "sk_war_banner"] },
  { name: "Sile", cls: "Archer", emoji: "🏹", hp: 80, atk: 36, spd: 9, sprite: "u6",
    element: "wind", attackKind: "range", attackStyle: "phys", targeting: "behind_front",
    attrs: { str: 6, agi: 9, vit: 4, int: 3, dex: 10 }, rank: "A",
    skills: ["sk_keen_eye", null, "sk_piercing_shot", "sk_arrow_rain"] },
  { name: "Brak", cls: "Lancer", emoji: "🗡️", hp: 105, atk: 30, spd: 7, sprite: "u1",
    element: "fire", attackKind: "melee", attackStyle: "phys", targeting: "front",
    attrs: { str: 9, agi: 6, vit: 6, int: 2, dex: 6 }, rank: "C",
    skills: ["sk_swift", null, "sk_fire_lance", "sk_inferno"] },
];

/** @type {SpeciesDef[]} wild/enemy pool */
export const ROSTER_B = [
  { name: "Vorth", cls: "Raider", emoji: "⚔️", hp: 115, atk: 28, spd: 7, sprite: "u2",
    element: "dark", attackKind: "melee", attackStyle: "phys", targeting: "front",
    attrs: { str: 8, agi: 6, vit: 7, int: 3, dex: 7 }, rank: "B",
    skills: ["sk_keen_eye", null, "sk_dark_slash", "sk_terror"] },
  { name: "Mesha", cls: "Shaman", emoji: "🔮", hp: 78, atk: 38, spd: 8, sprite: "u5",
    element: "water", attackKind: "range", attackStyle: "mag", targeting: "random_enemy",
    attrs: { str: 2, agi: 7, vit: 4, int: 12, dex: 5 }, rank: "S",
    skills: ["sk_swift", null, "sk_water_bolt", "sk_frost_nova"] },
  { name: "Gronk", cls: "Warbeast", emoji: "🐗", hp: 145, atk: 22, spd: 4, sprite: "u3",
    element: "earth", attackKind: "melee", attackStyle: "phys", targeting: "front",
    attrs: { str: 11, agi: 2, vit: 12, int: 1, dex: 3 }, rank: "D",
    skills: ["sk_tough", null, "sk_crush", "sk_earthquake"] },
];

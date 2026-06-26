// Army rosters. Each entry is a "unit definition" — the template the game
// clones into a live unit instance (see core/units.js). Index 0 is the FRONT
// lane (fights first); players can reorder before battle.
//
// Stat fields are intentionally simple and extensible. Add fields here (e.g.
// `def`, `crit`, `skills`) and consume them in core/battle.js + ui/board.js.

// `sprite` is OPTIONAL and points at a sheet id in data/sprites.js. It is kept
// separate from `cls` so visuals and stats vary independently. Units without a
// `sprite` fall back to their emoji (see ui/sprite.js), so art can be added one
// unit at a time.

/** @typedef {{name:string, cls:string, emoji:string, hp:number, atk:number, spd:number, sprite?:string}} UnitDef */

/** @type {UnitDef[]} */
export const ROSTER_A = [
  { name: "Garran", cls: "Knight", emoji: "🛡️", hp: 130, atk: 24, spd: 6, sprite: "u4" }, // armored knight
  { name: "Sile",   cls: "Archer", emoji: "🏹", hp: 80,  atk: 36, spd: 9, sprite: "u6" }, // archer
  { name: "Brak",   cls: "Lancer", emoji: "🗡️", hp: 105, atk: 30, spd: 7, sprite: "u1" }, // golden dragon
];

/** @type {UnitDef[]} */
export const ROSTER_B = [
  { name: "Vorth", cls: "Raider",   emoji: "⚔️", hp: 115, atk: 28, spd: 7, sprite: "u2" }, // skeletal horseman
  { name: "Mesha", cls: "Shaman",   emoji: "🔮", hp: 78,  atk: 38, spd: 8, sprite: "u5" }, // wizard
  { name: "Gronk", cls: "Warbeast", emoji: "🐗", hp: 145, atk: 22, spd: 4, sprite: "u3" }, // lava golem
];

// Army rosters. Each entry is a "unit definition" — the template the game
// clones into a live unit instance (see core/units.js). Index 0 is the FRONT
// lane (fights first); players can reorder before battle.
//
// Stat fields are intentionally simple and extensible. Add fields here (e.g.
// `def`, `crit`, `skills`) and consume them in core/battle.js + ui/board.js.

/** @typedef {{name:string, cls:string, emoji:string, hp:number, atk:number, spd:number}} UnitDef */

/** @type {UnitDef[]} */
export const ROSTER_A = [
  { name: "Garran", cls: "Knight", emoji: "🛡️", hp: 130, atk: 24, spd: 6 },
  { name: "Sile",   cls: "Archer", emoji: "🏹", hp: 80,  atk: 36, spd: 9 },
  { name: "Brak",   cls: "Lancer", emoji: "🗡️", hp: 105, atk: 30, spd: 7 },
];

/** @type {UnitDef[]} */
export const ROSTER_B = [
  { name: "Vorth", cls: "Raider",   emoji: "⚔️", hp: 115, atk: 28, spd: 7 },
  { name: "Mesha", cls: "Shaman",   emoji: "🔮", hp: 78,  atk: 38, spd: 8 },
  { name: "Gronk", cls: "Warbeast", emoji: "🐗", hp: 145, atk: 22, spd: 4 },
];

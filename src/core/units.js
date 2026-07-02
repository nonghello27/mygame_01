// Turns static unit definitions into live unit instances and provides small
// queue helpers used by the battle loop.

let uid = 0;

/** Create a live unit instance from a snapshot lane (derived stats included). */
export function makeUnit(def) {
  const maxHp = def.maxHp ?? def.hp;
  return {
    ...def,
    id: "u" + uid++,
    maxHp,
    hp: maxHp,
    alive: true,
    statuses: [], // status ids currently shown on the card
  };
}

/** Clone a whole roster into fresh instances. */
export const cloneRoster = (defs) => defs.map(makeUnit);

/** First still-living unit in a lane order (the current front-liner). */
export const firstAlive = (arr) => arr.find((u) => u.alive) || null;

/** How many units are still standing. */
export const aliveCount = (arr) => arr.filter((u) => u.alive).length;

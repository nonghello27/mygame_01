// Turns static unit definitions into live unit instances and provides small
// queue helpers used by the battle loop.

let uid = 0;

/** Create a live unit instance from a definition. */
export function makeUnit(def) {
  return {
    ...def,
    id: "u" + uid++,
    maxHp: def.hp,
    hp: def.hp,
    alive: true,
    // Room to grow: statuses live here later, e.g. status: []
  };
}

/** Clone a whole roster into fresh instances. */
export const cloneRoster = (defs) => defs.map(makeUnit);

/** First still-living unit in a lane order (the current front-liner). */
export const firstAlive = (arr) => arr.find((u) => u.alive) || null;

/** How many units are still standing. */
export const aliveCount = (arr) => arr.filter((u) => u.alive).length;

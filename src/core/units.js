// Turns static unit definitions into live unit instances and provides small
// queue helpers used by the battle loop.

import { applyGearStats } from "../../shared/rules/formulas.js";

let uid = 0;

/** Create a live unit instance from a snapshot lane (derived stats included).
 *  Display-only: fold the lane's equipped gear + socketed runes onto its
 *  derived stat fields via applyGearStats() so the card shows the SAME
 *  numbers the engine actually computed damage/HP from — the engine applies
 *  these same battle_start effects itself, server-side, before the fight
 *  ever starts; the replayer still does no math, it just now renders the
 *  gear-effective baseline instead of the raw one. */
export function makeUnit(def) {
  const eff = applyGearStats(def, [...(def.equipment ?? []), ...(def.runes ?? [])]);
  const maxHp = eff.maxHp ?? eff.hp;
  return {
    ...eff,
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

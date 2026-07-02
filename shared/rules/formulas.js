// Derived-stat and damage formulas — engine v2's balance knobs, kept as data
// in ONE place. Attributes (STR/AGI/VIT/INT/DEX) come from the DB; everything
// a battle actually uses is derived here. Change numbers here, not in the
// engine loop; the golden tests will diff any change so it's always deliberate.

/** Gauge points a unit must accumulate to take a turn (see engine loop). */
export const GAUGE_THRESHOLD = 100;

/** Hard stop: a battle that reaches this many turns is a draw. */
export const TURN_CAP = 200;

/** Range attacks into the FRONT lane keep only this fraction of their power —
 *  range's job is bypassing the front line, not duelling it (GAME_DESIGN §3). */
export const RANGE_FRONT_PENALTY = 0.25;

export const CRIT_MULTIPLIER = 1.5;

/**
 * Derive battle stats from a base statline + attributes.
 * @param {{hp:number, atk:number, spd:number}} base   species/monster baseline
 * @param {{str:number, agi:number, vit:number, int:number, dex:number}} attrs
 */
export function deriveStats(base, attrs) {
  const { str = 0, agi = 0, vit = 0, int: intel = 0, dex = 0 } = attrs;
  return {
    maxHp: base.hp + vit * 8,
    atkMin: base.atk + str,                 // physical roll range
    atkMax: base.atk + str + Math.ceil(dex / 2),
    matkMin: intel * 2,                     // magical roll range
    matkMax: intel * 3,
    spd: base.spd + agi,                    // gauge fill per tick
    crit: 5 + dex * 0.5,                    // % chance, 1.5x damage
    evade: Math.min(25, agi * 0.5),         // % chance to dodge (capped)
    acc: 90 + dex * 0.5,                    // % base chance to hit
  };
}

/** Chance (0–100) for an attack to land. Frozen targets cannot evade. */
export function hitChance(attacker, target, targetFrozen) {
  const evade = targetFrozen ? 0 : target.evade;
  return Math.max(50, Math.min(100, attacker.acc - evade));
}

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

/** Display-only "power" score for one lane/monster, derived from
 *  deriveStats() output. A UI number, never an engine input — the formula
 *  is a deliberate placeholder to be rebalanced later. */
export function powerScore(d) {
  return Math.round(d.maxHp + (d.atkMin + d.atkMax) * 5 + (d.matkMin + d.matkMax) * 5 + d.spd * 20);
}

/**
 * Fold a list of equipment/rune pieces' `perm_stat` battle_start effects onto
 * a derived statline — mirrors shared/engine/resolve.js's perm_stat +
 * scaledFx semantics EXACTLY (atk: round(v*(1+pct/100))+flat, clamped >=0;
 * maxHp: round(maxHp*(1+pct/100)), pct only; every other stat: flat add).
 * Two piece shapes share this one loop: equipment carries `enhanceLevel`
 * (the engine feeds it level = enhanceLevel + 1, so bonus = perLevel *
 * enhanceLevel); runes carry `level` directly (the engine feeds that level
 * as-is, so bonus = perLevel * (level - 1)) — a rune-only `target_select`
 * trigger has no `op:"perm_stat"` and is skipped by the guard below same as
 * any other non-perm_stat effect. Broken/depleted runes are skipped outright
 * — they can't fire in a real battle either. Display only — never sent
 * anywhere; the server (server/repos/equipment.js, server/repos/runes.js) is
 * the one place this math actually pays out in a real battle.
 */
export function applyGearStats(d, pieces) {
  const out = { ...d };
  for (const p of pieces) {
    if (p.broken || p.chargesLeft === 0) continue;
    const lvl = p.enhanceLevel ?? ((p.level ?? 1) - 1);
    for (const fx of p.effects ?? []) {
      if (fx.when !== "battle_start" || fx.op !== "perm_stat") continue;
      const bonus = (fx.perLevel ?? 0) * lvl;
      const flat = fx.flat !== undefined ? fx.flat + bonus : undefined;
      const pct = fx.flat !== undefined ? (fx.pct ?? 0) : (fx.pct ?? 0) + bonus;
      if (fx.stat === "maxHp") out.maxHp = Math.round(out.maxHp * (1 + pct / 100));
      else if (fx.stat === "atk") {
        out.atkMin = Math.max(0, Math.round(out.atkMin * (1 + pct / 100)) + (flat ?? 0));
        out.atkMax = Math.max(0, Math.round(out.atkMax * (1 + pct / 100)) + (flat ?? 0));
      } else out[fx.stat] = (out[fx.stat] ?? 0) + (flat ?? 0);
    }
  }
  return out;
}

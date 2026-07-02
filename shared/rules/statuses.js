// Status-effect registry (GAME_DESIGN §4). A status INSTANCE on a unit is
// { id, turnsLeft, pct } — this table says what the engine does with it.
// Flags are interpreted at fixed points of the turn pipeline; new statuses
// are new rows here (+ content that applies them), never engine branches.

export const STATUSES = {
  stun:   { label: "Stunned", control: true },              // skip the turn
  freeze: { label: "Frozen", noEvade: true },               // cannot dodge
  burn:   { label: "Burning", dot: "maxHpPct" },            // pct of maxHp per turn
  poison: { label: "Poisoned", dot: "maxHpPct" },
  // stat buffs/debuffs from skills also live as statuses so they expire the
  // same way; `mod` names the derived stat they scale (pct can be negative).
  atk_up:  { label: "ATK Up", mod: "atk" },
  spd_up:  { label: "SPD Up", mod: "spd" },
  atk_down:{ label: "Cursed", mod: "atk" },
};

/** Sum the active percentage modifier a unit has on a derived stat. */
export function statMod(unit, stat) {
  let pct = 0;
  for (const s of unit.statuses) {
    if (STATUSES[s.id]?.mod === stat) pct += s.pct;
  }
  return 1 + pct / 100;
}

export const hasFlag = (unit, flag) => unit.statuses.some((s) => STATUSES[s.id]?.[flag]);

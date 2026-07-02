// Targeting registry — the closed set of rules a species' attack or a skill
// may name (GAME_DESIGN §3: melee locks to the front; range picks a pattern).
// Each rule takes the ALIVE enemies in lane order (front first) plus the rng
// and returns the chosen target. New patterns are new entries, not engine ifs.

export const TARGETING = {
  /** The front-liner. The only rule melee is allowed to use. */
  front: (alive) => alive[0],
  /** Any living enemy, seeded-random. */
  random_enemy: (alive, rng) => rng.pick(alive),
  /** The slot behind the front (falls back to the front when alone). */
  behind_front: (alive) => alive[1] ?? alive[0],
  /** The backmost lane first — assassin pattern. */
  backmost: (alive) => alive[alive.length - 1],
  /** Executioner pattern: whoever is closest to death, by HP percentage. */
  lowest_hp_pct: (alive) =>
    alive.reduce((low, u) => (u.hp / u.maxHp < low.hp / low.maxHp ? u : low)),
};

/**
 * Resolve a rule name into concrete target(s).
 * @param {string} rule      key in TARGETING
 * @param {object[]} alive   living enemies, front first
 * @param {object} rng       seeded rng
 * @param {number|"all"} count  how many targets (multi-target skills)
 */
export function selectTargets(rule, alive, rng, count = 1) {
  if (alive.length === 0) return [];
  if (count === "all") return [...alive];
  const fn = TARGETING[rule] ?? TARGETING.front;
  const picked = [];
  const pool = [...alive];
  for (let i = 0; i < count && pool.length; i++) {
    const t = fn(pool, rng);
    picked.push(t);
    pool.splice(pool.indexOf(t), 1); // no double-hitting one unit in a volley
  }
  return picked;
}

// Master skill data — seeded into the `skills` table by db/seed.mjs and
// interpreted by the closed op-set in shared/engine + shared/rules. Adding a
// skill = adding a row here + assigning it in units.js; the engine never
// changes. `data` grammar (ARCHITECTURE §5):
//
//   power:  { scale:'phys'|'mag', pct, perLevel? }      damage roll multiplier
//   target: { rule?:<targeting.js>, count?:n|'all' }    defaults to the species' pattern
//   onHit:  [{ op:'apply_status', status, chance, turns, pct? }]
//   support:[{ op:'heal'|'apply_status', target:{rule,count}, ... }]  (allies pool)
//   passive:[{ when:'battle_start', op:'perm_stat', stat, pct?|flat? }]
//
// Slots: 'passive' | 'normal' | 'ultimate'. Ultimates start ON cooldown.

/** @type {Array<{id:string,name:string,slot:string,cooldown:number,data:object}>} */
export const SKILLS = [
  // --- normals ------------------------------------------------------------
  { id: "sk_power_strike", name: "Power Strike", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 120, perLevel: 5 } } },
  { id: "sk_piercing_shot", name: "Piercing Shot", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 110, perLevel: 5 }, target: { rule: "behind_front" } } },
  { id: "sk_fire_lance", name: "Fire Lance", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 115, perLevel: 5 },
            onHit: [{ op: "apply_status", status: "burn", chance: 30, turns: 2, pct: 8 }] } },
  { id: "sk_dark_slash", name: "Dark Slash", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 110, perLevel: 5 },
            onHit: [{ op: "apply_status", status: "atk_down", chance: 25, turns: 2, pct: -15 }] } },
  { id: "sk_water_bolt", name: "Water Bolt", slot: "normal", cooldown: 0,
    data: { power: { scale: "mag", pct: 120, perLevel: 5 } } },
  { id: "sk_crush", name: "Crush", slot: "normal", cooldown: 0,
    data: { power: { scale: "phys", pct: 125, perLevel: 5 } } },

  // --- ultimates (charge up: they start on cooldown) -----------------------
  { id: "sk_war_banner", name: "War Banner", slot: "ultimate", cooldown: 4,
    data: { support: [{ op: "apply_status", status: "atk_up", pct: 20, turns: 3,
                        target: { rule: "front", count: "all" } }] } },
  { id: "sk_arrow_rain", name: "Rain of Arrows", slot: "ultimate", cooldown: 4,
    data: { power: { scale: "phys", pct: 80, perLevel: 5 }, target: { count: "all" } } },
  { id: "sk_inferno", name: "Inferno", slot: "ultimate", cooldown: 5,
    data: { power: { scale: "phys", pct: 150, perLevel: 8 },
            onHit: [{ op: "apply_status", status: "burn", chance: 60, turns: 2, pct: 10 }] } },
  { id: "sk_terror", name: "Terrorize", slot: "ultimate", cooldown: 4,
    data: { power: { scale: "phys", pct: 130, perLevel: 6 },
            onHit: [{ op: "apply_status", status: "stun", chance: 50, turns: 1 }] } },
  { id: "sk_frost_nova", name: "Frost Nova", slot: "ultimate", cooldown: 5,
    data: { power: { scale: "mag", pct: 100, perLevel: 6 }, target: { count: "all" },
            onHit: [{ op: "apply_status", status: "freeze", chance: 40, turns: 2 }] } },
  { id: "sk_earthquake", name: "Earthquake", slot: "ultimate", cooldown: 5,
    data: { power: { scale: "phys", pct: 90, perLevel: 5 }, target: { count: "all" },
            onHit: [{ op: "apply_status", status: "stun", chance: 25, turns: 1 }] } },

  // --- passives (fire once at battle start) --------------------------------
  { id: "sk_tough", name: "Toughness", slot: "passive", cooldown: 0,
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "maxHp", pct: 15 }] } },
  { id: "sk_keen_eye", name: "Keen Eye", slot: "passive", cooldown: 0,
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "crit", flat: 10 }] } },
  { id: "sk_swift", name: "Swiftness", slot: "passive", cooldown: 0,
    data: { passive: [{ when: "battle_start", op: "perm_stat", stat: "spd", flat: 3 }] } },
];

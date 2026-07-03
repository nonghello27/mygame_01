// Fixture lanes shared by the golden tests (resolve.test.mjs), the behavior
// tests (engine.test.mjs), and the golden-file regenerator (golden/regen.mjs).
// Lanes carry DERIVED stats (as match snapshots do); `lane()` defaults to a
// zero-variance statline (min == max, no crit/evade, perfect accuracy) so
// behavior tests stay deterministic regardless of seed.

import { SKILLS } from "../src/data/skills.js";
import { EXPERTISES } from "../src/data/expertises.js";
import { EQUIPMENT } from "../src/data/equipment.js";
import { RUNES } from "../src/data/runes.js";

/** Build a snapshot lane with sane deterministic defaults. */
export function lane(idx, over = {}) {
  return {
    idx,
    name: over.name ?? `U${idx}`,
    cls: "Knight",
    element: "neutral",
    attackKind: "melee",
    attackStyle: "phys",
    targeting: "front",
    maxHp: 100,
    atkMin: 10,
    atkMax: 10,
    matkMin: 0,
    matkMax: 0,
    spd: 10,
    crit: 0,
    evade: 0,
    acc: 100,
    skills: [],
    ...over,
  };
}

/** Look up a master skill by id and attach a level (as the DB join would). */
export function skill(id, level = 1) {
  const s = SKILLS.find((x) => x.id === id);
  if (!s) throw new Error(`fixture references unknown skill ${id}`);
  return { id: s.id, name: s.name, slot: s.slot, cooldown: s.cooldown, level, data: s.data };
}

/** Look up a trainer skill by id and attach a level (shape resolveBattle's
 * `trainers` param expects — see src/data/expertises.js). */
export function trainerSkill(id, level = 1) {
  const s = EXPERTISES.flatMap((ex) => ex.skills).find((x) => x.id === id);
  if (!s) throw new Error(`fixture references unknown trainer skill ${id}`);
  return { id: s.id, name: s.name, level, data: s.data };
}

/** Look up a master equipment def by id and attach a level (shape a lane's
 * `equipment[]` entry / a trainer's `equipment[]` entry expects — see
 * server/repos/equipment.js: level is enhance_level + 1, so level 1 is an
 * unenhanced piece). */
export function equip(id, level = 1) {
  const e = EQUIPMENT.find((x) => x.id === id);
  if (!e) throw new Error(`fixture references unknown equipment ${id}`);
  return { id: e.id, name: e.name, level, effects: e.effects };
}

/** Look up a master rune def by id and attach the instance fields a lane's
 * `runes[]` entry expects (shape a lane's runes[] entry expects — see
 * server/repos/runes.js `listSocketedRunes`): `instanceId` is the OWNED
 * rune row's id (what runeUse tallies key off of, distinct from `id` the
 * def id), `chargesLeft` defaults to the def's maxCharges (a fresh rune). */
export function rune(id, { instanceId = 1, level = 1, chargesLeft } = {}) {
  const r = RUNES.find((x) => x.id === id);
  if (!r) throw new Error(`fixture references unknown rune ${id}`);
  return {
    instanceId, id: r.id, name: r.name, level,
    chargesLeft: chargesLeft ?? r.maxCharges,
    effects: r.effects,
  };
}

// Golden battles: full-fat teams exercising elements, range targeting,
// skills, statuses, crit/evade variance — everything the seed controls.
export const BATTLES = {
  "battle-skirmish": {
    seed: 42,
    rosterA: [
      lane(0, { name: "Garran", cls: "Knight", element: "earth", maxHp: 210, atkMin: 32, atkMax: 34, spd: 9, crit: 7, evade: 1.5, acc: 92,
                skills: [skill("sk_tough"), skill("sk_power_strike"), skill("sk_war_banner")] }),
      lane(1, { name: "Sile", cls: "Archer", element: "wind", attackKind: "range", targeting: "behind_front",
                maxHp: 112, atkMin: 42, atkMax: 47, spd: 18, crit: 10, evade: 4.5, acc: 95,
                skills: [skill("sk_keen_eye"), skill("sk_piercing_shot"), skill("sk_arrow_rain")] }),
      lane(2, { name: "Brak", cls: "Lancer", element: "fire", maxHp: 153, atkMin: 39, atkMax: 42, spd: 13, crit: 8, evade: 3, acc: 93,
                skills: [skill("sk_swift"), skill("sk_fire_lance"), skill("sk_inferno")] }),
    ],
    rosterB: [
      lane(0, { name: "Gronk", cls: "Warbeast", element: "earth", maxHp: 241, atkMin: 33, atkMax: 35, spd: 6, crit: 6.5, evade: 1, acc: 91,
                skills: [skill("sk_tough"), skill("sk_crush"), skill("sk_earthquake")] }),
      lane(1, { name: "Vorth", cls: "Raider", element: "dark", maxHp: 171, atkMin: 36, atkMax: 40, spd: 13, crit: 8.5, evade: 3, acc: 93,
                skills: [skill("sk_keen_eye"), skill("sk_dark_slash"), skill("sk_terror")] }),
      lane(2, { name: "Mesha", cls: "Shaman", element: "water", attackKind: "range", attackStyle: "mag", targeting: "random_enemy",
                maxHp: 110, atkMin: 4, atkMax: 7, matkMin: 24, matkMax: 36, spd: 15, crit: 7.5, evade: 3.5, acc: 92,
                skills: [skill("sk_swift"), skill("sk_water_bolt"), skill("sk_frost_nova")] }),
    ],
  },
  "battle-plain": {
    // no skills, no variance: the readiness loop and damage math in isolation
    seed: 7,
    rosterA: [lane(0, { atkMin: 30, atkMax: 30, spd: 12 }), lane(1, { maxHp: 80, atkMin: 20, atkMax: 20, spd: 8 })],
    rosterB: [lane(0, { maxHp: 120, atkMin: 25, atkMax: 25, spd: 10 }), lane(1, { atkMin: 15, atkMax: 15, spd: 14 })],
  },
  "battle-trainers": {
    // exercises trainer skills (Phase 6 step 2): a battle_start perm_stat
    // (level > 1, so perLevel scaling is live), an after_ally_turns heal
    // targeting lowest_hp_pct, and a single-skill loadout on the other side.
    seed: 21,
    rosterA: [
      lane(0, { name: "Adan", maxHp: 150, atkMin: 20, atkMax: 20, spd: 14 }),
      lane(1, { name: "Bex", maxHp: 90, atkMin: 15, atkMax: 15, spd: 11 }),
      lane(2, { name: "Coro", maxHp: 110, atkMin: 18, atkMax: 18, spd: 9 }),
    ],
    rosterB: [
      lane(0, { name: "Drask", maxHp: 200, atkMin: 22, atkMax: 22, spd: 10 }),
      lane(1, { name: "Elm", maxHp: 130, atkMin: 17, atkMax: 17, spd: 13 }),
    ],
    trainers: {
      a: { skills: [trainerSkill("ts_war_might", 3), trainerSkill("ts_war_rally", 2)] },
      b: { skills: [trainerSkill("ts_wiz_haste", 1)] },
    },
  },
};

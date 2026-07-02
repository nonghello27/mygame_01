// Battle engine v2 — pure, deterministic, NO DOM, no I/O, no wall clock.
// Runs on the SERVER from match snapshots and RECORDS an ordered event list
// the client animates; the replayer never does math (CLAUDE.md §1).
//
// Model (GAME_DESIGN §7): a READINESS loop — every unit's gauge fills by its
// effective speed each tick; crossing the threshold grants a turn (threshold
// subtracted, overflow carries, so haste/slow behave). Each turn runs one
// fixed pipeline: tick statuses → control check → choose action (ultimate if
// ready, else normal, else basic attack) → choose targets → resolve hits →
// cooldowns. ALL randomness (rolls, crits, procs, tie-breaks) flows through
// ONE rng seeded from the match's stored seed: same snapshots + same seed ⇒
// the exact same event log, replayable and auditable forever.
//
// Content is data: skills/statuses/targeting arrive as rows interpreted by
// the closed registries in shared/rules/. Adding a skill must not add an
// `if` here.

import { makeRng } from "./rng.js";
import {
  GAUGE_THRESHOLD,
  TURN_CAP,
  RANGE_FRONT_PENALTY,
  CRIT_MULTIPLIER,
  hitChance,
} from "../rules/formulas.js";
import { elementMultiplier } from "../rules/elements.js";
import { selectTargets } from "../rules/targeting.js";
import { STATUSES, statMod, hasFlag } from "../rules/statuses.js";

/**
 * Resolve a whole battle from two lane snapshots (see server/services/matches
 * `toLane`: derived stats + skills already computed and frozen in the DB).
 * @param {object[]} laneA player team, lane 0 = front
 * @param {object[]} laneB enemy team, lane 0 = front
 * @param {number} seed   the match's stored RNG seed
 * @returns {{youWin:boolean, draw:boolean, survivor:{side:string,idx:number}|null, events:object[]}}
 */
export function resolveBattle(laneA, laneB, seed = 1) {
  const rng = makeRng(seed);
  const events = [];
  const A = laneA.map((d) => liveUnit(d, "a"));
  const B = laneB.map((d) => liveUnit(d, "b"));
  const all = [...A, ...B];

  // battle_start passives fire in a frozen, deterministic order:
  // player lanes front-to-back, then enemy lanes.
  for (const u of all) {
    for (const sk of u.skills) {
      for (const fx of sk.data.passive ?? []) {
        if (fx.when === "battle_start") {
          applyEffect(u, u, fx, sk, events, rng, u.side === "a" ? A : B);
        }
      }
    }
  }

  let turns = 0;
  while (aliveCount(A) && aliveCount(B) && turns < TURN_CAP) {
    // Advance time until somebody crosses the threshold. Ties broken by the
    // seeded rng so neither side owns the coin flip.
    let ready = all.filter((u) => u.alive && u.gauge >= GAUGE_THRESHOLD);
    while (ready.length === 0) {
      for (const u of all) if (u.alive) u.gauge += effSpd(u);
      ready = all.filter((u) => u.alive && u.gauge >= GAUGE_THRESHOLD);
    }
    ready.sort((x, y) => y.gauge - x.gauge || (rng.next() < 0.5 ? -1 : 1));

    for (const unit of ready) {
      if (!unit.alive || !aliveCount(A) || !aliveCount(B)) break;
      unit.gauge -= GAUGE_THRESHOLD;
      takeTurn(unit, unit.side === "a" ? A : B, unit.side === "a" ? B : A, events, rng);
      turns++;
      if (turns >= TURN_CAP) break;
    }
  }

  const draw = Boolean(aliveCount(A) && aliveCount(B));
  const youWin = !draw && aliveCount(A) > 0;
  if (draw) events.push({ t: "draw", turns });
  const survivor = draw ? null : firstAlive(youWin ? A : B);
  return { youWin, draw, survivor: survivor ? ref(survivor) : null, events };
}

// --- one unit's turn (the fixed pipeline) --------------------------------------

function takeTurn(unit, own, enemies, events, rng) {
  events.push({ t: "turn", side: unit.side, idx: unit.idx });

  // 1. turn_start: damage-over-time ticks, status durations, cooldowns.
  for (const s of [...unit.statuses]) {
    if (STATUSES[s.id]?.dot) {
      const dmg = Math.max(1, Math.round((unit.maxHp * s.pct) / 100));
      const before = unit.hp;
      unit.hp = Math.max(0, unit.hp - dmg);
      events.push({ t: "dot", side: unit.side, idx: unit.idx, status: s.id, dmg, before, after: unit.hp });
    }
    s.turnsLeft--;
    if (s.turnsLeft <= 0) {
      unit.statuses.splice(unit.statuses.indexOf(s), 1);
      events.push({ t: "status_end", side: unit.side, idx: unit.idx, status: s.id });
    }
  }
  if (unit.hp <= 0) return fall(unit, events);
  for (const k of Object.keys(unit.cooldowns)) {
    if (unit.cooldowns[k] > 0) unit.cooldowns[k]--;
  }

  // 2. control check: stunned units lose the turn.
  if (hasFlag(unit, "control")) {
    return void events.push({ t: "skip", side: unit.side, idx: unit.idx, status: "stun" });
  }

  // 3. choose action: ultimate if off cooldown, else normal, else basic attack.
  const ultimate = unit.skills.find((s) => s.slot === "ultimate" && unit.cooldowns[s.id] === 0);
  const normal = unit.skills.find((s) => s.slot === "normal");
  const skill = ultimate ?? normal ?? basicAttack(unit);
  if (skill.cooldown > 0) unit.cooldowns[skill.id] = skill.cooldown;
  if (skill.id !== "basic") {
    events.push({ t: "skill", side: unit.side, idx: unit.idx, skill: skill.id, name: skill.name });
  }

  // 4+5. targets, then resolve every part of the skill.
  const alive = enemies.filter((u) => u.alive);
  if (skill.data.power) {
    const spec = skill.data.target ?? {};
    for (const target of selectTargets(spec.rule ?? unit.targeting, alive, rng, spec.count ?? 1)) {
      strike(unit, target, skill, events, rng, alive);
      if (!target.alive) alive.splice(alive.indexOf(target), 1);
    }
  }
  for (const fx of skill.data.support ?? []) {
    applyEffect(unit, unit, fx, skill, events, rng, own.filter((u) => u.alive));
  }
}

/** ONE damage choke point — every HP loss from an attack goes through here. */
function strike(att, def, skill, events, rng, aliveEnemies) {
  if (!rng.chance(hitChance(att, def, hasFlag(def, "noEvade")))) {
    return void events.push({ t: "miss", att: ref(att), def: ref(def) });
  }

  const scale = skill.data.power.scale === "mag" ? "matk" : "atk";
  const lo = att[scale + "Min"];
  const hi = att[scale + "Max"];
  const powerPct = skill.data.power.pct + (skill.data.power.perLevel ?? 0) * (skill.level - 1);

  let dmg = rng.int(Math.min(lo, hi), Math.max(lo, hi)) * (powerPct / 100);
  dmg *= statMod(att, "atk");
  const eMult = elementMultiplier(att.element, def.element);
  dmg *= eMult;
  const crit = rng.chance(att.crit);
  if (crit) dmg *= CRIT_MULTIPLIER;
  // Range pays the front-line penalty when it hits the current front-liner.
  if (att.attackKind === "range" && def === aliveEnemies[0]) dmg *= RANGE_FRONT_PENALTY;
  dmg = Math.max(1, Math.round(dmg));

  const before = def.hp;
  def.hp = Math.max(0, def.hp - dmg);
  events.push({
    t: "strike",
    att: ref(att),
    def: ref(def),
    dmg,
    before,
    after: def.hp,
    crit,
    eff: eMult > 1 ? "strong" : eMult < 1 ? "weak" : null,
    skill: skill.id === "basic" ? null : skill.id,
  });

  if (def.hp <= 0) return fall(def, events);

  // On-hit riders (status procs) — data, rolled on the shared rng.
  for (const fx of skill.data.onHit ?? []) applyEffect(att, def, fx, skill, events, rng);
}

/** Apply one data-driven effect (the closed op set). */
function applyEffect(source, fallbackTarget, fx, skill, events, rng, pool = []) {
  const targets = fx.target
    ? selectTargets(fx.target.rule ?? "front", pool, rng, fx.target.count ?? 1)
    : [fallbackTarget];

  for (const target of targets) {
    if (fx.chance !== undefined && !rng.chance(fx.chance)) continue;

    if (fx.op === "apply_status") {
      const status = { id: fx.status, turnsLeft: fx.turns ?? 2, pct: fx.pct ?? 0 };
      target.statuses = target.statuses.filter((s) => s.id !== status.id); // refresh, don't stack
      target.statuses.push(status);
      events.push({
        t: "status", side: target.side, idx: target.idx,
        status: status.id, turns: status.turnsLeft, from: ref(source),
      });
    } else if (fx.op === "heal") {
      const amount = Math.round((target.maxHp * fx.pct) / 100);
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amount);
      events.push({ t: "heal", side: target.side, idx: target.idx, amount: target.hp - before, before, after: target.hp });
    } else if (fx.op === "perm_stat") {
      // battle_start passives: bake the bonus into the derived stats for the fight.
      if (fx.stat === "maxHp") {
        target.maxHp = Math.round(target.maxHp * (1 + fx.pct / 100));
        target.hp = target.maxHp;
      } else if (fx.stat === "atk") {
        target.atkMin = Math.round(target.atkMin * (1 + (fx.pct ?? 0) / 100));
        target.atkMax = Math.round(target.atkMax * (1 + (fx.pct ?? 0) / 100));
      } else {
        target[fx.stat] += fx.flat ?? 0;
      }
      events.push({ t: "buff", side: target.side, idx: target.idx, stat: fx.stat, skill: skill.id });
    }
  }
}

// --- plumbing -------------------------------------------------------------------

/** A live combat instance from a snapshot lane (derived stats precomputed). */
function liveUnit(d, side) {
  return {
    side,
    idx: d.idx,
    name: d.name,
    cls: d.cls,
    element: d.element ?? "neutral",
    attackKind: d.attackKind ?? "melee",
    attackStyle: d.attackStyle ?? "phys",
    targeting: d.attackKind === "range" ? d.targeting ?? "front" : "front", // melee locks to front
    maxHp: d.maxHp ?? d.hp,
    hp: d.maxHp ?? d.hp,
    atkMin: d.atkMin ?? d.atk,
    atkMax: d.atkMax ?? d.atk,
    matkMin: d.matkMin ?? 0,
    matkMax: d.matkMax ?? 0,
    spd: d.spd,
    crit: d.crit ?? 0,
    evade: d.evade ?? 0,
    acc: d.acc ?? 100,
    skills: (d.skills ?? []).map((s) => ({ ...s, level: s.level ?? 1, data: s.data ?? {} })),
    // Ultimates start ON cooldown — they charge up, they don't open the fight.
    cooldowns: Object.fromEntries(
      (d.skills ?? []).filter((s) => s.cooldown > 0).map((s) => [s.id, s.cooldown])
    ),
    statuses: [],
    gauge: 0,
    alive: true,
  };
}

const basicAttack = (unit) => ({
  id: "basic",
  name: "Attack",
  slot: "normal",
  level: 1,
  cooldown: 0,
  data: { power: { scale: unit.attackStyle, pct: 100 } },
});

function fall(unit, events) {
  unit.alive = false;
  events.push({ t: "fall", side: unit.side, idx: unit.idx });
}

const effSpd = (u) => Math.max(1, u.spd * statMod(u, "spd"));
const ref = (u) => ({ side: u.side, idx: u.idx });
const firstAlive = (arr) => arr.find((u) => u.alive) || null;
const aliveCount = (arr) => arr.reduce((n, u) => n + (u.alive ? 1 : 0), 0);

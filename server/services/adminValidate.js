// Pure validation for admin master-data writes (Phase 5). No DB, no I/O —
// callers fetch whatever context a check needs (existing classes/skills) and
// pass it in, so every rule here is unit-testable like the engine.
//
// The enums are re-exported for /api/admin/master: the admin UI builds its
// dropdowns from THESE lists, so the form options can never drift from what
// the engine (shared/rules) actually interprets.

import { ELEMENTS } from "../../shared/rules/elements.js";
import { TARGETING } from "../../shared/rules/targeting.js";
import { STATUSES } from "../../shared/rules/statuses.js";
import { httpError } from "../http.js";

export const SKILL_SLOTS = ["passive", "normal", "ultimate"];
export const ATTACK_KINDS = ["melee", "range"];
export const ATTACK_STYLES = ["phys", "mag"];
export const JOB_KINDS = ["work", "training"];
export const ATTRS = ["str", "agi", "vit", "int", "dex"];
// Stats perm_stat passives may touch — the closed set resolve.js interprets.
export const PERM_STATS = ["maxHp", "atk", "matk", "spd", "crit", "evade", "acc"];
export const TARGET_RULES = Object.keys(TARGETING);
export const STATUS_IDS = Object.keys(STATUSES);
// Loadout contract from 004_engine_v2.sql: slots 0–1 passive, 2 normal, 3 ultimate.
export const LOADOUT_SLOT_TYPES = ["passive", "passive", "normal", "ultimate"];
// Phase 7.1 — item/equipment/rune master-data enums (009_items.sql).
export const ITEM_KINDS = ["material", "consumable"];
export const EQUIP_DOMAINS = ["trainer", "monster"];
export const EQUIP_SLOTS = {
  monster: ["weapon", "armor", "accessory"],
  trainer: ["head", "body", "charm"],
};

/** Everything the admin UI needs to render its dropdowns. */
export function enums() {
  return {
    elements: ELEMENTS,
    targeting: TARGET_RULES,
    statuses: STATUS_IDS,
    skillSlots: SKILL_SLOTS,
    attackKinds: ATTACK_KINDS,
    attackStyles: ATTACK_STYLES,
    jobKinds: JOB_KINDS,
    attrs: ATTRS,
    permStats: PERM_STATS,
    loadoutSlotTypes: LOADOUT_SLOT_TYPES,
    itemKinds: ITEM_KINDS,
    equipDomains: EQUIP_DOMAINS,
    equipSlots: EQUIP_SLOTS,
  };
}

// --- small field helpers ---------------------------------------------------

const bad = (msg) => httpError(400, msg);

function str(v, label, { pattern, max = 80 } = {}) {
  if (typeof v !== "string" || !v.trim()) throw bad(`${label} is required`);
  const s = v.trim();
  if (s.length > max) throw bad(`${label} is too long (max ${max})`);
  if (pattern && !pattern.test(s)) throw bad(`${label} must match ${pattern}`);
  return s;
}

function int(v, label, { min = 0, max = 1_000_000 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw bad(`${label} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function oneOf(v, list, label) {
  if (!list.includes(v)) throw bad(`${label} must be one of: ${list.join(", ")}`);
  return v;
}

function onlyKeys(obj, allowed, label) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw bad(`${label}: unknown key "${k}" (allowed: ${allowed.join(", ")})`);
  }
}

// --- classes -----------------------------------------------------------------

/** @returns {{cls:string, attackName:string, fx:string}} */
export function validateClass(input) {
  return {
    cls: str(input.cls, "class name", { pattern: /^[A-Za-z][A-Za-z0-9 ]*$/ }),
    attackName: str(input.attackName, "attack name"),
    fx: str(input.fx, "fx id", { pattern: /^[a-z][a-z0-9_]*$/ }),
  };
}

// --- skills --------------------------------------------------------------------

function validateTarget(t, label) {
  if (typeof t !== "object" || t === null) throw bad(`${label} must be an object`);
  onlyKeys(t, ["rule", "count"], label);
  const out = {};
  if (t.rule !== undefined) out.rule = oneOf(t.rule, TARGET_RULES, `${label}.rule`);
  if (t.count !== undefined) {
    out.count = t.count === "all" ? "all" : int(t.count, `${label}.count`, { min: 1, max: 9 });
  }
  return out;
}

function validateStatusOp(op, label) {
  const out = { op: "apply_status", status: oneOf(op.status, STATUS_IDS, `${label}.status`) };
  // chance is optional — the engine reads "no chance" as "always applies".
  if (op.chance !== undefined) out.chance = int(op.chance, `${label}.chance`, { min: 1, max: 100 });
  out.turns = int(op.turns, `${label}.turns`, { min: 1, max: 20 });
  if (op.pct !== undefined) {
    const n = Number(op.pct);
    if (!Number.isFinite(n) || n < -100 || n > 100) throw bad(`${label}.pct must be between -100 and 100`);
    out.pct = n;
  }
  if (op.target !== undefined) out.target = validateTarget(op.target, `${label}.target`);
  return out;
}

/** Skill `data` grammar — mirrors exactly what shared/engine/resolve.js reads. */
export function validateSkillData(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw bad("skill data must be a JSON object");
  }
  onlyKeys(data, ["power", "target", "onHit", "support", "passive"], "data");
  const out = {};

  if (data.power !== undefined) {
    onlyKeys(data.power, ["scale", "pct", "perLevel"], "data.power");
    out.power = {
      scale: oneOf(data.power.scale, ATTACK_STYLES, "data.power.scale"),
      pct: int(data.power.pct, "data.power.pct", { min: 1, max: 1000 }),
    };
    if (data.power.perLevel !== undefined) {
      out.power.perLevel = int(data.power.perLevel, "data.power.perLevel", { min: 0, max: 100 });
    }
  }
  if (data.target !== undefined) out.target = validateTarget(data.target, "data.target");

  if (data.onHit !== undefined) {
    if (!Array.isArray(data.onHit) || data.onHit.length === 0) throw bad("data.onHit must be a non-empty array");
    out.onHit = data.onHit.map((op, i) => {
      if (op?.op !== "apply_status") throw bad(`data.onHit[${i}].op must be "apply_status"`);
      return validateStatusOp(op, `data.onHit[${i}]`);
    });
  }

  if (data.support !== undefined) {
    if (!Array.isArray(data.support) || data.support.length === 0) throw bad("data.support must be a non-empty array");
    out.support = data.support.map((op, i) => {
      const label = `data.support[${i}]`;
      if (op?.op === "apply_status") return validateStatusOp(op, label);
      if (op?.op === "heal") {
        const heal = { op: "heal", pct: int(op.pct, `${label}.pct`, { min: 1, max: 100 }) };
        if (op.target !== undefined) heal.target = validateTarget(op.target, `${label}.target`);
        return heal;
      }
      throw bad(`${label}.op must be "heal" or "apply_status"`);
    });
  }

  // Skills never get perLevel on their passives — only equipment/runes do
  // (see validateBattleStartEffects below); this keeps skill grammar exactly
  // as it was before 7.1.
  if (data.passive !== undefined) out.passive = validateBattleStartEffects(data.passive, "data.passive", false);

  if (Object.keys(out).length === 0) throw bad("skill data must define power, support, or passive");
  return out;
}

/**
 * Shared grammar for a battle_start/perm_stat effects list — used by skill
 * passives, equipment effects, and rune effects alike (all interpreted by
 * the SAME engine op, shared/engine/resolve.js applyEffect()). Skills keep
 * their historical shape (no perLevel); equipment/runes may add perLevel so
 * 7.2's enhancement system has something to scale — pass allowPerLevel=true
 * for those callers.
 * @returns {object[]}
 */
export function validateBattleStartEffects(list, label, allowPerLevel = true) {
  if (!Array.isArray(list) || list.length === 0) throw bad(`${label} must be a non-empty array`);
  return list.map((fx, i) => {
    const l = `${label}[${i}]`;
    if (fx?.when !== "battle_start") throw bad(`${l}.when must be "battle_start"`);
    if (fx?.op !== "perm_stat") throw bad(`${l}.op must be "perm_stat"`);
    const o = { when: "battle_start", op: "perm_stat", stat: oneOf(fx.stat, PERM_STATS, `${l}.stat`) };
    if (fx.pct === undefined && fx.flat === undefined) throw bad(`${l} needs pct or flat`);
    if (fx.pct !== undefined) o.pct = int(fx.pct, `${l}.pct`, { min: -100, max: 100 });
    if (fx.flat !== undefined) o.flat = int(fx.flat, `${l}.flat`, { min: -1000, max: 1000 });
    if (fx.perLevel !== undefined) {
      if (!allowPerLevel) throw bad(`${l}.perLevel is not allowed here`);
      o.perLevel = int(fx.perLevel, `${l}.perLevel`, { min: 0, max: 100 });
    }
    return o;
  });
}

/** @returns {{id:string, name:string, slot:string, cooldown:number, data:object}} */
export function validateSkill(input) {
  const skill = {
    id: str(input.id, "skill id", { pattern: /^sk_[a-z0-9_]+$/ }),
    name: str(input.name, "skill name"),
    slot: oneOf(input.slot, SKILL_SLOTS, "slot"),
    cooldown: int(input.cooldown ?? 0, "cooldown", { min: 0, max: 20 }),
    data: validateSkillData(input.data),
  };
  if (skill.slot === "passive" && !skill.data.passive) throw bad("a passive skill needs data.passive");
  if (skill.slot !== "passive" && skill.data.passive) throw bad(`a ${skill.slot} skill cannot have data.passive`);
  if (skill.slot !== "passive" && !skill.data.power && !skill.data.support) {
    throw bad(`a ${skill.slot} skill needs data.power or data.support`);
  }
  return skill;
}

// --- species -----------------------------------------------------------------

/**
 * @param input   raw body
 * @param context {classNames:string[], skillsById:Map<string,{slot:string}>}
 *                fetched by the service so this stays pure.
 */
export function validateSpecies(input, { classNames, skillsById }) {
  const s = {
    id: str(input.id, "species id", { pattern: /^sp_[a-z0-9_]+$/ }),
    name: str(input.name, "species name"),
    cls: oneOf(input.cls, classNames, "class"),
    emoji: str(input.emoji, "emoji", { max: 8 }),
    sprite: input.sprite ? str(input.sprite, "sprite id", { pattern: /^[a-z0-9_-]+$/i }) : null,
    starter: input.starter === true,
    element: oneOf(input.element, ELEMENTS, "element"),
    attackKind: oneOf(input.attackKind, ATTACK_KINDS, "attack kind"),
    attackStyle: oneOf(input.attackStyle, ATTACK_STYLES, "attack style"),
    targeting: oneOf(input.targeting, TARGET_RULES, "targeting"),
    base: {
      hp: int(input.base?.hp, "base HP", { min: 1, max: 9999 }),
      atk: int(input.base?.atk, "base ATK", { min: 1, max: 999 }),
      spd: int(input.base?.spd, "base SPD", { min: 1, max: 99 }),
    },
    attrs: Object.fromEntries(
      ATTRS.map((a) => [a, int(input.attrs?.[a], `attr ${a.toUpperCase()}`, { min: 0, max: 99 })])
    ),
    runeSlots: int(input.runeSlots ?? 1, "rune slots", { min: 0, max: 5 }),
    skills: [],
  };

  const raw = input.skills;
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw bad("skills must be an array of 4 slots (passive, passive, normal, ultimate; null = empty)");
  }
  s.skills = raw.map((id, slot) => {
    if (id === null || id === "" || id === undefined) return null;
    if (typeof id !== "string" || !skillsById.has(id)) throw bad(`slot ${slot}: unknown skill "${id}"`);
    const want = LOADOUT_SLOT_TYPES[slot];
    const got = skillsById.get(id).slot;
    if (got !== want) throw bad(`slot ${slot} takes a ${want} skill, but "${id}" is a ${got}`);
    return id;
  });
  return s;
}

// --- jobs ----------------------------------------------------------------------

/** @returns {{id:string, kind:string, name:string, durationS:number, rewards:object}} */
export function validateJob(input) {
  const job = {
    id: str(input.id, "job id", { pattern: /^[a-z0-9_]+$/ }),
    kind: oneOf(input.kind, JOB_KINDS, "kind"),
    name: str(input.name, "job name"),
    durationS: int(input.durationS, "duration (seconds)", { min: 10, max: 7 * 24 * 3600 }),
  };
  const r = input.rewards;
  if (typeof r !== "object" || r === null) throw bad("rewards is required");
  if (job.kind === "work") {
    onlyKeys(r, ["gold", "trainerExp"], "rewards");
    job.rewards = {
      gold: int(r.gold, "rewards.gold", { min: 0 }),
      trainerExp: int(r.trainerExp, "rewards.trainerExp", { min: 0 }),
    };
    if (job.rewards.gold === 0 && job.rewards.trainerExp === 0) throw bad("a work job must pay something");
  } else {
    onlyKeys(r, ["attr", "gain"], "rewards");
    job.rewards = {
      attr: oneOf(r.attr, ATTRS, "rewards.attr"),
      gain: int(r.gain, "rewards.gain", { min: 1, max: 10 }),
    };
  }
  return job;
}

// --- items / equipment / runes (Phase 7.1) --------------------------------------

/** Optional free-text description: trimmed, max length, null when absent. */
function optStr(v, label, { max = 200 } = {}) {
  if (v === undefined || v === null || v === "") return null;
  return str(v, label, { max });
}

/** @returns {{id:string, kind:string, name:string, description:(string|null)}} */
export function validateItem(input) {
  return {
    id: str(input.id, "item id", { pattern: /^it_[a-z0-9_]+$/ }),
    kind: oneOf(input.kind, ITEM_KINDS, "kind"),
    name: str(input.name, "item name"),
    description: optStr(input.description, "description"),
  };
}

/**
 * @returns {{id:string, domain:string, slot:string, name:string,
 *   description:(string|null), effects:object[], enhance:(object|null)}}
 */
export function validateEquipment(input) {
  const domain = oneOf(input.domain, EQUIP_DOMAINS, "domain");
  const slot = oneOf(input.slot, EQUIP_SLOTS[domain], "slot");
  const eq = {
    id: str(input.id, "equipment id", { pattern: /^eq_[a-z0-9_]+$/ }),
    domain,
    slot,
    name: str(input.name, "equipment name"),
    description: optStr(input.description, "description"),
    effects: validateBattleStartEffects(input.effects, "effects", true),
    enhance: null,
  };
  if (input.enhance !== undefined && input.enhance !== null) {
    onlyKeys(input.enhance, ["maxLevel", "goldPerLevel"], "enhance");
    eq.enhance = {
      maxLevel: int(input.enhance.maxLevel, "enhance.maxLevel", { min: 1, max: 20 }),
      goldPerLevel: int(input.enhance.goldPerLevel, "enhance.goldPerLevel", { min: 1, max: 1_000_000 }),
    };
  }
  return eq;
}

/**
 * @returns {{id:string, name:string, description:(string|null), effects:object[],
 *   maxCharges:number, repairGold:number}}
 */
export function validateRune(input) {
  return {
    id: str(input.id, "rune id", { pattern: /^rn_[a-z0-9_]+$/ }),
    name: str(input.name, "rune name"),
    description: optStr(input.description, "description"),
    effects: validateBattleStartEffects(input.effects, "effects", true),
    maxCharges: int(input.maxCharges, "max charges", { min: 1, max: 100 }),
    repairGold: int(input.repairGold, "repair gold", { min: 0, max: 1_000_000 }),
  };
}

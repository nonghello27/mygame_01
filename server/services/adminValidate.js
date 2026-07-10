// Pure validation for admin master-data writes (Phase 5). No DB, no I/O —
// callers fetch whatever context a check needs (existing classes/skills) and
// pass it in, so every rule here is unit-testable like the engine.
//
// The enums are re-exported for /api/admin/master: the admin UI builds its
// dropdowns from THESE lists, so the form options can never drift from what
// the engine (shared/rules) actually interprets.

import { ELEMENTS } from "../../shared/rules/elements.js";
import { RANKS } from "../../shared/rules/ranks.js";
import { TARGETING } from "../../shared/rules/targeting.js";
import { STATUSES } from "../../shared/rules/statuses.js";
import { EVENT_REWARD_TYPES, validatePercentileCoverage } from "../../shared/rules/rewards.js";
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
// Phase 7.4 step A — Summon Hall cost-requirement kinds. A later phase's
// "quest" requirement is one more entry here AND one more entry in
// server/services/summon.js's REQUIREMENT_CHECKERS registry — never a
// branch in either validateSummon or performSummon.
export const SUMMON_COST_TYPES = ["gold", "item"];
// Phase 7.4 step B — Adventure node kinds a map step's option can be. A
// later node kind (e.g. a shop, an event) is one more entry here AND one
// more resolver entry in the step-B session service — never a branch in
// validateAdventure or generateMap.
export const ADVENTURE_NODE_TYPES = ["battle", "chest", "gather"];
// Phase 9.1 — the closed reward-type list tournaments (9.2) and GVG events
// (9.5) both validate against; re-exported here (rather than re-declared)
// so the admin UI's dropdown and the engine's actual grammar can never
// drift — same "one source of truth" reasoning as the enums above.
export { EVENT_REWARD_TYPES };

/** Everything the admin UI needs to render its dropdowns. */
export function enums() {
  return {
    elements: ELEMENTS,
    ranks: RANKS,
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
    summonCostTypes: SUMMON_COST_TYPES,
    adventureNodeTypes: ADVENTURE_NODE_TYPES,
    eventRewardTypes: EVENT_REWARD_TYPES,
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

/** @returns {{cls:string, attackName:string, fx:string, icon:string|null}} */
export function validateClass(input) {
  return {
    cls: str(input.cls, "class name", { pattern: /^[A-Za-z][A-Za-z0-9 ]*$/ }),
    attackName: str(input.attackName, "attack name"),
    fx: str(input.fx, "fx id", { pattern: /^[a-z][a-z0-9_]*$/ }),
    // optional: a base filename under public/icons/classes/, no extension.
    // Absent/empty falls back to the class name lowercased (classIconEl()).
    icon: input.icon ? str(input.icon, "icon id", { pattern: /^[a-z][a-z0-9_-]*$/ }) : null,
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
 * One battle_start/perm_stat entry (the historical shape). Extracted from
 * validateBattleStartEffects so validateRuneEffects (below) can reuse the
 * exact same per-entry logic instead of duplicating it, WITHOUT changing
 * behavior for skills/equipment — validateBattleStartEffects still maps this
 * over its list one-for-one.
 */
function validateBattleStartEffect(fx, label, allowPerLevel) {
  if (fx?.when !== "battle_start") throw bad(`${label}.when must be "battle_start"`);
  if (fx?.op !== "perm_stat") throw bad(`${label}.op must be "perm_stat"`);
  const o = { when: "battle_start", op: "perm_stat", stat: oneOf(fx.stat, PERM_STATS, `${label}.stat`) };
  if (fx.pct === undefined && fx.flat === undefined) throw bad(`${label} needs pct or flat`);
  if (fx.pct !== undefined) o.pct = int(fx.pct, `${label}.pct`, { min: -100, max: 100 });
  if (fx.flat !== undefined) o.flat = int(fx.flat, `${label}.flat`, { min: -1000, max: 1000 });
  if (fx.perLevel !== undefined) {
    if (!allowPerLevel) throw bad(`${label}.perLevel is not allowed here`);
    o.perLevel = int(fx.perLevel, `${label}.perLevel`, { min: 0, max: 100 });
  }
  return o;
}

/**
 * Shared grammar for a battle_start/perm_stat effects list — used by skill
 * passives and equipment effects alike (all interpreted by the SAME engine
 * op, shared/engine/resolve.js applyEffect()). Skills keep their historical
 * shape (no perLevel); equipment may add perLevel so 7.2's enhancement
 * system has something to scale — pass allowPerLevel=true for that caller.
 * Runes use validateRuneEffects (below) instead — they get one extra trigger
 * shape equipment/skills must NOT accept.
 * @returns {object[]}
 */
export function validateBattleStartEffects(list, label, allowPerLevel = true) {
  if (!Array.isArray(list) || list.length === 0) throw bad(`${label} must be a non-empty array`);
  return list.map((fx, i) => validateBattleStartEffect(fx, `${label}[${i}]`, allowPerLevel));
}

/**
 * Rune effects grammar (Phase 7.3 step C): each entry is EITHER the historical
 * battle_start/perm_stat shape (perLevel allowed, identical to equipment) OR
 * the new rune-only trigger `{ when: "target_select", op: "override_targeting",
 * rule }` — a rune can steer which enemy a turn targets (GAME_DESIGN §7:
 * targeting "modified by runes"); `rule` must be one of the same TARGETING
 * names species/skill targeting uses, so it can never name a rule the engine
 * doesn't have. The two shapes are distinguished by `when` and are mutually
 * exclusive per entry — mixing keys from both (or any extra key on the
 * override shape) is rejected by `onlyKeys`. Equipment/skills call
 * validateBattleStartEffects instead and never see this shape.
 * @returns {object[]}
 */
export function validateRuneEffects(list, label) {
  if (!Array.isArray(list) || list.length === 0) throw bad(`${label} must be a non-empty array`);
  return list.map((fx, i) => {
    const l = `${label}[${i}]`;
    if (fx?.when === "target_select") {
      onlyKeys(fx ?? {}, ["when", "op", "rule"], l);
      if (fx.op !== "override_targeting") throw bad(`${l}.op must be "override_targeting"`);
      return { when: "target_select", op: "override_targeting", rule: oneOf(fx.rule, TARGET_RULES, `${l}.rule`) };
    }
    return validateBattleStartEffect(fx, l, true);
  });
}

/** @returns {{id:string, name:string, slot:string, cooldown:number, data:object, icon:?string, animation:?string}} */
export function validateSkill(input) {
  const skill = {
    id: str(input.id, "skill id", { pattern: /^sk_[a-z0-9_]+$/ }),
    name: str(input.name, "skill name"),
    slot: oneOf(input.slot, SKILL_SLOTS, "slot"),
    cooldown: int(input.cooldown ?? 0, "cooldown", { min: 0, max: 20 }),
    data: validateSkillData(input.data),
    // optional: a base filename under public/icons/skills/, no extension.
    // Absent/empty falls back to the skill's slot placeholder, then default.png.
    icon: input.icon ? str(input.icon, "icon id", { pattern: /^[a-z][a-z0-9_-]*$/ }) : null,
    // optional: a full filename (extension included) under public/anim/skills/.
    // Absent/empty means no animation yet — see that folder's README.
    animation: input.animation
      ? str(input.animation, "animation filename", { pattern: /^[a-z0-9][a-z0-9_-]*\.(svg|png)$/ })
      : null,
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
    rank: oneOf(input.rank ?? "D", RANKS, "rank"),
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

/** @returns {{id:string, kind:string, name:string, description:(string|null),
 *   sellGold:number}} */
export function validateItem(input) {
  return {
    id: str(input.id, "item id", { pattern: /^it_[a-z0-9_]+$/ }),
    kind: oneOf(input.kind, ITEM_KINDS, "kind"),
    name: str(input.name, "item name"),
    description: optStr(input.description, "description"),
    // Phase 8 — per-unit instant sell-to-system price; 0 (the default when
    // absent) means "not sellable to the system", the marketplace-only floor.
    sellGold: int(input.sellGold ?? 0, "sell gold", { min: 0, max: 1_000_000 }),
  };
}

/**
 * @returns {{id:string, domain:string, slot:string, name:string,
 *   description:(string|null), effects:object[], enhance:(object|null),
 *   sellGold:number}}
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
    // Phase 8 — per-unit instant sell-to-system price; 0 (the default when
    // absent) means "not sellable to the system", the marketplace-only floor.
    sellGold: int(input.sellGold ?? 0, "sell gold", { min: 0, max: 1_000_000 }),
  };
  if (input.enhance !== undefined && input.enhance !== null) {
    onlyKeys(input.enhance, ["maxLevel", "goldPerLevel", "material"], "enhance");
    eq.enhance = {
      maxLevel: int(input.enhance.maxLevel, "enhance.maxLevel", { min: 1, max: 20 }),
      goldPerLevel: int(input.enhance.goldPerLevel, "enhance.goldPerLevel", { min: 1, max: 1_000_000 }),
    };
    // Optional material cost (Phase 7.2, step B): a flat qty of one item_defs
    // stack spent per enhance step, alongside gold. This validator is pure
    // (no DB) and so does NOT check that itemId actually exists in
    // item_defs — there's no context to check it against. A nonexistent
    // itemId isn't a security hole: at enhance time the guarded claim query
    // just never finds a matching stack, so it 409s exactly like "not enough
    // material" would. A bad admin-entered id is a content bug, not a break.
    if (input.enhance.material !== undefined && input.enhance.material !== null) {
      onlyKeys(input.enhance.material, ["itemId", "qtyPerLevel"], "enhance.material");
      eq.enhance.material = {
        itemId: str(input.enhance.material.itemId, "enhance.material.itemId", { pattern: /^it_[a-z0-9_]+$/ }),
        qtyPerLevel: int(input.enhance.material.qtyPerLevel, "enhance.material.qtyPerLevel", { min: 1, max: 100 }),
      };
    }
  }
  return eq;
}

/**
 * @returns {{id:string, name:string, description:(string|null), effects:object[],
 *   maxCharges:number, repairGold:number, sellGold:number}}
 */
export function validateRune(input) {
  return {
    id: str(input.id, "rune id", { pattern: /^rn_[a-z0-9_]+$/ }),
    name: str(input.name, "rune name"),
    description: optStr(input.description, "description"),
    effects: validateRuneEffects(input.effects, "effects"),
    maxCharges: int(input.maxCharges, "max charges", { min: 1, max: 100 }),
    repairGold: int(input.repairGold, "repair gold", { min: 0, max: 1_000_000 }),
    // Phase 8 — per-unit instant sell-to-system price; 0 (the default when
    // absent) means "not sellable to the system", the marketplace-only floor.
    sellGold: int(input.sellGold ?? 0, "sell gold", { min: 0, max: 1_000_000 }),
  };
}

// --- summon hall (Phase 7.4 step A) -----------------------------------------

/**
 * A summon banner's `cost` grammar: a non-empty list of requirement objects,
 * each `{type:"gold", amount}` or `{type:"item", itemId, qty}`. At most one
 * gold entry, no duplicate itemIds. An unknown `type` is a 400 — this is the
 * pluggable-requirement interface a later phase's "quest" type extends by
 * adding one more entry to SUMMON_COST_TYPES + one more branch here + one
 * more server/services/summon.js REQUIREMENT_CHECKERS entry, never a change
 * to how performSummon() itself pays/refunds.
 */
function validateSummonCost(list) {
  if (!Array.isArray(list) || list.length === 0) throw bad("cost must be a non-empty array");
  let goldSeen = false;
  const itemIds = new Set();
  return list.map((c, i) => {
    const label = `cost[${i}]`;
    const type = oneOf(c?.type, SUMMON_COST_TYPES, `${label}.type`);
    if (type === "gold") {
      if (goldSeen) throw bad("cost may only include one gold entry");
      goldSeen = true;
      onlyKeys(c, ["type", "amount"], label);
      return { type: "gold", amount: int(c.amount, `${label}.amount`, { min: 1, max: 1_000_000 }) };
    }
    // type === "item"
    onlyKeys(c, ["type", "itemId", "qty"], label);
    const itemId = str(c.itemId, `${label}.itemId`, { pattern: /^it_[a-z0-9_]+$/ });
    if (itemIds.has(itemId)) throw bad(`cost: duplicate itemId "${itemId}"`);
    itemIds.add(itemId);
    return { type: "item", itemId, qty: int(c.qty, `${label}.qty`, { min: 1, max: 1000 }) };
  });
}

/**
 * A summon banner's `pool` grammar: a non-empty list of
 * {speciesId, weight >= 1}, no duplicate speciesIds, capped at 50 entries
 * (shared/rules/summon.js rollSummon() walks this list once per pull).
 */
function validateSummonPool(list) {
  if (!Array.isArray(list) || list.length === 0) throw bad("pool must be a non-empty array");
  if (list.length > 50) throw bad("pool may have at most 50 entries");
  const seen = new Set();
  return list.map((p, i) => {
    const label = `pool[${i}]`;
    onlyKeys(p ?? {}, ["speciesId", "weight"], label);
    const speciesId = str(p?.speciesId, `${label}.speciesId`, { pattern: /^sp_[a-z0-9_]+$/ });
    if (seen.has(speciesId)) throw bad(`pool: duplicate speciesId "${speciesId}"`);
    seen.add(speciesId);
    return { speciesId, weight: int(p?.weight, `${label}.weight`, { min: 1, max: 1_000_000 }) };
  });
}

/**
 * @returns {{id:string, name:string, description:string, cost:object[],
 *   pool:object[], enabled:boolean}}
 */
export function validateSummon(input) {
  let enabled = true;
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw bad("enabled must be a boolean");
    enabled = input.enabled;
  }
  return {
    id: str(input.id, "summon id", { pattern: /^sm_[a-z0-9_]+$/ }),
    name: str(input.name, "summon name"),
    description: input.description === undefined || input.description === null || input.description === ""
      ? "" : str(input.description, "description", { max: 500 }),
    cost: validateSummonCost(input.cost),
    pool: validateSummonPool(input.pool),
    enabled,
  };
}

// --- adventures (Phase 7.4 step B) ------------------------------------------

/**
 * `nodes`: a non-empty list of {type, weight>=1}, type one of
 * ADVENTURE_NODE_TYPES, no duplicate types — the weighted table
 * generateMap() draws each non-final-step option's type from.
 */
function validateAdventureNodes(list) {
  if (!Array.isArray(list) || list.length === 0) throw bad("nodes must be a non-empty array");
  const seen = new Set();
  return list.map((n, i) => {
    const label = `nodes[${i}]`;
    onlyKeys(n ?? {}, ["type", "weight"], label);
    const type = oneOf(n?.type, ADVENTURE_NODE_TYPES, `${label}.type`);
    if (seen.has(type)) throw bad(`nodes: duplicate type "${type}"`);
    seen.add(type);
    return { type, weight: int(n?.weight, `${label}.weight`, { min: 1, max: 1_000_000 }) };
  });
}

/**
 * `encounters`: a non-empty list (max 50) of {speciesId, weight>=1}, no
 * duplicate speciesIds — the wild pool a "battle" node's enemy team is drawn
 * from.
 */
function validateAdventureEncounters(list) {
  if (!Array.isArray(list) || list.length === 0) throw bad("encounters must be a non-empty array");
  if (list.length > 50) throw bad("encounters may have at most 50 entries");
  const seen = new Set();
  return list.map((e, i) => {
    const label = `encounters[${i}]`;
    onlyKeys(e ?? {}, ["speciesId", "weight"], label);
    const speciesId = str(e?.speciesId, `${label}.speciesId`, { pattern: /^sp_[a-z0-9_]+$/ });
    if (seen.has(speciesId)) throw bad(`encounters: duplicate speciesId "${speciesId}"`);
    seen.add(speciesId);
    return { speciesId, weight: int(e?.weight, `${label}.weight`, { min: 1, max: 1_000_000 }) };
  });
}

/**
 * `loot`/`gather`: a non-empty list (max 50) of
 * {itemId, weight>=1, qtyMin>=1, qtyMax>=qtyMin (both <=100)}, no duplicate
 * itemIds — what a chest drops, or a gather node yields.
 */
function validateAdventureLootTable(list, label) {
  if (!Array.isArray(list) || list.length === 0) throw bad(`${label} must be a non-empty array`);
  if (list.length > 50) throw bad(`${label} may have at most 50 entries`);
  const seen = new Set();
  return list.map((row, i) => {
    const l = `${label}[${i}]`;
    onlyKeys(row ?? {}, ["itemId", "weight", "qtyMin", "qtyMax"], l);
    const itemId = str(row?.itemId, `${l}.itemId`, { pattern: /^it_[a-z0-9_]+$/ });
    if (seen.has(itemId)) throw bad(`${label}: duplicate itemId "${itemId}"`);
    seen.add(itemId);
    const weight = int(row?.weight, `${l}.weight`, { min: 1, max: 1_000_000 });
    const qtyMin = int(row?.qtyMin, `${l}.qtyMin`, { min: 1, max: 100 });
    const qtyMax = int(row?.qtyMax, `${l}.qtyMax`, { min: qtyMin, max: 100 });
    return { itemId, weight, qtyMin, qtyMax };
  });
}

/**
 * An adventure route's `config` grammar — see src/data/adventures.js's
 * header for the authoritative description, kept in sync with this
 * validator. Pure grammar only (no DB); the referential checks (every
 * encounters speciesId/loot/gather itemId must be a real row) happen in
 * server/services/admin.js's saveAdventure, same split as validateSummon /
 * saveSummon.
 */
function validateAdventureConfig(config) {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw bad("config must be a JSON object");
  }
  onlyKeys(config, ["steps", "choices", "nodes", "encounters", "loot", "gather", "catchPct"], "config");
  return {
    steps: int(config.steps, "config.steps", { min: 3, max: 10 }),
    choices: int(config.choices, "config.choices", { min: 2, max: 3 }),
    nodes: validateAdventureNodes(config.nodes),
    encounters: validateAdventureEncounters(config.encounters),
    loot: validateAdventureLootTable(config.loot, "config.loot"),
    gather: validateAdventureLootTable(config.gather, "config.gather"),
    catchPct: int(config.catchPct, "config.catchPct", { min: 0, max: 100 }),
  };
}

/**
 * @returns {{id:string, name:string, description:string, config:object,
 *   enabled:boolean}}
 */
export function validateAdventure(input) {
  let enabled = true;
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw bad("enabled must be a boolean");
    enabled = input.enabled;
  }
  return {
    id: str(input.id, "adventure id", { pattern: /^ad_[a-z0-9_]+$/ }),
    name: str(input.name, "adventure name"),
    description: input.description === undefined || input.description === null || input.description === ""
      ? "" : str(input.description, "description", { max: 500 }),
    config: validateAdventureConfig(input.config),
    enabled,
  };
}

// --- events: shared schedule + reward grammar (Phase 9.1) -------------------
//
// Written once here, shared VERBATIM by tournaments (9.2) and GVG events
// (9.5) — neither sub-phase should re-derive registration-window or reward
// validation, only supply the id-lookup sets validateEventRewards needs.

/**
 * A registration window: `regStartsAt < regEndsAt`, and BOTH must be in the
 * future at creation time (an event can't be scheduled to have already
 * started or already closed registration). Accepts ISO date strings (or
 * anything `new Date()` parses); returns the normalized pair as ISO
 * strings so the caller can persist them as-is.
 * @param {{regStartsAt:string, regEndsAt:string}} input
 * @returns {{regStartsAt:string, regEndsAt:string}}
 */
export function validateEventSchedule(input) {
  const regStartsAt = parseFutureDate(input?.regStartsAt, "regStartsAt");
  const regEndsAt = parseFutureDate(input?.regEndsAt, "regEndsAt");
  if (regStartsAt.getTime() >= regEndsAt.getTime()) throw bad("regStartsAt must be before regEndsAt");
  return { regStartsAt: regStartsAt.toISOString(), regEndsAt: regEndsAt.toISOString() };
}

function parseFutureDate(v, label) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${label} must be a valid date`);
  if (d.getTime() <= Date.now()) throw bad(`${label} must be in the future`);
  return d;
}

/**
 * One reward entry — `{type, ...}`, `type` one of EVENT_REWARD_TYPES
 * (shared/rules/rewards.js). Every referenced itemId/equipmentDefId/
 * runeDefId/speciesId must name a real master row — `lookups` carries
 * those id sets from the service layer, same split as validateSpecies's
 * `{classNames, skillsById}` / validateSummon's pool check: this validator
 * stays pure (no DB), the CALLER fetches what a check needs.
 * @param {object} r
 * @param {string} label
 * @param {{itemIds:Set<string>, equipmentDefIds:Set<string>,
 *   runeDefIds:Set<string>, speciesIds:Set<string>}} lookups
 */
function validateReward(r, label, lookups) {
  if (typeof r !== "object" || r === null || Array.isArray(r)) throw bad(`${label} must be an object`);
  const type = oneOf(r.type, EVENT_REWARD_TYPES, `${label}.type`);

  if (type === "gold") {
    onlyKeys(r, ["type", "amount"], label);
    return { type: "gold", amount: int(r.amount, `${label}.amount`, { min: 1, max: 1_000_000 }) };
  }
  if (type === "item") {
    onlyKeys(r, ["type", "itemId", "qty"], label);
    const itemId = str(r.itemId, `${label}.itemId`, { pattern: /^it_[a-z0-9_]+$/ });
    if (!lookups.itemIds.has(itemId)) throw bad(`${label}.itemId "${itemId}" is not a known item`);
    return { type: "item", itemId, qty: int(r.qty, `${label}.qty`, { min: 1, max: 1000 }) };
  }
  if (type === "equipment") {
    onlyKeys(r, ["type", "equipmentDefId"], label);
    const equipmentDefId = str(r.equipmentDefId, `${label}.equipmentDefId`, { pattern: /^eq_[a-z0-9_]+$/ });
    if (!lookups.equipmentDefIds.has(equipmentDefId)) {
      throw bad(`${label}.equipmentDefId "${equipmentDefId}" is not a known equipment def`);
    }
    return { type: "equipment", equipmentDefId };
  }
  if (type === "rune") {
    onlyKeys(r, ["type", "runeDefId"], label);
    const runeDefId = str(r.runeDefId, `${label}.runeDefId`, { pattern: /^rn_[a-z0-9_]+$/ });
    if (!lookups.runeDefIds.has(runeDefId)) throw bad(`${label}.runeDefId "${runeDefId}" is not a known rune def`);
    return { type: "rune", runeDefId };
  }
  // type === "monster"
  onlyKeys(r, ["type", "speciesId"], label);
  const speciesId = str(r.speciesId, `${label}.speciesId`, { pattern: /^sp_[a-z0-9_]+$/ });
  if (!lookups.speciesIds.has(speciesId)) throw bad(`${label}.speciesId "${speciesId}" is not a known species`);
  return { type: "monster", speciesId };
}

/** A non-empty list of validated rewards (one position tier, or one percentile tier). */
function validateRewardList(list, label, lookups) {
  if (!Array.isArray(list) || list.length === 0) throw bad(`${label} must be a non-empty array`);
  return list.map((r, i) => validateReward(r, `${label}[${i}]`, lookups));
}

/** `positionRewards`: an object keyed "1"/"2"/"3", every key optional. */
function validatePositionRewards(input, lookups) {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw bad("positionRewards must be an object keyed 1/2/3");
  onlyKeys(input, ["1", "2", "3"], "positionRewards");
  const out = {};
  for (const key of ["1", "2", "3"]) {
    if (input[key] === undefined) continue;
    out[key] = validateRewardList(input[key], `positionRewards[${key}]`, lookups);
  }
  return out;
}

/**
 * `percentileRewards`: a non-empty ordered tier list, each tier's `rewards`
 * validated like any other reward list. The tier-COVERAGE math (contiguous,
 * 1-100, no gap/overlap) is NOT re-derived here — it's delegated to
 * shared/rules/rewards.js's validatePercentileCoverage(), the one source of
 * truth 9.3's payout math also reads (CLAUDE.md §1.3/1.4).
 */
function validatePercentileRewards(input, lookups) {
  if (!Array.isArray(input) || input.length === 0) throw bad("percentileRewards must be a non-empty array");
  const tiers = input.map((tier, i) => {
    const label = `percentileRewards[${i}]`;
    if (typeof tier !== "object" || tier === null || Array.isArray(tier)) throw bad(`${label} must be an object`);
    onlyKeys(tier, ["fromPct", "toPct", "rewards"], label);
    return {
      fromPct: int(tier.fromPct, `${label}.fromPct`, { min: 1, max: 100 }),
      toPct: int(tier.toPct, `${label}.toPct`, { min: 1, max: 100 }),
      rewards: validateRewardList(tier.rewards, `${label}.rewards`, lookups),
    };
  });
  try {
    validatePercentileCoverage(tiers);
  } catch (e) {
    throw bad(e.message);
  }
  return tiers;
}

/**
 * An event's full rewards config: `{positionRewards, percentileRewards}` —
 * see shared/rules/rewards.js's header for the grammar and the percentile
 * formula 9.3's payout reads off it verbatim.
 * @param {{positionRewards?:object, percentileRewards:object[]}} input
 * @param {{itemIds:Set<string>, equipmentDefIds:Set<string>,
 *   runeDefIds:Set<string>, speciesIds:Set<string>}} lookups
 * @returns {{positionRewards:object, percentileRewards:object[]}}
 */
export function validateEventRewards(input, lookups) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw bad("rewards config must be a JSON object");
  }
  onlyKeys(input, ["positionRewards", "percentileRewards"], "rewards");
  return {
    positionRewards: validatePositionRewards(input.positionRewards, lookups),
    percentileRewards: validatePercentileRewards(input.percentileRewards, lookups),
  };
}

// --- tournaments (Phase 9.2) -------------------------------------------------
//
// A tournament's create-grammar composes the two 9.1 validators above
// (schedule + rewards) with its own few fields (name/description/entryFee) —
// written once here rather than in server/services/tournament.js so a later
// GVG event (9.5) can reuse this exact composition style, same "share the
// validator, not just the pieces" precedent as validateSummon/
// validateAdventure each composing their own grammar inline.

/**
 * @param {object} input raw body: {name, description?, entryFee?,
 *   regStartsAt, regEndsAt, rewards}
 * @param {{itemIds:Set<string>, equipmentDefIds:Set<string>,
 *   runeDefIds:Set<string>, speciesIds:Set<string>}} lookups fetched by the
 *   service (fresh DB state), same split as validateEventRewards's own
 *   `lookups` param — this validator stays pure (no DB).
 * @returns {{name:string, description:string, entryFee:number,
 *   regStartsAt:string, regEndsAt:string, rewards:object}}
 */
export function validateTournament(input, lookups) {
  const schedule = validateEventSchedule(input);
  const rewards = validateEventRewards(input?.rewards, lookups);
  return {
    name: str(input?.name, "tournament name", { max: 120 }),
    description: input?.description === undefined || input?.description === null || input?.description === ""
      ? "" : str(input.description, "description", { max: 500 }),
    entryFee: int(input?.entryFee ?? 0, "entry fee", { min: 0, max: 1_000_000 }),
    regStartsAt: schedule.regStartsAt,
    regEndsAt: schedule.regEndsAt,
    rewards,
  };
}

// --- GVG events (Phase 9.5) --------------------------------------------------
//
// The tournament event lifecycle, re-instantiated at guild level: same
// schedule + rewards grammar (validateEventSchedule/validateEventRewards,
// composed exactly like validateTournament above), plus two GVG-only knobs —
// minTeams/maxTeams, how many ordered teams a guild's lineup may field — and
// NO entryFee (GVG events have none by design).

/**
 * @param {object} input raw body: {name, description?, minTeams?, maxTeams?,
 *   regStartsAt, regEndsAt, rewards}
 * @param {{itemIds:Set<string>, equipmentDefIds:Set<string>,
 *   runeDefIds:Set<string>, speciesIds:Set<string>}} lookups fetched by the
 *   service (fresh DB state), same split as validateTournament's own param.
 * @returns {{name:string, description:string, minTeams:number, maxTeams:number,
 *   regStartsAt:string, regEndsAt:string, rewards:object}}
 */
export function validateGvgEvent(input, lookups) {
  const schedule = validateEventSchedule(input);
  const rewards = validateEventRewards(input?.rewards, lookups);
  const minTeams = int(input?.minTeams ?? 1, "minTeams", { min: 1, max: 10 });
  const maxTeams = int(input?.maxTeams ?? 10, "maxTeams", { min: 1, max: 10 });
  if (minTeams > maxTeams) throw bad("minTeams must be at most maxTeams");
  return {
    name: str(input?.name, "GVG event name", { max: 120 }),
    description: input?.description === undefined || input?.description === null || input?.description === ""
      ? "" : str(input.description, "description", { max: 500 }),
    minTeams,
    maxTeams,
    regStartsAt: schedule.regStartsAt,
    regEndsAt: schedule.regEndsAt,
    rewards,
  };
}

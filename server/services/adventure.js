// Adventure use-cases (Phase 7.4 step B, session engine). The client
// contributes exactly two choices across this whole domain: which route +
// which 3 monsters (start), and which option at the current step (move) —
// everything else (the map, every roll, loot, the enemy team, the catch) is
// decided/rolled HERE from server state, never trusted from the request body
// (CLAUDE.md §1.1).
//
// Lazy time (CLAUDE.md §1.5): every read/write starts by expiring stale
// sessions, same precedent as settleActivities/ensureSeason — no cron ever
// touches an adventure_sessions row.
//
// Node resolution is dispatched through NODE_RESOLVERS, keyed by
// ADVENTURE_NODE_TYPES ("battle"|"chest"|"gather") — a later node kind is one
// new registry entry, never a branch in move() (CLAUDE.md §1.4, same
// closed-op-set philosophy as summon.js's REQUIREMENT_CHECKERS).

import { httpError } from "../http.js";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { makeRng } from "../../shared/engine/rng.js";
import { generateMap, deriveNodeSeed, rollLoot, rollEncounter } from "../../shared/rules/adventure.js";
import {
  listEnabledAdventureDefs, getAdventureDef, getActiveSession, insertSession,
  claimAdvance, settleSession, claimAbandon, expireStaleSessions,
  claimPartyForAdventure, releaseParty,
} from "../repos/adventures.js";
import { listMonstersByTrainer, mintMonster } from "../repos/monsters.js";
import { getSpeciesById } from "../repos/species.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes, applyRuneWear } from "../repos/runes.js";
import { grantItem } from "../repos/inventory.js";
import { settleActivities } from "./activities.js";
import { toLane, groupByMonster } from "./matches.js";

// ends_at AND the party's busy claim share this exact duration — lock and
// timer can never drift, same principle as activities' claimMonsterForJob/
// insertActivity pairing.
export const SESSION_HOURS = 24;
export const PARTY_SIZE = 3;

/** Everything the Adventure panel needs: the enabled route list (public
 *  fields only — `config` is server balance data, never shipped to the
 *  client) and the trainer's current session, if any. */
export async function getState(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const [defs, session] = await Promise.all([
    listEnabledAdventureDefs(sql),
    getActiveSession(sql, trainerId),
  ]);
  return {
    adventures: defs.map((d) => ({ id: d.id, name: d.name, description: d.description })),
    session: session ? toSessionView(session) : null,
  };
}

/**
 * Start a run: lock the party, generate the map from a freshly minted seed,
 * and freeze both into a new session row. Any failure from the busy claim
 * onward must release the party first (compensating, same spirit as
 * summon.js's performSummon unmint/refund) — the try below wraps exactly
 * that span.
 * @param {{adventureId:string, monsterIds:number[]}} body the ONLY things
 *   the client contributes.
 */
export async function start(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  if (await getActiveSession(sql, trainerId)) throw httpError(409, "already on an adventure");

  const adventureId = body?.adventureId;
  if (typeof adventureId !== "string" || !adventureId) throw httpError(400, "adventureId is required");
  const def = await getAdventureDef(sql, adventureId);
  // 404 for both "no such route" and "disabled" — a retired route must not
  // leak that it ever existed, same precedent as the Summon Hall's banners.
  if (!def || !def.enabled) throw httpError(404, "unknown adventure");

  const monsterIds = body?.monsterIds;
  if (!Array.isArray(monsterIds) || monsterIds.length !== PARTY_SIZE) {
    throw httpError(400, `monsterIds must be exactly ${PARTY_SIZE} monster ids`);
  }
  const ids = monsterIds.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw httpError(400, "monsterIds must be integer monster ids");
  }
  if (new Set(ids).size !== ids.length) {
    throw httpError(400, `monsterIds must be ${PARTY_SIZE} distinct monsters`);
  }

  // Free anything that finished first (same precedent as createMatch), so a
  // monster that has actually come home isn't blocked by a stale busy_until.
  await settleActivities(sql, trainerId);

  const claimed = await claimPartyForAdventure(sql, trainerId, ids, SESSION_HOURS * 3600);
  if (claimed.length !== ids.length) {
    if (claimed.length > 0) await releaseParty(sql, trainerId, claimed);
    throw httpError(409, "a monster is busy or not yours");
  }

  try {
    // The frozen party snapshot: the trainer's own monsters, in the exact
    // order the player chose (their lane order IS their choice for the whole
    // run), joined with equipped monster-domain gear and socketed runes —
    // same toLane() shape server/services/matches.js createMatch freezes for
    // a free match's player side.
    const roster = await listMonstersByTrainer(sql, trainerId);
    const byId = new Map(roster.map((m) => [m.id, m]));
    const chosen = ids.map((id) => byId.get(id));
    if (chosen.some((m) => !m)) throw httpError(404, "monster not found");

    const equipByMonster = groupByMonster(await listEquippedMonsterEquipment(sql, trainerId));
    const runesByMonster = groupByMonster(await listSocketedRunes(sql, trainerId));
    const lanes = chosen.map((m, i) =>
      toLane(m, i, equipByMonster.get(m.id) ?? [], runesByMonster.get(m.id) ?? [])
    );
    const display = chosen.map((m) => ({ monsterId: m.id, name: m.name, emoji: m.emoji }));

    // Determinism (CLAUDE.md §1.6): a STORED seed, same minting precedent as
    // match creation and Summon Hall pulls.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const map = generateMap(def.config, seed);

    const session = await insertSession(sql, {
      trainerId, adventureId: def.id, seed, map, party: { lanes, display }, hours: SESSION_HOURS,
    });
    return { session: toSessionView(session) };
  } catch (err) {
    await releaseParty(sql, trainerId, ids);
    // The unique-active-session index (011_adventures.sql) is the last-resort
    // race guard — a concurrent start() that won the claim above but lost the
    // insert (shouldn't happen, since the claim above and the pre-check both
    // already gate this, but a genuinely simultaneous pair of requests could
    // still race the pre-check) surfaces as a clean 409 rather than a raw
    // DB error.
    if (err.code === "23505") throw httpError(409, "already on an adventure");
    throw err;
  }
}

/**
 * Advance one step: validate the choice against the CURRENT step (never
 * trust it blind), claim the move exactly once, resolve the node
 * deterministically from the stored seed, and persist the outcome.
 * @param {{choice:number}} body the ONLY thing the client contributes.
 */
export async function move(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");

  const step = session.map.steps[session.position];
  const choice = Number(body?.choice);
  if (!step || !Number.isInteger(choice) || choice < 0 || choice >= step.options.length) {
    throw httpError(400, "invalid choice");
  }

  const position = session.position; // the step this move resolves
  const newPosition = await claimAdvance(sql, session.id, trainerId, position);
  if (newPosition === null) throw httpError(409, "move already resolved — refresh");

  // Everything past this point is resolving a claim we already won —
  // deterministic from the stored seed + this node's position, never from
  // anything in the request body.
  const def = await getAdventureDef(sql, session.adventureId);
  const option = step.options[choice];
  const nodeSeed = deriveNodeSeed(session.seed, position);
  const rng = makeRng(nodeSeed);

  // A node that can't resolve fails the run instead of stranding it: the
  // claimAdvance above has ALREADY moved position, so simply letting a
  // throw escape here (an unregistered node type, an unknown species, a
  // failed grant/mint, any DB hiccup mid-resolver) would leave the session
  // 'active' with a skipped, unlogged node — every retry would then skip
  // ANOTHER node without resolving it, and a throw on the final step would
  // leave position === totalSteps with state 'active' forever (move() then
  // 400s "invalid choice" until abandon/expiry). So ANY failure resolving
  // this node — a missing resolver or a resolver that throws — goes through
  // the exact same "fail the run" path as a genuine lost battle.
  const resolver = NODE_RESOLVERS[option.type];
  let outcome;
  try {
    if (!resolver) {
      // Shouldn't happen — generateMap only ever emits ADVENTURE_NODE_TYPES —
      // but a hand-edited map or a def whose grammar drifted since the map
      // froze must still fail cleanly rather than crash unresolved.
      throw httpError(500, `adventure map references an unregistered node type "${option.type}"`);
    }
    outcome = await resolver(sql, trainerId, { def, session, rng, nodeSeed });
  } catch (err) {
    const logEntry = { position, choice, type: option.type, error: String(err?.message ?? err) };
    await settleSession(sql, session.id, { state: "failed", lootAppend: [logEntry] });
    await releaseParty(sql, trainerId, partyMonsterIds(session));
    throw err;
  }

  // Terminal transitions: a lost/drawn battle fails the run; the final step's
  // win completes it. Anything else stays 'active' (settleSession's
  // COALESCE leaves state untouched when we pass null).
  let terminalState = null;
  if (outcome.battle && !outcome.battle.won) terminalState = "failed";
  else if (newPosition === session.map.steps.length) terminalState = "completed";

  // The event log is derivable from the stored seed + position forever
  // (CLAUDE.md §1.6) — keep the persisted row small and never store it there;
  // it only ever rides in this response.
  const logEntry = { position, choice, type: option.type, ...stripEvents(outcome) };
  const updated = await settleSession(sql, session.id, { state: terminalState, lootAppend: [logEntry] });

  if (terminalState) await releaseParty(sql, trainerId, partyMonsterIds(session));

  return { session: toSessionView(updated), node: { position, choice, type: option.type, ...outcome } };
}

/** Give up the run early: fails no differently from a lost battle, except by
 *  the player's own choice rather than an outcome. */
export async function abandon(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");

  const updated = await claimAbandon(sql, session.id, trainerId);
  if (!updated) throw httpError(409, "adventure already resolved — refresh");

  await releaseParty(sql, trainerId, partyMonsterIds(session));
  return { session: toSessionView(updated) };
}

// --- node resolvers (closed set — a new node kind is one more entry) -------

const NODE_RESOLVERS = {
  chest: async (sql, trainerId, { def, rng }) => {
    const { itemId, qty } = rollLoot(def.config.loot, rng);
    await grantItem(sql, trainerId, itemId, qty);
    return { loot: [{ itemId, qty }] };
  },

  gather: async (sql, trainerId, { def, rng }) => {
    const { itemId, qty } = rollLoot(def.config.gather, rng);
    await grantItem(sql, trainerId, itemId, qty);
    return { loot: [{ itemId, qty }] };
  },

  battle: async (sql, trainerId, { def, session, rng, nodeSeed }) => {
    const partyLanes = session.party.lanes;
    const speciesIds = rollEncounter(def.config.encounters, rng, PARTY_SIZE);
    const speciesRows = await Promise.all(speciesIds.map((id) => getSpeciesById(sql, id)));
    if (speciesRows.some((s) => !s)) {
      throw httpError(500, "adventure encounters reference an unknown species — is master data seeded?");
    }
    const enemyLanes = speciesRows.map((s, i) => toLane(s, i));

    // The battle's own engine rng is seeded fresh from nodeSeed — a SEPARATE
    // stream from `rng` above (which this resolver already spent rolls from
    // for the encounter draw): battle outcomes stay decoupled from however
    // many rolls composing the wild team happened to cost, so a future
    // change to PARTY_SIZE or the encounter table never perturbs a fight's
    // own randomness for a given nodeSeed.
    const battle = resolveBattle(partyLanes, enemyLanes, nodeSeed);

    // Rune durability (Phase 7.3 parity): the party snapshot's charges are
    // frozen at session start, same accepted wrinkle as two open matches
    // sharing a snapshot (server/services/matches.js resolveMatch) — settled
    // here, against the party (attacking) side only, only after the move's
    // claim already won above.
    await applyRuneWear(sql, trainerId, battle.runeUse?.a);

    if (!battle.youWin || battle.draw) {
      return { battle: { won: false, events: battle.events } };
    }

    const outcome = { battle: { won: true, events: battle.events } };

    // Catch roll: continues on the SAME `rng` stream the encounter draw used
    // (not the battle's own internal rng) — one more roll off the node's
    // seeded stream, same accounting style as rollLoot/rollEncounter.
    if (rng.chance(def.config.catchPct)) {
      // A win means every enemy fell (the engine's draw/win split guarantees
      // aliveCount(B) === 0 on a win) — collect the defeated indices from the
      // event log rather than re-deriving "all of them", so this stays
      // correct even if that invariant ever loosens.
      const defeatedIdx = battle.events
        .filter((e) => e.t === "fall" && e.side === "b")
        .map((e) => e.idx);
      const pool = defeatedIdx.length > 0 ? defeatedIdx : enemyLanes.map((_, i) => i);
      const idx = rng.pick(pool);
      const species = speciesRows[idx];
      const monsterId = await mintMonster(sql, trainerId, species);
      outcome.catch = { speciesId: species.id, name: species.name, monsterId };
    }

    return outcome;
  },
};

// --- shaping helpers ---------------------------------------------------------

/** The wire shape for a session, used by every endpoint that returns one. The
 *  full map is NEVER sent — only the step in front of the player (server-
 *  authoritative: revealing the whole route would leak upcoming nodes). */
function toSessionView(session) {
  const totalSteps = session.map.steps.length;
  const atCurrentStep = session.state === "active" && session.position < totalSteps;
  const step = atCurrentStep ? session.map.steps[session.position] : null;
  return {
    id: session.id,
    adventureId: session.adventureId,
    state: session.state,
    position: session.position,
    totalSteps,
    options: step ? step.options : null,
    party: session.party.display,
    loot: session.loot,
  };
}

/** Strip a battle outcome's event log before it goes into the loot log row —
 *  the row stays small; events are re-derivable from the stored seed anytime
 *  (CLAUDE.md §1.6), and the response (not the DB row) is the only place
 *  they're needed. */
function stripEvents(outcome) {
  if (!outcome.battle) return outcome;
  return { ...outcome, battle: { won: outcome.battle.won } };
}

const partyMonsterIds = (session) => session.party.lanes.map((l) => l.monsterId);

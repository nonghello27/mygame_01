// Adventure use-cases (Phase 7.4 step B, session engine; Phase 10.14 made
// battle nodes interactive). The client contributes a small, closed set of
// choices across this whole domain: which route + which 3 monsters (start),
// which option at the current step (move), the lane ORDER for a staged
// fight (battle), or nothing at all (abandon/surrender) — everything else
// (the map, every roll, loot, the enemy team, the catch) is decided/rolled
// HERE from server state, never trusted from the request body (CLAUDE.md
// §1.1).
//
// Lazy time (CLAUDE.md §1.5): every read/write starts by expiring stale
// sessions, same precedent as settleActivities/ensureSeason — no cron ever
// touches an adventure_sessions row.
//
// Battle nodes are two-phase (Phase 10.14): picking a battle option in
// move() no longer resolves the fight — it ROLLS the enemy team (1-3 wild
// monsters, per the route's `config.enemies` knob) and freezes it into
// `pending_battle` via claimStageBattle(); the player's own lane order then
// arrives separately through battle() (or they give up via surrender()),
// which resolves deterministically off the frozen nodeSeed and claims the
// settlement exactly once via claimSettleBattle(). Chest/gather nodes are
// still one-shot, dispatched through NODE_RESOLVERS, keyed by
// ADVENTURE_NODE_TYPES — a later one-shot node kind is one new registry
// entry, never a branch in move() (CLAUDE.md §1.4, same closed-op-set
// philosophy as summon.js's REQUIREMENT_CHECKERS).
//
// Loot/catches are ESCROWED, not granted mid-run (Phase 10.14): every
// chest/gather/battle outcome only ever appends to the session's `loot` log;
// the actual grants (items, minted catches) happen exactly once, all
// together, when the run reaches 'completed' (grantRunRewards(), called from
// battle()). A defeat, a surrender, an abandon, or lazy expiry forfeits
// everything logged so far — nothing is granted until the run is won outright.

import { httpError } from "../http.js";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { makeRng } from "../../shared/engine/rng.js";
import { generateMap, deriveNodeSeed, rollLoot, rollEncounter } from "../../shared/rules/adventure.js";
import {
  listEnabledAdventureDefs, getAdventureDef, getActiveSession, insertSession,
  claimAdvance, claimStageBattle, claimSettleBattle, settleSession, claimAbandon, expireStaleSessions,
  claimPartyForAdventure, releaseParty,
} from "../repos/adventures.js";
import { listMonstersByTrainer, mintMonster } from "../repos/monsters.js";
import { getSpeciesById } from "../repos/species.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes, applyRuneWear } from "../repos/runes.js";
import { grantItem } from "../repos/inventory.js";
import { settleActivities } from "./activities.js";
import { toLane, groupByMonster, applyOrder } from "./matches.js";

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
 * trust it blind), then either resolve a chest/gather node in place, or —
 * for a battle option — STAGE the fight (Phase 10.14) instead of resolving
 * it: roll 1-3 wild enemies from the route's `config.enemies` knob and
 * freeze them into `pending_battle`, leaving the actual fight to battle()/
 * surrender(). A session with a battle already staged 409s before anything
 * else — resolve or surrender that one first.
 * @param {{choice:number}} body the ONLY thing the client contributes.
 */
export async function move(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");
  if (session.pendingBattle) throw httpError(409, "resolve the staged battle first");

  const step = session.map.steps[session.position];
  const choice = Number(body?.choice);
  if (!step || !Number.isInteger(choice) || choice < 0 || choice >= step.options.length) {
    throw httpError(400, "invalid choice");
  }

  const position = session.position; // the step this move resolves
  const option = step.options[choice];

  if (option.type === "battle") {
    // Everything needed to build the pending fight is loaded/rolled BEFORE
    // any claim — a throw here (an unregistered species, a hiccup on the
    // species read) must leave the session completely untouched, since
    // nothing has been claimed yet (unlike chest/gather below, staging a
    // battle grants nothing, so there's no compensating cleanup to do on a
    // pre-claim failure).
    const def = await getAdventureDef(sql, session.adventureId);
    const nodeSeed = deriveNodeSeed(session.seed, position);
    const rng = makeRng(nodeSeed);
    // Defensive default for a def validated before this phase's `enemies`
    // key existed — validateAdventureConfig now always fills it in for any
    // NEW/re-saved def, but an old row read straight from the DB predates it.
    const cfg = def.config.enemies ?? { min: 1, max: 3 };
    const count = rng.int(cfg.min, cfg.max);
    const speciesIds = rollEncounter(def.config.encounters, rng, count);
    const speciesRows = await Promise.all(speciesIds.map((id) => getSpeciesById(sql, id)));
    if (speciesRows.some((s) => !s)) {
      throw httpError(500, "adventure encounters reference an unknown species — is master data seeded?");
    }
    const enemyLanes = speciesRows.map((s, i) => toLane(s, i));
    const enemyDisplay = speciesRows.map((s) => ({ speciesId: s.id, name: s.name, emoji: s.emoji }));
    // One more roll off the SAME node-seeded stream the encounter draw used
    // (same accounting style as rollLoot/rollEncounter) — frozen now, so the
    // post-battle catch roll stays auditable from the stored session seed
    // alone, with no live rng state for battle()/surrender() to reconstruct.
    const catchSeed = Math.floor(rng.next() * 0x7fffffff);

    const pendingBattle = { position, choice, nodeSeed, catchSeed, enemy: { lanes: enemyLanes, display: enemyDisplay } };
    const updated = await claimStageBattle(sql, session.id, trainerId, position, pendingBattle);
    if (!updated) throw httpError(409, "move already resolved — refresh");
    return { session: toSessionView(updated), node: { position, choice, type: "battle", staged: true } };
  }

  // Chest/gather: still one-shot, claimAdvance is still the exactly-once gate.
  const newPosition = await claimAdvance(sql, session.id, trainerId, position);
  if (newPosition === null) throw httpError(409, "move already resolved — refresh");

  // Everything past this point is resolving a claim we already won —
  // deterministic from the stored seed + this node's position, never from
  // anything in the request body.
  const def = await getAdventureDef(sql, session.adventureId);
  const nodeSeed = deriveNodeSeed(session.seed, position);
  const rng = makeRng(nodeSeed);

  // A node that can't resolve fails the run instead of stranding it: the
  // claimAdvance above has ALREADY moved position, so simply letting a
  // throw escape here (an unregistered node type, a failed grant, any DB
  // hiccup mid-resolver) would leave the session 'active' with a skipped,
  // unlogged node — every retry would then skip ANOTHER node without
  // resolving it. So ANY failure resolving this node — a missing resolver
  // or a resolver that throws — goes through the exact same "fail the run"
  // path as a genuine lost battle.
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

  // Terminal transitions: only a battle node can fail or complete a run now
  // (Phase 10.14) — chest/gather always leaves the session 'active'. Since
  // generateMap forces every final-step option to "battle", newPosition ===
  // totalSteps can no longer actually be reached from this chest/gather
  // path; the check stays here anyway, harmless, in case that invariant
  // ever loosens.
  let terminalState = null;
  if (newPosition === session.map.steps.length) terminalState = "completed";

  // The event log never touches the session row (re-derivable forever from
  // the stored seed, CLAUDE.md §1.6) — chest/gather outcomes never carry one
  // anyway (only `{loot:[...]}`), so the log entry is just the outcome as-is.
  const logEntry = { position, choice, type: option.type, ...outcome };
  const updated = await settleSession(sql, session.id, { state: terminalState, lootAppend: [logEntry] });

  if (terminalState) await releaseParty(sql, trainerId, partyMonsterIds(session));
  if (terminalState === "completed") await grantRunRewards(sql, trainerId, updated);

  return { session: toSessionView(updated), node: { position, choice, type: option.type, ...outcome } };
}

/**
 * Resolve a staged battle (Phase 10.14): validate the player's lane order
 * against their OWN frozen party snapshot (applyOrder — the exact
 * permutation gate resolveMatch uses), resolve deterministically off the
 * pending battle's frozen nodeSeed, claim the settlement exactly once, then
 * fire post-claim effects — rune wear (always, win or lose, same
 * resolveMatch precedent: even a losing attack spends charges), a party
 * release on any terminal outcome, and — only once the run is fully
 * COMPLETED — the escrowed loot/catch grant.
 * @param {{order:number[]}} body the ONLY thing the client contributes.
 */
export async function battle(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");
  if (!session.pendingBattle) throw httpError(409, "no battle staged — pick a battle option first");

  const pb = session.pendingBattle;
  const orderedLanes = applyOrder(session.party.lanes, body?.order);
  const result = resolveBattle(orderedLanes, pb.enemy.lanes, pb.nodeSeed);
  const won = result.youWin && !result.draw;

  // The final step is always a battle (generateMap's exit guard) — winning
  // it completes the run; winning any earlier one just advances.
  const isFinal = pb.position + 1 === session.map.steps.length;
  const state = won ? (isFinal ? "completed" : null) : "failed";

  // Catch roll: only on a win, off the frozen catchSeed — a fresh rng each
  // call so a retried request (that lost the claim below) never perturbs it.
  let catchInfo = null;
  if (won) {
    const def = await getAdventureDef(sql, session.adventureId);
    const catchRng = makeRng(pb.catchSeed);
    if (catchRng.chance(def.config.catchPct)) {
      // A win means every enemy fell (the engine's draw/win split guarantees
      // aliveCount(B) === 0 on a win) — collect the defeated indices from the
      // event log rather than re-deriving "all of them", so this stays
      // correct even if that invariant ever loosens.
      const defeatedIdx = result.events
        .filter((e) => e.t === "fall" && e.side === "b")
        .map((e) => e.idx);
      const pool = defeatedIdx.length > 0 ? defeatedIdx : pb.enemy.lanes.map((_, i) => i);
      const idx = catchRng.pick(pool);
      catchInfo = { speciesId: pb.enemy.display[idx].speciesId, name: pb.enemy.display[idx].name };
    }
  }

  // The event log never touches the DB row (re-derivable forever from the
  // stored seed, CLAUDE.md §1.6) — it only rides in this response, below.
  const logEntry = {
    position: pb.position, choice: pb.choice, type: "battle", battle: { won },
    ...(catchInfo ? { catch: catchInfo } : {}),
  };
  const updated = await claimSettleBattle(sql, session.id, trainerId, { advance: won, state, lootAppend: [logEntry] });
  if (!updated) throw httpError(409, "battle already resolved — refresh");

  // Post-claim effects — fire at most once, same "only after the claim is
  // already won" reasoning as resolveMatch's Elo/rune wear.
  await applyRuneWear(sql, trainerId, result.runeUse?.a);
  let granted = null;
  if (state) await releaseParty(sql, trainerId, partyMonsterIds(session));
  if (state === "completed") granted = await grantRunRewards(sql, trainerId, updated);

  return {
    session: toSessionView(updated),
    node: {
      position: pb.position, choice: pb.choice, type: "battle",
      battle: { won, events: result.events },
      ...(catchInfo ? { catch: catchInfo } : {}),
      ...(granted ? { granted } : {}),
    },
  };
}

/**
 * Surrender a staged battle (Phase 10.14): this IS a defeat, exactly like a
 * lost fight — the run fails and every escrowed reward (the loot log so
 * far, any earlier catch) is forfeited. No order to validate; there's
 * nothing left to send in.
 */
export async function surrender(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");
  if (!session.pendingBattle) throw httpError(409, "no battle staged — nothing to surrender");

  const pb = session.pendingBattle;
  const logEntry = { position: pb.position, choice: pb.choice, type: "battle", battle: { won: false, surrendered: true } };
  const updated = await claimSettleBattle(sql, session.id, trainerId, { advance: false, state: "failed", lootAppend: [logEntry] });
  if (!updated) throw httpError(409, "battle already resolved — refresh");

  await releaseParty(sql, trainerId, partyMonsterIds(session));
  return { session: toSessionView(updated) };
}

/** Give up the run early: fails no differently from a lost battle, except by
 *  the player's own choice rather than an outcome. Any staged battle (should
 *  there ever be one — move() itself blocks starting a NEW one while a
 *  battle is staged, so this mainly matters if the client abandons instead
 *  of surrendering) is simply discarded along with the run. */
export async function abandon(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");

  const updated = await claimAbandon(sql, session.id, trainerId);
  if (!updated) throw httpError(409, "adventure already resolved — refresh");

  await releaseParty(sql, trainerId, partyMonsterIds(session));
  return { session: toSessionView(updated) };
}

// --- node resolvers (closed set — a new ONE-SHOT node kind is one more
// entry). Battle is the one TWO-PHASE node kind: move() dispatches it to the
// staging path above instead of through this registry, and battle()/
// surrender() resolve it. ---------------------------------------------------

const NODE_RESOLVERS = {
  // Loot is escrowed in the session log, not granted here — grantRunRewards()
  // (below) grants it only once the run reaches 'completed'; a later
  // defeat/surrender/abandon/expiry forfeits it (Phase 10.14).
  chest: async (sql, trainerId, { def, rng }) => {
    const { itemId, qty } = rollLoot(def.config.loot, rng);
    return { loot: [{ itemId, qty }] };
  },

  gather: async (sql, trainerId, { def, rng }) => {
    const { itemId, qty } = rollLoot(def.config.gather, rng);
    return { loot: [{ itemId, qty }] };
  },
};

/**
 * Walk a COMPLETED session's loot log, granting every escrowed item stack
 * and minting every escrowed catch, all at once. Fires only after the
 * completion claim (claimSettleBattle for the winning final battle, or the
 * chest/gather settleSession call reaching the unreachable-in-practice final
 * step) is already won — a crash between that claim and this call would
 * leave the grant unapplied even though the session already reads
 * 'completed', same accepted wrinkle as resolveMatch's post-claim Elo/rune
 * wear (the persisted `loot` log stays auditable so a reconciliation pass
 * could replay it later if this ever matters).
 * @returns {Promise<{items:object[], monsters:object[]}>}
 */
async function grantRunRewards(sql, trainerId, session) {
  const items = [];
  const monsters = [];
  for (const entry of session.loot) {
    if (entry.loot) {
      for (const { itemId, qty } of entry.loot) {
        await grantItem(sql, trainerId, itemId, qty);
        items.push({ itemId, qty });
      }
    }
    if (entry.catch) {
      const species = await getSpeciesById(sql, entry.catch.speciesId);
      // A species retired/deleted mid-run is a content-admin edge case, not
      // a reason to fail an already-completed run — skip that one mint
      // rather than throwing.
      if (!species) continue;
      const monsterId = await mintMonster(sql, trainerId, species);
      monsters.push({ speciesId: species.id, name: species.name, monsterId });
    }
  }
  return { items, monsters };
}

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
    // A staged battle forces the player's only moves to battle/surrender —
    // options is null whenever one is pending.
    options: session.pendingBattle ? null : (step ? step.options : null),
    party: session.party.display,
    loot: session.loot,
    // Both sides' frozen lane snapshots for the fight in front of the
    // player — the SAME disclosure level as POST /api/battle/match
    // returning `you`/`enemy` (server/services/matches.js createMatch): a
    // staged fight's own combatants are fair game to show. nodeSeed/
    // catchSeed never ship.
    pendingBattle: session.pendingBattle ? {
      position: session.pendingBattle.position,
      party: session.party.lanes,
      enemy: session.pendingBattle.enemy.lanes,
      enemyDisplay: session.pendingBattle.enemy.display,
    } : null,
  };
}

const partyMonsterIds = (session) => session.party.lanes.map((l) => l.monsterId);

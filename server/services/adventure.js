// Adventure use-cases (Phase 7.4 step B, session engine; Phase 10.14 made
// battle nodes interactive; Phase 11.2 rebuilds the whole thing on the grid
// maze Phase 11.1 designed). The client contributes a small, closed set of
// choices across this whole domain: which route + which difficulty + which 3
// monsters (start), a TARGET CELL to step onto (move), the lane ORDER for a
// staged fight (battle), or nothing at all (exit/surrender/abandon) —
// everything else (the maze, every roll, the enemy team, the loot, the
// reward rolls) is decided/rolled HERE from server state, never trusted from
// the request body (CLAUDE.md §1.1).
//
// Lazy time (CLAUDE.md §1.5): every read/write starts by expiring stale
// sessions, same precedent as settleActivities/ensureSeason — no cron ever
// touches an adventure_sessions row.
//
// The maze (Phase 11): a session freezes a width×height grid
// (generateGridMap) plus a MOVE BUDGET (the sum of the party's derived spd
// plus the route's movesBonus) at start. move({x,y}) steps onto an adjacent,
// passable cell, spending one move; an item cell rolls loot in the same
// claim, a monster cell instead STAGES a battle exactly like Phase 10.14 —
// the actual fight is resolved separately via battle() (or surrendered) —
// and a cell already in `cleared` is inert (backtracking is free of content,
// not of moves). Running out of moves anywhere but the entrance STRANDS the
// run (fails it, forfeiting the escrow); the entrance costs nothing to stand
// on, so a run only ever completes via the explicit exit() endpoint.
//
// Escrow philosophy unchanged from Phase 10.14: every chest/item/battle
// outcome only ever appends to the session's `loot` log; the actual grants
// (items, gold, exp, minted catches) happen exactly once, only when exit()
// completes the run. A defeat, a surrender, a stranding, an abandon, or lazy
// expiry forfeits everything logged so far — nothing is granted until the
// player actually walks back out.

import { httpError } from "../http.js";
import { resolveBattle } from "../../shared/engine/resolve.js";
import { makeRng } from "../../shared/engine/rng.js";
import {
  generateGridMap, cellKey, visibleCellKeys, CELL, deriveNodeSeed, rollLoot, rollEncounter,
} from "../../shared/rules/adventure.js";
import { ADVENTURE_DIFFICULTIES } from "./adminValidate.js";
import {
  listEnabledAdventureDefs, getAdventureDef, getActiveSession, insertSession,
  claimMove, claimExit, claimSettleBattle, claimAbandon, expireStaleSessions,
  claimPartyForAdventure, releaseParty,
} from "../repos/adventures.js";
import { listMonstersByTrainer, mintMonster } from "../repos/monsters.js";
import { getSpeciesById } from "../repos/species.js";
import { listEquippedMonsterEquipment } from "../repos/equipment.js";
import { listSocketedRunes, applyRuneWear } from "../repos/runes.js";
import { grantItem } from "../repos/inventory.js";
import { creditTrainerReward } from "../repos/trainers.js";
import { settleActivities } from "./activities.js";
import { toLane, groupByMonster, applyOrder } from "./matches.js";

// ends_at AND the party's busy claim share this exact duration — lock and
// timer can never drift, same principle as activities' claimMonsterForJob/
// insertActivity pairing.
export const SESSION_HOURS = 24;
export const PARTY_SIZE = 3;

/** Everything the Adventure panel needs: the enabled route list (public
 *  fields only — `config`'s density/reward knobs are server balance data,
 *  never shipped; width/height and the difficulty tier NAMES are fair to
 *  show, since a route card needs to advertise its size and let the player
 *  pick a difficulty) and the trainer's current session, if any. */
export async function getState(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const [defs, session] = await Promise.all([
    listEnabledAdventureDefs(sql),
    getActiveSession(sql, trainerId),
  ]);
  return {
    adventures: defs.map((d) => ({
      id: d.id, name: d.name, description: d.description,
      width: d.config.width, height: d.config.height,
      difficulties: Object.keys(d.config.difficulties ?? {}),
    })),
    session: session ? toSessionView(session) : null,
  };
}

/**
 * Start a run: lock the party, generate the maze from a freshly minted seed
 * at the chosen difficulty, compute the move budget, and freeze it all into
 * a new session row. Any failure from the busy claim onward must release the
 * party first (compensating, same spirit as summon.js's performSummon
 * unmint/refund) — the try below wraps exactly that span.
 * @param {{adventureId:string, difficulty:string, monsterIds:number[]}} body
 *   the ONLY things the client contributes.
 */
export async function start(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  if (await getActiveSession(sql, trainerId)) throw httpError(409, "already on an adventure");

  const adventureId = body?.adventureId;
  if (typeof adventureId !== "string" || !adventureId) throw httpError(400, "adventureId is required");

  const difficulty = body?.difficulty;
  if (!ADVENTURE_DIFFICULTIES.includes(difficulty)) {
    throw httpError(400, `difficulty must be one of ${ADVENTURE_DIFFICULTIES.join(", ")}`);
  }

  const def = await getAdventureDef(sql, adventureId);
  // 404 for both "no such route" and "disabled" — a retired route must not
  // leak that it ever existed, same precedent as the Summon Hall's banners.
  if (!def || !def.enabled) throw httpError(404, "unknown adventure");
  // Defensive guard against an admin-edited/hand-seeded def that predates
  // Phase 11's grid grammar (validateAdventureConfig always fills in a full
  // `difficulties` object for any NEW/re-saved def, but a row written before
  // this phase and never re-saved could still lack it) — fail cleanly rather
  // than crash deep inside generateGridMap.
  if (!def.config?.difficulties?.[difficulty]) {
    throw httpError(409, "this route hasn't been re-saved for grid adventures yet");
  }

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
    // `cls`/`sprite` ride along for the client's current-cell marker (Phase
    // 11.3): a class-icon tile for the party's front unit, the same
    // display-metadata bucket emoji already sits in.
    const display = chosen.map((m) => ({ monsterId: m.id, name: m.name, emoji: m.emoji, cls: m.cls, sprite: m.sprite }));

    // Determinism (CLAUDE.md §1.6): a STORED seed, same minting precedent as
    // match creation and Summon Hall pulls.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const map = generateGridMap(def.config, difficulty, seed);

    // The move budget: the party's own derived spd (read off the frozen
    // toLane() snapshots, so gear/runes that raise spd raise the budget too)
    // plus the route's flat movesBonus — the roadmap's risk/return knob.
    const movesTotal = lanes.reduce((sum, l) => sum + l.spd, 0) + (def.config.movesBonus ?? 0);

    const session = await insertSession(sql, {
      trainerId, adventureId: def.id, difficulty, seed, map,
      party: { lanes, display }, movesTotal, hours: SESSION_HOURS,
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
 * Step onto one adjacent cell (Phase 11.2's grid replaces the old step-list
 * move()): validate the target against the CURRENT state (bounds, passable,
 * orthogonally adjacent, moves remaining) — never trust it blind — then
 * resolve whatever the cell holds. An OPEN or already-`cleared` cell is just
 * a step; a fresh ITEM cell rolls loot in the SAME claim as the move; a
 * fresh MONSTER cell instead STAGES a battle (Phase 10.14's two-phase shape,
 * unchanged) for battle()/surrender() to resolve. Running the move budget to
 * 0 anywhere but the entrance STRANDS the run in the same statement — the
 * risk/return rule this whole phase is chasing. A session with a battle
 * already staged 409s before anything else — resolve or surrender that one
 * first.
 *
 * Everything about the target cell is computed BEFORE the claim (deterministic
 * or read-only — a throw here must leave the session untouched, the Phase
 * 10.14 battle-staging precedent), then claimMove() carries the whole result
 * as one atomic UPDATE.
 * @param {{x:number, y:number}} body the ONLY thing the client contributes.
 */
export async function move(sql, trainerId, body) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");
  if (session.pendingBattle) throw httpError(409, "resolve the staged battle first");

  const { map } = session;
  const x = Number(body?.x);
  const y = Number(body?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= map.width || y < 0 || y >= map.height) {
    throw httpError(400, "invalid target cell");
  }
  // Disclosure gate, NOT a style choice — do not reorder: adjacency must be
  // checked BEFORE impassability. A non-adjacent target's terrain is never
  // supposed to be visible (fog of war), so if the impassable check ran
  // first, a client could probe arbitrary in-bounds cells for free and tell
  // rock from open by which 400 message comes back, mapping the whole maze
  // without ever spending a move. Checking adjacency first means the only
  // cells that ever reach the impassable check are ones fog-of-war already
  // discloses (an adjacent cell's terrain rides every session view anyway).
  if (Math.abs(x - session.pos.x) + Math.abs(y - session.pos.y) !== 1) {
    throw httpError(400, "you can only move to an adjacent cell");
  }
  if (map.cells[y][x] === CELL.ROCK) throw httpError(400, "that cell is impassable");
  // Belt-and-braces: the stranded rule below should make this unreachable in
  // practice (0 moves left anywhere but the entrance already fails the run
  // the moment it happens), but a raced/replayed request must still 409
  // cleanly rather than let moves_left go negative.
  if (session.movesLeft <= 0) throw httpError(409, "no moves left");

  const key = cellKey(x, y);
  const kind = map.cells[y][x];
  const alreadyCleared = session.cleared.includes(key);
  const visitedAppend = session.visited.includes(key) ? [] : [key];
  const movesLeftAfter = session.movesLeft - 1;
  const atEntrance = x === map.entrance.x && y === map.entrance.y;

  let pendingBattle = null;
  let lootAppend = [];
  let clearedAppend = [];
  let state = null;
  let node = { x, y, type: "step" };

  // The cell index a fresh cell's rolls derive from — same "y·width + x"
  // scheme deriveNodeSeed's own doc comment now describes (it used to be a
  // step index; the grid replaces "position" with a cell coordinate).
  const cellIndex = y * map.width + x;

  // Loaded once, up front, for whichever fresh-cell branch below needs it —
  // this is the ONLY route the def's config could still change during (a
  // throw before either branch runs, e.g. the bounds/adjacency checks above,
  // must leave the session untouched, so def is loaded only once we know
  // we're actually resolving a cell).
  const needsDef = (kind === CELL.MONSTER || kind === CELL.ITEM) && !alreadyCleared;
  const def = needsDef ? await getAdventureDef(sql, session.adventureId) : null;

  if (kind === CELL.MONSTER && !alreadyCleared) {
    // Everything needed to build the pending fight is loaded/rolled BEFORE
    // any claim — a throw here (an unregistered species, a hiccup on the
    // species read) must leave the session completely untouched, since
    // nothing has been claimed yet.
    const nodeSeed = deriveNodeSeed(session.seed, cellIndex);
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
    // Two more rolls off the SAME node-seeded stream the encounter draw
    // used, in this FIXED order — encounter draws, then catchSeed, then
    // rewardSeed — so the whole cell stays auditable from the stored session
    // seed alone (same accounting style as rollLoot/rollEncounter): frozen
    // now, so battle()'s post-win catch and gold/exp rolls never need a live
    // rng state reconstructed later.
    const catchSeed = Math.floor(rng.next() * 0x7fffffff);
    const rewardSeed = Math.floor(rng.next() * 0x7fffffff);

    pendingBattle = { x, y, nodeSeed, catchSeed, rewardSeed, enemy: { lanes: enemyLanes, display: enemyDisplay } };
    node = { x, y, type: "battle", staged: true };
  } else if (kind === CELL.ITEM && !alreadyCleared) {
    const rng = makeRng(deriveNodeSeed(session.seed, cellIndex));
    const { itemId, qty } = rollLoot(def.config.loot, rng);
    lootAppend = [{ x, y, type: "item", loot: [{ itemId, qty }] }];
    clearedAppend = [key];
    node = { x, y, type: "item", loot: [{ itemId, qty }] };
  }

  // Stranded rule: running out of moves anywhere but the entrance forfeits
  // the run — the roadmap's risk/return loop (go deeper for more loot, or
  // bank what's already banked). Landing the LAST move ON the entrance stays
  // active (exit() itself costs nothing); a battle staged on the last move
  // defers this check to battle() below, since the fight isn't resolved yet.
  if (movesLeftAfter === 0 && !atEntrance && !pendingBattle) {
    state = "failed";
    lootAppend = [...lootAppend, { x, y, type: "stranded" }];
    node.stranded = true;
  }

  const updated = await claimMove(sql, session.id, trainerId, {
    fromX: session.pos.x, fromY: session.pos.y, toX: x, toY: y,
    movesLeftExpected: session.movesLeft, visitedAppend, clearedAppend, lootAppend, pendingBattle, state,
  });
  if (!updated) throw httpError(409, "move already resolved — refresh");

  if (state === "failed") await releaseParty(sql, trainerId, partyMonsterIds(session));
  return { session: toSessionView(updated), node };
}

/**
 * Resolve a staged battle (Phase 10.14, adapted to the grid in 11.2):
 * validate the player's lane order against their OWN frozen party snapshot
 * (applyOrder — the exact permutation gate resolveMatch uses), resolve
 * deterministically off the pending battle's frozen nodeSeed, claim the
 * settlement exactly once, then fire post-claim effects — rune wear (always,
 * win or lose, same resolveMatch precedent: even a losing attack spends
 * charges), a party release on any terminal outcome. UNLIKE Phase 10.14, a
 * win no longer completes the run by itself — only exit() does that; instead
 * a win on the party's LAST move (moves_left already at 0, and not standing
 * at the entrance) STRANDS the run right here, same forfeiture as running out
 * of moves on an ordinary step, since the fight was the last thing standing
 * between the party and 0 moves anywhere but the door out.
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

  // A win on the party's last move away from the entrance still strands the
  // run — the fight doesn't grant extra moves, it just clears the cell that
  // spent the last one. Everything escrowed so far (including this fight's
  // own reward roll below) is forfeited exactly like an ordinary stranding.
  const entrance = session.map.entrance;
  const stranded = won && session.movesLeft === 0 && !(session.pos.x === entrance.x && session.pos.y === entrance.y);
  const state = won ? (stranded ? "failed" : null) : "failed";

  // Rewards on a win: a fresh rng off the frozen rewardSeed (never a live
  // stream) so a retried request that lost the claim below can't perturb it
  // — the catchSeed precedent, one level up.
  let gold = 0, exp = 0;
  let catchInfo = null;
  if (won) {
    const def = await getAdventureDef(sql, session.adventureId);
    const d = def.config.difficulties?.[session.difficulty];
    // Guard against an old-grammar session (impossible after 024's migration
    // abandons every in-flight run predating this phase, but cheap and
    // harmless to keep): no reward tier on file just means no reward.
    if (d) {
      const rewardRng = makeRng(pb.rewardSeed);
      gold = rewardRng.int(d.battleGold.min, d.battleGold.max);
      exp = rewardRng.int(d.battleExp.min, d.battleExp.max);
    }

    // Catch roll: only on a win, off the frozen catchSeed — unchanged from
    // Phase 10.14.
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
  const lootAppend = [{
    x: pb.x, y: pb.y, type: "battle", battle: { won },
    ...(won ? { gold, exp } : {}),
    ...(catchInfo ? { catch: catchInfo } : {}),
  }];
  if (stranded) lootAppend.push({ x: pb.x, y: pb.y, type: "stranded" });

  const updated = await claimSettleBattle(sql, session.id, trainerId, {
    state, lootAppend, clearedAppend: won ? [cellKey(pb.x, pb.y)] : [],
  });
  if (!updated) throw httpError(409, "battle already resolved — refresh");

  // Post-claim effects — fire at most once, same "only after the claim is
  // already won" reasoning as resolveMatch's Elo/rune wear.
  await applyRuneWear(sql, trainerId, result.runeUse?.a);
  if (state) await releaseParty(sql, trainerId, partyMonsterIds(session));
  // No grant here any more (Phase 11.2): only exit() completing the run
  // grants the escrow — a battle win just clears the cell and logs its
  // gold/exp/catch, same as any other loot entry, until the player actually
  // walks back out.

  return {
    session: toSessionView(updated),
    node: {
      x: pb.x, y: pb.y, type: "battle",
      battle: { won, events: result.events },
      ...(won ? { gold, exp } : {}),
      ...(catchInfo ? { catch: catchInfo } : {}),
      ...(stranded ? { stranded: true } : {}),
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
  const logEntry = { x: pb.x, y: pb.y, type: "battle", battle: { won: false, surrendered: true } };
  const updated = await claimSettleBattle(sql, session.id, trainerId, { state: "failed", lootAppend: [logEntry] });
  if (!updated) throw httpError(409, "battle already resolved — refresh");

  await releaseParty(sql, trainerId, partyMonsterIds(session));
  return { session: toSessionView(updated) };
}

/**
 * Leave the maze (Phase 11.2, new): the ONLY way a run ever completes. Standing
 * anywhere but the entrance 409s with a clean message up front (a pre-check
 * for a friendly error); claimExit() below re-checks the exact same thing
 * atomically as its own claim, so a race between this check and the claim
 * can never let a run complete from the wrong cell. Once the claim wins, the
 * party is freed and every escrowed chest/item/battle reward logged this run
 * is granted, all at once, via grantRunRewards() — the moment (and the only
 * moment) this run's loot log turns into anything the trainer actually owns.
 */
export async function exit(sql, trainerId) {
  await expireStaleSessions(sql, trainerId);
  const session = await getActiveSession(sql, trainerId);
  if (!session) throw httpError(404, "no active adventure");
  if (session.pendingBattle) throw httpError(409, "resolve the staged battle first");

  const { entrance } = session.map;
  if (session.pos.x !== entrance.x || session.pos.y !== entrance.y) {
    throw httpError(409, "you must be standing at the entrance to leave");
  }

  const updated = await claimExit(sql, session.id, trainerId, { x: entrance.x, y: entrance.y });
  if (!updated) throw httpError(409, "adventure already resolved — refresh");

  await releaseParty(sql, trainerId, partyMonsterIds(session));
  const granted = await grantRunRewards(sql, trainerId, updated);
  return { session: toSessionView(updated), granted };
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

/**
 * Walk a COMPLETED session's loot log, granting every escrowed item stack,
 * summing every escrowed gold/exp roll into ONE trainer credit, and minting
 * every escrowed catch, all at once. Called ONLY from exit() — Phase 11.2
 * retired the old "the final step completes the run" path entirely, so
 * grantRunRewards now fires from exactly one call site. Fires only after the
 * completion claim (claimExit) is already won — a crash between that claim
 * and this call would leave the grant unapplied even though the session
 * already reads 'completed', same accepted wrinkle as resolveMatch's
 * post-claim Elo/rune wear (the persisted `loot` log stays auditable so a
 * reconciliation pass could replay it later if this ever matters).
 * @returns {Promise<{items:object[], monsters:object[], gold:number, exp:number}>}
 */
async function grantRunRewards(sql, trainerId, session) {
  const items = [];
  const monsters = [];
  let gold = 0;
  let exp = 0;
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
    gold += entry.gold ?? 0;
    exp += entry.exp ?? 0;
  }
  if (gold > 0 || exp > 0) await creditTrainerReward(sql, trainerId, { gold, exp });
  return { items, monsters, gold, exp };
}

// --- shaping helpers ---------------------------------------------------------

/**
 * The wire shape for a session, used by every endpoint that returns one. The
 * full map is NEVER sent — only fog-of-war terrain for cells the party has
 * actually visited plus their orthogonal neighbors (visibleCellKeys), and
 * even then only TERRAIN, never a cell's CONTENT: an item cell clears the
 * instant it's stepped on and a monster cell is either the pending battle or
 * `cleared`, so the `visited`/`cleared` flags already carry everything the
 * client is entitled to know about a cell (server-authoritative: shipping a
 * live map with un-stepped-on monster/item cells marked would leak upcoming
 * encounters, CLAUDE.md §1.1's "the full map would leak upcoming nodes"
 * precedent, carried over from the old step-list session's "only the current
 * step is ever shipped").
 */
function toSessionView(session) {
  const { map } = session;
  const visible = visibleCellKeys(map.width, map.height, session.visited);
  const cells = [...visible].map((key) => {
    const [x, y] = key.split(",").map(Number);
    return {
      x, y,
      terrain: map.cells[y][x] === CELL.ROCK ? "rock" : "open",
      visited: session.visited.includes(key),
      cleared: session.cleared.includes(key),
    };
  });
  // Stable wire order — (y, x) — so a client diffing successive reads
  // doesn't have to re-sort a Set's insertion order itself.
  cells.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  return {
    id: session.id,
    adventureId: session.adventureId,
    difficulty: session.difficulty,
    state: session.state,
    width: map.width,
    height: map.height,
    entrance: { x: map.entrance.x, y: map.entrance.y },
    pos: session.pos,
    movesLeft: session.movesLeft,
    movesTotal: session.movesTotal,
    party: session.party.display,
    loot: session.loot,
    cells,
    // Both sides' frozen lane snapshots for the fight in front of the
    // player — the SAME disclosure level as POST /api/battle/match
    // returning `you`/`enemy` (server/services/matches.js createMatch): a
    // staged fight's own combatants are fair game to show. nodeSeed/
    // catchSeed/rewardSeed never ship.
    pendingBattle: session.pendingBattle ? {
      x: session.pendingBattle.x, y: session.pendingBattle.y,
      party: session.party.lanes,
      enemy: session.pendingBattle.enemy.lanes,
      enemyDisplay: session.pendingBattle.enemy.display,
    } : null,
  };
}

const partyMonsterIds = (session) => session.party.lanes.map((l) => l.monsterId);

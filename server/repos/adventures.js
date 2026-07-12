// SQL for Adventure (Phase 7.4 step B's session engine, rebuilt on the grid
// in Phase 11.2): the enabled route list, one session per trainer (at most
// one 'active' row — db/migrations/011_adventures.sql's partial unique index
// is the DB-level guarantee), the grid session's move/exit claims, and the
// party's busy lock. Only server/services/adventure.js calls these — the
// rules (map generation, node resolution, lazy expiry, compensating
// releases) live there, the queries live here. Same division of labor as
// server/repos/summons.js.

import { cellKey } from "../../shared/rules/adventure.js";

function shapeSession(r) {
  return {
    id: Number(r.id),
    trainerId: Number(r.trainer_id),
    adventureId: r.adventure_id,
    seed: Number(r.seed),
    map: r.map,
    party: r.party,
    position: r.position,
    state: r.state,
    loot: r.loot,
    endsAt: r.ends_at,
    pendingBattle: r.pending_battle ?? null,
    difficulty: r.difficulty,
    pos: { x: r.pos_x, y: r.pos_y },
    movesTotal: Number(r.moves_total),
    movesLeft: Number(r.moves_left),
    visited: r.visited ?? [],
    cleared: r.cleared ?? [],
  };
}

/** Enabled routes only — what the state read offers a trainer. `config` rides
 *  along here (the service is what strips it before it ever reaches the
 *  client — see getState()'s public projection). */
export async function listEnabledAdventureDefs(sql) {
  const rows = await sql`
    SELECT id, name, description, config FROM adventure_defs WHERE enabled ORDER BY id`;
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, config: r.config }));
}

/** One route's full detail, including `enabled` — start() needs that flag
 *  itself (a disabled/unknown route both 404, same no-leak precedent as
 *  the Summon Hall's getSummonDef). */
export async function getAdventureDef(sql, id) {
  const rows = await sql`
    SELECT id, name, description, config, enabled FROM adventure_defs WHERE id = ${id}`;
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, description: r.description, config: r.config, enabled: r.enabled };
}

/** The trainer's one 'active' session, or null — the partial unique index
 *  guarantees there is at most one. */
export async function getActiveSession(sql, trainerId) {
  const rows = await sql`
    SELECT id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
           difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared
    FROM adventure_sessions WHERE trainer_id = ${trainerId} AND state = 'active'`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * The trainer's most recently completed session whose rewards are still
 * unclaimed, or null (the claim() flow's own precondition read, and what a
 * page reload re-renders the pending accept-rewards summary from). ORDER BY
 * id DESC + LIMIT 1 rather than a uniqueness guarantee — nothing enforces
 * "at most one unclaimed" the way the active-session partial index does,
 * since start() itself is what blocks a second run from ever completing on
 * top of an uncollected one.
 */
export async function getUnclaimedSession(sql, trainerId) {
  const rows = await sql`
    SELECT id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
           difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared
    FROM adventure_sessions
    WHERE trainer_id = ${trainerId} AND state = 'completed' AND rewards_claimed = false
    ORDER BY id DESC LIMIT 1`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Mint a new session row (state 'active'). `position` (the legacy step-index
 * column, unused by the grid engine — kept in place rather than dropped, see
 * 024_adventure_grid.sql's header) is still written 0 for compatibility with
 * its NOT NULL default; the grid's own cursor is `pos_x`/`pos_y`, seeded from
 * `map.entrance`. `visited` starts holding just the entrance's own cellKey()
 * (the party can already see the cell it's standing on and its neighbors —
 * server/services/adventure.js's toSessionView derives the rest via
 * visibleCellKeys()); `cleared` starts empty. Guarded only by
 * `adventure_sessions_one_active_idx` — a race loses this INSERT with a
 * unique-violation (code 23505), which the SERVICE (not this repo, unlike
 * server/repos/pvp.js insertSeason's precedent) catches and turns into a 409,
 * per this task's design.
 */
export async function insertSession(sql, { trainerId, adventureId, difficulty, seed, map, party, movesTotal, hours }) {
  const rows = await sql`
    INSERT INTO adventure_sessions (
      trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at,
      difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared
    )
    VALUES (
      ${trainerId}, ${adventureId}, ${seed}, ${JSON.stringify(map)}::jsonb,
      ${JSON.stringify(party)}::jsonb, 0, 'active', '[]'::jsonb,
      now() + make_interval(hours => ${hours}),
      ${difficulty}, ${map.entrance.x}, ${map.entrance.y}, ${movesTotal}, ${movesTotal},
      ${JSON.stringify([cellKey(map.entrance.x, map.entrance.y)])}::jsonb, '[]'::jsonb
    )
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
              difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared`;
  return shapeSession(rows[0]);
}

/**
 * The grid engine's one move claim (Phase 11.2) — the exactly-once gate for
 * move(), playing claimAdvance's old role but widened to the grid's shape:
 * the WHERE clause re-checks ownership, `active`, no battle already staged,
 * AND that the party is still standing at `fromX,fromY` with exactly
 * `movesLeftExpected` moves left (a raced double-POST's second request loses
 * on the position or moves_left check, same "the whole gate lives in the
 * WHERE" precedent as claimSettleBattle). ONE statement moves the cursor,
 * decrements the budget, appends to `visited`/`cleared`/`loot` (each an
 * already-JSON-stringified array — `[]` when nothing to append — so `||`
 * concatenates two jsonb arrays rather than nesting), optionally STAGES a
 * battle (`pendingBattle` object or null — the WHERE's own `pending_battle
 * IS NULL` check means this is always a fresh set, never an overwrite), and
 * optionally flips to a terminal `state` (the settleSession COALESCE
 * precedent — omitted/null leaves state untouched, e.g. the stranded rule
 * flipping 'active' -> 'failed' in the same statement as the move that
 * triggered it).
 * @param {{fromX:number, fromY:number, toX:number, toY:number,
 *   movesLeftExpected:number, visitedAppend:string[], clearedAppend:string[],
 *   lootAppend:object[], pendingBattle:(object|null), state:(string|null)}} opts
 * @returns the refreshed session row, or null when the claim lost.
 */
export async function claimMove(sql, sessionId, trainerId, opts) {
  const { fromX, fromY, toX, toY, movesLeftExpected, visitedAppend, clearedAppend, lootAppend, pendingBattle, state } = opts;
  const rows = await sql`
    UPDATE adventure_sessions
    SET pos_x = ${toX}, pos_y = ${toY},
        moves_left = moves_left - 1,
        visited = visited || ${JSON.stringify(visitedAppend)}::jsonb,
        cleared = cleared || ${JSON.stringify(clearedAppend)}::jsonb,
        loot = loot || ${JSON.stringify(lootAppend)}::jsonb,
        pending_battle = ${pendingBattle ? JSON.stringify(pendingBattle) : null}::jsonb,
        state = COALESCE(${state}::text, state),
        updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId}
      AND state = 'active' AND pending_battle IS NULL
      AND pos_x = ${fromX} AND pos_y = ${fromY}
      AND moves_left = ${movesLeftExpected} AND moves_left > 0
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
              difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Leave the maze (Phase 11.2) — the exactly-once gate for exit(): a guarded
 * `active -> completed` flip. The WHERE clause re-checks ownership, `active`,
 * no battle staged, AND that the party is standing AT the entrance
 * (`pos_x/pos_y = x/y`, the caller passes the map's own entrance coords) —
 * standing-at-the-entrance is part of the claim itself, never a separate
 * pre-check that could race between the read and the write. Also stamps
 * `rewards_claimed = false` (the Phase 11 follow-up, 025_adventure_claim.sql)
 * — completing a run banks its escrowed haul as CLAIMABLE, not granted; only
 * claim()'s own claimRewards() below actually grants it.
 * @returns the refreshed (now 'completed') session row, or null when the
 *   claim lost (already resolved, or the party isn't at the entrance after
 *   all — a stale client read racing a move that's already left it).
 */
export async function claimExit(sql, sessionId, trainerId, { x, y }) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET state = 'completed', rewards_claimed = false, updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId}
      AND state = 'active' AND pending_battle IS NULL
      AND pos_x = ${x} AND pos_y = ${y}
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
              difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Collect a completed run's escrowed rewards — the exactly-once gate for
 * claim() (the payoutSeason `reward IS NULL`-style precedent, here
 * `rewards_claimed = false`): the WHERE clause is the WHOLE gate — ownership,
 * `completed`, and not-already-claimed — so a raced double-POST's second
 * request cleanly loses. `RETURNING *` (rather than the explicit column list
 * the other claims use) is fine here: shapeSession() only ever reads the
 * fields it names off the row, so the extra `rewards_claimed`/`created_at`/
 * etc. columns are simply ignored.
 * @returns the refreshed (now-claimed) session row, or null when the claim
 *   lost (already collected by an earlier request).
 */
export async function claimRewards(sql, sessionId, trainerId) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET rewards_claimed = true, updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId}
      AND state = 'completed' AND rewards_claimed = false
    RETURNING *`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Resolve a staged battle (Phase 10.14, adapted to the grid in 11.2): the
 * exactly-once gate for battle()/surrender(): the WHERE clause re-checks
 * ownership, `active`, AND that a battle IS staged (`pending_battle IS NOT
 * NULL`), so a raced double-POST's second request loses. ONE statement clears
 * the stage, appends `clearedAppend` (the fought cell's key, on a win — an
 * empty array by default, on a loss/surrender), appends `lootAppend` to the
 * running log, and optionally flips to a terminal `state` (the claimMove
 * COALESCE precedent — omitted/null leaves state untouched). UNLIKE Phase
 * 10.14's version, this never advances a step-index `position` — battles
 * never move the party on the grid; only exit() (via claimExit) or a
 * stranded claimMove ever completes/fails a run from here on.
 * @param {{state?:(string|null), lootAppend:object[], clearedAppend?:string[]}} opts
 * @returns the refreshed session row, or null when the claim lost.
 */
export async function claimSettleBattle(sql, sessionId, trainerId, { state = null, lootAppend, clearedAppend = [] }) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET pending_battle = NULL,
        cleared = cleared || ${JSON.stringify(clearedAppend)}::jsonb,
        state = COALESCE(${state}::text, state),
        loot = loot || ${JSON.stringify(lootAppend)}::jsonb,
        updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId}
      AND state = 'active' AND pending_battle IS NOT NULL
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
              difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * Guarded UPDATE for abandon(): 'active' -> 'abandoned', same shape as
 * claimMove/claimExit (id + trainer + state='active' is the whole gate).
 * Abandoning with a battle still staged simply discards it — `pending_battle`
 * is left as-is on the now-abandoned row (harmless: an abandoned session is
 * never read by move()/battle()/surrender()/exit() again).
 * @returns the refreshed session row, or null when the claim lost (already
 *   resolved/abandoned by a racing request).
 */
export async function claimAbandon(sql, sessionId, trainerId) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET state = 'abandoned', updated_at = now()
    WHERE id = ${sessionId} AND trainer_id = ${trainerId} AND state = 'active'
    RETURNING id, trainer_id, adventure_id, seed, map, party, position, state, loot, ends_at, pending_battle,
              difficulty, pos_x, pos_y, moves_total, moves_left, visited, cleared`;
  return rows[0] ? shapeSession(rows[0]) : null;
}

/**
 * The lazy-time valve (CLAUDE.md §1.5): any 'active' session whose ends_at
 * has passed is marked 'abandoned'. No compensating releaseParty call here —
 * the party's own busy_until was minted to match ends_at exactly (same
 * lock+timer pairing as activities' claimMonsterForJob/insertActivity), so
 * it has already lapsed on its own by the time this fires; a fresh
 * claimMonsterForJob/claimPartyForAdventure call reads it as free again.
 */
export async function expireStaleSessions(sql, trainerId) {
  const rows = await sql`
    UPDATE adventure_sessions
    SET state = 'abandoned', updated_at = now()
    WHERE trainer_id = ${trainerId} AND state = 'active' AND ends_at <= now()
    RETURNING id`;
  return rows.length;
}

/**
 * Take the busy lock for every monster in the party, atomically, in ONE
 * statement — same claim shape as server/repos/monsters.js
 * claimMonsterForJob, widened to a set of ids. Only ids that are BOTH owned
 * by this trainer AND currently free come back; the service checks it got
 * all of them (fewer means a partial claim that must be released, never
 * left half-locked).
 */
export async function claimPartyForAdventure(sql, trainerId, monsterIds, durationS) {
  const rows = await sql`
    UPDATE monsters
    SET busy_until = now() + make_interval(secs => ${durationS}), busy_kind = 'adventure'
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId}
      AND (busy_until IS NULL OR busy_until <= now())
    RETURNING id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Free the party's busy lock. Guarded on `busy_kind = 'adventure'` so this
 * can never clear a work/training lock it doesn't own — a monster whose lock
 * changed kind since the session snapshot froze (shouldn't happen, since a
 * busy monster can't be claimed for a second job) is simply left alone.
 */
export async function releaseParty(sql, trainerId, monsterIds) {
  await sql`
    UPDATE monsters
    SET busy_until = NULL, busy_kind = NULL
    WHERE id = ANY(${monsterIds}::bigint[]) AND trainer_id = ${trainerId} AND busy_kind = 'adventure'`;
}
